-- Messages mix, Phase 12: "Seen" in one-to-one messages (Rich board). Both people must keep "Send read receipts"
-- on (the default); a block hides it both ways; groups, channels, notes to self and application conversations never
-- show it. seen_seq / seen_at only grow: Mark unread moves last_read_seq back but never un-sees (it is not changed here).
-- Give up rather than queue reads and sends behind this migration's locks.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE public.chat_channel_members
  ADD COLUMN seen_seq bigint,
  ADD COLUMN seen_at timestamptz;
--> statement-breakpoint
ALTER TABLE public.profiles ADD COLUMN read_receipts boolean NOT NULL DEFAULT true;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_mark_read(p_channel_id uuid, p_user_id uuid, p_seq bigint) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_moved boolean;
  v_share boolean;
BEGIN
  -- A read becomes "seen" only in a DM, while the reader keeps read receipts on, and never across a block:
  -- reads made with receipts off (or while blocked) never surface later.
  SELECT c.kind = 'dm' AND coalesce(p.read_receipts, true)
         AND NOT EXISTS (SELECT 1 FROM public.chat_channel_members o
                         WHERE o.channel_id = p_channel_id AND o.user_id <> p_user_id AND app_private.blocked_between(p_user_id, o.user_id))
  INTO v_share
  FROM public.chat_channels c, public.profiles p
  WHERE c.id = p_channel_id AND p.id = p_user_id;
  v_share := coalesce(v_share, false);
  UPDATE public.chat_channel_members m
  SET last_read_seq = p_seq,
      seen_at = CASE WHEN v_share AND coalesce(m.seen_seq, 0) < p_seq THEN now() ELSE m.seen_at END,
      seen_seq = CASE WHEN v_share THEN greatest(coalesce(m.seen_seq, 0), p_seq) ELSE m.seen_seq END
  FROM public.chat_channels c
  WHERE m.channel_id = p_channel_id AND m.user_id = p_user_id
    AND c.id = m.channel_id AND p_seq <= c.last_seq AND m.last_read_seq < p_seq;
  v_moved := FOUND;
  IF v_moved THEN
    UPDATE public.chat_mentions mn SET read_at = now()
    FROM public.chat_messages msg
    WHERE mn.user_id = p_user_id AND mn.channel_id = p_channel_id AND mn.message_seq <= p_seq AND mn.read_at IS NULL
      AND msg.channel_id = mn.channel_id AND msg.channel_seq = mn.message_seq AND msg.thread_root_seq IS NULL;
    -- Same definition as Mark unread: unread mentions the read did not reach.
    UPDATE public.chat_channel_members m
    SET mention_count = (
      SELECT count(*)::int FROM public.chat_mentions mn
      WHERE mn.user_id = p_user_id AND mn.channel_id = p_channel_id
        AND mn.message_seq > p_seq AND mn.kind <> 'thread_reply' AND mn.read_at IS NULL
    )
    WHERE m.channel_id = p_channel_id AND m.user_id = p_user_id;
  END IF;
  RETURN v_moved;
END
$$;
