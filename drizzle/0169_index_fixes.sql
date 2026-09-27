CREATE INDEX IF NOT EXISTS project_nodes_active_file_idx
  ON public.project_nodes (project_id, id)
  WHERE type = 'file' AND deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_nodes_active_file_s3_key_idx
  ON public.project_nodes (s3_key text_pattern_ops)
  WHERE type = 'file' AND deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_nodes_permanent_delete_root_idx
  ON public.project_nodes (updated_at)
  WHERE deleted_at IS NOT NULL AND (metadata->>'permanentDeleteRoot') = id::text;
--> statement-breakpoint
DROP INDEX IF EXISTS public.idx_project_nodes_perm_del;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_node_events_reconciliation_key_idx
  ON public.project_node_events (project_id, (metadata->>'reconciliationKey'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS github_sync_runs_actor_idx
  ON public.github_sync_runs (actor_id);
