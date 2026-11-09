-- CLI 2.0 follow-up: an index under each foreign key 0072–0075 added, so deleting a person or workspace (ON DELETE
-- CASCADE / SET NULL) never scans these tables. Found by check:db:live-lineage after 0072–0076 went live.
CREATE INDEX extension_device_sessions_workspace_idx ON public.extension_device_sessions (workspace_id) WHERE workspace_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX personal_access_tokens_workspace_idx ON public.personal_access_tokens (workspace_id) WHERE workspace_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX device_codes_user_idx ON public.device_codes (user_id) WHERE user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX device_codes_workspace_idx ON public.device_codes (workspace_id) WHERE workspace_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX device_codes_session_idx ON public.device_codes (session_id) WHERE session_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX undo_operations_workspace_idx ON public.undo_operations (workspace_id);
--> statement-breakpoint
CREATE INDEX agent_questions_workspace_idx ON public.agent_questions (workspace_id);
--> statement-breakpoint
CREATE INDEX agent_questions_asker_idx ON public.agent_questions (asker_user_id);
--> statement-breakpoint
CREATE INDEX agent_questions_answered_by_idx ON public.agent_questions (answered_by) WHERE answered_by IS NOT NULL;
--> statement-breakpoint
CREATE INDEX agent_question_mutes_task_idx ON public.agent_question_mutes (task_id);
--> statement-breakpoint
CREATE INDEX agent_notification_buffer_recipient_idx ON public.agent_notification_buffer (recipient_user_id);
