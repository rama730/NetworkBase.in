-- RLS-009 (and the write paths of RLS-005, RLS-006, RLS-008, RLS-011): every
-- application write goes through the server (Drizzle as the table owner); the
-- browser only reads a few tables via the Data API and Realtime. Browser roles
-- therefore get no DML anywhere in public and SELECT only where it is used.
-- Policies still gate every row of the tables that remain readable.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
--> statement-breakpoint
REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
-- Read by browser code (Data API) or Realtime postgres_changes, plus the
-- tables those tables' policies and the storage/realtime policies query as the caller.
GRANT SELECT ON
  public.profiles,
  public.projects,
  public.project_members,
  public.project_follows,
  public.connections,
  public.tasks,
  public.task_subtasks,
  public.task_comments,
  public.task_comment_likes,
  public.task_node_links,
  public.project_workflow_columns,
  public.project_updates,
  public.project_update_comments,
  public.project_node_locks,
  public.user_notifications
TO anon, authenticated;
--> statement-breakpoint
-- New objects start with no browser access; grant reads explicitly.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
