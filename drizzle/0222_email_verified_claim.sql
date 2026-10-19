-- SEC-003: email verification must not rest on user-editable metadata. A trigger keeps
-- auth.users.raw_app_meta_data.email_verified equal to "email_confirmed_at is set"; app metadata is
-- written only by Auth and admins and travels in the access token, so the claim is server-owned.
CREATE OR REPLACE FUNCTION app_private.sync_email_verified_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.raw_app_meta_data := coalesce(NEW.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('email_verified', NEW.email_confirmed_at IS NOT NULL);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.sync_email_verified_claim() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DROP TRIGGER IF EXISTS nb_sync_email_verified_claim ON auth.users;
--> statement-breakpoint
CREATE TRIGGER nb_sync_email_verified_claim
BEFORE INSERT OR UPDATE OF email_confirmed_at, raw_app_meta_data ON auth.users
FOR EACH ROW EXECUTE FUNCTION app_private.sync_email_verified_claim();
--> statement-breakpoint
-- Backfill: touching the column fires the trigger for every row whose claim is missing or stale.
UPDATE auth.users
SET email_confirmed_at = email_confirmed_at
WHERE (raw_app_meta_data->>'email_verified') IS DISTINCT FROM ((email_confirmed_at IS NOT NULL)::text);
