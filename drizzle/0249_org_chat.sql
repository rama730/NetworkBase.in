-- 0249_org_chat.sql
-- Org Messages (docs/organization-concept-report.md §25): an org is one chat workspace; each child project is
-- a channel group inside it, with a default channel named after its handle. Guests aren't auto-added to
-- #general; the org's #general has no 500-member cap; org admins may join child channels (mentions only);
-- people in the same org may always DM; org rules for creating channels and posting in #general; channels
-- follow a project into or out of an org; two new live cards (announcement, assignment).
-- Mirrors src/lib/organizations/chat-rules.ts. Other projects behave exactly as before.

-- The default channel's name: a child project's handle (`#compiler-lab`), otherwise `general`.
CREATE FUNCTION app_private.chat_default_channel_name(p_project_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN p.parent_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.projects o WHERE o.id = p.parent_id AND o.kind = 'organization')
      THEN coalesce(nullif(left(trim(both '-' FROM regexp_replace(lower(coalesce(p.slug, p.title)), '[^a-z0-9-]+', '-', 'g')), 80), ''), 'general')
    ELSE 'general'
  END
  FROM public.projects p WHERE p.id = p_project_id
$$;

--> statement-breakpoint

-- Owners and admins of the org a child project belongs to.
CREATE FUNCTION app_private.chat_is_parent_org_admin(p_project_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.projects c JOIN public.projects o ON o.id = c.parent_id AND o.kind = 'organization' AND o.deleted_at IS NULL
    WHERE c.id = p_project_id AND c.deleted_at IS NULL
      AND (o.owner_id = p_user_id OR EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = o.id AND m.user_id = p_user_id AND m.role = 'admin'))
  )
$$;

--> statement-breakpoint

REVOKE ALL ON FUNCTION app_private.chat_default_channel_name(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.chat_is_parent_org_admin(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.chat_default_channel_name(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.chat_is_parent_org_admin(uuid, uuid) TO authenticated, service_role;

--> statement-breakpoint

-- Same as 0240, plus: the default channel's name comes from chat_default_channel_name, and an org's guests
-- (role viewer) aren't added to #general (admins may add them to specific channels).
CREATE OR REPLACE FUNCTION app_private.chat_sync_project_members(p_project_id uuid, p_user_id uuid, p_op text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_default uuid;
  v_added integer;
  v_is_org boolean;
BEGIN
  IF p_op = 'remove' THEN
    WITH removed AS (
      DELETE FROM public.chat_channel_members m
      USING public.chat_channels c
      WHERE c.id = m.channel_id AND c.project_id = p_project_id AND c.application_id IS NULL AND m.user_id = p_user_id
      RETURNING m.channel_id
    )
    UPDATE public.chat_channels c
    SET member_count = greatest(c.member_count - 1, 0)
    FROM removed WHERE c.id = removed.channel_id;
    PERFORM app_private.chat_reconcile_application_members(p_project_id, p_user_id);
    RETURN NULL;
  END IF;

  IF p_op NOT IN ('ensure_default', 'add', 'role') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_sync_op';
  END IF;

  SELECT kind = 'organization' INTO v_is_org FROM public.projects WHERE id = p_project_id;
  SELECT id INTO v_default FROM public.chat_channels WHERE project_id = p_project_id AND is_default;
  IF NOT FOUND THEN
    INSERT INTO public.chat_channels (kind, name, project_id, is_default, description, created_by)
    SELECT 'public', app_private.chat_default_channel_name(p.id), p.id, true,
           CASE WHEN p.parent_id IS NOT NULL THEN 'Everyone in ' || p.title ELSE 'Everyone in the project' END, p.owner_id
    FROM public.projects p WHERE p.id = p_project_id
    ON CONFLICT (project_id) WHERE is_default DO NOTHING
    RETURNING id INTO v_default;
    IF v_default IS NULL THEN
      SELECT id INTO v_default FROM public.chat_channels WHERE project_id = p_project_id AND is_default;
    END IF;
    IF v_default IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_project_not_found';
    END IF;
  END IF;

  IF p_op = 'role' THEN
    UPDATE public.chat_channel_members m
    SET role = CASE pm.role WHEN 'owner' THEN 'owner' WHEN 'admin' THEN 'admin' ELSE 'member' END
    FROM public.project_members pm
    WHERE m.channel_id = v_default AND m.user_id = p_user_id
      AND pm.project_id = p_project_id AND pm.user_id = p_user_id;
    PERFORM app_private.chat_reconcile_application_members(p_project_id, p_user_id);
    RETURN v_default;
  END IF;

  INSERT INTO public.chat_channel_members (channel_id, user_id, role)
  SELECT v_default, pm.user_id, CASE pm.role WHEN 'owner' THEN 'owner' WHEN 'admin' THEN 'admin' ELSE 'member' END
  FROM public.project_members pm
  WHERE pm.project_id = p_project_id AND (p_user_id IS NULL OR pm.user_id = p_user_id)
    AND NOT (coalesce(v_is_org, false) AND pm.role = 'viewer')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  IF v_added > 0 THEN
    UPDATE public.chat_channels SET member_count = member_count + v_added WHERE id = v_default;
    IF p_user_id IS NOT NULL THEN
      PERFORM app_private.chat_post_member_joined(p_project_id, p_user_id);
    END IF;
  END IF;
  PERFORM app_private.chat_reconcile_application_members(p_project_id, p_user_id);
  RETURN v_default;
END
$$;

--> statement-breakpoint

-- Same as 0202, but an org's #general has no 500-member cap (up to the org's size or Max members).
CREATE OR REPLACE FUNCTION app_private.chat_assert_capacity(p_channel_id uuid, p_users uuid[])
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT member_count FROM public.chat_channels WHERE id = p_channel_id) + cardinality(p_users) > 500
     AND NOT EXISTS (
       SELECT 1 FROM public.chat_channels c JOIN public.projects p ON p.id = c.project_id
       WHERE c.id = p_channel_id AND c.is_default AND p.kind = 'organization'
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_member_limit';
  END IF;
  PERFORM app_private.chat_assert_user_capacity(p_users);
END
$$;

--> statement-breakpoint

-- Same as 0240, plus: org owners and admins may open (join) a child project's public channels, mentions only.
CREATE OR REPLACE FUNCTION app_private.chat_join_channel(p_channel_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_channel record;
  v_added integer;
  v_supervisor boolean := false;
BEGIN
  SELECT kind, project_id, archived_at, name INTO v_channel FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  IF NOT FOUND OR v_channel.kind <> 'public' OR v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_channel_not_joinable';
  END IF;
  IF NOT app_private.chat_is_project_member(v_channel.project_id, p_user_id) THEN
    v_supervisor := app_private.chat_is_parent_org_admin(v_channel.project_id, p_user_id);
    IF NOT v_supervisor THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_project_member';
    END IF;
  END IF;
  PERFORM app_private.chat_assert_capacity(p_channel_id, ARRAY[p_user_id]);
  INSERT INTO public.chat_channel_members (channel_id, user_id, notify)
  VALUES (p_channel_id, p_user_id, CASE WHEN v_supervisor THEN 'mentions' ELSE 'all' END) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  IF v_added > 0 THEN
    UPDATE public.chat_channels SET member_count = member_count + 1 WHERE id = p_channel_id;
    PERFORM app_private.chat_post_system(p_channel_id, p_user_id, 'joined #' || coalesce(v_channel.name, 'general'));
  END IF;
END
$$;

--> statement-breakpoint

-- Same as 0180, plus: owners, admins and members of the same org may always DM each other (guests follow the
-- usual privacy rule). Blocks always win.
CREATE OR REPLACE FUNCTION app_private.chat_can_dm(p_from uuid, p_to uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_from IS NULL OR p_to IS NULL THEN false
    WHEN p_from = p_to THEN true
    WHEN app_private.chat_is_blocked(p_from, p_to) THEN false
    WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_to AND deleted_at IS NULL) THEN false
    WHEN (SELECT coalesce(message_privacy, 'connections') FROM public.profiles WHERE id = p_to) = 'everyone' THEN true
    WHEN EXISTS (
      SELECT 1 FROM public.projects o
      JOIN public.project_members a ON a.project_id = o.id AND a.user_id = p_from AND a.role <> 'viewer'
      JOIN public.project_members b ON b.project_id = o.id AND b.user_id = p_to AND b.role <> 'viewer'
      WHERE o.kind = 'organization' AND o.deleted_at IS NULL
    ) THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.connections c
      WHERE c.status = 'accepted'
        AND ((c.requester_id = p_from AND c.addressee_id = p_to) OR (c.requester_id = p_to AND c.addressee_id = p_from))
    )
  END
$$;

--> statement-breakpoint

-- Same as 0202, plus: in an org whose members may not create channels (Education's default), only owners and
-- admins create org channels. Child projects keep the existing rule (any project member).
CREATE OR REPLACE FUNCTION app_private.chat_create_channel(p_project_id uuid, p_creator uuid, p_name text, p_description text, p_private boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT app_private.chat_is_project_member(p_project_id, p_creator) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_project_member';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id AND p.kind = 'organization' AND p.owner_id <> p_creator
      AND NOT coalesce((p.org_settings->>'membersCreateChannels')::boolean, p.org_type IS DISTINCT FROM 'education')
      AND NOT EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = p.id AND m.user_id = p_creator AND m.role = 'admin')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_org_channels_admins_only';
  END IF;
  IF p_name IS NULL OR p_name !~ '^[a-z0-9-]{1,80}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_channel_name';
  END IF;
  -- Serialize channel creation per project so the 200-channel limit holds under concurrency.
  PERFORM pg_advisory_xact_lock(hashtextextended('chat-project-channels:' || p_project_id::text, 0));
  IF (
    SELECT count(*) FROM public.chat_channels
    WHERE project_id = p_project_id AND application_id IS NULL AND archived_at IS NULL
  ) >= 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_project_channel_limit';
  END IF;
  PERFORM app_private.chat_assert_user_capacity(ARRAY[p_creator]);

  INSERT INTO public.chat_channels (kind, name, description, project_id, created_by, member_count)
  VALUES (CASE WHEN p_private THEN 'private' ELSE 'public' END, p_name, nullif(btrim(coalesce(p_description, '')), ''),
          p_project_id, p_creator, 1)
  RETURNING id INTO v_id;
  INSERT INTO public.chat_channel_members (channel_id, user_id, role) VALUES (v_id, p_creator, 'owner');
  PERFORM app_private.chat_post_system(v_id, p_creator, 'created #' || p_name);
  RETURN v_id;
END
$$;

--> statement-breakpoint

-- "Who can post in #general: Admins only" (report §25.4): people's own messages in an org's #general.
CREATE FUNCTION app_private.chat_org_general_post_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.kind = 'user' AND NEW.author_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_channels c JOIN public.projects p ON p.id = c.project_id
    WHERE c.id = NEW.channel_id AND c.is_default AND p.kind = 'organization'
      AND coalesce((p.org_settings->>'generalAdminsOnly')::boolean, false)
      AND p.owner_id <> NEW.author_id
      AND NOT EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = p.id AND m.user_id = NEW.author_id AND m.role = 'admin')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_general_admins_only';
  END IF;
  RETURN NEW;
END
$$;

--> statement-breakpoint

CREATE TRIGGER chat_messages_org_general_guard
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION app_private.chat_org_general_post_guard();

--> statement-breakpoint

-- A project moved into an org or detached (report §25.2): the default channel takes its new name, and people
-- who are neither project members nor admins of its current org leave its channels (no messages move).
CREATE FUNCTION app_private.chat_reparent_project(p_project_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_default uuid;
  v_old text;
  v_new text;
BEGIN
  SELECT id, name INTO v_default, v_old FROM public.chat_channels WHERE project_id = p_project_id AND is_default;
  v_new := app_private.chat_default_channel_name(p_project_id);
  IF v_default IS NOT NULL AND v_old IS DISTINCT FROM v_new THEN
    UPDATE public.chat_channels SET name = v_new WHERE id = v_default;
    PERFORM app_private.chat_post_system(v_default, NULL, 'renamed the channel to #' || v_new);
  END IF;
  WITH gone AS (
    DELETE FROM public.chat_channel_members m
    USING public.chat_channels c
    WHERE c.id = m.channel_id AND c.project_id = p_project_id AND c.application_id IS NULL
      AND NOT app_private.chat_is_project_member(p_project_id, m.user_id)
      AND NOT app_private.chat_is_parent_org_admin(p_project_id, m.user_id)
    RETURNING m.channel_id
  )
  UPDATE public.chat_channels c SET member_count = greatest(c.member_count - n.k, 0)
  FROM (SELECT channel_id, count(*)::int AS k FROM gone GROUP BY channel_id) n
  WHERE c.id = n.channel_id;
END
$$;

--> statement-breakpoint

REVOKE ALL ON FUNCTION app_private.chat_reparent_project(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.chat_reparent_project(uuid) TO service_role;

--> statement-breakpoint

ALTER TABLE public.chat_message_cards DROP CONSTRAINT chat_message_cards_kind_check;

--> statement-breakpoint

ALTER TABLE public.chat_message_cards
  ADD CONSTRAINT chat_message_cards_kind_check CHECK (kind IN ('application', 'task', 'invite', 'announcement', 'assignment'));

--> statement-breakpoint

-- Same as 0225, plus each project's kind and parent org.
CREATE OR REPLACE FUNCTION app_private.chat_bootstrap(p_user_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH mine AS (
    SELECT c.id, c.kind, c.name, c.title, c.topic, c.project_id, c.application_id, c.is_default, c.last_seq, c.last_top_seq,
           c.last_message_at, c.last_preview, c.last_author_id, c.member_count, c.archived_at AS channel_archived_at,
           m.role, m.last_read_seq, m.mention_count, m.notify, m.starred, m.archived_at, m.joined_at
    FROM public.chat_channel_members m
    JOIN public.chat_channels c ON c.id = m.channel_id
    WHERE m.user_id = p_user_id
      AND (p_since IS NULL OR c.last_message_at > p_since OR m.joined_at > p_since)
      -- A deleted project owns no chat: its channels and its project row stay out of the sidebar.
      AND NOT EXISTS (SELECT 1 FROM public.projects dp WHERE dp.id = c.project_id AND dp.deleted_at IS NOT NULL)
  ), ranked AS (
    SELECT mine.*, row_number() OVER (PARTITION BY (kind = 'dm') ORDER BY last_message_at DESC NULLS LAST) AS rn
    FROM mine
  )
  SELECT jsonb_build_object(
    'server_time', now(),
    'activity_latest_at', (SELECT max(created_at) FROM public.chat_mentions WHERE user_id = p_user_id),
    'inbox_unread', app_private.chat_inbox_unread(p_user_id),
    'channels', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'name', r.name, 'title', r.title, 'topic', r.topic, 'project_id', r.project_id,
        'application_id', r.application_id, 'is_default', r.is_default, 'last_seq', r.last_seq,
        'last_top_seq', r.last_top_seq, 'last_read_seq', r.last_read_seq, 'mention_count', r.mention_count,
        'notify', r.notify, 'starred', r.starred, 'archived_at', r.archived_at,
        'channel_archived_at', r.channel_archived_at, 'last_message_at', r.last_message_at,
        'last_preview', r.last_preview, 'last_author_id', r.last_author_id, 'member_count', r.member_count,
        'role', r.role,
        'dm_user', CASE WHEN r.kind = 'dm' THEN (
          SELECT jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url)
          FROM public.chat_channel_members o JOIN public.profiles p ON p.id = o.user_id
          WHERE o.channel_id = r.id
          ORDER BY (o.user_id = p_user_id) LIMIT 1
        ) END,
        'members_preview', CASE WHEN r.kind = 'private' AND r.name IS NULL THEN (
          SELECT jsonb_agg(jsonb_build_object('id', x.id, 'username', x.username, 'full_name', x.full_name, 'avatar_url', x.avatar_url))
          FROM (
            SELECT p.id, p.username, p.full_name, p.avatar_url
            FROM public.chat_channel_members o JOIN public.profiles p ON p.id = o.user_id
            WHERE o.channel_id = r.id AND o.user_id <> p_user_id
            ORDER BY o.joined_at LIMIT 3
          ) x
        ) END
      ))
      FROM ranked r
      WHERE r.kind <> 'dm' OR r.rn <= 100
    ), '[]'::jsonb),
    -- Org workspaces (0249): each project says its kind and parent org, so the client groups child projects
    -- under their org; org admins also get the child projects whose channels they joined (role 'org_admin').
    'projects', CASE WHEN p_since IS NULL THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'slug', x.slug, 'cover_image', x.cover_image, 'role', x.role,
                                          'kind', x.kind, 'parent_id', x.parent_id, 'parent_title', x.parent_title) ORDER BY x.title)
      FROM (
        SELECT p.id, p.title, p.slug, p.cover_image, pm.role, p.kind, o.id AS parent_id, o.title AS parent_title
        FROM public.project_members pm JOIN public.projects p ON p.id = pm.project_id
        LEFT JOIN public.projects o ON o.id = p.parent_id AND o.kind = 'organization' AND o.deleted_at IS NULL
        WHERE pm.user_id = p_user_id AND p.deleted_at IS NULL
        UNION
        SELECT p.id, p.title, p.slug, p.cover_image, 'org_admin', p.kind, o.id, o.title
        FROM public.chat_channel_members cm JOIN public.chat_channels c ON c.id = cm.channel_id AND c.application_id IS NULL
        JOIN public.projects p ON p.id = c.project_id AND p.deleted_at IS NULL
        JOIN public.projects o ON o.id = p.parent_id AND o.kind = 'organization' AND o.deleted_at IS NULL
        WHERE cm.user_id = p_user_id AND NOT EXISTS (SELECT 1 FROM public.project_members own WHERE own.project_id = p.id AND own.user_id = p_user_id)
      ) x
    ), '[]'::jsonb) END
  )
$function$;
