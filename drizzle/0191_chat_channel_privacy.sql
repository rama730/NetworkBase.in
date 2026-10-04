-- 0191: channel admins switch a named project channel between public and private
-- (Details → About). Making it private keeps its members and hides it from Browse;
-- making it public lets every project member find, preview and join it. Never the
-- default channel, application threads, group chats, DMs or archived channels.

CREATE OR REPLACE FUNCTION app_private.chat_set_channel_privacy(p_channel_id uuid, p_actor uuid, p_private boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_channel record;
  v_kind text := CASE WHEN p_private THEN 'private' ELSE 'public' END;
BEGIN
  SELECT kind, name, project_id, application_id, is_default, archived_at INTO v_channel
  FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  IF NOT FOUND OR v_channel.kind = 'dm' OR v_channel.name IS NULL OR v_channel.project_id IS NULL
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

DO $chat_privacy_grants$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private' AND p.proname = 'chat_set_channel_privacy'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.signature);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', fn.signature);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.signature);
    END IF;
  END LOOP;
END
$chat_privacy_grants$;
