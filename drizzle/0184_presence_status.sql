-- 0184: presence statuses (people and projects) and the activity privacy switch.
-- Browsers read profiles column by column (explicit GRANT SELECT (...)); these
-- columns are deliberately NOT granted, so status text, its audience and the
-- privacy switch are read only through the server's privacy-aware path.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS show_activity boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS status_kind text,
  ADD COLUMN IF NOT EXISTS status_text text,
  ADD COLUMN IF NOT EXISTS status_icon text,
  ADD COLUMN IF NOT EXISTS status_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_pauses_notifications boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status_visibility text NOT NULL DEFAULT 'network';

DO $presence_checks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_status_kind_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_status_kind_check
      CHECK (status_kind IS NULL OR status_kind IN ('meeting', 'sick', 'vacation', 'remote', 'custom'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_status_icon_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_status_icon_check
      CHECK (status_icon IS NULL OR status_icon IN ('meeting', 'sick', 'vacation', 'remote', 'custom'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_status_text_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_status_text_check
      CHECK (status_text IS NULL OR char_length(status_text) <= 80);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_status_visibility_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_status_visibility_check
      CHECK (status_visibility IN ('everyone', 'network', 'team'));
  END IF;
END
$presence_checks$;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS status_kind text,
  ADD COLUMN IF NOT EXISTS status_text text,
  ADD COLUMN IF NOT EXISTS status_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_set_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status_set_at timestamptz;

DO $project_presence_checks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_status_kind_check') THEN
    ALTER TABLE public.projects ADD CONSTRAINT projects_status_kind_check
      CHECK (status_kind IS NULL OR status_kind IN ('sprinting', 'launching', 'hiring', 'on_hold', 'break', 'custom'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_status_text_check') THEN
    ALTER TABLE public.projects ADD CONSTRAINT projects_status_text_check
      CHECK (status_text IS NULL OR char_length(status_text) <= 80);
  END IF;
END
$project_presence_checks$;
