-- Report Part B: who sees "with Claude Code". The owner chooses per workspace; the server decides per viewer.
ALTER TABLE public.workspaces ADD COLUMN agent_label_visibility text DEFAULT 'everyone' NOT NULL,
    ADD CONSTRAINT workspaces_agent_label_visibility_check CHECK (agent_label_visibility IN ('everyone', 'person', 'none'));
--> statement-breakpoint
-- "Only the person" needs to know whose agent made a subtask. Older rows have none: they stay hidden under it.
ALTER TABLE public.task_subtasks ADD COLUMN created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX task_subtasks_created_by_idx ON public.task_subtasks (created_by) WHERE created_by IS NOT NULL;
--> statement-breakpoint
-- Browsers read these tables directly (the task panel reads subtasks); "No one" must also mean via and agent_name
-- never reach other people, so browsers get every column but those two (like workspaces.import_source, 0035).
REVOKE SELECT ON public.tasks FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT (id, workspace_id, sprint_id, assignee_id, creator_id, title, description, status, priority, story_points, due_date, created_at, updated_at, task_number, deleted_at, position, workflow_column_id, timeline_origin_sprint_id, timeline_origin_at, review_status, review_submitted_at, review_content_hash, completed_at, completed_by, completion_source, kind, assignment_id, assignment_settings, submission, excused_at, excused_reason, team_name, submit_until) ON public.tasks TO anon, authenticated;
--> statement-breakpoint
REVOKE SELECT ON public.task_subtasks FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT (id, task_id, title, completed, position, created_at, updated_at, completed_by, created_by) ON public.task_subtasks TO anon, authenticated;
--> statement-breakpoint
REVOKE SELECT ON public.task_comments FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT (id, task_id, user_id, content, created_at, updated_at, parent_comment_id, deleted_by, deleted_at) ON public.task_comments TO anon, authenticated;
