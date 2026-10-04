-- Local-only stand-ins for app_private helpers that hosted migrations created
-- before the chat rebuild and that 0180's realtime policies still reference.
-- The local test DB is built from the Drizzle schema (scripts/chat-db/local-db.sh),
-- not by replaying history, so these helpers would otherwise be missing.
-- They deny everything: the chat checks only exercise the chat:* branches.
CREATE SCHEMA IF NOT EXISTS app_private;
CREATE OR REPLACE FUNCTION app_private.nb_can_observe_user_presence(p_target_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION app_private.nb_is_conversation_participant(p_conversation_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION app_private.nb_project_can_read(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
GRANT USAGE ON SCHEMA app_private TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO authenticated, service_role;
