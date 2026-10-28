-- 0260: the opt-in Work record on an org contribution (report §24.5): "12 of 12 assignments · 5 sprints", off by default.
ALTER TABLE public.profile_project_contributions ADD COLUMN IF NOT EXISTS show_work_record boolean NOT NULL DEFAULT false;
