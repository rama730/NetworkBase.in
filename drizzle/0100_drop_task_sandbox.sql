-- Report Part H, phase H-5 (M8), H16: the old task-sandbox merge is gone, replaced by branches. Production had no rows
-- in workspace_git_deltas and no node using canonical_node_id (checked 2026-11-17). The column's index and foreign
-- key go with it. docs/superpowers/plans/2026-11-17-m8-h5-github-branches.md
DROP TABLE IF EXISTS public.workspace_git_deltas;
--> statement-breakpoint
ALTER TABLE public.workspace_nodes DROP COLUMN IF EXISTS canonical_node_id;
