-- 0192: one mute rule for the Inbox (round-2 UX review #36, #200). In a muted
-- conversation your @mentions still count (like Slack); thread replies don't.
-- The sidebar row, the Inbox list, the Threads tab and every badge now agree.
-- CREATE OR REPLACE keeps the function's existing grants.

CREATE OR REPLACE FUNCTION app_private.chat_inbox_unread(p_user_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*)::int
  FROM public.chat_mentions mn
  JOIN public.chat_channel_members mem ON mem.channel_id = mn.channel_id AND mem.user_id = mn.user_id
  JOIN public.chat_messages msg ON msg.channel_id = mn.channel_id AND msg.channel_seq = mn.message_seq
  WHERE mn.user_id = p_user_id AND mn.read_at IS NULL AND msg.deleted_at IS NULL
    AND (mn.kind <> 'thread_reply' OR mem.notify <> 'mute')
$$;
