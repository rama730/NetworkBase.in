-- 0212: Onboarding submissions carry an attempt token (API-002, API-003).
-- A takeover is a compare-and-swap on the token it observed, and finalization must present the token
-- of the attempt that owns the row, so a slow earlier attempt cannot overwrite a later one.
-- updated_at cannot serve as the token: a trigger rewrites it on every update.
ALTER TABLE public.onboarding_submissions ADD COLUMN IF NOT EXISTS attempt_token uuid NOT NULL DEFAULT gen_random_uuid();
