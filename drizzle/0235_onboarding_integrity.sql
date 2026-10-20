-- Onboarding integrity. The live catalog had none of the 0035/0044 checks, one reserved name missing from the
-- seed, and no unique-primary-alias index. Nothing here edits or deletes anyone's text.

-- 1. `networkbase` was only reserved in code (CORE_RESERVED_USERNAMES); availability and the DB trigger read this table.
INSERT INTO reserved_usernames (username, reason) VALUES ('networkbase', 'brand')
ON CONFLICT (username) DO NOTHING;
--> statement-breakpoint

-- 2. One primary alias per user. Older onboarding retries left several primaries behind: keep the alias that
--    matches the profile username (else the newest claim) and demote the rest. Only the flag changes.
WITH ranked AS (
  SELECT a.username,
         row_number() OVER (
           PARTITION BY a.user_id
           ORDER BY coalesce(a.username = p.username, false) DESC, a.claimed_at DESC, a.username
         ) AS rn
  FROM username_aliases a
  LEFT JOIN profiles p ON p.id = a.user_id
  WHERE a.is_primary
)
UPDATE username_aliases a
SET is_primary = false,
    replaced_at = coalesce(a.replaced_at, now())
FROM ranked r
WHERE a.username = r.username AND r.rn > 1;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS username_aliases_user_primary_unique_idx
ON username_aliases (user_id)
WHERE is_primary = true;
--> statement-breakpoint

-- 3. Field checks. Added NOT VALID (guards new and edited rows), then validated only when no existing row
--    breaks them, so this migration never fails the rollout.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_onboarding_shape_check;
--> statement-breakpoint
ALTER TABLE profiles ADD CONSTRAINT profiles_onboarding_shape_check CHECK (
  (full_name IS NULL OR char_length(trim(full_name)) BETWEEN 2 AND 80)
  AND (headline IS NULL OR char_length(headline) <= 120)
  AND (bio IS NULL OR char_length(bio) <= 500)
  AND (location IS NULL OR char_length(location) <= 120)
  AND (website IS NULL OR (char_length(website) <= 200 AND website ~ '^https?://'))
  AND (visibility IS NULL OR visibility IN ('public', 'connections', 'private'))
  AND (skills IS NULL OR (jsonb_typeof(skills) = 'array' AND jsonb_array_length(skills) <= 25))
  AND (interests IS NULL OR (jsonb_typeof(interests) = 'array' AND jsonb_array_length(interests) <= 25))
) NOT VALID;
--> statement-breakpoint

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_experience_level_check;
--> statement-breakpoint
ALTER TABLE profiles ADD CONSTRAINT profiles_experience_level_check CHECK (
  experience_level IS NULL OR experience_level IN ('student', 'junior', 'mid', 'senior', 'lead', 'founder')
) NOT VALID;
--> statement-breakpoint

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_hours_per_week_check;
--> statement-breakpoint
ALTER TABLE profiles ADD CONSTRAINT profiles_hours_per_week_check CHECK (
  hours_per_week IS NULL OR hours_per_week IN ('lt_5', 'h_5_10', 'h_10_20', 'h_20_40', 'h_40_plus')
) NOT VALID;
--> statement-breakpoint

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_gender_identity_check;
--> statement-breakpoint
ALTER TABLE profiles ADD CONSTRAINT profiles_gender_identity_check CHECK (
  gender_identity IS NULL OR gender_identity IN ('male', 'female', 'non_binary', 'prefer_not_to_say', 'other')
) NOT VALID;
--> statement-breakpoint

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_pronouns_length_check;
--> statement-breakpoint
ALTER TABLE profiles ADD CONSTRAINT profiles_pronouns_length_check CHECK (
  pronouns IS NULL OR char_length(trim(pronouns)) <= 60
) NOT VALID;
--> statement-breakpoint

ALTER TABLE onboarding_drafts DROP CONSTRAINT IF EXISTS onboarding_drafts_step_range_check;
--> statement-breakpoint
ALTER TABLE onboarding_drafts ADD CONSTRAINT onboarding_drafts_step_range_check CHECK (step BETWEEN 1 AND 4) NOT VALID;
--> statement-breakpoint

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
    WHERE NOT convalidated
      AND conname IN (
        'profiles_onboarding_shape_check', 'profiles_experience_level_check', 'profiles_hours_per_week_check',
        'profiles_gender_identity_check', 'profiles_pronouns_length_check', 'onboarding_drafts_step_range_check'
      )
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.tbl, c.conname);
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE '% left NOT VALID: existing rows break it', c.conname;
    END;
  END LOOP;
END
$$;
