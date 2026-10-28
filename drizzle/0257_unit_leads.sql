-- 0257: a unit's lead (report §14.4, "Unit lead ★"): receives the unit's mentions and reminders, and is next in line
-- when a child project needs a new lead (§30.7). A unit is a role box (project_open_roles) filled with people.
ALTER TABLE public.project_open_roles ADD COLUMN IF NOT EXISTS lead_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS project_open_roles_lead_user_idx ON public.project_open_roles (lead_user_id) WHERE lead_user_id IS NOT NULL;
