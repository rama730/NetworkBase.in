-- 0185: channel admins may rename the default channel too (it stays the
-- project's default; only the name check remains). Moved here from an edit to
-- the already-applied 0180, which must stay byte-identical.
CREATE OR REPLACE FUNCTION app_private.chat_update_channel(
  p_channel_id uuid,
  p_actor uuid,
  p_name text,
  p_topic text,
  p_description text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;
