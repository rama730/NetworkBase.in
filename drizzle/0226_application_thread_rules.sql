-- An application's private thread is for the applicant and the people who can decide it, and nobody
-- else. Before this the thread was a snapshot taken on the first message: a demoted admin kept reading
-- it, a promoted admin never joined, anyone in it could add or remove people by hand, and deleting the
-- card message left the thread with no Accept or Decline controls.

-- 1. One place that says who belongs in an application thread: the applicant, the project owner and the
-- project's admins.
CREATE OR REPLACE FUNCTION app_private.chat_application_cast(p_project_id uuid, p_user_id uuid)
RETURNS TABLE (channel_id uuid, user_id uuid, role text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT ON (c.id, w.user_id) c.id, w.user_id, w.role
  FROM public.chat_channels c
  JOIN public.role_applications a ON a.id = c.application_id
  CROSS JOIN LATERAL (
    SELECT a.applicant_id AS user_id, 'member' AS role, 3 AS rank
    UNION ALL
    SELECT p.owner_id, 'owner', 1 FROM public.projects p WHERE p.id = c.project_id
    UNION ALL
    SELECT pm.user_id, CASE pm.role WHEN 'owner' THEN 'owner' ELSE 'admin' END, CASE pm.role WHEN 'owner' THEN 1 ELSE 2 END
    FROM public.project_members pm WHERE pm.project_id = c.project_id AND pm.role IN ('owner', 'admin')
  ) w
  WHERE c.project_id = p_project_id AND c.application_id IS NOT NULL
    AND (p_user_id IS NULL OR w.user_id = p_user_id)
  ORDER BY c.id, w.user_id, w.rank
$$;
--> statement-breakpoint
-- Pass a user to fix one person across the project's threads, or NULL to fix everyone.
-- ponytail: re-checks every application thread of the project. ceiling: one pass per role change, fine
-- while a project has hundreds of applications. upgrade: restrict to pending applications.
CREATE OR REPLACE FUNCTION app_private.chat_reconcile_application_members(p_project_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.chat_channel_members m
  USING public.chat_channels c
  WHERE c.id = m.channel_id AND c.project_id = p_project_id AND c.application_id IS NOT NULL
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
    FROM public.chat_channels ch WHERE ch.project_id = p_project_id AND ch.application_id IS NOT NULL
  ) counted
  WHERE c.id = counted.id AND c.member_count IS DISTINCT FROM counted.n;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_application_cast(uuid, uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_reconcile_application_members(uuid, uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- 2. Project membership changes now reach application threads. Removing someone from the project no
-- longer removes an applicant from their own thread.
CREATE OR REPLACE FUNCTION app_private.chat_sync_project_members(p_project_id uuid, p_user_id uuid, p_op text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_default uuid;
  v_added integer;
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

  SELECT id INTO v_default FROM public.chat_channels WHERE project_id = p_project_id AND is_default;
  IF NOT FOUND THEN
    INSERT INTO public.chat_channels (kind, name, project_id, is_default, description, created_by)
    SELECT 'public', 'general', p.id, true, 'Everyone in the project', p.owner_id
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
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  IF v_added > 0 THEN
    UPDATE public.chat_channels SET member_count = member_count + v_added WHERE id = v_default;
  END IF;
  PERFORM app_private.chat_reconcile_application_members(p_project_id, p_user_id);
  RETURN v_default;
END
$$;
--> statement-breakpoint

-- 3. Nobody is added to or removed from an application thread by hand.
CREATE OR REPLACE FUNCTION app_private.chat_add_members(p_channel_id uuid, p_actor uuid, p_users uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_channel record;
  v_new uuid[];
  v_added integer;
BEGIN
  SELECT kind, project_id, archived_at, application_id INTO v_channel FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
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
  IF v_channel.project_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM unnest(v_new) AS u WHERE NOT app_private.chat_is_project_member(v_channel.project_id, u)) THEN
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
CREATE OR REPLACE FUNCTION app_private.chat_remove_member(p_channel_id uuid, p_actor uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
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

-- 4. The application card message stays: it carries Accept and Decline in chat.
CREATE OR REPLACE FUNCTION app_private.chat_delete_message(p_channel_id uuid, p_seq bigint, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
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

-- 5. Opening the thread again puts a missing card back (threads that lost it before the rule above).
CREATE OR REPLACE FUNCTION app_private.chat_ensure_application_channel(p_application_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_app record;
  v_id uuid;
  v_added integer;
  v_seq bigint;
  v_card jsonb;
BEGIN
  SELECT a.id, a.project_id, a.applicant_id, a.message INTO v_app
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

  INSERT INTO public.chat_channels (kind, project_id, application_id, created_by)
  VALUES ('private', v_app.project_id, p_application_id, v_app.applicant_id)
  ON CONFLICT (application_id) WHERE application_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.chat_channels WHERE application_id = p_application_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.chat_channel_members (channel_id, user_id, role)
  SELECT v_id, v_app.applicant_id, 'member'
  UNION
  SELECT v_id, p.owner_id, 'owner' FROM public.projects p WHERE p.id = v_app.project_id
  UNION
  SELECT v_id, pm.user_id, CASE pm.role WHEN 'owner' THEN 'owner' ELSE 'admin' END
  FROM public.project_members pm
  WHERE pm.project_id = v_app.project_id AND pm.role IN ('owner', 'admin')
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

-- 6. Bring existing threads in line: current admins join, demoted admins and removed owners leave.
SELECT app_private.chat_reconcile_application_members(p.id, NULL)
FROM public.projects p
WHERE EXISTS (SELECT 1 FROM public.chat_channels c WHERE c.project_id = p.id AND c.application_id IS NOT NULL);
