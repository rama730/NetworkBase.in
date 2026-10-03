-- 0186: statuses become any emoji + text (Slack style). The fixed status kinds
-- and their custom icons (0184) are retired; existing statuses keep their
-- meaning as an emoji. Availability (Active now/today/this week/Offline) is
-- unchanged. Browser grants are unchanged: none on the profile status columns.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status_emoji text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS status_emoji text;

DO $status_emoji$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'status_kind') THEN
    UPDATE public.profiles SET
      status_emoji = CASE status_kind WHEN 'meeting' THEN '📅' WHEN 'sick' THEN '🤒' WHEN 'vacation' THEN '🌴' WHEN 'remote' THEN '🏡' ELSE '💬' END,
      status_text = coalesce(status_text, CASE status_kind WHEN 'meeting' THEN 'In a meeting' WHEN 'sick' THEN 'Out sick' WHEN 'vacation' THEN 'Vacationing' WHEN 'remote' THEN 'Working remotely' END)
    WHERE status_kind IS NOT NULL AND status_emoji IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'status_kind') THEN
    UPDATE public.projects SET
      status_emoji = CASE status_kind WHEN 'sprinting' THEN '🏃' WHEN 'launching' THEN '🚀' WHEN 'hiring' THEN '🙋' WHEN 'on_hold' THEN '⏸️' WHEN 'break' THEN '🏖️' ELSE '💬' END,
      status_text = coalesce(status_text, CASE status_kind WHEN 'sprinting' THEN 'Sprinting' WHEN 'launching' THEN 'Launching' WHEN 'hiring' THEN 'Hiring' WHEN 'on_hold' THEN 'On hold' WHEN 'break' THEN 'Team on break' END)
    WHERE status_kind IS NOT NULL AND status_emoji IS NULL;
  END IF;
END
$status_emoji$;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_status_kind_check,
  DROP CONSTRAINT IF EXISTS profiles_status_icon_check,
  DROP COLUMN IF EXISTS status_kind,
  DROP COLUMN IF EXISTS status_icon;
ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_status_kind_check,
  DROP COLUMN IF EXISTS status_kind;

DO $status_emoji_checks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_status_emoji_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_status_emoji_check
      CHECK (status_emoji IS NULL OR char_length(status_emoji) BETWEEN 1 AND 16);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_status_emoji_check') THEN
    ALTER TABLE public.projects ADD CONSTRAINT projects_status_emoji_check
      CHECK (status_emoji IS NULL OR char_length(status_emoji) BETWEEN 1 AND 16);
  END IF;
END
$status_emoji_checks$;
