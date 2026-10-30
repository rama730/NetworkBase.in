-- Schemas, enum types, the nb_app role and its default permissions, job tables. app_migration_journal itself is created by scripts/setup-database.ts.
SET LOCAL check_function_bodies = off;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', true);
--> statement-breakpoint
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nb_app') THEN
    CREATE ROLE nb_app NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$role$;
--> statement-breakpoint
CREATE SCHEMA app_private;
--> statement-breakpoint
COMMENT ON SCHEMA public IS 'standard public schema';
--> statement-breakpoint
CREATE TYPE public.status_connection AS ENUM (
    'pending',
    'accepted',
    'rejected',
    'cancelled',
    'disconnected',
    'blocked'
);
--> statement-breakpoint
CREATE TYPE public.status_file AS ENUM (
    'pending',
    'finalized',
    'expired',
    'failed'
);
--> statement-breakpoint
CREATE TYPE public.status_job AS ENUM (
    'processing',
    'completed',
    'failed'
);
--> statement-breakpoint
CREATE TYPE public.status_notification AS ENUM (
    'delivered',
    'failed',
    'dropped'
);
--> statement-breakpoint
CREATE TYPE public.status_role_application AS ENUM (
    'pending',
    'accepted',
    'rejected',
    'withdrawn',
    'proposed'
);
--> statement-breakpoint
CREATE TYPE public.status_sprint AS ENUM (
    'planning',
    'active',
    'completed',
    'archived',
    'cancelled'
);
--> statement-breakpoint
CREATE TYPE public.status_task AS ENUM (
    'todo',
    'in_progress',
    'done',
    'blocked'
);
--> statement-breakpoint
CREATE TYPE public.status_workspace AS ENUM (
    'draft',
    'active',
    'completed',
    'archived'
);
--> statement-breakpoint
CREATE FUNCTION app_private.join_block_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user uuid;
BEGIN
  -- One branch per table: plpgsql resolves every field an expression names, even in a branch not taken.
  IF TG_TABLE_NAME = 'workspace_members' THEN v_user := NEW.user_id;
  ELSIF TG_TABLE_NAME = 'role_applications' THEN v_user := NEW.applicant_id;
  ELSE v_user := NEW.candidate_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_join_blocks j WHERE j.org_id = NEW.workspace_id AND j.user_id = v_user) THEN
    PERFORM app_private.refuse_across_block();
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.nb_can_observe_user_presence(p_target_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT
    p_target_user_id = (SELECT auth.uid())
    OR (
      app_private.nb_presence_activity_visible((SELECT auth.uid()), p_target_user_id)
      AND (
        EXISTS (
          SELECT 1
          FROM public.chat_channel_members viewer
          JOIN public.chat_channels c ON c.id = viewer.channel_id AND (c.kind = 'dm' OR (c.kind = 'private' AND c.name IS NULL))
          JOIN public.chat_channel_members target ON target.channel_id = viewer.channel_id
          WHERE viewer.user_id = (SELECT auth.uid())
            AND target.user_id = p_target_user_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.workspace_members viewer
          JOIN public.workspace_members target
            ON target.workspace_id = viewer.workspace_id
          WHERE viewer.user_id = (SELECT auth.uid())
            AND target.user_id = p_target_user_id
        )
      )
    );
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.nb_can_publish_user_presence() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT coalesce((SELECT p.show_activity FROM public.profiles p WHERE p.id = (SELECT auth.uid())), false);
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.nb_presence_activity_visible(p_viewer uuid, p_target uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p_viewer IS NOT NULL AND p_target IS NOT NULL AND (
    p_viewer = p_target
    OR (
      NOT app_private.blocked_between(p_viewer, p_target)
      AND (SELECT count(*) FROM public.profiles p WHERE p.id IN (p_viewer, p_target) AND p.show_activity) = 2
    )
  );
$$;
--> statement-breakpoint
CREATE TABLE public.counter_flush_batches (
    batch_id text NOT NULL,
    kind text NOT NULL,
    entry_count integer DEFAULT 0 NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.job_heartbeats (
    job_id text NOT NULL,
    last_success_at timestamp with time zone NOT NULL,
    last_payload jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.work_leases (
    scope text NOT NULL,
    lease_id uuid NOT NULL,
    fence bigint DEFAULT 1 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE ONLY public.counter_flush_batches
    ADD CONSTRAINT counter_flush_batches_pkey PRIMARY KEY (batch_id);
--> statement-breakpoint
ALTER TABLE ONLY public.job_heartbeats
    ADD CONSTRAINT job_heartbeats_pkey PRIMARY KEY (job_id);
--> statement-breakpoint
ALTER TABLE ONLY public.work_leases
    ADD CONSTRAINT work_leases_pkey PRIMARY KEY (scope);
--> statement-breakpoint
CREATE INDEX counter_flush_batches_applied_idx ON public.counter_flush_batches USING btree (applied_at);
--> statement-breakpoint
ALTER TABLE public.app_migration_journal ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.counter_flush_batches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.job_heartbeats ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.app_migration_journal TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.counter_flush_batches TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.job_heartbeats TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.work_leases TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE public.work_leases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app_private TO anon;
GRANT USAGE ON SCHEMA app_private TO authenticated;
GRANT USAGE ON SCHEMA app_private TO service_role;
GRANT USAGE ON SCHEMA app_private TO nb_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.join_block_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.join_block_guard() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_can_observe_user_presence(p_target_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_can_observe_user_presence(p_target_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.nb_can_observe_user_presence(p_target_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app_private.nb_can_observe_user_presence(p_target_user_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_can_publish_user_presence() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_can_publish_user_presence() TO authenticated;
GRANT ALL ON FUNCTION app_private.nb_can_publish_user_presence() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_presence_activity_visible(p_viewer uuid, p_target uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_presence_activity_visible(p_viewer uuid, p_target uuid) TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.app_migration_journal TO anon;
GRANT MAINTAIN ON TABLE public.app_migration_journal TO authenticated;
GRANT ALL ON TABLE public.app_migration_journal TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.app_migration_journal TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.counter_flush_batches TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.counter_flush_batches TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.job_heartbeats TO anon;
GRANT MAINTAIN ON TABLE public.job_heartbeats TO authenticated;
GRANT ALL ON TABLE public.job_heartbeats TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.job_heartbeats TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.work_leases TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.work_leases TO nb_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app_private GRANT ALL ON FUNCTIONS TO nb_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO nb_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO nb_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO nb_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;
--> statement-breakpoint
GRANT USAGE ON SCHEMA extensions TO nb_app;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO nb_app;
