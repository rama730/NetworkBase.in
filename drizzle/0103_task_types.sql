-- Workflow tabs F1 (report 38.2, plan A0.1): a task can carry a type and a stage. The stage decides the status and
-- whether the item sits on the board. Every existing task becomes type 'task', no stage, on the board: nothing changes.
-- item_type and stage are checked in the server, not in SQL, so later types and stages need no ALTER (plan section 3).
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'task';
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS stage text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS type_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS on_board boolean NOT NULL DEFAULT true;
-- Off for everyone until each wave is switched on (F1 call 10).
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS workflows_enabled boolean NOT NULL DEFAULT false;
-- One settings column for the workflow rounds (meetings, goals, docs, assets, path).
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS workflow_settings jsonb;
