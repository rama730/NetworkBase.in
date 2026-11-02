-- Decision 163 (report §29.5): launch is 18 and over, so Report gains "This person may be under 18", decided by
-- NetworkBase's team. Widens the allowed reasons; NOT VALID then VALIDATE keeps the table writable meanwhile.
ALTER TABLE public.content_reports DROP CONSTRAINT content_reports_reason_check;
--> statement-breakpoint
ALTER TABLE public.content_reports ADD CONSTRAINT content_reports_reason_check CHECK ((reason = ANY (ARRAY['threat'::text, 'self_harm'::text, 'child_safety'::text, 'intimate_images'::text, 'private_info'::text, 'harassment'::text, 'hate_speech'::text, 'impersonation'::text, 'evading_block'::text, 'under_18'::text, 'scam'::text, 'inappropriate'::text, 'spam'::text, 'other'::text]))) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.content_reports VALIDATE CONSTRAINT content_reports_reason_check;
