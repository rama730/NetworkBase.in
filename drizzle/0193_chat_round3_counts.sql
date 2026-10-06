-- 0193: messaging round 3 (UX review #1, #6, #7, #9).
-- #1 An @mention in a thread you follow files as a mention, not "replied in a thread"
--    (send and edit upgrade the follower's 'thread_reply' row).
-- #6 Leaving a thread marks its reply items read, so they leave the badge.
-- #7 Reading a thread recounts that conversation's @ count in the sidebar.
-- #9 Muted members who are mentioned get a live hint (never a push).
-- #22 An edit can clear the text of a message that has files (removes the caption).
-- CREATE OR REPLACE keeps each function's existing grants.

CREATE OR REPLACE FUNCTION app_private.chat_send_message(
  p_channel_id uuid,
  p_author_id uuid,
  p_body text,
  p_client_id text DEFAULT NULL,
  p_thread_root bigint DEFAULT NULL,
  p_mentions uuid[] DEFAULT '{}',
  p_broadcast text DEFAULT NULL,
  p_attachments jsonb DEFAULT '[]'::jsonb,
  p_card jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
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

  SELECT id, kind, name, project_id, archived_at, member_count INTO v_channel FROM public.chat_channels WHERE id = p_channel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_not_found';
  END IF;
  IF NOT app_private.chat_is_member(p_channel_id, p_author_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_channel_archived';
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
  v_direct := v_channel.kind = 'dm' OR (v_channel.kind = 'private' AND v_channel.project_id IS NULL);
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
$$;
--> statement-breakpoint

-- Edit: empty text is allowed when the message keeps files or a card (it removes a caption).
CREATE OR REPLACE FUNCTION app_private.chat_edit_message(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_body text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_body IS NULL OR char_length(p_body) > 4000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_body';
  END IF;
  IF btrim(p_body) = ''
    AND NOT EXISTS (SELECT 1 FROM public.chat_attachments a WHERE a.channel_id = p_channel_id AND a.message_seq = p_seq)
    AND NOT EXISTS (SELECT 1 FROM public.chat_message_cards k WHERE k.channel_id = p_channel_id AND k.message_seq = p_seq) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_body';
  END IF;
  UPDATE public.chat_messages SET body = p_body, edited_at = now()
  WHERE channel_id = p_channel_id AND channel_seq = p_seq AND author_id = p_user_id
    AND kind = 'user' AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_editable';
  END IF;
  UPDATE public.chat_channels
  SET last_preview = CASE WHEN btrim(p_body) = '' THEN 'Attachment' ELSE left(regexp_replace(btrim(p_body), '\s+', ' ', 'g'), 120) END
  WHERE id = p_channel_id AND last_top_seq = p_seq;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.chat_edit_message(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_body text, p_mentions uuid[])
RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_added uuid[];
  v_removed uuid[];
BEGIN
  PERFORM app_private.chat_edit_message(p_channel_id, p_seq, p_user_id, p_body);

  WITH gone AS (
    DELETE FROM public.chat_mentions
    WHERE channel_id = p_channel_id AND message_seq = p_seq AND kind = 'user'
      AND NOT (user_id = ANY (coalesce(p_mentions, '{}')))
    RETURNING user_id, read_at
  )
  SELECT coalesce(array_agg(user_id) FILTER (WHERE read_at IS NULL), '{}') INTO v_removed FROM gone;
  UPDATE public.chat_channel_members
  SET mention_count = greatest(mention_count - 1, 0)
  WHERE channel_id = p_channel_id AND user_id = ANY (v_removed) AND last_read_seq < p_seq;

  WITH added AS (
    INSERT INTO public.chat_mentions (user_id, channel_id, message_seq, kind)
    SELECT m.user_id, p_channel_id, p_seq, 'user'
    FROM public.chat_channel_members m
    WHERE m.channel_id = p_channel_id AND m.user_id = ANY (coalesce(p_mentions, '{}')) AND m.user_id <> p_user_id
    -- A thread follower's reply row becomes a mention when an edit adds them (#1).
    ON CONFLICT (user_id, channel_id, message_seq) DO UPDATE SET kind = 'user', read_at = NULL
      WHERE public.chat_mentions.kind = 'thread_reply'
    RETURNING user_id
  )
  SELECT coalesce(array_agg(user_id), '{}') INTO v_added FROM added;
  UPDATE public.chat_channel_members
  SET mention_count = mention_count + 1
  WHERE channel_id = p_channel_id AND user_id = ANY (v_added) AND last_read_seq < p_seq;

  RETURN v_added;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.chat_set_thread_follow(p_channel_id uuid, p_user_id uuid, p_root bigint, p_on boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT app_private.chat_is_member(p_channel_id, p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
  IF p_on THEN
    INSERT INTO public.chat_thread_follows (user_id, channel_id, root_seq, last_read_seq)
    SELECT p_user_id, p_channel_id, m.channel_seq, coalesce(m.last_reply_seq, m.channel_seq)
    FROM public.chat_messages m
    WHERE m.channel_id = p_channel_id AND m.channel_seq = p_root AND m.thread_root_seq IS NULL
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.chat_thread_follows WHERE user_id = p_user_id AND channel_id = p_channel_id AND root_seq = p_root;
    -- Its unread replies leave the Inbox with it (mentions stay).
    UPDATE public.chat_mentions mn SET read_at = now()
    FROM public.chat_messages msg
    WHERE mn.user_id = p_user_id AND mn.channel_id = p_channel_id AND mn.kind = 'thread_reply' AND mn.read_at IS NULL
      AND msg.channel_id = mn.channel_id AND msg.channel_seq = mn.message_seq AND msg.thread_root_seq = p_root;
  END IF;
END
$$;
--> statement-breakpoint

-- Thread cursor: that thread's mentions and replies at or before it are read, and the
-- conversation's @ count is what's left unread (same recount as the Inbox mark-read).
CREATE OR REPLACE FUNCTION app_private.chat_mark_thread_read(p_channel_id uuid, p_user_id uuid, p_root bigint, p_seq bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_moved boolean;
BEGIN
  UPDATE public.chat_thread_follows
  SET last_read_seq = p_seq
  WHERE user_id = p_user_id AND channel_id = p_channel_id AND root_seq = p_root AND last_read_seq < p_seq;
  v_moved := FOUND;
  -- Also for non-followers who were mentioned in the thread.
  UPDATE public.chat_mentions mn SET read_at = now()
  FROM public.chat_messages msg
  WHERE mn.user_id = p_user_id AND mn.channel_id = p_channel_id AND mn.message_seq <= p_seq AND mn.read_at IS NULL
    AND msg.channel_id = mn.channel_id AND msg.channel_seq = mn.message_seq AND msg.thread_root_seq = p_root;
  IF FOUND THEN
    UPDATE public.chat_channel_members m SET mention_count = (
      SELECT count(*)::int FROM public.chat_mentions mn
      WHERE mn.user_id = m.user_id AND mn.channel_id = m.channel_id AND mn.read_at IS NULL
        AND mn.kind <> 'thread_reply' AND mn.message_seq > m.last_read_seq
    )
    WHERE m.channel_id = p_channel_id AND m.user_id = p_user_id AND m.mention_count > 0;
  END IF;
  RETURN v_moved;
END
$$;
