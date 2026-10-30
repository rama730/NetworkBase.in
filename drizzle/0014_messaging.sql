-- Chat channels, members, messages and their partitions, reactions, attachments, pins, reports, chat functions.
SET LOCAL check_function_bodies = off;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', true);
--> statement-breakpoint
CREATE FUNCTION app_private.chat_add_members(p_channel_id uuid, p_actor uuid, p_users uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_channel record;
  v_new uuid[];
  v_added integer;
BEGIN
  SELECT kind, workspace_id, archived_at, application_id INTO v_channel FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  IF NOT FOUND OR v_channel.kind = 'dm' OR v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_not_found';
  END IF;
  IF v_channel.application_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_application_members_fixed';
  END IF;
  IF NOT app_private.chat_is_member(p_channel_id, p_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
  SELECT coalesce(array_agg(DISTINCT u), '{}') INTO v_new
  FROM unnest(coalesce(p_users, '{}')) AS u
  WHERE u IS NOT NULL AND NOT app_private.chat_is_member(p_channel_id, u);
  IF cardinality(v_new) = 0 THEN
    RETURN 0;
  END IF;
  IF v_channel.workspace_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM unnest(v_new) AS u WHERE NOT app_private.chat_is_workspace_member(v_channel.workspace_id, u)) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_project_member';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM unnest(v_new) AS u WHERE NOT app_private.chat_can_dm(p_actor, u)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_dm_not_allowed';
  END IF;
  PERFORM app_private.chat_assert_capacity(p_channel_id, v_new);

  INSERT INTO public.chat_channel_members (channel_id, user_id)
  SELECT p_channel_id, u FROM unnest(v_new) AS u
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  UPDATE public.chat_channels SET member_count = member_count + v_added WHERE id = p_channel_id;
  IF v_added > 0 THEN
    PERFORM app_private.chat_post_system(
      p_channel_id, p_actor,
      'added ' || (SELECT string_agg('<@' || u || '>', ', ') FROM unnest(v_new) AS u)
    );
  END IF;
  RETURN v_added;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_append_message(p_channel_id uuid, p_author_id uuid, p_kind text, p_body text, p_client_id text, p_thread_root bigint, p_attachments jsonb, p_card jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_seq bigint;
  v_existing bigint;
  v_now timestamptz := now();
  -- A decision line in an application thread is news for the other side: it counts as unread and shows in the preview.
  v_top boolean := p_thread_root IS NULL AND (p_kind = 'user' OR (p_kind = 'system' AND EXISTS (
    SELECT 1 FROM public.chat_channels ac WHERE ac.id = p_channel_id AND ac.application_id IS NOT NULL)));
  v_preview text;
  v_root record;
BEGIN
  PERFORM 1 FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_not_found';
  END IF;

  IF p_client_id IS NOT NULL THEN
    SELECT channel_seq INTO v_existing FROM public.chat_messages
    WHERE channel_id = p_channel_id AND author_id = p_author_id AND client_message_id = p_client_id;
    IF FOUND THEN
      RETURN jsonb_build_object('channel_seq', v_existing, 'deduped', true);
    END IF;
  END IF;

  IF p_thread_root IS NOT NULL THEN
    SELECT thread_root_seq, deleted_at, author_id INTO v_root FROM public.chat_messages
    WHERE channel_id = p_channel_id AND channel_seq = p_thread_root;
    IF NOT FOUND OR v_root.thread_root_seq IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_thread_root';
    END IF;
  END IF;

  v_preview := CASE
    -- A decision line in an application thread names who did it ("Ann declined this application").
    WHEN p_kind = 'system' AND v_top AND btrim(coalesce(p_body, '')) <> '' THEN left(regexp_replace(
      coalesce((SELECT coalesce(pr.full_name, pr.username) || ' ' FROM public.profiles pr WHERE pr.id = p_author_id), '') || btrim(p_body), '\s+', ' ', 'g'), 120)
    WHEN btrim(coalesce(p_body, '')) <> '' THEN left(regexp_replace(btrim(p_body), '\s+', ' ', 'g'), 120)
    WHEN p_card IS NOT NULL THEN CASE p_card->>'kind' WHEN 'application' THEN 'Application' WHEN 'task' THEN 'Task' ELSE 'Invitation' END
    WHEN jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 0 THEN 'Attachment'
    ELSE ''
  END;

  UPDATE public.chat_channels SET
    last_seq = last_seq + 1,
    last_top_seq = CASE WHEN v_top THEN last_seq + 1 ELSE last_top_seq END,
    last_message_at = CASE WHEN v_top THEN v_now ELSE last_message_at END,
    last_preview = CASE WHEN v_top THEN v_preview ELSE last_preview END,
    last_author_id = CASE WHEN v_top THEN p_author_id ELSE last_author_id END
  WHERE id = p_channel_id
  RETURNING last_seq INTO v_seq;

  INSERT INTO public.chat_messages (channel_id, channel_seq, author_id, kind, body, thread_root_seq, client_message_id, created_at)
  VALUES (p_channel_id, v_seq, p_author_id, p_kind, coalesce(p_body, ''), p_thread_root, p_client_id, v_now);

  IF jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.chat_attachments (channel_id, message_seq, idx, asset_id, name, mime, size, width, height)
    SELECT p_channel_id, v_seq, (t.ord - 1)::smallint, (t.a->>'asset_id')::uuid, coalesce(t.a->>'name', ''),
           t.a->>'mime', (t.a->>'size')::bigint, (t.a->>'width')::integer, (t.a->>'height')::integer
    FROM jsonb_array_elements(p_attachments) WITH ORDINALITY AS t(a, ord);
  END IF;

  IF p_card IS NOT NULL THEN
    INSERT INTO public.chat_message_cards (channel_id, message_seq, kind, ref_id, snapshot)
    VALUES (p_channel_id, v_seq, p_card->>'kind', (p_card->>'ref_id')::uuid, coalesce(p_card->'snapshot', '{}'::jsonb));
  END IF;

  IF p_thread_root IS NOT NULL THEN
    UPDATE public.chat_messages
    SET reply_count = reply_count + 1, last_reply_seq = v_seq, last_reply_at = v_now
    WHERE channel_id = p_channel_id AND channel_seq = p_thread_root;

    INSERT INTO public.chat_thread_follows (user_id, channel_id, root_seq, last_read_seq)
    SELECT u, p_channel_id, p_thread_root, CASE WHEN u = p_author_id THEN v_seq ELSE 0 END
    -- DISTINCT: replying in your own thread lists you twice, and one INSERT ... ON CONFLICT
    -- DO UPDATE can't touch the same row twice (it failed the whole send).
    FROM (SELECT DISTINCT u FROM unnest(ARRAY[p_author_id, v_root.author_id]) AS u) AS d
    WHERE u IS NOT NULL
    ON CONFLICT (user_id, channel_id, root_seq) DO UPDATE
      SET last_read_seq = greatest(public.chat_thread_follows.last_read_seq, EXCLUDED.last_read_seq);

    INSERT INTO public.chat_mentions (user_id, channel_id, message_seq, kind)
    SELECT f.user_id, p_channel_id, v_seq, 'thread_reply'
    FROM public.chat_thread_follows f
    WHERE f.channel_id = p_channel_id AND f.root_seq = p_thread_root AND f.user_id IS DISTINCT FROM p_author_id
    ON CONFLICT DO NOTHING;
  ELSIF p_author_id IS NOT NULL THEN
    UPDATE public.chat_channel_members
    SET last_read_seq = greatest(last_read_seq, v_seq)
    WHERE channel_id = p_channel_id AND user_id = p_author_id;
  END IF;

  RETURN jsonb_build_object('channel_seq', v_seq, 'created_at', v_now, 'deduped', false);
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_application_cast(p_project_id uuid, p_user_id uuid) RETURNS TABLE(channel_id uuid, user_id uuid, role text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT DISTINCT ON (c.id, w.user_id) c.id, w.user_id, w.role
  FROM public.chat_channels c
  JOIN public.role_applications a ON a.id = c.application_id
  CROSS JOIN LATERAL (
    SELECT a.applicant_id AS user_id, 'member' AS role, 3 AS rank
    UNION ALL
    SELECT p.owner_id, 'owner', 1 FROM public.workspaces p WHERE p.id = c.workspace_id
    UNION ALL
    SELECT pm.user_id, CASE pm.role WHEN 'owner' THEN 'owner' ELSE 'admin' END, CASE pm.role WHEN 'owner' THEN 1 ELSE 2 END
    FROM public.workspace_members pm WHERE pm.workspace_id = c.workspace_id AND pm.role IN ('owner', 'admin')
  ) w
  WHERE c.workspace_id = p_project_id AND c.application_id IS NOT NULL
    AND (p_user_id IS NULL OR w.user_id = p_user_id)
  ORDER BY c.id, w.user_id, w.rank
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_application_letter_changed() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM app_private.chat_sync_application_letter(NEW.id);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_archive_channel(p_channel_id uuid, p_actor uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.chat_channels WHERE id = p_channel_id AND kind <> 'dm' AND NOT is_default) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_not_archivable';
  END IF;
  IF NOT app_private.chat_is_channel_admin(p_channel_id, p_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_channel_admin';
  END IF;
  UPDATE public.chat_channels SET archived_at = now() WHERE id = p_channel_id AND archived_at IS NULL;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_assert_capacity(p_channel_id uuid, p_users uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF (SELECT member_count FROM public.chat_channels WHERE id = p_channel_id) + cardinality(p_users) > 500
     AND NOT EXISTS (
       SELECT 1 FROM public.chat_channels c JOIN public.workspaces p ON p.id = c.workspace_id
       WHERE c.id = p_channel_id AND c.is_default AND p.kind = 'organization'
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_member_limit';
  END IF;
  PERFORM app_private.chat_assert_user_capacity(p_users);
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_assert_user_capacity(p_users uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  -- Fixed lock order across users prevents deadlocks between concurrent joins.
  PERFORM pg_advisory_xact_lock(hashtextextended('chat-user-capacity:' || u::text, 0))
  FROM (SELECT DISTINCT u FROM unnest(p_users) AS u WHERE u IS NOT NULL ORDER BY u) AS ordered;
  IF EXISTS (
    SELECT 1 FROM public.chat_channel_members m
    WHERE m.user_id = ANY (p_users)
    GROUP BY m.user_id HAVING count(*) >= 500
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_user_channel_limit';
  END IF;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_block_heads_up() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.chat_channels c WHERE c.id = NEW.channel_id AND c.kind = 'private' AND c.workspace_id IS NULL AND c.application_id IS NULL) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.user_notifications (user_id, kind, importance, title, body, href, dedupe_key)
  SELECT b.blocker_id, 'chat_invite', 'important',
         'Someone you blocked is in a group chat with you',
         'Only you can see this. Their messages are folded for you, and you can leave the conversation any time.',
         '/messages/' || NEW.channel_id::text,
         'block-heads-up:' || NEW.channel_id::text || ':' || b.blocked_id::text
  FROM public.chat_channel_members m
  JOIN public.user_blocks b ON (b.blocker_id = m.user_id AND b.blocked_id = NEW.user_id) OR (b.blocker_id = NEW.user_id AND b.blocked_id = m.user_id)
  WHERE m.channel_id = NEW.channel_id AND m.user_id <> NEW.user_id
  ON CONFLICT (user_id, dedupe_key) DO NOTHING;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_bootstrap(p_user_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  WITH mine AS (
    SELECT c.id, c.kind, c.name, c.title, c.topic, c.workspace_id, c.application_id, c.is_default, c.last_seq, c.last_top_seq,
           c.last_message_at, c.last_preview, c.last_author_id, c.member_count, c.archived_at AS channel_archived_at,
           m.role, m.last_read_seq, m.mention_count, m.notify, m.starred, m.archived_at, m.joined_at
    FROM public.chat_channel_members m
    JOIN public.chat_channels c ON c.id = m.channel_id
    WHERE m.user_id = p_user_id
      AND (p_since IS NULL OR c.last_message_at > p_since OR m.joined_at > p_since)
      -- A deleted project owns no chat: its channels and its project row stay out of the sidebar.
      AND NOT EXISTS (SELECT 1 FROM public.workspaces dp WHERE dp.id = c.workspace_id AND dp.deleted_at IS NOT NULL)
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
        'id', r.id, 'kind', r.kind, 'name', r.name, 'title', r.title, 'topic', r.topic, 'project_id', r.workspace_id,
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
        FROM public.workspace_members pm JOIN public.workspaces p ON p.id = pm.workspace_id
        LEFT JOIN public.workspaces o ON o.id = p.parent_id AND o.kind = 'organization' AND o.deleted_at IS NULL
        WHERE pm.user_id = p_user_id AND p.deleted_at IS NULL
        UNION
        SELECT p.id, p.title, p.slug, p.cover_image, 'org_admin', p.kind, o.id, o.title
        FROM public.chat_channel_members cm JOIN public.chat_channels c ON c.id = cm.channel_id AND c.application_id IS NULL
        JOIN public.workspaces p ON p.id = c.workspace_id AND p.deleted_at IS NULL
        JOIN public.workspaces o ON o.id = p.parent_id AND o.kind = 'organization' AND o.deleted_at IS NULL
        WHERE cm.user_id = p_user_id AND NOT EXISTS (SELECT 1 FROM public.workspace_members own WHERE own.workspace_id = p.id AND own.user_id = p_user_id)
      ) x
    ), '[]'::jsonb) END
  )
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_can_dm(p_from uuid, p_to uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT CASE
    WHEN p_from IS NULL OR p_to IS NULL THEN false
    WHEN p_from = p_to THEN true
    WHEN app_private.chat_is_blocked(p_from, p_to) THEN false
    WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_to AND deleted_at IS NULL) THEN false
    WHEN (SELECT coalesce(message_privacy, 'connections') FROM public.profiles WHERE id = p_to) = 'everyone' THEN true
    WHEN EXISTS (
      SELECT 1 FROM public.workspaces o
      JOIN public.workspace_members a ON a.workspace_id = o.id AND a.user_id = p_from AND a.role <> 'viewer'
      JOIN public.workspace_members b ON b.workspace_id = o.id AND b.user_id = p_to AND b.role <> 'viewer'
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
CREATE FUNCTION app_private.chat_can_signal(p_channel uuid, p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT app_private.chat_is_member(p_channel, p_user) AND NOT app_private.chat_contact_cut(p_channel, p_user)
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_card_changed() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_card record;
BEGIN
  FOR v_card IN
    SELECT channel_id, message_seq FROM public.chat_message_cards
    WHERE kind = TG_ARGV[0] AND ref_id = NEW.id
  LOOP
    PERFORM realtime.send(
      jsonb_build_object('kind', TG_ARGV[0], 'ref_id', NEW.id, 'seq', v_card.message_seq),
      'card.changed',
      'chat:channel:' || v_card.channel_id,
      true
    );
  END LOOP;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_contact_cut(p_channel uuid, p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_channels c
    JOIN public.chat_channel_members m ON m.channel_id = c.id AND m.user_id <> p_user
    WHERE c.id = p_channel
      AND (c.kind = 'dm' OR (c.workspace_id IS NULL AND c.application_id IS NULL AND (SELECT count(*) FROM public.chat_channel_members a WHERE a.channel_id = c.id) = 2))
      AND app_private.blocked_between(p_user, m.user_id)
  )
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_create_channel(p_project_id uuid, p_creator uuid, p_name text, p_description text, p_private boolean) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_id uuid;
BEGIN
  IF NOT app_private.chat_is_workspace_member(p_project_id, p_creator) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_project_member';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.workspaces p
    WHERE p.id = p_project_id AND p.kind = 'organization' AND p.owner_id <> p_creator
      AND NOT coalesce((p.org_settings->>'membersCreateChannels')::boolean, p.org_type IS DISTINCT FROM 'education')
      AND NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = p.id AND m.user_id = p_creator AND m.role = 'admin')
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
    WHERE workspace_id = p_project_id AND application_id IS NULL AND archived_at IS NULL
  ) >= 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_project_channel_limit';
  END IF;
  PERFORM app_private.chat_assert_user_capacity(ARRAY[p_creator]);

  INSERT INTO public.chat_channels (kind, name, description, workspace_id, created_by, member_count)
  VALUES (CASE WHEN p_private THEN 'private' ELSE 'public' END, p_name, nullif(btrim(coalesce(p_description, '')), ''),
          p_project_id, p_creator, 1)
  RETURNING id INTO v_id;
  INSERT INTO public.chat_channel_members (channel_id, user_id, role) VALUES (v_id, p_creator, 'owner');
  PERFORM app_private.chat_post_system(v_id, p_creator, 'created #' || p_name);
  RETURN v_id;
END
$_$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_create_group(p_creator uuid, p_members uuid[]) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_others uuid[];
  v_id uuid;
BEGIN
  SELECT coalesce(array_agg(DISTINCT u), '{}') INTO v_others
  FROM unnest(coalesce(p_members, '{}')) AS u WHERE u IS NOT NULL AND u <> p_creator;
  IF cardinality(v_others) < 1 OR cardinality(v_others) > 8 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_group_size';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_others) AS u WHERE NOT app_private.chat_can_dm(p_creator, u)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_dm_not_allowed';
  END IF;
  PERFORM app_private.chat_assert_user_capacity(array_append(v_others, p_creator));

  INSERT INTO public.chat_channels (kind, created_by, member_count)
  VALUES ('private', p_creator, cardinality(v_others) + 1)
  RETURNING id INTO v_id;
  INSERT INTO public.chat_channel_members (channel_id, user_id, role)
  SELECT v_id, p_creator, 'owner'
  UNION ALL
  SELECT v_id, u, 'member' FROM unnest(v_others) AS u;
  RETURN v_id;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_default_channel_name(p_project_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT CASE
    WHEN p.parent_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.workspaces o WHERE o.id = p.parent_id AND o.kind = 'organization')
      THEN coalesce(nullif(left(trim(both '-' FROM regexp_replace(lower(coalesce(p.slug, p.title)), '[^a-z0-9-]+', '-', 'g')), 80), ''), 'general')
    ELSE 'general'
  END
  FROM public.workspaces p WHERE p.id = p_project_id
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_delete_message(p_channel_id uuid, p_seq bigint, p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_author uuid;
BEGIN
  SELECT author_id INTO v_author FROM public.chat_messages
  WHERE channel_id = p_channel_id AND channel_seq = p_seq AND kind = 'user' AND deleted_at IS NULL;
  IF NOT FOUND OR NOT (
    (v_author = p_user_id AND app_private.chat_is_member(p_channel_id, p_user_id))
    OR app_private.chat_is_channel_admin(p_channel_id, p_user_id)
  ) OR EXISTS (
    SELECT 1 FROM public.chat_message_cards k WHERE k.channel_id = p_channel_id AND k.message_seq = p_seq AND k.kind = 'application'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_deletable';
  END IF;
  UPDATE public.chat_messages SET body = '', deleted_at = now()
  WHERE channel_id = p_channel_id AND channel_seq = p_seq;
  DELETE FROM public.chat_attachments WHERE channel_id = p_channel_id AND message_seq = p_seq;
  DELETE FROM public.chat_message_cards WHERE channel_id = p_channel_id AND message_seq = p_seq;
  DELETE FROM public.chat_pins WHERE channel_id = p_channel_id AND message_seq = p_seq;
  UPDATE public.chat_channels SET last_preview = 'Message deleted'
  WHERE id = p_channel_id AND last_top_seq = p_seq;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_edit_message(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_body text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF p_body IS NULL OR char_length(p_body) > 4000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_body';
  END IF;
  IF btrim(p_body) = ''
    AND NOT EXISTS (SELECT 1 FROM public.chat_attachments a WHERE a.channel_id = p_channel_id AND a.message_seq = p_seq)
    AND NOT EXISTS (SELECT 1 FROM public.chat_message_cards k WHERE k.channel_id = p_channel_id AND k.message_seq = p_seq) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_body';
  END IF;
  -- The application card message is the application's record: its text changes only through the application itself.
  IF EXISTS (SELECT 1 FROM public.chat_message_cards k WHERE k.channel_id = p_channel_id AND k.message_seq = p_seq AND k.kind = 'application') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_editable';
  END IF;
  -- Only a current member may edit their own message, and not in an archived channel.
  UPDATE public.chat_messages SET body = p_body, edited_at = now()
  WHERE channel_id = p_channel_id AND channel_seq = p_seq AND author_id = p_user_id
    AND kind = 'user' AND deleted_at IS NULL
    AND app_private.chat_is_member(p_channel_id, p_user_id)
    AND EXISTS (SELECT 1 FROM public.chat_channels c WHERE c.id = p_channel_id AND c.archived_at IS NULL);
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_editable';
  END IF;
  UPDATE public.chat_channels
  SET last_preview = CASE WHEN btrim(p_body) = '' THEN 'Attachment' ELSE left(regexp_replace(btrim(p_body), '\s+', ' ', 'g'), 120) END
  WHERE id = p_channel_id AND last_top_seq = p_seq;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_edit_message(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_body text, p_mentions uuid[]) RETURNS uuid[]
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_added uuid[];
  v_removed uuid[];
BEGIN
  PERFORM app_private.chat_edit_message(p_channel_id, p_seq, p_user_id, p_body);

  WITH gone AS (
    DELETE FROM public.chat_mentions
    WHERE channel_id = p_channel_id AND message_seq = p_seq AND kind = 'user'
      AND NOT (user_id = ANY (coalesce(p_mentions, '{}')))
    RETURNING user_id, read_at
  )
  SELECT coalesce(array_agg(user_id) FILTER (WHERE read_at IS NULL), '{}') INTO v_removed FROM gone;
  UPDATE public.chat_channel_members
  SET mention_count = greatest(mention_count - 1, 0)
  WHERE channel_id = p_channel_id AND user_id = ANY (v_removed) AND last_read_seq < p_seq;

  WITH added AS (
    INSERT INTO public.chat_mentions (user_id, channel_id, message_seq, kind)
    SELECT m.user_id, p_channel_id, p_seq, 'user'
    FROM public.chat_channel_members m
    WHERE m.channel_id = p_channel_id AND m.user_id = ANY (coalesce(p_mentions, '{}')) AND m.user_id <> p_user_id
    -- A thread follower's reply row becomes a mention when an edit adds them (#1).
    ON CONFLICT (user_id, channel_id, message_seq) DO UPDATE SET kind = 'user', read_at = NULL
      WHERE public.chat_mentions.kind = 'thread_reply'
    RETURNING user_id
  )
  SELECT coalesce(array_agg(user_id), '{}') INTO v_added FROM added;
  UPDATE public.chat_channel_members
  SET mention_count = mention_count + 1
  WHERE channel_id = p_channel_id AND user_id = ANY (v_added) AND last_read_seq < p_seq;

  RETURN v_added;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_ensure_application_channel(p_application_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_app record;
  v_id uuid;
  v_added integer;
  v_seq bigint;
  v_card jsonb;
BEGIN
  SELECT a.id, a.workspace_id, a.applicant_id, a.message INTO v_app
  FROM public.role_applications a WHERE a.id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_application_not_found';
  END IF;
  v_card := jsonb_build_object('kind', 'application', 'ref_id', p_application_id);

  SELECT id INTO v_id FROM public.chat_channels WHERE application_id = p_application_id;
  IF FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.chat_message_cards k WHERE k.channel_id = v_id AND k.kind = 'application' AND k.ref_id = p_application_id) THEN
      SELECT channel_seq INTO v_seq FROM public.chat_messages
      WHERE channel_id = v_id AND client_message_id = 'application:' || p_application_id AND deleted_at IS NULL;
      IF FOUND THEN
        INSERT INTO public.chat_message_cards (channel_id, message_seq, kind, ref_id)
        VALUES (v_id, v_seq, 'application', p_application_id);
      ELSE
        PERFORM app_private.chat_append_message(
          v_id, v_app.applicant_id, 'user', left(coalesce(v_app.message, ''), 4000), 'application-card:' || p_application_id,
          NULL, '[]'::jsonb, v_card
        );
      END IF;
    END IF;
    RETURN v_id;
  END IF;

  INSERT INTO public.chat_channels (kind, workspace_id, application_id, created_by)
  VALUES ('private', v_app.workspace_id, p_application_id, v_app.applicant_id)
  ON CONFLICT (application_id) WHERE application_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.chat_channels WHERE application_id = p_application_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.chat_channel_members (channel_id, user_id, role)
  SELECT v_id, v_app.applicant_id, 'member'
  UNION
  SELECT v_id, p.owner_id, 'owner' FROM public.workspaces p WHERE p.id = v_app.workspace_id
  UNION
  SELECT v_id, pm.user_id, CASE pm.role WHEN 'owner' THEN 'owner' ELSE 'admin' END
  FROM public.workspace_members pm
  WHERE pm.workspace_id = v_app.workspace_id AND pm.role IN ('owner', 'admin')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  UPDATE public.chat_channels SET member_count = v_added WHERE id = v_id;

  PERFORM app_private.chat_append_message(
    v_id, v_app.applicant_id, 'user', left(coalesce(v_app.message, ''), 4000), 'application:' || p_application_id,
    NULL, '[]'::jsonb, v_card
  );
  RETURN v_id;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_get_or_create_dm(p_from uuid, p_to uuid, p_reason text DEFAULT 'user'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_key text;
  v_id uuid;
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_dm_requires_two_users';
  END IF;
  IF app_private.chat_is_blocked(p_from, p_to) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_blocked';
  END IF;
  v_key := least(p_from::text, p_to::text) || ':' || greatest(p_from::text, p_to::text);

  SELECT id INTO v_id FROM public.chat_channels WHERE dm_key = v_key;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  -- Invites and applications may open a DM regardless of message_privacy;
  -- ordinary DMs follow it.
  IF p_reason NOT IN ('invite', 'application') AND NOT app_private.chat_can_dm(p_from, p_to) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_dm_not_allowed';
  END IF;

  INSERT INTO public.chat_channels (kind, dm_key, created_by, member_count)
  VALUES ('dm', v_key, p_from, CASE WHEN p_from = p_to THEN 1 ELSE 2 END)
  ON CONFLICT (dm_key) WHERE dm_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.chat_channels WHERE dm_key = v_key;
    RETURN v_id;
  END IF;

  INSERT INTO public.chat_channel_members (channel_id, user_id, role)
  SELECT DISTINCT v_id, u, 'member' FROM unnest(ARRAY[p_from, p_to]) AS u;
  RETURN v_id;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_inbox_unread(p_user_id uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT count(*)::int
  FROM public.chat_mentions mn
  JOIN public.chat_channel_members mem ON mem.channel_id = mn.channel_id AND mem.user_id = mn.user_id
  JOIN public.chat_messages msg ON msg.channel_id = mn.channel_id AND msg.channel_seq = mn.message_seq
  WHERE mn.user_id = p_user_id AND mn.read_at IS NULL AND msg.deleted_at IS NULL
    AND (mn.kind <> 'thread_reply' OR mem.notify <> 'mute')
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_is_blocked(p_a uuid, p_b uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT app_private.blocked_between(p_a, p_b)
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_is_channel_admin(p_channel_id uuid, p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_channel_members m
    WHERE m.channel_id = p_channel_id AND m.user_id = p_user_id AND m.role IN ('owner', 'admin')
  ) OR EXISTS (
    SELECT 1 FROM public.chat_channels c
    JOIN public.workspace_members pm ON pm.workspace_id = c.workspace_id
    WHERE c.id = p_channel_id AND pm.user_id = p_user_id AND pm.role IN ('owner', 'admin')
  )
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_is_member(p_channel_id uuid, p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_channel_members m
    WHERE m.channel_id = p_channel_id AND m.user_id = p_user_id
  )
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_is_parent_org_admin(p_project_id uuid, p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workspaces c JOIN public.workspaces o ON o.id = c.parent_id AND o.kind = 'organization' AND o.deleted_at IS NULL
    WHERE c.id = p_project_id AND c.deleted_at IS NULL
      AND (o.owner_id = p_user_id OR EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = o.id AND m.user_id = p_user_id AND m.role = 'admin'))
  )
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_is_workspace_member(p_project_id uuid, p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.workspace_members pm
    JOIN public.workspaces p ON p.id = pm.workspace_id AND p.deleted_at IS NULL
    WHERE pm.workspace_id = p_project_id AND pm.user_id = p_user_id
  )
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_join_channel(p_channel_id uuid, p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_channel record;
  v_added integer;
  v_supervisor boolean := false;
BEGIN
  SELECT kind, workspace_id, archived_at, name INTO v_channel FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  IF NOT FOUND OR v_channel.kind <> 'public' OR v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_channel_not_joinable';
  END IF;
  IF NOT app_private.chat_is_workspace_member(v_channel.workspace_id, p_user_id) THEN
    v_supervisor := app_private.chat_is_parent_org_admin(v_channel.workspace_id, p_user_id);
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
CREATE FUNCTION app_private.chat_leave_channel(p_channel_id uuid, p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_removed integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.chat_channels WHERE id = p_channel_id AND kind <> 'dm' AND NOT is_default) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_channel_not_leavable';
  END IF;
  DELETE FROM public.chat_channel_members WHERE channel_id = p_channel_id AND user_id = p_user_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  IF v_removed > 0 THEN
    UPDATE public.chat_channels SET member_count = greatest(member_count - 1, 0) WHERE id = p_channel_id;
    PERFORM app_private.chat_post_system(p_channel_id, p_user_id, 'left');
  END IF;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_mark_read(p_channel_id uuid, p_user_id uuid, p_seq bigint) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_moved boolean;
BEGIN
  UPDATE public.chat_channel_members m
  SET last_read_seq = p_seq
  FROM public.chat_channels c
  WHERE m.channel_id = p_channel_id AND m.user_id = p_user_id
    AND c.id = m.channel_id AND p_seq <= c.last_seq AND m.last_read_seq < p_seq;
  v_moved := FOUND;
  IF v_moved THEN
    UPDATE public.chat_mentions mn SET read_at = now()
    FROM public.chat_messages msg
    WHERE mn.user_id = p_user_id AND mn.channel_id = p_channel_id AND mn.message_seq <= p_seq AND mn.read_at IS NULL
      AND msg.channel_id = mn.channel_id AND msg.channel_seq = mn.message_seq AND msg.thread_root_seq IS NULL;
    -- Same definition as chat_mark_unread: unread mentions the read did not reach.
    UPDATE public.chat_channel_members m
    SET mention_count = (
      SELECT count(*)::int FROM public.chat_mentions mn
      WHERE mn.user_id = p_user_id AND mn.channel_id = p_channel_id
        AND mn.message_seq > p_seq AND mn.kind <> 'thread_reply' AND mn.read_at IS NULL
    )
    WHERE m.channel_id = p_channel_id AND m.user_id = p_user_id;
  END IF;
  RETURN v_moved;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_mark_thread_read(p_channel_id uuid, p_user_id uuid, p_root bigint, p_seq bigint) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_moved boolean;
BEGIN
  UPDATE public.chat_thread_follows
  SET last_read_seq = p_seq
  WHERE user_id = p_user_id AND channel_id = p_channel_id AND root_seq = p_root AND last_read_seq < p_seq;
  v_moved := FOUND;
  -- Also for non-followers who were mentioned in the thread.
  UPDATE public.chat_mentions mn SET read_at = now()
  FROM public.chat_messages msg
  WHERE mn.user_id = p_user_id AND mn.channel_id = p_channel_id AND mn.message_seq <= p_seq AND mn.read_at IS NULL
    AND msg.channel_id = mn.channel_id AND msg.channel_seq = mn.message_seq AND msg.thread_root_seq = p_root;
  IF FOUND THEN
    UPDATE public.chat_channel_members m SET mention_count = (
      SELECT count(*)::int FROM public.chat_mentions mn
      WHERE mn.user_id = m.user_id AND mn.channel_id = m.channel_id AND mn.read_at IS NULL
        AND mn.kind <> 'thread_reply' AND mn.message_seq > m.last_read_seq
    )
    WHERE m.channel_id = p_channel_id AND m.user_id = p_user_id AND m.mention_count > 0;
  END IF;
  RETURN v_moved;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_mark_unread(p_channel_id uuid, p_user_id uuid, p_seq bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT app_private.chat_is_member(p_channel_id, p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
  UPDATE public.chat_mentions SET read_at = NULL
  WHERE user_id = p_user_id AND channel_id = p_channel_id AND message_seq >= p_seq;
  UPDATE public.chat_channel_members m
  SET last_read_seq = greatest(p_seq - 1, 0),
      mention_count = (
        SELECT count(*)::int FROM public.chat_mentions mn
        WHERE mn.user_id = p_user_id AND mn.channel_id = p_channel_id AND mn.message_seq >= p_seq AND mn.kind <> 'thread_reply'
      )
  WHERE m.channel_id = p_channel_id AND m.user_id = p_user_id;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_org_general_post_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.kind = 'user' AND NEW.author_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_channels c JOIN public.workspaces p ON p.id = c.workspace_id
    WHERE c.id = NEW.channel_id AND c.is_default AND p.kind = 'organization'
      AND coalesce((p.org_settings->>'generalAdminsOnly')::boolean, false)
      AND p.owner_id <> NEW.author_id
      AND NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = p.id AND m.user_id = NEW.author_id AND m.role = 'admin')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_general_admins_only';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_org_read_only_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.kind = 'user' AND EXISTS (
    SELECT 1 FROM public.chat_channels c
    JOIN public.workspaces p ON p.id = c.workspace_id
    LEFT JOIN public.workspaces o ON o.id = p.parent_id AND o.kind = 'organization'
    WHERE c.id = NEW.channel_id AND (
      p.suspended_at IS NOT NULL OR p.deletion_scheduled_at IS NOT NULL
      OR (p.kind = 'organization' AND p.status = 'archived')
      OR o.suspended_at IS NOT NULL
      OR (o.status = 'archived' AND p.status = 'archived')
      OR (o.id IS NOT NULL AND p.status = 'archived')
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_org_read_only';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_pin(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_on boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT app_private.chat_is_member(p_channel_id, p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_allowed_to_pin';
  END IF;
  IF p_on THEN
    INSERT INTO public.chat_pins (channel_id, message_seq, pinned_by)
    SELECT p_channel_id, p_seq, p_user_id
    WHERE EXISTS (SELECT 1 FROM public.chat_messages WHERE channel_id = p_channel_id AND channel_seq = p_seq AND deleted_at IS NULL)
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.chat_pins WHERE channel_id = p_channel_id AND message_seq = p_seq;
  END IF;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_post_application_update(p_application_id uuid, p_actor uuid, p_body text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.chat_channels WHERE application_id = p_application_id;
  IF v_id IS NULL THEN
    v_id := app_private.chat_ensure_application_channel(p_application_id);
  END IF;
  PERFORM app_private.chat_post_system(v_id, p_actor, left(p_body, 4000));
  UPDATE public.chat_channel_members SET archived_at = NULL
  WHERE channel_id = v_id AND user_id <> p_actor AND archived_at IS NOT NULL;
  RETURN v_id;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_post_member_joined(p_project_id uuid, p_user_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_default uuid;
  v_channel_name text;
  v_already_joined boolean;
BEGIN
  -- 1. Locate default channel for this project
  SELECT id, coalesce(name, 'general') INTO v_default, v_channel_name
  FROM public.chat_channels
  WHERE workspace_id = p_project_id AND is_default;

  IF v_default IS NULL THEN
    RETURN NULL;
  END IF;

  -- 2. Prevent duplicate join notice if already announced in this project's default channel
  SELECT EXISTS (
    SELECT 1 FROM public.chat_messages
    WHERE channel_id = v_default AND author_id = p_user_id AND kind = 'system'
      AND body LIKE 'joined #%' AND deleted_at IS NULL
  ) INTO v_already_joined;

  IF v_already_joined THEN
    RETURN v_default;
  END IF;

  -- 3. Post lean Slack-style join system notice
  PERFORM app_private.chat_post_system(v_default, p_user_id, 'joined #' || v_channel_name);

  RETURN v_default;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_post_system(p_channel_id uuid, p_actor_id uuid, p_body text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT app_private.chat_append_message(p_channel_id, p_actor_id, 'system', p_body, NULL, NULL, '[]'::jsonb, NULL);
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_react(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_emoji text, p_on boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT app_private.chat_is_member(p_channel_id, p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
  IF p_on THEN
    IF NOT EXISTS (SELECT 1 FROM public.chat_messages WHERE channel_id = p_channel_id AND channel_seq = p_seq AND deleted_at IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_message_not_found';
    END IF;
    INSERT INTO public.chat_reactions (channel_id, message_seq, user_id, emoji)
    VALUES (p_channel_id, p_seq, p_user_id, p_emoji) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.chat_reactions
    WHERE channel_id = p_channel_id AND message_seq = p_seq AND user_id = p_user_id AND emoji = p_emoji;
  END IF;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_reconcile_application_members(p_project_id uuid, p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  DELETE FROM public.chat_channel_members m
  USING public.chat_channels c
  WHERE c.id = m.channel_id AND c.workspace_id = p_project_id AND c.application_id IS NOT NULL
    AND (p_user_id IS NULL OR m.user_id = p_user_id)
    AND NOT EXISTS (
      SELECT 1 FROM app_private.chat_application_cast(p_project_id, p_user_id) k
      WHERE k.channel_id = m.channel_id AND k.user_id = m.user_id
    );

  INSERT INTO public.chat_channel_members (channel_id, user_id, role)
  SELECT k.channel_id, k.user_id, k.role FROM app_private.chat_application_cast(p_project_id, p_user_id) k
  ON CONFLICT (channel_id, user_id) DO UPDATE SET role = EXCLUDED.role
  WHERE public.chat_channel_members.role IS DISTINCT FROM EXCLUDED.role;

  UPDATE public.chat_channels c
  SET member_count = counted.n
  FROM (
    SELECT ch.id, (SELECT count(*)::int FROM public.chat_channel_members m WHERE m.channel_id = ch.id) AS n
    FROM public.chat_channels ch WHERE ch.workspace_id = p_project_id AND ch.application_id IS NOT NULL
  ) counted
  WHERE c.id = counted.id AND c.member_count IS DISTINCT FROM counted.n;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_remove_member(p_channel_id uuid, p_actor uuid, p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_removed integer;
  v_application uuid;
BEGIN
  SELECT application_id INTO v_application FROM public.chat_channels WHERE id = p_channel_id AND kind <> 'dm' AND NOT is_default;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_not_found';
  END IF;
  IF v_application IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_application_members_fixed';
  END IF;
  IF NOT app_private.chat_is_channel_admin(p_channel_id, p_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_channel_admin';
  END IF;
  DELETE FROM public.chat_channel_members WHERE channel_id = p_channel_id AND user_id = p_user_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  IF v_removed > 0 THEN
    UPDATE public.chat_channels SET member_count = greatest(member_count - 1, 0) WHERE id = p_channel_id;
    PERFORM app_private.chat_post_system(p_channel_id, p_actor, 'removed <@' || p_user_id || '>');
  END IF;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_rename_group(p_channel_id uuid, p_actor uuid, p_title text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_channels
    WHERE id = p_channel_id AND kind = 'private' AND name IS NULL AND workspace_id IS NULL AND application_id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_not_found';
  END IF;
  IF NOT app_private.chat_is_member(p_channel_id, p_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
  IF v_title IS NOT NULL AND char_length(v_title) > 80 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_input';
  END IF;
  UPDATE public.chat_channels SET title = v_title WHERE id = p_channel_id AND title IS DISTINCT FROM v_title;
  IF FOUND THEN
    PERFORM app_private.chat_post_system(p_channel_id, p_actor,
      CASE WHEN v_title IS NULL THEN 'removed the group name' ELSE 'named the group ' || v_title END);
  END IF;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_reparent_workspace(p_project_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_default uuid;
  v_old text;
  v_new text;
BEGIN
  SELECT id, name INTO v_default, v_old FROM public.chat_channels WHERE workspace_id = p_project_id AND is_default;
  v_new := app_private.chat_default_channel_name(p_project_id);
  IF v_default IS NOT NULL AND v_old IS DISTINCT FROM v_new THEN
    UPDATE public.chat_channels SET name = v_new WHERE id = v_default;
    PERFORM app_private.chat_post_system(v_default, NULL, 'renamed the channel to #' || v_new);
  END IF;
  WITH gone AS (
    DELETE FROM public.chat_channel_members m
    USING public.chat_channels c
    WHERE c.id = m.channel_id AND c.workspace_id = p_project_id AND c.application_id IS NULL
      AND NOT app_private.chat_is_workspace_member(p_project_id, m.user_id)
      AND NOT app_private.chat_is_parent_org_admin(p_project_id, m.user_id)
    RETURNING m.channel_id
  )
  UPDATE public.chat_channels c SET member_count = greatest(c.member_count - n.k, 0)
  FROM (SELECT channel_id, count(*)::int AS k FROM gone GROUP BY channel_id) n
  WHERE c.id = n.channel_id;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_report(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT app_private.chat_is_member(p_channel_id, p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
  INSERT INTO public.chat_reports (channel_id, message_seq, reporter_id, reason)
  VALUES (p_channel_id, p_seq, p_user_id, p_reason)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_save_canvas(p_channel_id uuid, p_user_id uuid, p_title text, p_body text, p_asset_ids uuid[], p_base_version integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_existing uuid[];
  v_assets uuid[];
  v_version integer;
BEGIN
  IF NOT app_private.chat_is_member(p_channel_id, p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
  SELECT asset_ids INTO v_existing FROM public.chat_canvases WHERE channel_id = p_channel_id FOR UPDATE;
  -- Only the saver's own verified uploads, or images already in this canvas.
  SELECT coalesce(array_agg(DISTINCT a.id), '{}') INTO v_assets
  FROM public.storage_assets a
  WHERE a.id = ANY(coalesce(p_asset_ids, '{}'))
    AND a.bucket = 'chat-attachments' AND a.state = 'verified'
    AND (a.owner_user_id = p_user_id OR a.id = ANY(coalesce(v_existing, '{}')));

  INSERT INTO public.chat_canvases AS c (channel_id, title, body, asset_ids, version, updated_by, updated_at)
  VALUES (p_channel_id, coalesce(p_title, ''), coalesce(p_body, ''), v_assets, 1, p_user_id, now())
  ON CONFLICT (channel_id) DO UPDATE
    SET title = excluded.title, body = excluded.body, asset_ids = excluded.asset_ids,
        version = c.version + 1, updated_by = excluded.updated_by, updated_at = now()
    WHERE c.version = p_base_version
  RETURNING version INTO v_version;

  IF v_version IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_canvas_conflict';
  END IF;
  RETURN v_version;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_send_message(p_channel_id uuid, p_author_id uuid, p_body text, p_client_id text DEFAULT NULL::text, p_thread_root bigint DEFAULT NULL::bigint, p_mentions uuid[] DEFAULT '{}'::uuid[], p_broadcast text DEFAULT NULL::text, p_attachments jsonb DEFAULT '[]'::jsonb, p_card jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_channel record;
  v_other uuid;
  v_result jsonb;
  v_seq bigint;
  v_direct boolean;
  v_mentioned uuid[] := '{}';
  v_notify uuid[] := '{}';
  v_muted uuid[] := '{}';
  v_follows uuid[] := '{}';
BEGIN
  p_body := coalesce(p_body, '');
  p_attachments := coalesce(p_attachments, '[]'::jsonb);
  IF char_length(p_body) > 4000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_body_too_long';
  END IF;
  IF btrim(p_body) = '' AND jsonb_array_length(p_attachments) = 0 AND p_card IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_empty_message';
  END IF;
  IF jsonb_array_length(p_attachments) > 10 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_too_many_attachments';
  END IF;
  IF p_broadcast IS NOT NULL AND p_broadcast NOT IN ('channel', 'here') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_broadcast';
  END IF;

  SELECT id, kind, name, workspace_id, archived_at, member_count, application_id INTO v_channel FROM public.chat_channels WHERE id = p_channel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_not_found';
  END IF;
  IF NOT app_private.chat_is_member(p_channel_id, p_author_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_channel_archived';
  END IF;
  -- An application thread is a shared room: nobody posts into it while blocked with someone else in it.
  IF v_channel.application_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_channel_members bm
    WHERE bm.channel_id = p_channel_id AND bm.user_id <> p_author_id AND app_private.chat_is_blocked(p_author_id, bm.user_id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_blocked';
  END IF;
  IF v_channel.kind = 'dm' THEN
    SELECT user_id INTO v_other FROM public.chat_channel_members
    WHERE channel_id = p_channel_id AND user_id <> p_author_id LIMIT 1;
    IF v_other IS NOT NULL AND app_private.chat_is_blocked(p_author_id, v_other) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_blocked';
    END IF;
  END IF;
  IF p_broadcast IS NOT NULL AND v_channel.member_count > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_broadcast_mention_too_large';
  END IF;

  v_result := app_private.chat_append_message(p_channel_id, p_author_id, 'user', p_body, p_client_id, p_thread_root, p_attachments, p_card);
  IF (v_result->>'deduped')::boolean THEN
    RETURN v_result;
  END IF;
  v_seq := (v_result->>'channel_seq')::bigint;

  IF p_broadcast IS NOT NULL OR cardinality(coalesce(p_mentions, '{}')) > 0 THEN
    SELECT coalesce(array_agg(m.user_id), '{}') INTO v_mentioned
    FROM public.chat_channel_members m
    WHERE m.channel_id = p_channel_id
      AND m.user_id <> p_author_id
      -- Mentions, @channel and @here never reach someone in a block with the author: no row, no badge (B33, K31).
      AND NOT app_private.blocked_between(m.user_id, p_author_id)
      AND (p_broadcast IS NOT NULL OR m.user_id = ANY (p_mentions));
    -- A follower mentioned in a thread reply already got a 'thread_reply' row from
    -- chat_append_message: the mention wins, so it files under Mentions (#1).
    INSERT INTO public.chat_mentions (user_id, channel_id, message_seq, kind)
    SELECT u, p_channel_id, v_seq, coalesce(p_broadcast, 'user') FROM unnest(v_mentioned) AS u
    ON CONFLICT (user_id, channel_id, message_seq) DO UPDATE SET kind = EXCLUDED.kind
      WHERE public.chat_mentions.kind = 'thread_reply';
    UPDATE public.chat_channel_members
    SET mention_count = mention_count + 1, archived_at = NULL
    WHERE channel_id = p_channel_id AND user_id = ANY (v_mentioned);
  END IF;

  -- A new DM or group-chat message brings the conversation back for everyone.
  IF v_channel.kind = 'dm' OR v_channel.kind = 'private' THEN
    UPDATE public.chat_channel_members
    SET archived_at = NULL
    WHERE channel_id = p_channel_id AND user_id <> p_author_id AND archived_at IS NOT NULL;
  END IF;

  -- Who gets a live hint: DM and group-chat members (notify = all), mentioned
  -- members and thread followers. Muted members get a hint only when mentioned
  -- (their badge counts it, #9) and never a push (`muted`). `follows` lists the
  -- thread followers, so a reply only counts for people who follow it (#3).
  -- Skipped for ordinary channel messages so big channels pay nothing extra.
  v_direct := v_channel.kind = 'dm' OR (v_channel.kind = 'private' AND v_channel.workspace_id IS NULL) OR v_channel.application_id IS NOT NULL;
  IF v_direct OR cardinality(v_mentioned) > 0 OR p_thread_root IS NOT NULL THEN
    SELECT coalesce(array_agg(m.user_id), '{}'),
           coalesce(array_agg(m.user_id) FILTER (WHERE m.notify = 'mute'), '{}'),
           coalesce(array_agg(m.user_id) FILTER (WHERE f.user_id IS NOT NULL), '{}')
    INTO v_notify, v_muted, v_follows
    FROM public.chat_channel_members m
    LEFT JOIN public.chat_thread_follows f
      ON p_thread_root IS NOT NULL AND f.user_id = m.user_id AND f.channel_id = p_channel_id AND f.root_seq = p_thread_root
    WHERE m.channel_id = p_channel_id AND m.user_id <> p_author_id
      -- No hint or push from someone you're in a block with, in groups and threads too (B8, B33).
      AND NOT app_private.blocked_between(m.user_id, p_author_id)
      AND (
        m.user_id = ANY (v_mentioned)
        OR (m.notify <> 'mute' AND ((v_direct AND m.notify = 'all') OR f.user_id IS NOT NULL))
      );
  END IF;

  RETURN v_result || jsonb_build_object('notify', to_jsonb(v_notify), 'muted', to_jsonb(v_muted),
    'follows', to_jsonb(v_follows), 'channel_kind', v_channel.kind);
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_set_channel_privacy(p_channel_id uuid, p_actor uuid, p_private boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_channel record;
  v_kind text := CASE WHEN p_private THEN 'private' ELSE 'public' END;
BEGIN
  SELECT kind, name, workspace_id, application_id, is_default, archived_at INTO v_channel
  FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  IF NOT FOUND OR v_channel.kind = 'dm' OR v_channel.name IS NULL OR v_channel.workspace_id IS NULL
     OR v_channel.application_id IS NOT NULL OR v_channel.is_default OR v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_privacy_fixed';
  END IF;
  IF NOT app_private.chat_is_channel_admin(p_channel_id, p_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_channel_admin';
  END IF;
  IF v_channel.kind = v_kind THEN
    RETURN;
  END IF;
  UPDATE public.chat_channels SET kind = v_kind WHERE id = p_channel_id;
  PERFORM app_private.chat_post_system(p_channel_id, p_actor, CASE WHEN p_private THEN 'made the channel private' ELSE 'made the channel public' END);
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_set_member_role(p_channel_id uuid, p_actor uuid, p_user_id uuid, p_role text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF p_role NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_role';
  END IF;
  IF EXISTS (SELECT 1 FROM public.chat_channels WHERE id = p_channel_id AND application_id IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_application_members_fixed';
  END IF;
  IF NOT app_private.chat_is_channel_admin(p_channel_id, p_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_channel_admin';
  END IF;
  UPDATE public.chat_channel_members SET role = p_role
  WHERE channel_id = p_channel_id AND user_id = p_user_id AND role <> 'owner';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_member_not_found';
  END IF;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_set_member_state(p_channel_id uuid, p_user_id uuid, p_notify text, p_starred boolean, p_archived boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  UPDATE public.chat_channel_members SET
    notify = coalesce(p_notify, notify),
    starred = coalesce(p_starred, starred),
    archived_at = CASE WHEN p_archived IS NULL THEN archived_at WHEN p_archived THEN coalesce(archived_at, now()) ELSE NULL END
  WHERE channel_id = p_channel_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_set_thread_follow(p_channel_id uuid, p_user_id uuid, p_root bigint, p_on boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT app_private.chat_is_member(p_channel_id, p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
  IF p_on THEN
    INSERT INTO public.chat_thread_follows (user_id, channel_id, root_seq, last_read_seq)
    SELECT p_user_id, p_channel_id, m.channel_seq, coalesce(m.last_reply_seq, m.channel_seq)
    FROM public.chat_messages m
    WHERE m.channel_id = p_channel_id AND m.channel_seq = p_root AND m.thread_root_seq IS NULL
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.chat_thread_follows WHERE user_id = p_user_id AND channel_id = p_channel_id AND root_seq = p_root;
    -- Its unread replies leave the Inbox with it (mentions stay).
    UPDATE public.chat_mentions mn SET read_at = now()
    FROM public.chat_messages msg
    WHERE mn.user_id = p_user_id AND mn.channel_id = p_channel_id AND mn.kind = 'thread_reply' AND mn.read_at IS NULL
      AND msg.channel_id = mn.channel_id AND msg.channel_seq = mn.message_seq AND msg.thread_root_seq = p_root;
  END IF;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_sync_application_letter(p_application_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_message record;
  v_body text;
BEGIN
  SELECT left(coalesce(a.message, ''), 4000) INTO v_body FROM public.role_applications a WHERE a.id = p_application_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  UPDATE public.chat_messages m SET body = v_body, edited_at = now()
  FROM public.chat_channels c
  WHERE c.application_id = p_application_id AND m.channel_id = c.id
    AND m.client_message_id = 'application:' || p_application_id AND m.kind = 'user' AND m.deleted_at IS NULL
    AND m.body IS DISTINCT FROM v_body
  RETURNING m.channel_id, m.channel_seq, m.body, m.edited_at INTO v_message;
  IF v_message.channel_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.chat_channels SET last_preview = left(regexp_replace(btrim(v_body), '\s+', ' ', 'g'), 120)
  WHERE id = v_message.channel_id AND last_top_seq = v_message.channel_seq;
  PERFORM realtime.send(
    jsonb_build_object('seq', v_message.channel_seq, 'body', v_message.body, 'edited_at', v_message.edited_at),
    'message.edit',
    'chat:channel:' || v_message.channel_id,
    true
  );
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_sync_workspace_members(p_project_id uuid, p_user_id uuid, p_op text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_default uuid;
  v_added integer;
  v_is_org boolean;
  v_notify text;
BEGIN
  IF p_op = 'remove' THEN
    WITH removed AS (
      DELETE FROM public.chat_channel_members m
      USING public.chat_channels c
      WHERE c.id = m.channel_id AND c.workspace_id = p_project_id AND c.application_id IS NULL AND m.user_id = p_user_id
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

  -- Org #general starts at the org's default notify level: Mentions for Education, All otherwise (report §25.4).
  SELECT kind = 'organization',
         CASE WHEN kind = 'organization' THEN coalesce(nullif(org_settings->>'generalNotify', ''), CASE WHEN org_type = 'education' THEN 'mentions' ELSE 'all' END) ELSE 'all' END
    INTO v_is_org, v_notify FROM public.workspaces WHERE id = p_project_id;
  IF v_notify NOT IN ('all', 'mentions', 'mute') THEN v_notify := 'all'; END IF;
  SELECT id INTO v_default FROM public.chat_channels WHERE workspace_id = p_project_id AND is_default;
  IF NOT FOUND THEN
    INSERT INTO public.chat_channels (kind, name, workspace_id, is_default, description, created_by)
    SELECT 'public', app_private.chat_default_channel_name(p.id), p.id, true,
           CASE WHEN p.parent_id IS NOT NULL THEN 'Everyone in ' || p.title ELSE 'Everyone in the project' END, p.owner_id
    FROM public.workspaces p WHERE p.id = p_project_id
    ON CONFLICT (workspace_id) WHERE is_default DO NOTHING
    RETURNING id INTO v_default;
    IF v_default IS NULL THEN
      SELECT id INTO v_default FROM public.chat_channels WHERE workspace_id = p_project_id AND is_default;
    END IF;
    IF v_default IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_project_not_found';
    END IF;
  END IF;

  IF p_op = 'role' THEN
    UPDATE public.chat_channel_members m
    SET role = CASE pm.role WHEN 'owner' THEN 'owner' WHEN 'admin' THEN 'admin' ELSE 'member' END
    FROM public.workspace_members pm
    WHERE m.channel_id = v_default AND m.user_id = p_user_id
      AND pm.workspace_id = p_project_id AND pm.user_id = p_user_id;
    PERFORM app_private.chat_reconcile_application_members(p_project_id, p_user_id);
    RETURN v_default;
  END IF;

  INSERT INTO public.chat_channel_members (channel_id, user_id, role, notify)
  SELECT v_default, pm.user_id, CASE pm.role WHEN 'owner' THEN 'owner' WHEN 'admin' THEN 'admin' ELSE 'member' END, v_notify
  FROM public.workspace_members pm
  WHERE pm.workspace_id = p_project_id AND (p_user_id IS NULL OR pm.user_id = p_user_id)
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
CREATE FUNCTION app_private.chat_unarchive_channel(p_channel_id uuid, p_actor uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT app_private.chat_is_channel_admin(p_channel_id, p_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_channel_admin';
  END IF;
  UPDATE public.chat_channels SET archived_at = NULL WHERE id = p_channel_id AND kind <> 'dm' AND archived_at IS NOT NULL;
  IF FOUND THEN
    PERFORM app_private.chat_post_system(p_channel_id, p_actor, 'unarchived the channel');
  END IF;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.chat_update_channel(p_channel_id uuid, p_actor uuid, p_name text, p_topic text, p_description text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_channel record;
BEGIN
  SELECT * INTO v_channel FROM public.chat_channels WHERE id = p_channel_id;
  IF NOT FOUND OR v_channel.kind = 'dm' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_not_found';
  END IF;
  IF NOT app_private.chat_is_channel_admin(p_channel_id, p_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_channel_admin';
  END IF;
  IF p_name IS NOT NULL AND p_name IS DISTINCT FROM v_channel.name THEN
    IF p_name !~ '^[a-z0-9-]{1,80}$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_channel_name';
    END IF;
    UPDATE public.chat_channels SET name = p_name WHERE id = p_channel_id;
    PERFORM app_private.chat_post_system(p_channel_id, p_actor, 'renamed the channel to #' || p_name);
  END IF;
  IF p_topic IS NOT NULL AND nullif(btrim(p_topic), '') IS DISTINCT FROM v_channel.topic THEN
    UPDATE public.chat_channels SET topic = nullif(btrim(p_topic), '') WHERE id = p_channel_id;
    PERFORM app_private.chat_post_system(p_channel_id, p_actor, 'set the topic');
  END IF;
  IF p_description IS NOT NULL THEN
    UPDATE public.chat_channels SET description = nullif(btrim(p_description), '') WHERE id = p_channel_id;
  END IF;
END
$_$;
--> statement-breakpoint
CREATE FUNCTION app_private.drop_chat_of_deleted_workspace() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  DELETE FROM public.chat_channels WHERE workspace_id = NEW.id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TABLE public.chat_attachments (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
)
PARTITION BY HASH (channel_id);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p00 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p01 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p02 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p03 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p04 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p05 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p06 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p07 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p08 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p09 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p10 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p11 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p12 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p13 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p14 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p15 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p16 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p17 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p18 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p19 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p20 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p21 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p22 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p23 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p24 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p25 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p26 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p27 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p28 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p29 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p30 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_attachments_p31 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    idx smallint NOT NULL,
    asset_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_attachments_shape_check CHECK (((idx >= 0) AND (idx <= 9) AND (size >= 0) AND (char_length(name) <= 255)))
);
--> statement-breakpoint
CREATE TABLE public.chat_canvases (
    channel_id uuid NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    asset_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_canvases_asset_ids_check CHECK ((cardinality(asset_ids) <= 50)),
    CONSTRAINT chat_canvases_body_check CHECK ((char_length(body) <= 100000)),
    CONSTRAINT chat_canvases_title_check CHECK ((char_length(title) <= 200))
);
--> statement-breakpoint
CREATE TABLE public.chat_channel_members (
    channel_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    last_read_seq bigint DEFAULT 0 NOT NULL,
    mention_count integer DEFAULT 0 NOT NULL,
    notify text DEFAULT 'all'::text NOT NULL,
    starred boolean DEFAULT false NOT NULL,
    archived_at timestamp with time zone,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_channel_members_counter_check CHECK (((last_read_seq >= 0) AND (mention_count >= 0))),
    CONSTRAINT chat_channel_members_notify_check CHECK ((notify = ANY (ARRAY['all'::text, 'mentions'::text, 'mute'::text]))),
    CONSTRAINT chat_channel_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])))
)
WITH (fillfactor='80');
--> statement-breakpoint
CREATE TABLE public.chat_channel_tabs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    url text,
    "position" integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_channel_tabs_kind_check CHECK ((kind = ANY (ARRAY['tasks'::text, 'link'::text, 'files'::text]))),
    CONSTRAINT chat_channel_tabs_title_check CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 60))),
    CONSTRAINT chat_channel_tabs_url_check CHECK ((((kind = 'link'::text) AND (url IS NOT NULL) AND (char_length(url) <= 2000) AND (url ~ '^https?://'::text)) OR ((kind <> 'link'::text) AND (url IS NULL))))
);
--> statement-breakpoint
CREATE TABLE public.chat_channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    name text,
    topic text,
    description text,
    workspace_id uuid,
    application_id uuid,
    is_default boolean DEFAULT false NOT NULL,
    dm_key text,
    created_by uuid,
    last_seq bigint DEFAULT 0 NOT NULL,
    last_top_seq bigint DEFAULT 0 NOT NULL,
    last_message_at timestamp with time zone,
    last_preview text,
    last_author_id uuid,
    member_count integer DEFAULT 0 NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    title text,
    CONSTRAINT chat_channels_counter_check CHECK (((last_seq >= 0) AND (last_top_seq <= last_seq) AND (member_count >= 0))),
    CONSTRAINT chat_channels_default_check CHECK (((NOT is_default) OR (kind = 'public'::text))),
    CONSTRAINT chat_channels_dm_scope_check CHECK (((kind <> 'dm'::text) OR ((workspace_id IS NULL) AND (name IS NULL) AND (application_id IS NULL)))),
    CONSTRAINT chat_channels_dm_shape_check CHECK (((kind = 'dm'::text) = (dm_key IS NOT NULL))),
    CONSTRAINT chat_channels_kind_check CHECK ((kind = ANY (ARRAY['public'::text, 'private'::text, 'dm'::text]))),
    CONSTRAINT chat_channels_name_check CHECK (((name IS NULL) OR (name ~ '^[a-z0-9-]{1,80}$'::text))),
    CONSTRAINT chat_channels_public_shape_check CHECK (((kind <> 'public'::text) OR ((name IS NOT NULL) AND (workspace_id IS NOT NULL)))),
    CONSTRAINT chat_channels_text_check CHECK ((((topic IS NULL) OR (char_length(topic) <= 250)) AND ((description IS NULL) OR (char_length(description) <= 250)) AND ((last_preview IS NULL) OR (char_length(last_preview) <= 120)))),
    CONSTRAINT chat_channels_title_check CHECK (((title IS NULL) OR ((char_length(title) >= 1) AND (char_length(title) <= 80))))
)
WITH (fillfactor='70');
--> statement-breakpoint
CREATE TABLE public.chat_mentions (
    user_id uuid NOT NULL,
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    kind text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    CONSTRAINT chat_mentions_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'channel'::text, 'here'::text, 'thread_reply'::text])))
);
--> statement-breakpoint
CREATE TABLE public.chat_message_cards (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    kind text NOT NULL,
    ref_id uuid NOT NULL,
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT chat_message_cards_kind_check CHECK ((kind = ANY (ARRAY['application'::text, 'task'::text, 'invite'::text, 'announcement'::text, 'assignment'::text]))),
    CONSTRAINT chat_message_cards_snapshot_check CHECK ((jsonb_typeof(snapshot) = 'object'::text))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
)
PARTITION BY HASH (channel_id);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p00 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p01 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p02 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p03 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p04 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p05 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p06 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p07 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p08 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p09 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p10 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p11 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p12 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p13 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p14 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p15 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p16 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p17 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p18 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p19 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p20 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p21 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p22 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p23 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p24 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p25 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p26 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p27 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p28 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p29 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p30 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_messages_p31 (
    channel_id uuid NOT NULL,
    channel_seq bigint NOT NULL,
    author_id uuid,
    kind text DEFAULT 'user'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    thread_root_seq bigint,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_seq bigint,
    last_reply_at timestamp with time zone,
    client_message_id text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_preview_hidden boolean DEFAULT false NOT NULL,
    CONSTRAINT chat_messages_body_check CHECK ((char_length(body) <= 4000)),
    CONSTRAINT chat_messages_client_id_check CHECK (((client_message_id IS NULL) OR ((char_length(client_message_id) >= 1) AND (char_length(client_message_id) <= 160)))),
    CONSTRAINT chat_messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT chat_messages_thread_check CHECK (((thread_root_seq IS NULL) OR (thread_root_seq < channel_seq)))
);
--> statement-breakpoint
CREATE TABLE public.chat_pins (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    pinned_by uuid,
    pinned_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
)
PARTITION BY HASH (channel_id);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p00 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p01 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p02 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p03 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p04 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p05 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p06 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p07 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p08 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p09 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p10 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p11 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p12 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p13 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p14 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p15 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p16 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p17 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p18 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p19 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p20 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p21 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p22 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p23 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p24 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p25 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p26 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p27 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p28 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p29 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p30 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reactions_p31 (
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 64)))
);
--> statement-breakpoint
CREATE TABLE public.chat_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    reporter_id uuid NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_reports_reason_check CHECK (((char_length(btrim(reason)) >= 1) AND (char_length(btrim(reason)) <= 1000))),
    CONSTRAINT chat_reports_status_check CHECK ((status = ANY (ARRAY['open'::text, 'reviewed'::text, 'dismissed'::text])))
);
--> statement-breakpoint
CREATE TABLE public.chat_saved (
    user_id uuid NOT NULL,
    channel_id uuid NOT NULL,
    message_seq bigint NOT NULL,
    remind_at timestamp with time zone,
    reminded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reminder_claim_expires_at timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE public.chat_scheduled_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel_id uuid NOT NULL,
    user_id uuid NOT NULL,
    body text NOT NULL,
    thread_root_seq bigint,
    send_at timestamp with time zone NOT NULL,
    sent_at timestamp with time zone,
    failed_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    claim_expires_at timestamp with time zone,
    CONSTRAINT chat_scheduled_messages_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 4000))),
    CONSTRAINT chat_scheduled_messages_reason_check CHECK (((failed_reason IS NULL) OR (char_length(failed_reason) <= 120)))
);
--> statement-breakpoint
CREATE TABLE public.chat_thread_follows (
    user_id uuid NOT NULL,
    channel_id uuid NOT NULL,
    root_seq bigint NOT NULL,
    last_read_seq bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p00 FOR VALUES WITH (modulus 32, remainder 0);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p01 FOR VALUES WITH (modulus 32, remainder 1);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p02 FOR VALUES WITH (modulus 32, remainder 2);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p03 FOR VALUES WITH (modulus 32, remainder 3);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p04 FOR VALUES WITH (modulus 32, remainder 4);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p05 FOR VALUES WITH (modulus 32, remainder 5);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p06 FOR VALUES WITH (modulus 32, remainder 6);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p07 FOR VALUES WITH (modulus 32, remainder 7);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p08 FOR VALUES WITH (modulus 32, remainder 8);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p09 FOR VALUES WITH (modulus 32, remainder 9);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p10 FOR VALUES WITH (modulus 32, remainder 10);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p11 FOR VALUES WITH (modulus 32, remainder 11);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p12 FOR VALUES WITH (modulus 32, remainder 12);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p13 FOR VALUES WITH (modulus 32, remainder 13);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p14 FOR VALUES WITH (modulus 32, remainder 14);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p15 FOR VALUES WITH (modulus 32, remainder 15);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p16 FOR VALUES WITH (modulus 32, remainder 16);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p17 FOR VALUES WITH (modulus 32, remainder 17);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p18 FOR VALUES WITH (modulus 32, remainder 18);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p19 FOR VALUES WITH (modulus 32, remainder 19);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p20 FOR VALUES WITH (modulus 32, remainder 20);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p21 FOR VALUES WITH (modulus 32, remainder 21);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p22 FOR VALUES WITH (modulus 32, remainder 22);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p23 FOR VALUES WITH (modulus 32, remainder 23);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p24 FOR VALUES WITH (modulus 32, remainder 24);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p25 FOR VALUES WITH (modulus 32, remainder 25);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p26 FOR VALUES WITH (modulus 32, remainder 26);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p27 FOR VALUES WITH (modulus 32, remainder 27);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p28 FOR VALUES WITH (modulus 32, remainder 28);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p29 FOR VALUES WITH (modulus 32, remainder 29);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p30 FOR VALUES WITH (modulus 32, remainder 30);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments ATTACH PARTITION public.chat_attachments_p31 FOR VALUES WITH (modulus 32, remainder 31);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p00 FOR VALUES WITH (modulus 32, remainder 0);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p01 FOR VALUES WITH (modulus 32, remainder 1);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p02 FOR VALUES WITH (modulus 32, remainder 2);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p03 FOR VALUES WITH (modulus 32, remainder 3);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p04 FOR VALUES WITH (modulus 32, remainder 4);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p05 FOR VALUES WITH (modulus 32, remainder 5);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p06 FOR VALUES WITH (modulus 32, remainder 6);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p07 FOR VALUES WITH (modulus 32, remainder 7);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p08 FOR VALUES WITH (modulus 32, remainder 8);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p09 FOR VALUES WITH (modulus 32, remainder 9);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p10 FOR VALUES WITH (modulus 32, remainder 10);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p11 FOR VALUES WITH (modulus 32, remainder 11);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p12 FOR VALUES WITH (modulus 32, remainder 12);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p13 FOR VALUES WITH (modulus 32, remainder 13);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p14 FOR VALUES WITH (modulus 32, remainder 14);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p15 FOR VALUES WITH (modulus 32, remainder 15);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p16 FOR VALUES WITH (modulus 32, remainder 16);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p17 FOR VALUES WITH (modulus 32, remainder 17);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p18 FOR VALUES WITH (modulus 32, remainder 18);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p19 FOR VALUES WITH (modulus 32, remainder 19);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p20 FOR VALUES WITH (modulus 32, remainder 20);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p21 FOR VALUES WITH (modulus 32, remainder 21);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p22 FOR VALUES WITH (modulus 32, remainder 22);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p23 FOR VALUES WITH (modulus 32, remainder 23);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p24 FOR VALUES WITH (modulus 32, remainder 24);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p25 FOR VALUES WITH (modulus 32, remainder 25);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p26 FOR VALUES WITH (modulus 32, remainder 26);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p27 FOR VALUES WITH (modulus 32, remainder 27);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p28 FOR VALUES WITH (modulus 32, remainder 28);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p29 FOR VALUES WITH (modulus 32, remainder 29);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p30 FOR VALUES WITH (modulus 32, remainder 30);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages ATTACH PARTITION public.chat_messages_p31 FOR VALUES WITH (modulus 32, remainder 31);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p00 FOR VALUES WITH (modulus 32, remainder 0);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p01 FOR VALUES WITH (modulus 32, remainder 1);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p02 FOR VALUES WITH (modulus 32, remainder 2);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p03 FOR VALUES WITH (modulus 32, remainder 3);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p04 FOR VALUES WITH (modulus 32, remainder 4);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p05 FOR VALUES WITH (modulus 32, remainder 5);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p06 FOR VALUES WITH (modulus 32, remainder 6);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p07 FOR VALUES WITH (modulus 32, remainder 7);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p08 FOR VALUES WITH (modulus 32, remainder 8);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p09 FOR VALUES WITH (modulus 32, remainder 9);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p10 FOR VALUES WITH (modulus 32, remainder 10);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p11 FOR VALUES WITH (modulus 32, remainder 11);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p12 FOR VALUES WITH (modulus 32, remainder 12);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p13 FOR VALUES WITH (modulus 32, remainder 13);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p14 FOR VALUES WITH (modulus 32, remainder 14);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p15 FOR VALUES WITH (modulus 32, remainder 15);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p16 FOR VALUES WITH (modulus 32, remainder 16);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p17 FOR VALUES WITH (modulus 32, remainder 17);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p18 FOR VALUES WITH (modulus 32, remainder 18);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p19 FOR VALUES WITH (modulus 32, remainder 19);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p20 FOR VALUES WITH (modulus 32, remainder 20);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p21 FOR VALUES WITH (modulus 32, remainder 21);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p22 FOR VALUES WITH (modulus 32, remainder 22);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p23 FOR VALUES WITH (modulus 32, remainder 23);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p24 FOR VALUES WITH (modulus 32, remainder 24);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p25 FOR VALUES WITH (modulus 32, remainder 25);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p26 FOR VALUES WITH (modulus 32, remainder 26);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p27 FOR VALUES WITH (modulus 32, remainder 27);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p28 FOR VALUES WITH (modulus 32, remainder 28);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p29 FOR VALUES WITH (modulus 32, remainder 29);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p30 FOR VALUES WITH (modulus 32, remainder 30);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions ATTACH PARTITION public.chat_reactions_p31 FOR VALUES WITH (modulus 32, remainder 31);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments
    ADD CONSTRAINT chat_attachments_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p00
    ADD CONSTRAINT chat_attachments_p00_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p01
    ADD CONSTRAINT chat_attachments_p01_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p02
    ADD CONSTRAINT chat_attachments_p02_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p03
    ADD CONSTRAINT chat_attachments_p03_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p04
    ADD CONSTRAINT chat_attachments_p04_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p05
    ADD CONSTRAINT chat_attachments_p05_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p06
    ADD CONSTRAINT chat_attachments_p06_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p07
    ADD CONSTRAINT chat_attachments_p07_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p08
    ADD CONSTRAINT chat_attachments_p08_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p09
    ADD CONSTRAINT chat_attachments_p09_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p10
    ADD CONSTRAINT chat_attachments_p10_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p11
    ADD CONSTRAINT chat_attachments_p11_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p12
    ADD CONSTRAINT chat_attachments_p12_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p13
    ADD CONSTRAINT chat_attachments_p13_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p14
    ADD CONSTRAINT chat_attachments_p14_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p15
    ADD CONSTRAINT chat_attachments_p15_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p16
    ADD CONSTRAINT chat_attachments_p16_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p17
    ADD CONSTRAINT chat_attachments_p17_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p18
    ADD CONSTRAINT chat_attachments_p18_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p19
    ADD CONSTRAINT chat_attachments_p19_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p20
    ADD CONSTRAINT chat_attachments_p20_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p21
    ADD CONSTRAINT chat_attachments_p21_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p22
    ADD CONSTRAINT chat_attachments_p22_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p23
    ADD CONSTRAINT chat_attachments_p23_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p24
    ADD CONSTRAINT chat_attachments_p24_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p25
    ADD CONSTRAINT chat_attachments_p25_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p26
    ADD CONSTRAINT chat_attachments_p26_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p27
    ADD CONSTRAINT chat_attachments_p27_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p28
    ADD CONSTRAINT chat_attachments_p28_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p29
    ADD CONSTRAINT chat_attachments_p29_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p30
    ADD CONSTRAINT chat_attachments_p30_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_attachments_p31
    ADD CONSTRAINT chat_attachments_p31_pkey PRIMARY KEY (channel_id, message_seq, idx);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_canvases
    ADD CONSTRAINT chat_canvases_pkey PRIMARY KEY (channel_id);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_channel_members
    ADD CONSTRAINT chat_channel_members_pkey PRIMARY KEY (channel_id, user_id);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_channel_tabs
    ADD CONSTRAINT chat_channel_tabs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_channels
    ADD CONSTRAINT chat_channels_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_mentions
    ADD CONSTRAINT chat_mentions_pkey PRIMARY KEY (user_id, channel_id, message_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_message_cards
    ADD CONSTRAINT chat_message_cards_pkey PRIMARY KEY (channel_id, message_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p00
    ADD CONSTRAINT chat_messages_p00_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p01
    ADD CONSTRAINT chat_messages_p01_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p02
    ADD CONSTRAINT chat_messages_p02_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p03
    ADD CONSTRAINT chat_messages_p03_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p04
    ADD CONSTRAINT chat_messages_p04_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p05
    ADD CONSTRAINT chat_messages_p05_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p06
    ADD CONSTRAINT chat_messages_p06_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p07
    ADD CONSTRAINT chat_messages_p07_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p08
    ADD CONSTRAINT chat_messages_p08_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p09
    ADD CONSTRAINT chat_messages_p09_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p10
    ADD CONSTRAINT chat_messages_p10_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p11
    ADD CONSTRAINT chat_messages_p11_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p12
    ADD CONSTRAINT chat_messages_p12_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p13
    ADD CONSTRAINT chat_messages_p13_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p14
    ADD CONSTRAINT chat_messages_p14_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p15
    ADD CONSTRAINT chat_messages_p15_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p16
    ADD CONSTRAINT chat_messages_p16_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p17
    ADD CONSTRAINT chat_messages_p17_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p18
    ADD CONSTRAINT chat_messages_p18_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p19
    ADD CONSTRAINT chat_messages_p19_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p20
    ADD CONSTRAINT chat_messages_p20_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p21
    ADD CONSTRAINT chat_messages_p21_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p22
    ADD CONSTRAINT chat_messages_p22_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p23
    ADD CONSTRAINT chat_messages_p23_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p24
    ADD CONSTRAINT chat_messages_p24_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p25
    ADD CONSTRAINT chat_messages_p25_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p26
    ADD CONSTRAINT chat_messages_p26_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p27
    ADD CONSTRAINT chat_messages_p27_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p28
    ADD CONSTRAINT chat_messages_p28_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p29
    ADD CONSTRAINT chat_messages_p29_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p30
    ADD CONSTRAINT chat_messages_p30_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_messages_p31
    ADD CONSTRAINT chat_messages_p31_pkey PRIMARY KEY (channel_id, channel_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_pins
    ADD CONSTRAINT chat_pins_pkey PRIMARY KEY (channel_id, message_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions
    ADD CONSTRAINT chat_reactions_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p00
    ADD CONSTRAINT chat_reactions_p00_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p01
    ADD CONSTRAINT chat_reactions_p01_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p02
    ADD CONSTRAINT chat_reactions_p02_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p03
    ADD CONSTRAINT chat_reactions_p03_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p04
    ADD CONSTRAINT chat_reactions_p04_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p05
    ADD CONSTRAINT chat_reactions_p05_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p06
    ADD CONSTRAINT chat_reactions_p06_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p07
    ADD CONSTRAINT chat_reactions_p07_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p08
    ADD CONSTRAINT chat_reactions_p08_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p09
    ADD CONSTRAINT chat_reactions_p09_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p10
    ADD CONSTRAINT chat_reactions_p10_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p11
    ADD CONSTRAINT chat_reactions_p11_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p12
    ADD CONSTRAINT chat_reactions_p12_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p13
    ADD CONSTRAINT chat_reactions_p13_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p14
    ADD CONSTRAINT chat_reactions_p14_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p15
    ADD CONSTRAINT chat_reactions_p15_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p16
    ADD CONSTRAINT chat_reactions_p16_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p17
    ADD CONSTRAINT chat_reactions_p17_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p18
    ADD CONSTRAINT chat_reactions_p18_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p19
    ADD CONSTRAINT chat_reactions_p19_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p20
    ADD CONSTRAINT chat_reactions_p20_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p21
    ADD CONSTRAINT chat_reactions_p21_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p22
    ADD CONSTRAINT chat_reactions_p22_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p23
    ADD CONSTRAINT chat_reactions_p23_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p24
    ADD CONSTRAINT chat_reactions_p24_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p25
    ADD CONSTRAINT chat_reactions_p25_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p26
    ADD CONSTRAINT chat_reactions_p26_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p27
    ADD CONSTRAINT chat_reactions_p27_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p28
    ADD CONSTRAINT chat_reactions_p28_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p29
    ADD CONSTRAINT chat_reactions_p29_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p30
    ADD CONSTRAINT chat_reactions_p30_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reactions_p31
    ADD CONSTRAINT chat_reactions_p31_pkey PRIMARY KEY (channel_id, message_seq, user_id, emoji);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reports
    ADD CONSTRAINT chat_reports_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_saved
    ADD CONSTRAINT chat_saved_pkey PRIMARY KEY (user_id, channel_id, message_seq);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_scheduled_messages
    ADD CONSTRAINT chat_scheduled_messages_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.chat_thread_follows
    ADD CONSTRAINT chat_thread_follows_pkey PRIMARY KEY (user_id, channel_id, root_seq);
--> statement-breakpoint
CREATE INDEX chat_attachments_asset_idx ON ONLY public.chat_attachments USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p00_asset_id_idx ON public.chat_attachments_p00 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p01_asset_id_idx ON public.chat_attachments_p01 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p02_asset_id_idx ON public.chat_attachments_p02 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p03_asset_id_idx ON public.chat_attachments_p03 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p04_asset_id_idx ON public.chat_attachments_p04 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p05_asset_id_idx ON public.chat_attachments_p05 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p06_asset_id_idx ON public.chat_attachments_p06 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p07_asset_id_idx ON public.chat_attachments_p07 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p08_asset_id_idx ON public.chat_attachments_p08 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p09_asset_id_idx ON public.chat_attachments_p09 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p10_asset_id_idx ON public.chat_attachments_p10 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p11_asset_id_idx ON public.chat_attachments_p11 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p12_asset_id_idx ON public.chat_attachments_p12 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p13_asset_id_idx ON public.chat_attachments_p13 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p14_asset_id_idx ON public.chat_attachments_p14 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p15_asset_id_idx ON public.chat_attachments_p15 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p16_asset_id_idx ON public.chat_attachments_p16 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p17_asset_id_idx ON public.chat_attachments_p17 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p18_asset_id_idx ON public.chat_attachments_p18 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p19_asset_id_idx ON public.chat_attachments_p19 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p20_asset_id_idx ON public.chat_attachments_p20 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p21_asset_id_idx ON public.chat_attachments_p21 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p22_asset_id_idx ON public.chat_attachments_p22 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p23_asset_id_idx ON public.chat_attachments_p23 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p24_asset_id_idx ON public.chat_attachments_p24 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p25_asset_id_idx ON public.chat_attachments_p25 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p26_asset_id_idx ON public.chat_attachments_p26 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p27_asset_id_idx ON public.chat_attachments_p27 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p28_asset_id_idx ON public.chat_attachments_p28 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p29_asset_id_idx ON public.chat_attachments_p29 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p30_asset_id_idx ON public.chat_attachments_p30 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_attachments_p31_asset_id_idx ON public.chat_attachments_p31 USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX chat_canvases_asset_ids_idx ON public.chat_canvases USING gin (asset_ids);
--> statement-breakpoint
CREATE INDEX chat_canvases_updated_by_idx ON public.chat_canvases USING btree (updated_by);
--> statement-breakpoint
CREATE INDEX chat_channel_members_user_idx ON public.chat_channel_members USING btree (user_id, channel_id);
--> statement-breakpoint
CREATE INDEX chat_channel_tabs_channel_idx ON public.chat_channel_tabs USING btree (channel_id, "position");
--> statement-breakpoint
CREATE INDEX chat_channel_tabs_created_by_idx ON public.chat_channel_tabs USING btree (created_by);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_channel_tabs_files_uniq ON public.chat_channel_tabs USING btree (channel_id) WHERE (kind = 'files'::text);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_channel_tabs_tasks_uniq ON public.chat_channel_tabs USING btree (channel_id) WHERE (kind = 'tasks'::text);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_channels_application_uniq ON public.chat_channels USING btree (application_id) WHERE (application_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_channels_created_by_idx ON public.chat_channels USING btree (created_by);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_channels_default_uniq ON public.chat_channels USING btree (workspace_id) WHERE is_default;
--> statement-breakpoint
CREATE UNIQUE INDEX chat_channels_dm_key_uniq ON public.chat_channels USING btree (dm_key) WHERE (dm_key IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_channels_workspace_browse_idx ON public.chat_channels USING btree (workspace_id, kind) WHERE ((archived_at IS NULL) AND (workspace_id IS NOT NULL));
--> statement-breakpoint
CREATE INDEX chat_channels_workspace_idx ON public.chat_channels USING btree (workspace_id) WHERE (workspace_id IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_channels_workspace_name_uniq ON public.chat_channels USING btree (workspace_id, lower(name)) WHERE ((name IS NOT NULL) AND (workspace_id IS NOT NULL));
--> statement-breakpoint
CREATE INDEX chat_mentions_feed_idx ON public.chat_mentions USING btree (user_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX chat_mentions_message_idx ON public.chat_mentions USING btree (channel_id, message_seq);
--> statement-breakpoint
CREATE INDEX chat_mentions_unread_idx ON public.chat_mentions USING btree (user_id) WHERE (read_at IS NULL);
--> statement-breakpoint
CREATE INDEX chat_message_cards_ref_idx ON public.chat_message_cards USING btree (kind, ref_id);
--> statement-breakpoint
CREATE INDEX chat_messages_author_idx ON ONLY public.chat_messages USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE INDEX chat_messages_body_fts_idx ON ONLY public.chat_messages USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_client_uniq ON ONLY public.chat_messages USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p00_author_id_channel_id_channel_seq_idx ON public.chat_messages_p00 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p00_channel_id_author_id_client_message_id_idx ON public.chat_messages_p00 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_thread_idx ON ONLY public.chat_messages USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p00_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p00 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p00_to_tsvector_idx ON public.chat_messages_p00 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p01_author_id_channel_id_channel_seq_idx ON public.chat_messages_p01 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p01_channel_id_author_id_client_message_id_idx ON public.chat_messages_p01 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p01_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p01 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p01_to_tsvector_idx ON public.chat_messages_p01 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p02_author_id_channel_id_channel_seq_idx ON public.chat_messages_p02 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p02_channel_id_author_id_client_message_id_idx ON public.chat_messages_p02 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p02_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p02 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p02_to_tsvector_idx ON public.chat_messages_p02 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p03_author_id_channel_id_channel_seq_idx ON public.chat_messages_p03 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p03_channel_id_author_id_client_message_id_idx ON public.chat_messages_p03 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p03_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p03 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p03_to_tsvector_idx ON public.chat_messages_p03 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p04_author_id_channel_id_channel_seq_idx ON public.chat_messages_p04 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p04_channel_id_author_id_client_message_id_idx ON public.chat_messages_p04 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p04_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p04 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p04_to_tsvector_idx ON public.chat_messages_p04 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p05_author_id_channel_id_channel_seq_idx ON public.chat_messages_p05 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p05_channel_id_author_id_client_message_id_idx ON public.chat_messages_p05 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p05_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p05 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p05_to_tsvector_idx ON public.chat_messages_p05 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p06_author_id_channel_id_channel_seq_idx ON public.chat_messages_p06 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p06_channel_id_author_id_client_message_id_idx ON public.chat_messages_p06 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p06_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p06 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p06_to_tsvector_idx ON public.chat_messages_p06 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p07_author_id_channel_id_channel_seq_idx ON public.chat_messages_p07 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p07_channel_id_author_id_client_message_id_idx ON public.chat_messages_p07 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p07_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p07 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p07_to_tsvector_idx ON public.chat_messages_p07 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p08_author_id_channel_id_channel_seq_idx ON public.chat_messages_p08 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p08_channel_id_author_id_client_message_id_idx ON public.chat_messages_p08 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p08_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p08 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p08_to_tsvector_idx ON public.chat_messages_p08 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p09_author_id_channel_id_channel_seq_idx ON public.chat_messages_p09 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p09_channel_id_author_id_client_message_id_idx ON public.chat_messages_p09 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p09_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p09 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p09_to_tsvector_idx ON public.chat_messages_p09 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p10_author_id_channel_id_channel_seq_idx ON public.chat_messages_p10 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p10_channel_id_author_id_client_message_id_idx ON public.chat_messages_p10 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p10_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p10 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p10_to_tsvector_idx ON public.chat_messages_p10 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p11_author_id_channel_id_channel_seq_idx ON public.chat_messages_p11 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p11_channel_id_author_id_client_message_id_idx ON public.chat_messages_p11 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p11_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p11 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p11_to_tsvector_idx ON public.chat_messages_p11 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p12_author_id_channel_id_channel_seq_idx ON public.chat_messages_p12 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p12_channel_id_author_id_client_message_id_idx ON public.chat_messages_p12 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p12_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p12 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p12_to_tsvector_idx ON public.chat_messages_p12 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p13_author_id_channel_id_channel_seq_idx ON public.chat_messages_p13 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p13_channel_id_author_id_client_message_id_idx ON public.chat_messages_p13 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p13_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p13 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p13_to_tsvector_idx ON public.chat_messages_p13 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p14_author_id_channel_id_channel_seq_idx ON public.chat_messages_p14 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p14_channel_id_author_id_client_message_id_idx ON public.chat_messages_p14 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p14_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p14 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p14_to_tsvector_idx ON public.chat_messages_p14 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p15_author_id_channel_id_channel_seq_idx ON public.chat_messages_p15 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p15_channel_id_author_id_client_message_id_idx ON public.chat_messages_p15 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p15_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p15 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p15_to_tsvector_idx ON public.chat_messages_p15 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p16_author_id_channel_id_channel_seq_idx ON public.chat_messages_p16 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p16_channel_id_author_id_client_message_id_idx ON public.chat_messages_p16 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p16_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p16 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p16_to_tsvector_idx ON public.chat_messages_p16 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p17_author_id_channel_id_channel_seq_idx ON public.chat_messages_p17 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p17_channel_id_author_id_client_message_id_idx ON public.chat_messages_p17 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p17_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p17 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p17_to_tsvector_idx ON public.chat_messages_p17 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p18_author_id_channel_id_channel_seq_idx ON public.chat_messages_p18 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p18_channel_id_author_id_client_message_id_idx ON public.chat_messages_p18 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p18_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p18 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p18_to_tsvector_idx ON public.chat_messages_p18 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p19_author_id_channel_id_channel_seq_idx ON public.chat_messages_p19 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p19_channel_id_author_id_client_message_id_idx ON public.chat_messages_p19 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p19_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p19 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p19_to_tsvector_idx ON public.chat_messages_p19 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p20_author_id_channel_id_channel_seq_idx ON public.chat_messages_p20 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p20_channel_id_author_id_client_message_id_idx ON public.chat_messages_p20 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p20_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p20 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p20_to_tsvector_idx ON public.chat_messages_p20 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p21_author_id_channel_id_channel_seq_idx ON public.chat_messages_p21 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p21_channel_id_author_id_client_message_id_idx ON public.chat_messages_p21 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p21_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p21 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p21_to_tsvector_idx ON public.chat_messages_p21 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p22_author_id_channel_id_channel_seq_idx ON public.chat_messages_p22 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p22_channel_id_author_id_client_message_id_idx ON public.chat_messages_p22 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p22_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p22 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p22_to_tsvector_idx ON public.chat_messages_p22 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p23_author_id_channel_id_channel_seq_idx ON public.chat_messages_p23 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p23_channel_id_author_id_client_message_id_idx ON public.chat_messages_p23 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p23_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p23 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p23_to_tsvector_idx ON public.chat_messages_p23 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p24_author_id_channel_id_channel_seq_idx ON public.chat_messages_p24 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p24_channel_id_author_id_client_message_id_idx ON public.chat_messages_p24 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p24_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p24 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p24_to_tsvector_idx ON public.chat_messages_p24 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p25_author_id_channel_id_channel_seq_idx ON public.chat_messages_p25 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p25_channel_id_author_id_client_message_id_idx ON public.chat_messages_p25 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p25_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p25 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p25_to_tsvector_idx ON public.chat_messages_p25 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p26_author_id_channel_id_channel_seq_idx ON public.chat_messages_p26 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p26_channel_id_author_id_client_message_id_idx ON public.chat_messages_p26 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p26_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p26 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p26_to_tsvector_idx ON public.chat_messages_p26 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p27_author_id_channel_id_channel_seq_idx ON public.chat_messages_p27 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p27_channel_id_author_id_client_message_id_idx ON public.chat_messages_p27 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p27_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p27 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p27_to_tsvector_idx ON public.chat_messages_p27 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p28_author_id_channel_id_channel_seq_idx ON public.chat_messages_p28 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p28_channel_id_author_id_client_message_id_idx ON public.chat_messages_p28 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p28_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p28 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p28_to_tsvector_idx ON public.chat_messages_p28 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p29_author_id_channel_id_channel_seq_idx ON public.chat_messages_p29 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p29_channel_id_author_id_client_message_id_idx ON public.chat_messages_p29 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p29_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p29 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p29_to_tsvector_idx ON public.chat_messages_p29 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p30_author_id_channel_id_channel_seq_idx ON public.chat_messages_p30 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p30_channel_id_author_id_client_message_id_idx ON public.chat_messages_p30 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p30_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p30 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p30_to_tsvector_idx ON public.chat_messages_p30 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_messages_p31_author_id_channel_id_channel_seq_idx ON public.chat_messages_p31 USING btree (author_id, channel_id, channel_seq);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_messages_p31_channel_id_author_id_client_message_id_idx ON public.chat_messages_p31 USING btree (channel_id, author_id, client_message_id) WHERE (client_message_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p31_channel_id_thread_root_seq_channel_seq_idx ON public.chat_messages_p31 USING btree (channel_id, thread_root_seq, channel_seq) WHERE (thread_root_seq IS NOT NULL);
--> statement-breakpoint
CREATE INDEX chat_messages_p31_to_tsvector_idx ON public.chat_messages_p31 USING gin (to_tsvector('simple'::regconfig, body));
--> statement-breakpoint
CREATE INDEX chat_pins_pinned_by_idx ON public.chat_pins USING btree (pinned_by);
--> statement-breakpoint
CREATE INDEX chat_reactions_user_idx ON ONLY public.chat_reactions USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p00_user_id_idx ON public.chat_reactions_p00 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p01_user_id_idx ON public.chat_reactions_p01 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p02_user_id_idx ON public.chat_reactions_p02 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p03_user_id_idx ON public.chat_reactions_p03 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p04_user_id_idx ON public.chat_reactions_p04 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p05_user_id_idx ON public.chat_reactions_p05 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p06_user_id_idx ON public.chat_reactions_p06 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p07_user_id_idx ON public.chat_reactions_p07 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p08_user_id_idx ON public.chat_reactions_p08 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p09_user_id_idx ON public.chat_reactions_p09 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p10_user_id_idx ON public.chat_reactions_p10 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p11_user_id_idx ON public.chat_reactions_p11 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p12_user_id_idx ON public.chat_reactions_p12 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p13_user_id_idx ON public.chat_reactions_p13 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p14_user_id_idx ON public.chat_reactions_p14 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p15_user_id_idx ON public.chat_reactions_p15 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p16_user_id_idx ON public.chat_reactions_p16 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p17_user_id_idx ON public.chat_reactions_p17 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p18_user_id_idx ON public.chat_reactions_p18 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p19_user_id_idx ON public.chat_reactions_p19 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p20_user_id_idx ON public.chat_reactions_p20 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p21_user_id_idx ON public.chat_reactions_p21 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p22_user_id_idx ON public.chat_reactions_p22 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p23_user_id_idx ON public.chat_reactions_p23 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p24_user_id_idx ON public.chat_reactions_p24 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p25_user_id_idx ON public.chat_reactions_p25 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p26_user_id_idx ON public.chat_reactions_p26 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p27_user_id_idx ON public.chat_reactions_p27 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p28_user_id_idx ON public.chat_reactions_p28 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p29_user_id_idx ON public.chat_reactions_p29 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p30_user_id_idx ON public.chat_reactions_p30 USING btree (user_id);
--> statement-breakpoint
CREATE INDEX chat_reactions_p31_user_id_idx ON public.chat_reactions_p31 USING btree (user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_reports_once_uniq ON public.chat_reports USING btree (channel_id, message_seq, reporter_id);
--> statement-breakpoint
CREATE INDEX chat_reports_queue_idx ON public.chat_reports USING btree (status, created_at);
--> statement-breakpoint
CREATE INDEX chat_reports_reporter_idx ON public.chat_reports USING btree (reporter_id);
--> statement-breakpoint
CREATE INDEX chat_saved_due_idx ON public.chat_saved USING btree (remind_at) WHERE ((reminded_at IS NULL) AND (remind_at IS NOT NULL));
--> statement-breakpoint
CREATE INDEX chat_saved_message_idx ON public.chat_saved USING btree (channel_id, message_seq);
--> statement-breakpoint
CREATE INDEX chat_saved_user_idx ON public.chat_saved USING btree (user_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX chat_scheduled_messages_channel_idx ON public.chat_scheduled_messages USING btree (channel_id);
--> statement-breakpoint
CREATE INDEX chat_scheduled_messages_due_idx ON public.chat_scheduled_messages USING btree (send_at) WHERE ((sent_at IS NULL) AND (failed_reason IS NULL));
--> statement-breakpoint
CREATE INDEX chat_scheduled_messages_user_idx ON public.chat_scheduled_messages USING btree (user_id, send_at);
--> statement-breakpoint
CREATE INDEX chat_thread_follows_root_idx ON public.chat_thread_follows USING btree (channel_id, root_seq);
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p00_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p00_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p01_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p01_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p02_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p02_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p03_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p03_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p04_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p04_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p05_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p05_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p06_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p06_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p07_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p07_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p08_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p08_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p09_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p09_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p10_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p10_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p11_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p11_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p12_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p12_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p13_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p13_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p14_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p14_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p15_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p15_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p16_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p16_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p17_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p17_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p18_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p18_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p19_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p19_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p20_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p20_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p21_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p21_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p22_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p22_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p23_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p23_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p24_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p24_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p25_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p25_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p26_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p26_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p27_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p27_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p28_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p28_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p29_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p29_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p30_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p30_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_asset_idx ATTACH PARTITION public.chat_attachments_p31_asset_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_attachments_pkey ATTACH PARTITION public.chat_attachments_p31_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p00_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p00_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p00_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p00_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p00_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p01_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p01_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p01_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p01_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p01_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p02_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p02_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p02_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p02_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p02_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p03_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p03_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p03_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p03_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p03_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p04_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p04_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p04_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p04_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p04_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p05_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p05_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p05_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p05_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p05_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p06_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p06_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p06_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p06_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p06_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p07_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p07_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p07_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p07_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p07_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p08_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p08_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p08_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p08_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p08_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p09_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p09_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p09_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p09_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p09_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p10_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p10_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p10_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p10_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p10_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p11_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p11_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p11_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p11_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p11_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p12_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p12_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p12_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p12_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p12_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p13_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p13_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p13_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p13_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p13_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p14_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p14_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p14_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p14_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p14_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p15_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p15_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p15_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p15_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p15_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p16_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p16_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p16_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p16_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p16_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p17_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p17_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p17_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p17_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p17_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p18_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p18_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p18_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p18_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p18_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p19_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p19_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p19_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p19_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p19_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p20_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p20_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p20_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p20_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p20_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p21_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p21_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p21_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p21_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p21_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p22_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p22_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p22_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p22_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p22_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p23_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p23_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p23_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p23_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p23_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p24_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p24_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p24_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p24_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p24_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p25_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p25_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p25_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p25_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p25_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p26_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p26_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p26_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p26_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p26_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p27_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p27_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p27_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p27_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p27_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p28_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p28_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p28_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p28_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p28_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p29_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p29_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p29_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p29_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p29_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p30_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p30_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p30_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p30_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p30_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_author_idx ATTACH PARTITION public.chat_messages_p31_author_id_channel_id_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_client_uniq ATTACH PARTITION public.chat_messages_p31_channel_id_author_id_client_message_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_thread_idx ATTACH PARTITION public.chat_messages_p31_channel_id_thread_root_seq_channel_seq_idx;
--> statement-breakpoint
ALTER INDEX public.chat_messages_pkey ATTACH PARTITION public.chat_messages_p31_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_messages_body_fts_idx ATTACH PARTITION public.chat_messages_p31_to_tsvector_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p00_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p00_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p01_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p01_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p02_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p02_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p03_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p03_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p04_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p04_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p05_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p05_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p06_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p06_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p07_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p07_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p08_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p08_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p09_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p09_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p10_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p10_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p11_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p11_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p12_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p12_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p13_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p13_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p14_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p14_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p15_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p15_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p16_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p16_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p17_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p17_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p18_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p18_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p19_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p19_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p20_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p20_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p21_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p21_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p22_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p22_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p23_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p23_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p24_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p24_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p25_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p25_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p26_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p26_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p27_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p27_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p28_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p28_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p29_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p29_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p30_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p30_user_id_idx;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_pkey ATTACH PARTITION public.chat_reactions_p31_pkey;
--> statement-breakpoint
ALTER INDEX public.chat_reactions_user_idx ATTACH PARTITION public.chat_reactions_p31_user_id_idx;
--> statement-breakpoint
CREATE TRIGGER chat_application_letter_changed AFTER UPDATE OF message ON public.role_applications FOR EACH ROW WHEN ((old.message IS DISTINCT FROM new.message)) EXECUTE FUNCTION app_private.chat_application_letter_changed();
--> statement-breakpoint
CREATE TRIGGER chat_card_changed_application AFTER UPDATE OF status, message, role_id, details, decision_reason_code ON public.role_applications FOR EACH ROW WHEN (((old.status IS DISTINCT FROM new.status) OR (old.message IS DISTINCT FROM new.message) OR (old.role_id IS DISTINCT FROM new.role_id) OR (old.details IS DISTINCT FROM new.details) OR (old.decision_reason_code IS DISTINCT FROM new.decision_reason_code))) EXECUTE FUNCTION app_private.chat_card_changed('application');
--> statement-breakpoint
CREATE TRIGGER chat_card_changed_invite AFTER UPDATE OF status ON public.workspace_invitations FOR EACH ROW WHEN ((old.status IS DISTINCT FROM new.status)) EXECUTE FUNCTION app_private.chat_card_changed('invite');
--> statement-breakpoint
CREATE TRIGGER chat_card_changed_task AFTER UPDATE OF status, assignee_id, title, priority, due_date ON public.tasks FOR EACH ROW WHEN (((old.status IS DISTINCT FROM new.status) OR (old.assignee_id IS DISTINCT FROM new.assignee_id) OR (old.title IS DISTINCT FROM new.title) OR (old.priority IS DISTINCT FROM new.priority) OR (old.due_date IS DISTINCT FROM new.due_date))) EXECUTE FUNCTION app_private.chat_card_changed('task');
--> statement-breakpoint
CREATE TRIGGER chat_channel_members_block_heads_up AFTER INSERT ON public.chat_channel_members FOR EACH ROW EXECUTE FUNCTION app_private.chat_block_heads_up();
--> statement-breakpoint
CREATE TRIGGER chat_messages_org_general_guard BEFORE INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION app_private.chat_org_general_post_guard();
--> statement-breakpoint
CREATE TRIGGER chat_messages_org_read_only_guard BEFORE INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION app_private.chat_org_read_only_guard();
--> statement-breakpoint
CREATE TRIGGER workspaces_drop_chat_on_soft_delete AFTER UPDATE OF deleted_at ON public.workspaces FOR EACH ROW WHEN (((old.deleted_at IS NULL) AND (new.deleted_at IS NOT NULL))) EXECUTE FUNCTION app_private.drop_chat_of_deleted_workspace();
--> statement-breakpoint
ALTER TABLE public.chat_attachments
    ADD CONSTRAINT chat_attachments_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.storage_assets(id);
--> statement-breakpoint
ALTER TABLE public.chat_attachments
    ADD CONSTRAINT chat_attachments_channel_id_message_seq_fkey FOREIGN KEY (channel_id, message_seq) REFERENCES public.chat_messages(channel_id, channel_seq) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.chat_canvases
    ADD CONSTRAINT chat_canvases_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.chat_channels(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.chat_canvases
    ADD CONSTRAINT chat_canvases_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.chat_channel_members
    ADD CONSTRAINT chat_channel_members_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.chat_channels(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.chat_channel_members
    ADD CONSTRAINT chat_channel_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.chat_channel_tabs
    ADD CONSTRAINT chat_channel_tabs_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.chat_channels(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.chat_channel_tabs
    ADD CONSTRAINT chat_channel_tabs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.chat_channels
    ADD CONSTRAINT chat_channels_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.role_applications(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.chat_channels
    ADD CONSTRAINT chat_channels_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.chat_channels
    ADD CONSTRAINT chat_channels_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.chat_mentions
    ADD CONSTRAINT chat_mentions_channel_id_message_seq_fkey FOREIGN KEY (channel_id, message_seq) REFERENCES public.chat_messages(channel_id, channel_seq) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.chat_mentions
    ADD CONSTRAINT chat_mentions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.chat_message_cards
    ADD CONSTRAINT chat_message_cards_channel_id_message_seq_fkey FOREIGN KEY (channel_id, message_seq) REFERENCES public.chat_messages(channel_id, channel_seq) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.chat_messages
    ADD CONSTRAINT chat_messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE public.chat_messages
    ADD CONSTRAINT chat_messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.chat_channels(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.chat_pins
    ADD CONSTRAINT chat_pins_channel_id_message_seq_fkey FOREIGN KEY (channel_id, message_seq) REFERENCES public.chat_messages(channel_id, channel_seq) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.chat_pins
    ADD CONSTRAINT chat_pins_pinned_by_fkey FOREIGN KEY (pinned_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE public.chat_reactions
    ADD CONSTRAINT chat_reactions_channel_id_message_seq_fkey FOREIGN KEY (channel_id, message_seq) REFERENCES public.chat_messages(channel_id, channel_seq) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.chat_reactions
    ADD CONSTRAINT chat_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reports
    ADD CONSTRAINT chat_reports_channel_id_message_seq_fkey FOREIGN KEY (channel_id, message_seq) REFERENCES public.chat_messages(channel_id, channel_seq) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.chat_reports
    ADD CONSTRAINT chat_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.chat_saved
    ADD CONSTRAINT chat_saved_channel_id_message_seq_fkey FOREIGN KEY (channel_id, message_seq) REFERENCES public.chat_messages(channel_id, channel_seq) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.chat_saved
    ADD CONSTRAINT chat_saved_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.chat_scheduled_messages
    ADD CONSTRAINT chat_scheduled_messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.chat_channels(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.chat_scheduled_messages
    ADD CONSTRAINT chat_scheduled_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.chat_thread_follows
    ADD CONSTRAINT chat_thread_follows_channel_id_root_seq_fkey FOREIGN KEY (channel_id, root_seq) REFERENCES public.chat_messages(channel_id, channel_seq) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.chat_thread_follows
    ADD CONSTRAINT chat_thread_follows_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.chat_attachments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY chat_attachments_member_select ON public.chat_attachments FOR SELECT TO authenticated USING (app_private.chat_is_member(channel_id, ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p00 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p01 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p02 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p03 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p04 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p05 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p06 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p07 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p08 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p09 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p10 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p11 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p12 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p13 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p14 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p15 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p16 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p17 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p18 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p19 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p20 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p21 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p22 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p23 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p24 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p25 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p26 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p27 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p28 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p29 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p30 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_attachments_p31 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_canvases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY chat_canvases_member_select ON public.chat_canvases FOR SELECT TO authenticated USING (app_private.chat_is_member(channel_id, ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
ALTER TABLE public.chat_channel_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY chat_channel_members_member_select ON public.chat_channel_members FOR SELECT TO authenticated USING (app_private.chat_is_member(channel_id, ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
ALTER TABLE public.chat_channel_tabs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY chat_channel_tabs_member_select ON public.chat_channel_tabs FOR SELECT TO authenticated USING (app_private.chat_is_member(channel_id, ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
ALTER TABLE public.chat_channels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY chat_channels_member_select ON public.chat_channels FOR SELECT TO authenticated USING ((app_private.chat_is_member(id, ( SELECT auth.uid() AS uid)) OR ((kind = 'public'::text) AND (archived_at IS NULL) AND app_private.chat_is_workspace_member(workspace_id, ( SELECT auth.uid() AS uid)))));
--> statement-breakpoint
ALTER TABLE public.chat_mentions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY chat_mentions_owner_select ON public.chat_mentions FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
ALTER TABLE public.chat_message_cards ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY chat_message_cards_member_select ON public.chat_message_cards FOR SELECT TO authenticated USING (app_private.chat_is_member(channel_id, ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY chat_messages_member_select ON public.chat_messages FOR SELECT TO authenticated USING (app_private.chat_is_member(channel_id, ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
ALTER TABLE public.chat_messages_p00 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p01 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p02 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p03 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p04 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p05 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p06 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p07 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p08 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p09 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p10 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p11 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p12 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p13 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p14 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p15 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p16 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p17 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p18 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p19 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p20 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p21 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p22 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p23 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p24 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p25 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p26 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p27 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p28 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p29 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p30 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_messages_p31 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_pins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY chat_pins_member_select ON public.chat_pins FOR SELECT TO authenticated USING (app_private.chat_is_member(channel_id, ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
ALTER TABLE public.chat_reactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY chat_reactions_member_select ON public.chat_reactions FOR SELECT TO authenticated USING (app_private.chat_is_member(channel_id, ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p00 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p01 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p02 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p03 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p04 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p05 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p06 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p07 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p08 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p09 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p10 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p11 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p12 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p13 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p14 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p15 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p16 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p17 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p18 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p19 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p20 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p21 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p22 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p23 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p24 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p25 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p26 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p27 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p28 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p29 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p30 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reactions_p31 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chat_reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY chat_reports_owner_select ON public.chat_reports FOR SELECT TO authenticated USING ((reporter_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
ALTER TABLE public.chat_saved ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY chat_saved_owner_select ON public.chat_saved FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
ALTER TABLE public.chat_scheduled_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY chat_scheduled_messages_owner_select ON public.chat_scheduled_messages FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
ALTER TABLE public.chat_thread_follows ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY chat_thread_follows_owner_select ON public.chat_thread_follows FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.chat_attachments TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.chat_canvases TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.chat_channel_members TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.chat_channel_tabs TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.chat_channels TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.chat_mentions TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.chat_message_cards TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.chat_messages TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.chat_pins TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.chat_reactions TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.chat_reports TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.chat_saved TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.chat_scheduled_messages TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.chat_thread_follows TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_add_members(p_channel_id uuid, p_actor uuid, p_users uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_add_members(p_channel_id uuid, p_actor uuid, p_users uuid[]) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_add_members(p_channel_id uuid, p_actor uuid, p_users uuid[]) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_append_message(p_channel_id uuid, p_author_id uuid, p_kind text, p_body text, p_client_id text, p_thread_root bigint, p_attachments jsonb, p_card jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_append_message(p_channel_id uuid, p_author_id uuid, p_kind text, p_body text, p_client_id text, p_thread_root bigint, p_attachments jsonb, p_card jsonb) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_append_message(p_channel_id uuid, p_author_id uuid, p_kind text, p_body text, p_client_id text, p_thread_root bigint, p_attachments jsonb, p_card jsonb) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_application_cast(p_project_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_application_cast(p_project_id uuid, p_user_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_application_letter_changed() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_application_letter_changed() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_archive_channel(p_channel_id uuid, p_actor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_archive_channel(p_channel_id uuid, p_actor uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_archive_channel(p_channel_id uuid, p_actor uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_assert_capacity(p_channel_id uuid, p_users uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_assert_capacity(p_channel_id uuid, p_users uuid[]) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_assert_capacity(p_channel_id uuid, p_users uuid[]) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_assert_user_capacity(p_users uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_assert_user_capacity(p_users uuid[]) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_block_heads_up() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_block_heads_up() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_bootstrap(p_user_id uuid, p_since timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_bootstrap(p_user_id uuid, p_since timestamp with time zone) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_bootstrap(p_user_id uuid, p_since timestamp with time zone) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_can_dm(p_from uuid, p_to uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_can_dm(p_from uuid, p_to uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_can_dm(p_from uuid, p_to uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_can_signal(p_channel uuid, p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_can_signal(p_channel uuid, p_user uuid) TO nb_app;
GRANT ALL ON FUNCTION app_private.chat_can_signal(p_channel uuid, p_user uuid) TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_card_changed() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_card_changed() TO service_role;
GRANT ALL ON FUNCTION app_private.chat_card_changed() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_contact_cut(p_channel uuid, p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_contact_cut(p_channel uuid, p_user uuid) TO nb_app;
GRANT ALL ON FUNCTION app_private.chat_contact_cut(p_channel uuid, p_user uuid) TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_create_channel(p_project_id uuid, p_creator uuid, p_name text, p_description text, p_private boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_create_channel(p_project_id uuid, p_creator uuid, p_name text, p_description text, p_private boolean) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_create_channel(p_project_id uuid, p_creator uuid, p_name text, p_description text, p_private boolean) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_create_group(p_creator uuid, p_members uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_create_group(p_creator uuid, p_members uuid[]) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_create_group(p_creator uuid, p_members uuid[]) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_default_channel_name(p_project_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_default_channel_name(p_project_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app_private.chat_default_channel_name(p_project_id uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_default_channel_name(p_project_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_delete_message(p_channel_id uuid, p_seq bigint, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_delete_message(p_channel_id uuid, p_seq bigint, p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_delete_message(p_channel_id uuid, p_seq bigint, p_user_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_edit_message(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_body text) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_edit_message(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_body text) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_edit_message(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_body text) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_edit_message(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_body text, p_mentions uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_edit_message(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_body text, p_mentions uuid[]) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_edit_message(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_body text, p_mentions uuid[]) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_ensure_application_channel(p_application_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_ensure_application_channel(p_application_id uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_ensure_application_channel(p_application_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_get_or_create_dm(p_from uuid, p_to uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_get_or_create_dm(p_from uuid, p_to uuid, p_reason text) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_get_or_create_dm(p_from uuid, p_to uuid, p_reason text) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_inbox_unread(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_inbox_unread(p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_inbox_unread(p_user_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_is_blocked(p_a uuid, p_b uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_is_blocked(p_a uuid, p_b uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_is_blocked(p_a uuid, p_b uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_is_channel_admin(p_channel_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_is_channel_admin(p_channel_id uuid, p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_is_channel_admin(p_channel_id uuid, p_user_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_is_member(p_channel_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_is_member(p_channel_id uuid, p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_is_member(p_channel_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app_private.chat_is_member(p_channel_id uuid, p_user_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_is_parent_org_admin(p_project_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_is_parent_org_admin(p_project_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app_private.chat_is_parent_org_admin(p_project_id uuid, p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_is_parent_org_admin(p_project_id uuid, p_user_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_is_workspace_member(p_project_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_is_workspace_member(p_project_id uuid, p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_is_workspace_member(p_project_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app_private.chat_is_workspace_member(p_project_id uuid, p_user_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_join_channel(p_channel_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_join_channel(p_channel_id uuid, p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_join_channel(p_channel_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app_private.chat_join_channel(p_channel_id uuid, p_user_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_leave_channel(p_channel_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_leave_channel(p_channel_id uuid, p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_leave_channel(p_channel_id uuid, p_user_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_mark_read(p_channel_id uuid, p_user_id uuid, p_seq bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_mark_read(p_channel_id uuid, p_user_id uuid, p_seq bigint) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_mark_read(p_channel_id uuid, p_user_id uuid, p_seq bigint) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_mark_thread_read(p_channel_id uuid, p_user_id uuid, p_root bigint, p_seq bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_mark_thread_read(p_channel_id uuid, p_user_id uuid, p_root bigint, p_seq bigint) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_mark_thread_read(p_channel_id uuid, p_user_id uuid, p_root bigint, p_seq bigint) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_mark_unread(p_channel_id uuid, p_user_id uuid, p_seq bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_mark_unread(p_channel_id uuid, p_user_id uuid, p_seq bigint) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_mark_unread(p_channel_id uuid, p_user_id uuid, p_seq bigint) TO nb_app;
--> statement-breakpoint
GRANT ALL ON FUNCTION app_private.chat_org_general_post_guard() TO nb_app;
--> statement-breakpoint
GRANT ALL ON FUNCTION app_private.chat_org_read_only_guard() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_pin(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_on boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_pin(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_on boolean) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_pin(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_on boolean) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_post_application_update(p_application_id uuid, p_actor uuid, p_body text) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_post_application_update(p_application_id uuid, p_actor uuid, p_body text) TO nb_app;
--> statement-breakpoint
GRANT ALL ON FUNCTION app_private.chat_post_member_joined(p_project_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app_private.chat_post_member_joined(p_project_id uuid, p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_post_member_joined(p_project_id uuid, p_user_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_post_system(p_channel_id uuid, p_actor_id uuid, p_body text) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_post_system(p_channel_id uuid, p_actor_id uuid, p_body text) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_post_system(p_channel_id uuid, p_actor_id uuid, p_body text) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_react(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_emoji text, p_on boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_react(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_emoji text, p_on boolean) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_react(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_emoji text, p_on boolean) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_reconcile_application_members(p_project_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_reconcile_application_members(p_project_id uuid, p_user_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_remove_member(p_channel_id uuid, p_actor uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_remove_member(p_channel_id uuid, p_actor uuid, p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_remove_member(p_channel_id uuid, p_actor uuid, p_user_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_rename_group(p_channel_id uuid, p_actor uuid, p_title text) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_rename_group(p_channel_id uuid, p_actor uuid, p_title text) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_rename_group(p_channel_id uuid, p_actor uuid, p_title text) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_reparent_workspace(p_project_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_reparent_workspace(p_project_id uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_reparent_workspace(p_project_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_report(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_report(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_reason text) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_report(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_reason text) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_save_canvas(p_channel_id uuid, p_user_id uuid, p_title text, p_body text, p_asset_ids uuid[], p_base_version integer) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_save_canvas(p_channel_id uuid, p_user_id uuid, p_title text, p_body text, p_asset_ids uuid[], p_base_version integer) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_save_canvas(p_channel_id uuid, p_user_id uuid, p_title text, p_body text, p_asset_ids uuid[], p_base_version integer) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_send_message(p_channel_id uuid, p_author_id uuid, p_body text, p_client_id text, p_thread_root bigint, p_mentions uuid[], p_broadcast text, p_attachments jsonb, p_card jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_send_message(p_channel_id uuid, p_author_id uuid, p_body text, p_client_id text, p_thread_root bigint, p_mentions uuid[], p_broadcast text, p_attachments jsonb, p_card jsonb) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_send_message(p_channel_id uuid, p_author_id uuid, p_body text, p_client_id text, p_thread_root bigint, p_mentions uuid[], p_broadcast text, p_attachments jsonb, p_card jsonb) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_set_channel_privacy(p_channel_id uuid, p_actor uuid, p_private boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_set_channel_privacy(p_channel_id uuid, p_actor uuid, p_private boolean) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_set_channel_privacy(p_channel_id uuid, p_actor uuid, p_private boolean) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_set_member_role(p_channel_id uuid, p_actor uuid, p_user_id uuid, p_role text) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_set_member_role(p_channel_id uuid, p_actor uuid, p_user_id uuid, p_role text) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_set_member_role(p_channel_id uuid, p_actor uuid, p_user_id uuid, p_role text) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_set_member_state(p_channel_id uuid, p_user_id uuid, p_notify text, p_starred boolean, p_archived boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_set_member_state(p_channel_id uuid, p_user_id uuid, p_notify text, p_starred boolean, p_archived boolean) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_set_member_state(p_channel_id uuid, p_user_id uuid, p_notify text, p_starred boolean, p_archived boolean) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_set_thread_follow(p_channel_id uuid, p_user_id uuid, p_root bigint, p_on boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_set_thread_follow(p_channel_id uuid, p_user_id uuid, p_root bigint, p_on boolean) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_set_thread_follow(p_channel_id uuid, p_user_id uuid, p_root bigint, p_on boolean) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_sync_application_letter(p_application_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_sync_application_letter(p_application_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_sync_workspace_members(p_project_id uuid, p_user_id uuid, p_op text) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_sync_workspace_members(p_project_id uuid, p_user_id uuid, p_op text) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_sync_workspace_members(p_project_id uuid, p_user_id uuid, p_op text) TO authenticated;
GRANT ALL ON FUNCTION app_private.chat_sync_workspace_members(p_project_id uuid, p_user_id uuid, p_op text) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_unarchive_channel(p_channel_id uuid, p_actor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_unarchive_channel(p_channel_id uuid, p_actor uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_unarchive_channel(p_channel_id uuid, p_actor uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_update_channel(p_channel_id uuid, p_actor uuid, p_name text, p_topic text, p_description text) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.chat_update_channel(p_channel_id uuid, p_actor uuid, p_name text, p_topic text, p_description text) TO service_role;
GRANT ALL ON FUNCTION app_private.chat_update_channel(p_channel_id uuid, p_actor uuid, p_name text, p_topic text, p_description text) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.drop_chat_of_deleted_workspace() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.drop_chat_of_deleted_workspace() TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p00 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p00 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p01 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p01 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p02 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p02 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p03 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p03 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p04 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p04 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p05 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p05 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p06 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p06 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p07 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p07 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p08 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p08 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p09 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p09 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p10 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p10 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p11 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p11 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p12 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p12 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p13 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p13 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p14 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p14 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p15 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p15 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p16 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p16 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p17 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p17 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p18 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p18 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p19 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p19 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p20 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p20 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p21 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p21 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p22 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p22 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p23 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p23 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p24 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p24 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p25 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p25 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p26 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p26 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p27 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p27 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p28 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p28 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p29 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p29 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p30 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p30 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_attachments_p31 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_attachments_p31 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_canvases TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_canvases TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_channel_members TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_channel_members TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_channel_tabs TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_channel_tabs TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_channels TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_channels TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_mentions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_mentions TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_message_cards TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_message_cards TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p00 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p00 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p01 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p01 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p02 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p02 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p03 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p03 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p04 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p04 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p05 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p05 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p06 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p06 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p07 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p07 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p08 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p08 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p09 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p09 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p10 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p10 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p11 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p11 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p12 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p12 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p13 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p13 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p14 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p14 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p15 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p15 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p16 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p16 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p17 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p17 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p18 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p18 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p19 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p19 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p20 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p20 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p21 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p21 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p22 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p22 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p23 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p23 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p24 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p24 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p25 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p25 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p26 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p26 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p27 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p27 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p28 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p28 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p29 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p29 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p30 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p30 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_messages_p31 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_messages_p31 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_pins TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_pins TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p00 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p00 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p01 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p01 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p02 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p02 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p03 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p03 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p04 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p04 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p05 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p05 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p06 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p06 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p07 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p07 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p08 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p08 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p09 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p09 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p10 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p10 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p11 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p11 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p12 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p12 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p13 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p13 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p14 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p14 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p15 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p15 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p16 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p16 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p17 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p17 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p18 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p18 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p19 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p19 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p20 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p20 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p21 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p21 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p22 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p22 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p23 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p23 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p24 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p24 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p25 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p25 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p26 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p26 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p27 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p27 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p28 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p28 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p29 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p29 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p30 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p30 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reactions_p31 TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reactions_p31 TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_reports TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_reports TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_saved TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_saved TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_scheduled_messages TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_scheduled_messages TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.chat_thread_follows TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.chat_thread_follows TO nb_app;
--> statement-breakpoint
CREATE POLICY application_topic_read ON realtime.messages AS PERMISSIVE FOR SELECT TO authenticated USING (
CASE
    WHEN (( SELECT realtime.topic() AS topic) ~ '^presence:user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = ANY (ARRAY['presence'::text, 'broadcast'::text])) AND app_private.nb_can_observe_user_presence((split_part(( SELECT realtime.topic() AS topic), ':'::text, 3))::uuid))
    WHEN (( SELECT realtime.topic() AS topic) ~ '^presence:task:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = ANY (ARRAY['presence'::text, 'broadcast'::text])) AND (EXISTS ( SELECT 1
       FROM public.tasks task
      WHERE (((task.id)::text = split_part(( SELECT realtime.topic() AS topic), ':'::text, 3)) AND app_private.nb_workspace_tab_visible(task.workspace_id, 'tasks'::text)))))
    WHEN (( SELECT realtime.topic() AS topic) ~ '^project-stats:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = 'broadcast'::text) AND app_private.nb_workspace_can_read((split_part(( SELECT realtime.topic() AS topic), ':'::text, 2))::uuid))
    WHEN (( SELECT realtime.topic() AS topic) ~ '^chat:channel:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = 'broadcast'::text) AND app_private.chat_is_member((split_part(( SELECT realtime.topic() AS topic), ':'::text, 3))::uuid, ( SELECT auth.uid() AS uid)))
    WHEN (( SELECT realtime.topic() AS topic) ~ '^chat:typing:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = 'broadcast'::text) AND app_private.chat_is_member((split_part(( SELECT realtime.topic() AS topic), ':'::text, 3))::uuid, ( SELECT auth.uid() AS uid)))
    WHEN (( SELECT realtime.topic() AS topic) ~ '^chat:user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = 'broadcast'::text) AND (split_part(( SELECT realtime.topic() AS topic), ':'::text, 3) = (( SELECT auth.uid() AS uid))::text))
    ELSE false
END);
--> statement-breakpoint
CREATE POLICY application_topic_send ON realtime.messages AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (
CASE
    WHEN (( SELECT realtime.topic() AS topic) ~ '^presence:user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = ANY (ARRAY['presence'::text, 'broadcast'::text])) AND (split_part(( SELECT realtime.topic() AS topic), ':'::text, 3) = (( SELECT auth.uid() AS uid))::text) AND app_private.nb_can_publish_user_presence())
    WHEN (( SELECT realtime.topic() AS topic) ~ '^presence:task:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = ANY (ARRAY['presence'::text, 'broadcast'::text])) AND (EXISTS ( SELECT 1
       FROM public.tasks task
      WHERE (((task.id)::text = split_part(( SELECT realtime.topic() AS topic), ':'::text, 3)) AND app_private.nb_workspace_tab_visible(task.workspace_id, 'tasks'::text)))))
    WHEN (( SELECT realtime.topic() AS topic) ~ '^project-stats:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = 'broadcast'::text) AND app_private.nb_workspace_can_read((split_part(( SELECT realtime.topic() AS topic), ':'::text, 2))::uuid))
    WHEN (( SELECT realtime.topic() AS topic) ~ '^chat:channel:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN false
    WHEN (( SELECT realtime.topic() AS topic) ~ '^chat:typing:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = 'broadcast'::text) AND app_private.chat_can_signal((split_part(( SELECT realtime.topic() AS topic), ':'::text, 3))::uuid, ( SELECT auth.uid() AS uid)))
    ELSE false
END);
