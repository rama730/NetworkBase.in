-- Workflow tabs T1 (report 38.5 part 5, plan A1.3): projects group work. A task can carry a start date (never after its
-- due date) and be Part of one project in its workspace. Add-only; works with the code already live.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS start_date timestamptz;
--> statement-breakpoint
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS part_of_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE public.tasks ADD CONSTRAINT tasks_start_before_due CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
