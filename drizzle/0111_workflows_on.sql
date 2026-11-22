-- Workflow tabs: wave switch-on (plan section 10, decision 1; approved 2026-11-23). Wave 0 (types, stages, Add
-- workflow, document blocks) and wave A1 (Project planner) are live, so workflows are on for every workspace and
-- organization, and new ones start on. Removing a workflow stays hide-only; nothing is added for anyone.
ALTER TABLE workspaces ALTER COLUMN workflows_enabled SET DEFAULT true;
--> statement-breakpoint
UPDATE workspaces SET workflows_enabled = true WHERE workflows_enabled = false AND deleted_at IS NULL;
