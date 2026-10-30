-- Gives every new public table its nb_app policy. Must stay after every file that creates tables.
SET LOCAL check_function_bodies = off;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', true);
--> statement-breakpoint
CREATE FUNCTION app_private.nb_app_policy_for_new_tables() RETURNS event_trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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
REVOKE ALL ON FUNCTION app_private.nb_app_policy_for_new_tables() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_app_policy_for_new_tables() TO nb_app;
--> statement-breakpoint
CREATE EVENT TRIGGER nb_app_policy_for_new_tables ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION app_private.nb_app_policy_for_new_tables();
