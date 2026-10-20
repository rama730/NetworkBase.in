-- Applications can now be closed by the project (it stops taking applications, a role is removed): two more reasons.
ALTER TABLE public.role_applications DROP CONSTRAINT IF EXISTS role_applications_reason_code_check;
--> statement-breakpoint
ALTER TABLE public.role_applications
  ADD CONSTRAINT role_applications_reason_code_check CHECK (
    decision_reason_code IS NULL OR decision_reason_code IN
      ('skills_mismatch', 'role_filled', 'project_closed', 'role_removed', 'availability', 'experience', 'other', 'withdrawn_by_applicant', 'reopened_by_reviewer')
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.role_applications VALIDATE CONSTRAINT role_applications_reason_code_check;
--> statement-breakpoint
-- creator_id is history (the owner when the application was sent). Hard-deleting a former owner must not delete the
-- applications to a project they no longer own, so the column no longer cascades.
ALTER TABLE public.role_applications ALTER COLUMN creator_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE public.role_applications DROP CONSTRAINT IF EXISTS role_applications_creator_id_profiles_id_fk;
--> statement-breakpoint
ALTER TABLE public.role_applications
  ADD CONSTRAINT role_applications_creator_id_profiles_id_fk FOREIGN KEY (creator_id) REFERENCES public.profiles(id) ON DELETE SET NULL NOT VALID;
--> statement-breakpoint
ALTER TABLE public.role_applications VALIDATE CONSTRAINT role_applications_creator_id_profiles_id_fk;
