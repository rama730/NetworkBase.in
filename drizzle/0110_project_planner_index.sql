-- Workflow tabs T1 (plan A1.3): a project's work. Non-transactional (CREATE INDEX CONCURRENTLY), listed in
-- NON_TRANSACTIONAL_MIGRATIONS.
CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_part_of_idx ON public.tasks (part_of_id) WHERE deleted_at IS NULL AND part_of_id IS NOT NULL;
