-- 0183: typing moves to its own topic. Supabase checks topic permissions once,
-- at join, not per event, so letting members send on chat:channel:<id> let any
-- member broadcast fake message/edit/delete/pin events to everyone else.
--   chat:channel:<id>  members read; only the server sends (REST, service role)
--   chat:typing:<id>   members read and send (typing on/off, client-side)
-- Every other branch is copied verbatim from 0181.

DROP POLICY IF EXISTS application_topic_read ON realtime.messages;
DROP POLICY IF EXISTS application_topic_send ON realtime.messages;

CREATE POLICY application_topic_read ON realtime.messages
FOR SELECT TO authenticated
USING (
  CASE
    WHEN (SELECT realtime.topic()) ~ '^presence:user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension IN ('presence', 'broadcast')
      AND app_private.nb_can_observe_user_presence(split_part((SELECT realtime.topic()), ':', 3)::uuid)
    WHEN (SELECT realtime.topic()) ~ '^presence:task:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension IN ('presence', 'broadcast')
      AND EXISTS (
        SELECT 1 FROM public.tasks task
        WHERE task.id::text = split_part((SELECT realtime.topic()), ':', 3)
          AND app_private.nb_project_can_read(task.project_id)
      )
    WHEN (SELECT realtime.topic()) ~ '^project-stats:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension = 'broadcast'
      AND app_private.nb_project_can_read(split_part((SELECT realtime.topic()), ':', 2)::uuid)
    WHEN (SELECT realtime.topic()) ~ '^chat:channel:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension = 'broadcast'
      AND app_private.chat_is_member(split_part((SELECT realtime.topic()), ':', 3)::uuid, (SELECT auth.uid()))
    WHEN (SELECT realtime.topic()) ~ '^chat:typing:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension = 'broadcast'
      AND app_private.chat_is_member(split_part((SELECT realtime.topic()), ':', 3)::uuid, (SELECT auth.uid()))
    WHEN (SELECT realtime.topic()) ~ '^chat:user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension = 'broadcast'
      AND split_part((SELECT realtime.topic()), ':', 3) = (SELECT auth.uid())::text
    ELSE FALSE
  END
);

CREATE POLICY application_topic_send ON realtime.messages
FOR INSERT TO authenticated
WITH CHECK (
  CASE
    WHEN (SELECT realtime.topic()) ~ '^presence:user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension IN ('presence', 'broadcast')
      AND split_part((SELECT realtime.topic()), ':', 3) = (SELECT auth.uid())::text
    WHEN (SELECT realtime.topic()) ~ '^presence:task:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension IN ('presence', 'broadcast')
      AND EXISTS (
        SELECT 1 FROM public.tasks task
        WHERE task.id::text = split_part((SELECT realtime.topic()), ':', 3)
          AND app_private.nb_project_can_read(task.project_id)
      )
    WHEN (SELECT realtime.topic()) ~ '^project-stats:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension = 'broadcast'
      AND app_private.nb_project_can_read(split_part((SELECT realtime.topic()), ':', 2)::uuid)
    -- Server-only: message, edit, reaction and pin events are published by the
    -- server, so no browser may send on the channel topic.
    WHEN (SELECT realtime.topic()) ~ '^chat:channel:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      FALSE
    WHEN (SELECT realtime.topic()) ~ '^chat:typing:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension = 'broadcast'
      AND app_private.chat_is_member(split_part((SELECT realtime.topic()), ':', 3)::uuid, (SELECT auth.uid()))
    ELSE FALSE
  END
);
