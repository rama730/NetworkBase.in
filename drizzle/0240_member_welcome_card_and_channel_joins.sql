-- 0240_member_welcome_card_and_channel_joins.sql
-- Lean Slack-style channel and project member joined events.

--> statement-breakpoint

-- 1. Enhance chat_join_channel to clearly record the joined channel name
CREATE OR REPLACE FUNCTION app_private.chat_join_channel(p_channel_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_channel record;
  v_added integer;
BEGIN
  SELECT kind, project_id, archived_at, name INTO v_channel FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  IF NOT FOUND OR v_channel.kind <> 'public' OR v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_channel_not_joinable';
  END IF;
  IF NOT app_private.chat_is_project_member(v_channel.project_id, p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_project_member';
  END IF;
  PERFORM app_private.chat_assert_capacity(p_channel_id, ARRAY[p_user_id]);
  INSERT INTO public.chat_channel_members (channel_id, user_id) VALUES (p_channel_id, p_user_id) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  IF v_added > 0 THEN
    UPDATE public.chat_channels SET member_count = member_count + 1 WHERE id = p_channel_id;
    PERFORM app_private.chat_post_system(p_channel_id, p_user_id, 'joined #' || coalesce(v_channel.name, 'general'));
  END IF;
END
$$;

--> statement-breakpoint

-- 2. Create chat_post_member_joined function for atomic, deduplicated project arrival in #general
CREATE OR REPLACE FUNCTION app_private.chat_post_member_joined(
  p_project_id uuid,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_default uuid;
  v_channel_name text;
  v_already_joined boolean;
BEGIN
  -- 1. Locate default channel for this project
  SELECT id, coalesce(name, 'general') INTO v_default, v_channel_name
  FROM public.chat_channels
  WHERE project_id = p_project_id AND is_default;

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

-- 3. Connect chat_sync_project_members to post arrival notice when a member joins
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
    IF p_user_id IS NOT NULL THEN
      PERFORM app_private.chat_post_member_joined(p_project_id, p_user_id);
    END IF;
  END IF;
  PERFORM app_private.chat_reconcile_application_members(p_project_id, p_user_id);
  RETURN v_default;
END
$$;

--> statement-breakpoint

-- 4. Grants for app_private functions to service_role and authenticated
GRANT EXECUTE ON FUNCTION app_private.chat_post_member_joined(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.chat_sync_project_members(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.chat_join_channel(uuid, uuid) TO authenticated, service_role;
