-- Two-person live check (2026-11-26, docs/superpowers/plans/2026-11-26-messages-person-b-findings.md).
-- #6: deleting a thread reply moves its thread's reply count, last reply and followers' unread back to the replies
--     left, and drops the deleted message's unread mentions; existing threads are repaired once.
-- #11: #general says "Everyone in the organization" / "Everyone in the workspace", never "the project".
-- #18: titles saved with spaces around them are trimmed ("In Network for builders ." in the create-channel dialog).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_delete_message(p_channel_id uuid, p_seq bigint, p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_author uuid;
  v_root bigint;
BEGIN
  SELECT author_id, thread_root_seq INTO v_author, v_root FROM public.chat_messages
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
  -- Unread mentions of a deleted message stop counting on the conversation's badge. Only ones the badge still counts:
  -- after the person's read point (the chat_mark_read rule), so a newer @ is never cleared by an older one.
  UPDATE public.chat_channel_members m SET mention_count = greatest(m.mention_count - 1, 0)
  FROM public.chat_mentions mn
  WHERE mn.channel_id = p_channel_id AND mn.message_seq = p_seq AND mn.kind <> 'thread_reply' AND mn.read_at IS NULL
    AND m.channel_id = p_channel_id AND m.user_id = mn.user_id AND m.mention_count > 0 AND m.last_read_seq < p_seq;
  DELETE FROM public.chat_mentions WHERE channel_id = p_channel_id AND message_seq = p_seq;
  -- A deleted reply leaves its thread: the count, the last reply and the followers' unread move back to the replies left.
  -- A thread whose message and every reply are deleted then disappears (the timeline drops deleted rows with 0 replies).
  IF v_root IS NOT NULL THEN
    -- The same lock a send takes: a reply landing now can't be lost from the count.
    PERFORM 1 FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
    UPDATE public.chat_messages r
    SET reply_count = live.n, last_reply_seq = live.last_seq,
        last_reply_at = (SELECT x.created_at FROM public.chat_messages x WHERE x.channel_id = p_channel_id AND x.channel_seq = live.last_seq)
    FROM (
      SELECT count(*)::int AS n, max(p.channel_seq) AS last_seq FROM public.chat_messages p
      WHERE p.channel_id = p_channel_id AND p.thread_root_seq = v_root AND p.deleted_at IS NULL
    ) AS live
    WHERE r.channel_id = p_channel_id AND r.channel_seq = v_root;
  END IF;
  UPDATE public.chat_channels SET last_preview = 'Message deleted'
  WHERE id = p_channel_id AND last_top_seq = p_seq;
END
$$;
--> statement-breakpoint
WITH live AS (
  SELECT r.channel_id, r.channel_seq,
         count(p.channel_seq) FILTER (WHERE p.deleted_at IS NULL)::int AS n,
         max(p.channel_seq) FILTER (WHERE p.deleted_at IS NULL) AS last_seq
  FROM public.chat_messages r
  JOIN public.chat_messages p ON p.channel_id = r.channel_id AND p.thread_root_seq = r.channel_seq
  WHERE r.reply_count > 0
  GROUP BY r.channel_id, r.channel_seq
)
UPDATE public.chat_messages r
SET reply_count = live.n, last_reply_seq = live.last_seq,
    last_reply_at = (SELECT x.created_at FROM public.chat_messages x WHERE x.channel_id = r.channel_id AND x.channel_seq = live.last_seq)
FROM live
WHERE r.channel_id = live.channel_id AND r.channel_seq = live.channel_seq
  AND (r.reply_count <> live.n OR r.last_reply_seq IS DISTINCT FROM live.last_seq);
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
           CASE WHEN p.parent_id IS NOT NULL THEN 'Everyone in ' || p.title WHEN p.kind = 'organization' THEN 'Everyone in the organization' ELSE 'Everyone in the workspace' END, p.owner_id
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
--> statement-breakpoint
UPDATE public.chat_channels c
SET description = CASE WHEN p.kind = 'organization' THEN 'Everyone in the organization' ELSE 'Everyone in the workspace' END
FROM public.workspaces p
WHERE p.id = c.workspace_id AND c.is_default AND c.description = 'Everyone in the project';
--> statement-breakpoint
UPDATE public.workspaces SET title = btrim(title) WHERE title <> btrim(title);
