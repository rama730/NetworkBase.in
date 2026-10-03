-- Shared channel canvases (one per channel). The body is markdown; images are
-- chat-attachments assets listed in asset_ids so channel members can open them.
-- ponytail: last writer wins per version (optimistic check). upgrade: Yjs
-- co-editing when two people editing at once becomes common.

CREATE TABLE IF NOT EXISTS public.chat_canvases (
  channel_id uuid PRIMARY KEY REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 100000),
  asset_ids uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(asset_ids) <= 50),
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_canvases_asset_ids_idx ON public.chat_canvases USING gin (asset_ids);

CREATE OR REPLACE FUNCTION app_private.chat_save_canvas(
  p_channel_id uuid, p_user_id uuid, p_title text, p_body text, p_asset_ids uuid[], p_base_version integer
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
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

ALTER TABLE public.chat_canvases ENABLE ROW LEVEL SECURITY;

DO $chat_canvas_grants$
BEGIN
  REVOKE ALL ON FUNCTION app_private.chat_save_canvas(uuid, uuid, text, text, uuid[], integer) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.chat_canvases FROM anon, authenticated;
    GRANT SELECT ON public.chat_canvases TO authenticated;
    REVOKE ALL ON FUNCTION app_private.chat_save_canvas(uuid, uuid, text, text, uuid[], integer) FROM anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON public.chat_canvases TO service_role;
    GRANT EXECUTE ON FUNCTION app_private.chat_save_canvas(uuid, uuid, text, text, uuid[], integer) TO service_role;
  END IF;
END
$chat_canvas_grants$;

DROP POLICY IF EXISTS chat_canvases_member_select ON public.chat_canvases;
CREATE POLICY chat_canvases_member_select ON public.chat_canvases FOR SELECT TO authenticated
USING (app_private.chat_is_member(channel_id, (SELECT auth.uid())));
