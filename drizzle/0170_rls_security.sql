DO $sync_profile_metadata$
BEGIN
  IF to_regprocedure('public.sync_profile_to_auth_user_metadata()') IS NOT NULL THEN
    ALTER FUNCTION public.sync_profile_to_auth_user_metadata() SET search_path = '';
    REVOKE ALL ON FUNCTION public.sync_profile_to_auth_user_metadata() FROM PUBLIC;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
      REVOKE ALL ON FUNCTION public.sync_profile_to_auth_user_metadata() FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
      REVOKE ALL ON FUNCTION public.sync_profile_to_auth_user_metadata() FROM authenticated;
    END IF;
  END IF;
END
$sync_profile_metadata$;
