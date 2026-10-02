-- 0181: chat rebuild cutover (report 10.1). Drops the old conversation/message
-- system after 0180 added chat_* next to it. Destructive by design; take a
-- pg_dump of the old tables first (report 5.A). Every statement is idempotent.

-- 1. Realtime topics without the old presence:conversation branch, before the
--    function it calls is dropped.
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
    WHEN (SELECT realtime.topic()) ~ '^chat:channel:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension = 'broadcast'
      AND app_private.chat_is_member(split_part((SELECT realtime.topic()), ':', 3)::uuid, (SELECT auth.uid()))
    ELSE FALSE
  END
);

--> statement-breakpoint

-- 2. Presence visibility: people who share a DM or group chat, or a project.
CREATE OR REPLACE FUNCTION app_private.nb_can_observe_user_presence(p_target_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_target_user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.chat_channel_members viewer
      JOIN public.chat_channels c ON c.id = viewer.channel_id AND (c.kind = 'dm' OR (c.kind = 'private' AND c.name IS NULL))
      JOIN public.chat_channel_members target ON target.channel_id = viewer.channel_id
      WHERE viewer.user_id = (SELECT auth.uid())
        AND target.user_id = p_target_user_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.project_members viewer
      JOIN public.project_members target
        ON target.project_id = viewer.project_id
      WHERE viewer.user_id = (SELECT auth.uid())
        AND target.user_id = p_target_user_id
    );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_can_observe_user_presence(uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.nb_can_observe_user_presence(uuid) TO authenticated, service_role;
--> statement-breakpoint

-- 3. Old chat uploads go through the storage lifecycle, which deletes the bytes
--    and then the rows (report 5.A "Data"; the bucket ends up empty).
DO $$
BEGIN
  IF to_regclass('public.message_attachments') IS NOT NULL THEN
    UPDATE public.storage_assets a
    SET state = 'delete_pending', delete_after = now(), updated_at = now()
    WHERE a.state IN ('pending', 'verified')
      AND a.id IN (SELECT ma.asset_id FROM public.message_attachments ma WHERE ma.asset_id IS NOT NULL);
  END IF;
  IF to_regclass('public.attachment_uploads') IS NOT NULL THEN
    UPDATE public.storage_assets a
    SET state = 'delete_pending', delete_after = now(), updated_at = now()
    WHERE a.state IN ('pending', 'verified')
      AND a.id IN (SELECT u.asset_id FROM public.attachment_uploads u WHERE u.asset_id IS NOT NULL);
  END IF;
END
$$;
--> statement-breakpoint

-- 4. Notifications that point at the old system (their links would 404).
DELETE FROM public.notification_deliveries d
USING public.user_notifications n
WHERE d.notification_id = n.id
  AND (n.kind IN ('message_burst', 'message_reaction', 'workflow_assigned', 'workflow_resolved')
       OR n.entity_refs ? 'conversationId');
--> statement-breakpoint
DELETE FROM public.user_notifications
WHERE kind IN ('message_burst', 'message_reaction', 'workflow_assigned', 'workflow_resolved')
   OR entity_refs ? 'conversationId';
--> statement-breakpoint

-- 5. Columns that linked other domains to conversations.
ALTER TABLE public.projects DROP COLUMN IF EXISTS conversation_id;
--> statement-breakpoint
ALTER TABLE public.role_applications DROP COLUMN IF EXISTS conversation_id;
--> statement-breakpoint
ALTER TABLE public.project_invitations DROP COLUMN IF EXISTS message_workflow_item_id;
--> statement-breakpoint

-- 6. The 16 old tables. CASCADE takes their triggers, policies, FKs and
--    publication membership with them.
DROP TABLE IF EXISTS
  public.message_work_links,
  public.message_workflow_items,
  public.message_delivery_receipts,
  public.message_read_receipts,
  public.message_hidden_for_users,
  public.message_edit_logs,
  public.message_reports,
  public.message_pins,
  public.message_reactions,
  public.message_attachments,
  public.attachment_uploads,
  public.typing_indicators,
  public.messages,
  public.dm_pairs,
  public.conversation_participants,
  public.conversations
CASCADE;
--> statement-breakpoint

-- 7. Old functions, every overload.
DO $$
DECLARE
  v_fn regprocedure;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname, p.proname) IN (
      ('app_private', 'nb_is_conversation_participant'),
      ('public', 'nb_is_conversation_participant'),
      ('app_private', 'nb_reconcile_conversation_participants'),
      ('app_private', 'nb_validate_dm_conversation'),
      ('app_private', 'nb_validate_dm_conversation_trigger'),
      ('app_private', 'nb_validate_message_work_link_target'),
      ('public', 'get_or_create_dm_conversation'),
      ('public', 'handle_message_insert_consistency'),
      ('public', 'update_conversation_timestamp'),
      ('public', 'update_typing_timestamp'),
      ('public', 'cleanup_old_typing_indicators')
    )
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', v_fn);
  END LOOP;
END
$$;
--> statement-breakpoint

-- 8. Backfill: every project gets #general with its members; every pending
--    application gets its private thread and card. Both are idempotent.
-- ponytail: one pass inside the migration. ceiling: fine pre-launch (few
-- thousand projects). upgrade: batch in a job if run on a large live database.
SELECT app_private.chat_sync_project_members(p.id, NULL, 'ensure_default') FROM public.projects p;
--> statement-breakpoint
SELECT app_private.chat_ensure_application_channel(a.id) FROM public.role_applications a WHERE a.status = 'pending';
