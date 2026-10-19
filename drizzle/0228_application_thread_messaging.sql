-- Messages in an application thread: a reply notifies the other side like a direct message, a decision line counts
-- as unread and shows in the preview, a block between two people in the thread stops posting, and the card follows
-- edits (message, role, details) as well as status.
-- 1. Decision lines count (only application threads change).
CREATE OR REPLACE FUNCTION app_private.chat_append_message(p_channel_id uuid, p_author_id uuid, p_kind text, p_body text, p_client_id text, p_thread_root bigint, p_attachments jsonb, p_card jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
--> statement-breakpoint
-- 2. Replies notify; blocks stop posting.
CREATE OR REPLACE FUNCTION app_private.chat_send_message(p_channel_id uuid, p_author_id uuid, p_body text, p_client_id text DEFAULT NULL::text, p_thread_root bigint DEFAULT NULL::bigint, p_mentions uuid[] DEFAULT '{}'::uuid[], p_broadcast text DEFAULT NULL::text, p_attachments jsonb DEFAULT '[]'::jsonb, p_card jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  SELECT id, kind, name, project_id, archived_at, member_count, application_id INTO v_channel FROM public.chat_channels WHERE id = p_channel_id;
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
  v_direct := v_channel.kind = 'dm' OR (v_channel.kind = 'private' AND v_channel.project_id IS NULL) OR v_channel.application_id IS NOT NULL;
  IF v_direct OR cardinality(v_mentioned) > 0 OR p_thread_root IS NOT NULL THEN
    SELECT coalesce(array_agg(m.user_id), '{}'),
           coalesce(array_agg(m.user_id) FILTER (WHERE m.notify = 'mute'), '{}'),
           coalesce(array_agg(m.user_id) FILTER (WHERE f.user_id IS NOT NULL), '{}')
    INTO v_notify, v_muted, v_follows
    FROM public.chat_channel_members m
    LEFT JOIN public.chat_thread_follows f
      ON p_thread_root IS NOT NULL AND f.user_id = m.user_id AND f.channel_id = p_channel_id AND f.root_seq = p_thread_root
    WHERE m.channel_id = p_channel_id AND m.user_id <> p_author_id
      AND (
        m.user_id = ANY (v_mentioned)
        OR (m.notify <> 'mute' AND ((v_direct AND m.notify = 'all') OR f.user_id IS NOT NULL))
      );
  END IF;

  RETURN v_result || jsonb_build_object('notify', to_jsonb(v_notify), 'muted', to_jsonb(v_muted),
    'follows', to_jsonb(v_follows), 'channel_kind', v_channel.kind);
END
$function$;
--> statement-breakpoint
-- 3. An open card refetches when the applicant edits it too.
DROP TRIGGER IF EXISTS chat_card_changed_application ON public.role_applications;
--> statement-breakpoint
CREATE TRIGGER chat_card_changed_application
AFTER UPDATE OF status, message, role_id, details, decision_reason_code ON public.role_applications
FOR EACH ROW WHEN (
  OLD.status IS DISTINCT FROM NEW.status OR OLD.message IS DISTINCT FROM NEW.message OR OLD.role_id IS DISTINCT FROM NEW.role_id
  OR OLD.details IS DISTINCT FROM NEW.details OR OLD.decision_reason_code IS DISTINCT FROM NEW.decision_reason_code
)
EXECUTE FUNCTION app_private.chat_card_changed('application');
