-- 0259: who ticked a step (report §16.11, "✓ Write tests · Kiran"): shared team copies show each tick's author.
ALTER TABLE public.task_subtasks ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS task_subtasks_completed_by_idx ON public.task_subtasks (completed_by) WHERE completed_by IS NOT NULL;
