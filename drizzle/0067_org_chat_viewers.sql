-- Organization viewers and chat (audit 2026-11-09: 7.2, 7.3, N40).
-- A viewer of an organization is not a chat member of it: they can't create or join its channels or be added to
-- them, a demotion to viewer takes them out of every channel, and a promotion from viewer adds them to #general.
CREATE OR REPLACE FUNCTION app_private.chat_is_workspace_member(p_project_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.workspace_members pm
    JOIN public.workspaces p ON p.id = pm.workspace_id AND p.deleted_at IS NULL
    WHERE pm.workspace_id = p_project_id AND pm.user_id = p_user_id
      AND NOT (p.kind = 'organization' AND pm.role = 'viewer')
  )
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_sync_workspace_members(p_project_id uuid, p_user_id uuid, p_op text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    -- An organization's viewers are in none of its channels (audit 7.3): becoming a viewer takes them out of all.
    IF coalesce(v_is_org, false) AND EXISTS (
      SELECT 1 FROM public.workspace_members WHERE workspace_id = p_project_id AND user_id = p_user_id AND role = 'viewer'
    ) THEN
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
      RETURN v_default;
    END IF;
    UPDATE public.chat_channel_members m
    SET role = CASE pm.role WHEN 'owner' THEN 'owner' WHEN 'admin' THEN 'admin' ELSE 'member' END
    FROM public.workspace_members pm
    WHERE m.channel_id = v_default AND m.user_id = p_user_id
      AND pm.workspace_id = p_project_id AND pm.user_id = p_user_id;
    -- Falls through: someone who was a viewer joins #general now (audit N40); everyone else is already in it.
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
$function$;
