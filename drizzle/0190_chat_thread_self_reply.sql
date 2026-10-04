-- 0190: replying in a thread you started failed ("ON CONFLICT DO UPDATE command cannot
-- affect row a second time"): the reply author and the root author are the same user, so
-- the follows upsert listed them twice. Same function as 0180, follows insert de-duplicated.

CREATE OR REPLACE FUNCTION app_private.chat_append_message(
  p_channel_id uuid,
  p_author_id uuid,
  p_kind text,
  p_body text,
  p_client_id text,
  p_thread_root bigint,
  p_attachments jsonb,
  p_card jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_seq bigint;
  v_existing bigint;
  v_now timestamptz := now();
  v_top boolean := p_thread_root IS NULL AND p_kind = 'user';
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
