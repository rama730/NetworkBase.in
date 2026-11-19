-- Workflow tabs F1 (plan A0.1): own tabs read a workspace's items by type and stage. Non-transactional
-- (CREATE INDEX CONCURRENTLY), listed in NON_TRANSACTIONAL_MIGRATIONS.
CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_workspace_type_stage_idx ON public.tasks (workspace_id, item_type, stage)
  WHERE deleted_at IS NULL;
