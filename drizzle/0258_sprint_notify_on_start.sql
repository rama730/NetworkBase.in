-- 0258: "Notify members when it starts" on each org sprint (report §15.2); the org's Work setting is its default.
ALTER TABLE public.project_sprints ADD COLUMN IF NOT EXISTS notify_on_start boolean NOT NULL DEFAULT true;
