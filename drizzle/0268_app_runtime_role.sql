-- Production stops connecting as postgres (BYPASSRLS). nb_app reads and writes rows; it cannot change
-- table structure, truncate, or touch Supabase's auth and storage tables except through the narrow
-- functions below. Authorization stays in the app, so nb_app's policies allow every row.
-- NOLOGIN here: the owner sets LOGIN and a password outside the repo (docs/ops/runtime-database-role.md).
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nb_app') THEN
    CREATE ROLE nb_app NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$role$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public, extensions, app_private TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nb_app;
--> statement-breakpoint
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO nb_app;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, extensions, app_private TO nb_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nb_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO nb_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public, app_private GRANT EXECUTE ON FUNCTIONS TO nb_app;
--> statement-breakpoint
DO $policies$
DECLARE
  t regclass;
BEGIN
  -- Partitions are read through their parent, whose policy applies.
  FOR t IN SELECT c.oid::regclass FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND NOT c.relispartition LOOP
    EXECUTE format('DROP POLICY IF EXISTS nb_app_all ON %s', t);
    EXECUTE format('CREATE POLICY nb_app_all ON %s FOR ALL TO nb_app USING (true) WITH CHECK (true)', t);
  END LOOP;
END
$policies$;
--> statement-breakpoint
-- New public tables get the same policy, so a migration cannot forget it (ensure_rls already turns RLS on).
CREATE OR REPLACE FUNCTION app_private.nb_app_policy_for_new_tables() RETURNS event_trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table', 'partitioned table') AND schema_name = 'public'
      AND NOT (SELECT c.relispartition FROM pg_catalog.pg_class c WHERE c.oid = objid)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS nb_app_all ON %s', cmd.object_identity);
    EXECUTE format('CREATE POLICY nb_app_all ON %s FOR ALL TO nb_app USING (true) WITH CHECK (true)', cmd.object_identity);
  END LOOP;
END;
$$;
--> statement-breakpoint
DROP EVENT TRIGGER IF EXISTS nb_app_policy_for_new_tables;
--> statement-breakpoint
CREATE EVENT TRIGGER nb_app_policy_for_new_tables ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION app_private.nb_app_policy_for_new_tables();
--> statement-breakpoint
-- Supabase's auth and storage tables keep RLS and belong to their own admin roles, so the app reaches
-- them only here: each function runs as postgres and returns just the columns the code uses.
CREATE OR REPLACE FUNCTION app_private.nb_user_has_password(p_user_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN (SELECT u.encrypted_password IS NOT NULL AND u.encrypted_password <> '' FROM auth.users u WHERE u.id = p_user_id);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_user_has_verified_mfa(p_user_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = p_user_id AND f.status::text = 'verified');
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_user_identities(p_user_id uuid)
RETURNS TABLE (id uuid, provider text, provider_id text, identity_data jsonb, last_sign_in_at timestamptz, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY SELECT i.id, i.provider, i.provider_id, i.identity_data, i.last_sign_in_at, i.created_at
    FROM auth.identities i WHERE i.user_id = p_user_id;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_user_sessions(p_user_id uuid)
RETURNS TABLE (id uuid, ip inet, user_agent text, created_at timestamptz, updated_at timestamptz, refreshed_at timestamptz, aal text, not_after timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY SELECT s.id, s.ip, s.user_agent, s.created_at, s.updated_at, s.refreshed_at::timestamptz, s.aal::text, s.not_after
    FROM auth.sessions s WHERE s.user_id = p_user_id;
END;
$$;
--> statement-breakpoint
-- Fills a missing device name and address; a name the person already sees is kept.
CREATE OR REPLACE FUNCTION app_private.nb_session_set_device(p_session_id uuid, p_user_agent text, p_ip inet) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE auth.sessions s
  SET user_agent = CASE
        WHEN p_user_agent IS NOT NULL AND (s.user_agent IS NULL OR s.user_agent = '' OR s.user_agent = 'Unknown device') THEN p_user_agent
        ELSE s.user_agent
      END,
      ip = COALESCE(s.ip, p_ip)
  WHERE s.id = p_session_id;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_session_delete(p_session_id uuid, p_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM auth.sessions s WHERE s.id = p_session_id AND s.user_id = p_user_id;
END;
$$;
--> statement-breakpoint
-- Objects in one bucket by exact name or LIKE pattern (file reconciliation); never the file bytes.
CREATE OR REPLACE FUNCTION app_private.nb_storage_objects(p_bucket text, p_names text[], p_patterns text[])
RETURNS TABLE (name text, metadata jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY SELECT o.name::text, o.metadata
    FROM storage.objects o
    WHERE o.bucket_id = p_bucket AND (o.name = ANY (p_names) OR o.name LIKE ANY (p_patterns));
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION
  app_private.nb_user_has_password(uuid), app_private.nb_user_has_verified_mfa(uuid), app_private.nb_user_identities(uuid),
  app_private.nb_user_sessions(uuid), app_private.nb_session_set_device(uuid, text, inet), app_private.nb_session_delete(uuid, uuid),
  app_private.nb_storage_objects(text, text[], text[]), app_private.nb_app_policy_for_new_tables()
FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  app_private.nb_user_has_password(uuid), app_private.nb_user_has_verified_mfa(uuid), app_private.nb_user_identities(uuid),
  app_private.nb_user_sessions(uuid), app_private.nb_session_set_device(uuid, text, inet), app_private.nb_session_delete(uuid, uuid),
  app_private.nb_storage_objects(text, text[], text[])
TO nb_app;
--> statement-breakpoint
-- The one caller-run trigger that used auth.uid(): nb_app has no USAGE on schema auth (postgres cannot grant it),
-- so it reads the same JWT setting auth.uid() reads. Otherwise unchanged.
CREATE OR REPLACE FUNCTION public.record_file_content_contribution()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  project_uuid uuid;
  actor uuid := coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
BEGIN
  IF current_setting('app.maintenance_operation', true) IN ('hash_backfill', 'version_repair') THEN
    RETURN NEW;
  END IF;
  IF actor IS NOT NULL AND (NEW.uploaded_by IS DISTINCT FROM actor OR NEW.attribution <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'File authorship must match the authenticated actor';
  END IF;
  IF TG_OP = 'UPDATE'
    AND NEW.s3_key IS NOT DISTINCT FROM OLD.s3_key
    AND NEW.size IS NOT DISTINCT FROM OLD.size
    AND NEW.mime_type IS NOT DISTINCT FROM OLD.mime_type THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.content_hash IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.file_versions previous WHERE previous.node_id=NEW.node_id
      AND previous.version=NEW.version-1 AND previous.content_hash=NEW.content_hash
  ) THEN RETURN NEW; END IF;
  SELECT workspace_id INTO project_uuid FROM public.workspace_nodes WHERE id = NEW.node_id;
  INSERT INTO public.workspace_node_events(workspace_id,node_id,actor_id,type,sequence_number,metadata)
  VALUES (project_uuid,NEW.node_id,NEW.uploaded_by,'file_content_contributed',0,
    jsonb_build_object('version',NEW.version,'hash',NEW.content_hash,'source',COALESCE(NEW.attribution->>'source','edge'),'attribution',NEW.attribution));
  IF NEW.uploaded_by IS NOT NULL THEN
    UPDATE public.profile_collaboration_summaries SET stale=true,updated_at=now() WHERE profile_id=NEW.uploaded_by;
  END IF;
  RETURN NEW;
END $function$;
