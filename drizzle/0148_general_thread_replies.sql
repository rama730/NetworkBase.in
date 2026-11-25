-- Messages mix, Phase 5 (OrgChat board, bug 1): in an organization's #general set to "Only admins post",
-- members may still reply in threads, as the setting's own help text says. The guard now skips thread
-- replies (rows with a thread root); top-level posts stay admins-only. A thread reply that carries @channel
-- or @here (<!channel> / <!here> in the body) is still refused: it would notify the whole organization.
-- Same body as 0014 otherwise.
CREATE OR REPLACE FUNCTION app_private.chat_org_general_post_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.kind = 'user' AND NEW.author_id IS NOT NULL AND (NEW.thread_root_seq IS NULL OR NEW.body ~ '<!(channel|here)>') AND EXISTS (
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
