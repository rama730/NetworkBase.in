-- CLI 2.0 Phase 3 (P3.1, report A3.10): the country a device or agent token was last used from, so use from a new
-- country can be told to its owner.
ALTER TABLE public.extension_device_sessions ADD COLUMN last_country text;
