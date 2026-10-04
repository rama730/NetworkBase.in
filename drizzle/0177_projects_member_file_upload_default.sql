-- Project-level default for the per-member file upload switch; applied when a member joins.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS member_file_upload_default boolean DEFAULT true NOT NULL;
