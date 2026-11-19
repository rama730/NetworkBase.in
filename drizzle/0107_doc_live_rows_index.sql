-- Workflow tabs F2 (plan A0.5): a block's rows in order. Non-transactional (CREATE INDEX CONCURRENTLY), listed in
-- NON_TRANSACTIONAL_MIGRATIONS.
CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_source_block_idx ON public.tasks (source_doc_id, source_block, source_position)
  WHERE deleted_at IS NULL AND source_doc_id IS NOT NULL;
