-- Workflow tabs F2 (report 38.3 S4, call 6; plan A0.6): a decision's D-number is unique in its workspace and never
-- reused. Numbers live in workspace_documents.settings (no column). Non-transactional (CREATE INDEX CONCURRENTLY), listed
-- in NON_TRANSACTIONAL_MIGRATIONS.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS workspace_documents_decision_number_unique
  ON public.workspace_documents (workspace_id, ((settings->>'decisionNumber')::int))
  WHERE settings ? 'decisionNumber';
