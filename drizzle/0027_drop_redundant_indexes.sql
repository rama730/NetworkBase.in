-- Each index here is either the first part of a longer index on the same table, which already serves its lookups, or stores only NULL. Every write paid for them.
DROP INDEX CONCURRENTLY IF EXISTS public.connections_requester_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.connections_addressee_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.connections_status_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.workspace_members_user_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.workspace_members_workspace_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.workspaces_created_at_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.workspaces_owner_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.workspaces_status_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.workspace_open_roles_workspace_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.workspace_follows_workspace_id_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.workspace_sprints_workspace_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.tasks_workspace_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.tasks_assignee_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.workspace_nodes_workspace_id_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.task_node_links_task_id_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.workspace_node_locks_workspace_id_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.workspace_node_locks_locked_by_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.task_subtasks_task_id_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.onboarding_events_user_id_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.onboarding_submissions_user_id_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.profile_audit_events_user_id_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.task_comment_likes_comment_id_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.task_comments_task_id_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.task_comments_parent_id_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.comment_mentions_comment_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.workspace_documents_workspace_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.workspace_update_likes_update_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.task_pushes_task_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.workspace_nodes_deleted_at_partial_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.tasks_deleted_at_partial_idx;
