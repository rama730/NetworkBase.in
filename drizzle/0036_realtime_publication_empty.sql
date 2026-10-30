-- Every screen now hears changes through private broadcasts (0034), so Realtime no longer needs to read these tables' changes.
ALTER PUBLICATION supabase_realtime DROP TABLE
  public.profiles,
  public.task_comments,
  public.task_node_links,
  public.task_subtasks,
  public.tasks,
  public.user_notifications,
  public.workspace_node_locks,
  public.workspace_workflow_columns,
  public.workspaces;
