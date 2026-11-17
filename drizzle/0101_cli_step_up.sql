-- Report F5 (M7): "Verify it's you" for risky terminal actions. The person verifies in the browser (/cli/verify) and
-- that terminal's sign-in counts as verified until this time (10 minutes). Browser verifications stay a cookie.
ALTER TABLE public.extension_device_sessions ADD COLUMN IF NOT EXISTS step_up_until timestamptz;
