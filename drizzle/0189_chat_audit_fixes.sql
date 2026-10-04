-- 0189: messaging audit fixes (docs/audits/ponytail-messages-system-comprehensive-audit-2026-10-04.md).
-- LOAD-04: reading a channel or thread now stamps read_at on the mentions it
-- covers, so "unread Inbox item" = read_at IS NULL and the count reads a small
-- partial index instead of every mention from the last 90 days.
-- MUT-01: editing a message keeps its @person mentions in step with the body.

-- Channel cursor: top-level mentions at or before it are read.
CREATE OR REPLACE FUNCTION app_private.chat_mark_read(p_channel_id uuid, p_user_id uuid, p_seq bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_moved boolean;
BEGIN
  UPDATE public.chat_channel_members m
  SET last_read_seq = p_seq, mention_count = 0
  FROM public.chat_channels c
  WHERE m.channel_id = p_channel_id AND m.user_id = p_user_id
    AND c.id = m.channel_id AND p_seq <= c.last_seq AND m.last_read_seq < p_seq;
  v_moved := FOUND;
  IF v_moved THEN
    UPDATE public.chat_mentions mn SET read_at = now()
    FROM public.chat_messages msg
    WHERE mn.user_id = p_user_id AND mn.channel_id = p_channel_id AND mn.message_seq <= p_seq AND mn.read_at IS NULL
      AND msg.channel_id = mn.channel_id AND msg.channel_seq = mn.message_seq AND msg.thread_root_seq IS NULL;
  END IF;
  RETURN v_moved;
END
$$;

-- Thread cursor: that thread's mentions and replies at or before it are read.
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
  RETURN v_moved;
END
$$;

-- One-time: mentions the cursors already cover become read.
UPDATE public.chat_mentions mn SET read_at = now()
FROM public.chat_messages msg, public.chat_channel_members mem
WHERE mn.read_at IS NULL
  AND msg.channel_id = mn.channel_id AND msg.channel_seq = mn.message_seq
  AND mem.channel_id = mn.channel_id AND mem.user_id = mn.user_id
  AND msg.thread_root_seq IS NULL AND mn.message_seq <= mem.last_read_seq;
UPDATE public.chat_mentions mn SET read_at = now()
FROM public.chat_messages msg, public.chat_thread_follows f
WHERE mn.read_at IS NULL
  AND msg.channel_id = mn.channel_id AND msg.channel_seq = mn.message_seq
  AND f.user_id = mn.user_id AND f.channel_id = mn.channel_id AND f.root_seq = msg.thread_root_seq
  AND mn.message_seq <= f.last_read_seq;

CREATE INDEX IF NOT EXISTS chat_mentions_unread_idx ON public.chat_mentions (user_id) WHERE read_at IS NULL;

CREATE OR REPLACE FUNCTION app_private.chat_inbox_unread(p_user_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*)::int
  FROM public.chat_mentions mn
  JOIN public.chat_channel_members mem ON mem.channel_id = mn.channel_id AND mem.user_id = mn.user_id
  JOIN public.chat_messages msg ON msg.channel_id = mn.channel_id AND msg.channel_seq = mn.message_seq
  WHERE mn.user_id = p_user_id AND mn.read_at IS NULL AND msg.deleted_at IS NULL AND mem.notify <> 'mute'
$$;

-- Edit with mention sync. Returns the newly mentioned people (they get a hint).
-- ponytail: @channel/@here added or removed by an edit aren't re-synced. ceiling:
-- a broadcast edited in or out keeps its original mentions. upgrade: if asked.
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
    ON CONFLICT DO NOTHING
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

DO $chat_audit_grants$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private'
      AND p.proname IN ('chat_mark_read', 'chat_mark_thread_read', 'chat_inbox_unread', 'chat_edit_message')
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
$chat_audit_grants$;
