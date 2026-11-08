-- Organization hot-path indexes (audit 2026-11-09, Part D). Non-transactional: CREATE INDEX CONCURRENTLY can't run
-- inside a transaction, so this file is listed in NON_TRANSACTIONAL_MIGRATIONS and each statement stands alone.

-- An organization's main assignments (Assignments list, dashboard, late-joiner copies), without walking every copy.
CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_org_masters_idx ON public.tasks (workspace_id, due_date)
  WHERE kind = 'assignment' AND assignment_id IS NULL AND deleted_at IS NULL;
--> statement-breakpoint
-- The review queue and its count on every admin org page, oldest first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_copy_pending_review_idx ON public.tasks (assignment_id, (coalesce(review_submitted_at, updated_at)), id)
  WHERE review_status = 'pending' AND deleted_at IS NULL AND excused_at IS NULL AND assignment_id IS NOT NULL;
--> statement-breakpoint
-- An organization's own board with copies left out.
CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_board_no_copies_idx ON public.tasks (workspace_id, status, position DESC, created_at DESC, id DESC)
  WHERE deleted_at IS NULL AND assignment_id IS NULL;
--> statement-breakpoint
-- The hourly scheduled-publish scan, platform-wide.
CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_assignment_drafts_idx ON public.tasks (created_at)
  WHERE kind = 'assignment' AND assignment_id IS NULL AND deleted_at IS NULL AND (assignment_settings->>'publishedAt') IS NULL;
--> statement-breakpoint
-- The hourly sprint auto-start scan, platform-wide.
CREATE INDEX CONCURRENTLY IF NOT EXISTS workspace_sprints_autostart_due_idx ON public.workspace_sprints (start_date, id)
  WHERE status = 'planning' AND auto_start;
--> statement-breakpoint
-- Trash older than 30 days, platform-wide.
CREATE INDEX CONCURRENTLY IF NOT EXISTS workspace_nodes_trashed_at_idx ON public.workspace_nodes (deleted_at)
  WHERE deleted_at IS NOT NULL;
--> statement-breakpoint
-- ON DELETE SET NULL foreign key, scanned when a profile is hard-deleted.
CREATE INDEX CONCURRENTLY IF NOT EXISTS assignment_submissions_submitted_by_idx ON public.assignment_submissions (submitted_by)
  WHERE submitted_by IS NOT NULL;
--> statement-breakpoint
-- Largest files in an organization (Storage).
CREATE INDEX CONCURRENTLY IF NOT EXISTS workspace_nodes_active_file_size_idx ON public.workspace_nodes (workspace_id, size DESC NULLS LAST)
  WHERE type = 'file' AND deleted_at IS NULL;
--> statement-breakpoint
-- The org feed's "shared from workspaces" part.
CREATE INDEX CONCURRENTLY IF NOT EXISTS workspace_updates_shared_to_org_idx ON public.workspace_updates (workspace_id, created_at DESC)
  WHERE shared_to_org_at IS NOT NULL AND hidden_from_org_at IS NULL AND deleted_at IS NULL;
--> statement-breakpoint
-- Invites sent today, and the Invited list.
CREATE INDEX CONCURRENTLY IF NOT EXISTS org_email_invites_org_created_idx ON public.org_email_invites (org_id, created_at);
--> statement-breakpoint
-- Foreign keys scanned when a profile is deleted.
CREATE INDEX CONCURRENTLY IF NOT EXISTS workspaces_takeover_requested_by_idx ON public.workspaces (takeover_requested_by)
  WHERE takeover_requested_by IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS org_member_away_user_idx ON public.org_member_away (user_id);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS org_verification_codes_user_idx ON public.org_verification_codes (user_id);
