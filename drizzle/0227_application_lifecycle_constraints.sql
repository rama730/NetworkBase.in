-- The database enforced almost none of the application lifecycle: any text in the reason column,
-- "accepted" with no decision time, messages of any length, and no home for the structured fields the
-- apply form collects (they were flattened into the message). Reviewers also had no index for their queue.
-- 1. Structured apply-form fields live next to the message (portfolioUrl, availability).
ALTER TABLE public.role_applications ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE public.role_applications
  ADD CONSTRAINT role_applications_details_object_check CHECK (jsonb_typeof(details) = 'object');
--> statement-breakpoint
-- 2. Tidy rows the new rules would reject. The capacity sweep used to write role_capacity_filled; any
-- other stray code reads as "other", which is what the applicant already saw.
UPDATE public.role_applications SET decision_reason_code = 'role_filled' WHERE decision_reason_code = 'role_capacity_filled';
--> statement-breakpoint
UPDATE public.role_applications SET decision_reason_code = 'other'
WHERE decision_reason_code IS NOT NULL
  AND decision_reason_code NOT IN ('skills_mismatch', 'role_filled', 'availability', 'experience', 'other', 'withdrawn_by_applicant', 'reopened_by_reviewer');
--> statement-breakpoint
UPDATE public.role_applications SET decision_at = updated_at WHERE status = 'accepted' AND decision_at IS NULL;
--> statement-breakpoint
-- 3. The rules. Both are validated here, after the tidy-up above.
ALTER TABLE public.role_applications
  ADD CONSTRAINT role_applications_reason_code_check CHECK (
    decision_reason_code IS NULL OR decision_reason_code IN
      ('skills_mismatch', 'role_filled', 'availability', 'experience', 'other', 'withdrawn_by_applicant', 'reopened_by_reviewer')
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.role_applications VALIDATE CONSTRAINT role_applications_reason_code_check;
--> statement-breakpoint
ALTER TABLE public.role_applications
  ADD CONSTRAINT role_applications_accepted_decided_check CHECK (status <> 'accepted' OR decision_at IS NOT NULL) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.role_applications VALIDATE CONSTRAINT role_applications_accepted_decided_check;
--> statement-breakpoint
-- The message limit applies to new and edited rows only. Old rows are left as written (no silent
-- truncation of someone's text); validate it after a read-only check of the live data.
ALTER TABLE public.role_applications
  ADD CONSTRAINT role_applications_message_length_check CHECK (message IS NULL OR char_length(message) <= 2000) NOT VALID;
--> statement-breakpoint
-- 4. A reviewer's queue is "pending applications of my projects".
CREATE INDEX IF NOT EXISTS role_applications_pending_project_idx ON public.role_applications (project_id) WHERE status = 'pending';
