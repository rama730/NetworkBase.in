-- None of these is called by a read rule, and several take a user id from the caller. app_private is not exposed through the API today; this keeps it safe if that ever changes. nb_app keeps its grant.
REVOKE ALL ON FUNCTION app_private.blocked_between(uuid, uuid), app_private.chat_contact_cut(uuid, uuid), app_private.chat_default_channel_name(uuid), app_private.chat_is_parent_org_admin(uuid, uuid), app_private.chat_join_channel(uuid, uuid), app_private.chat_post_member_joined(uuid, uuid), app_private.chat_sync_workspace_members(uuid, uuid, text), app_private.nb_org_node_access_ok(uuid, uuid, text), app_private.nb_org_role(uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
-- Nothing in the app uses the task-files bucket; these rules let members upload around the quota and upload-intent flow.
DROP POLICY task_files_insert ON storage.objects;
--> statement-breakpoint
DROP POLICY task_files_select ON storage.objects;
--> statement-breakpoint
DROP POLICY task_files_update ON storage.objects;
--> statement-breakpoint
DROP POLICY task_files_delete ON storage.objects;
