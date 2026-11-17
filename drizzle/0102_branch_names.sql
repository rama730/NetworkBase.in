-- Report H24, H26 (M9 B2): a branch is known by its id. A rename keeps its GitHub link (the GitHub branch it syncs
-- with, recorded on its first sync) and the old name keeps working in links and folders for 30 days.
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS github_branch text;
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS previous_name text;
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS renamed_at timestamptz;
