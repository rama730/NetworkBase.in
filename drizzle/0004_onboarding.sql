-- Onboarding drafts, events, submissions, the daily stats view.
SET LOCAL check_function_bodies = off;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', true);
--> statement-breakpoint
CREATE TABLE public.onboarding_drafts (
    user_id uuid NOT NULL,
    step integer DEFAULT 1 NOT NULL,
    draft jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    completed_through integer DEFAULT 0 NOT NULL,
    active_section text DEFAULT 'identity'::text NOT NULL,
    schema_version integer DEFAULT 3 NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval) NOT NULL,
    CONSTRAINT onboarding_drafts_active_section_check CHECK ((active_section = ANY (ARRAY['identity'::text, 'work'::text, 'profile'::text, 'social'::text]))),
    CONSTRAINT onboarding_drafts_completed_through_check CHECK (((completed_through >= 0) AND (completed_through <= 4))),
    CONSTRAINT onboarding_drafts_schema_version_check CHECK ((schema_version > 0)),
    CONSTRAINT onboarding_drafts_step_range_check CHECK (((step >= 1) AND (step <= 4)))
);
--> statement-breakpoint
CREATE TABLE public.onboarding_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    event_type text NOT NULL,
    step integer,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE VIEW public.onboarding_slo_daily WITH (security_invoker='true') AS
 WITH base AS (
         SELECT date_trunc('day'::text, onboarding_events.created_at) AS day,
            onboarding_events.event_type
           FROM public.onboarding_events
          WHERE (onboarding_events.created_at >= (now() - '30 days'::interval))
        )
 SELECT (day)::date AS day,
    count(*) FILTER (WHERE (event_type = 'submit_start'::text)) AS submit_starts,
    count(*) FILTER (WHERE (event_type = 'submit_success'::text)) AS submit_successes,
    count(*) FILTER (WHERE (event_type = 'submit_error'::text)) AS submit_errors,
        CASE
            WHEN (count(*) FILTER (WHERE (event_type = 'submit_start'::text)) = 0) THEN NULL::numeric
            ELSE ((count(*) FILTER (WHERE (event_type = 'submit_success'::text)))::numeric / (count(*) FILTER (WHERE (event_type = 'submit_start'::text)))::numeric)
        END AS submit_success_rate
   FROM base
  GROUP BY day
  ORDER BY ((day)::date) DESC;
--> statement-breakpoint
CREATE TABLE public.onboarding_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    status public.status_job DEFAULT 'processing'::public.status_job NOT NULL,
    response jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    claims_repaired_at timestamp with time zone,
    attempt_token uuid DEFAULT gen_random_uuid() NOT NULL
);
--> statement-breakpoint
ALTER TABLE ONLY public.onboarding_drafts
    ADD CONSTRAINT onboarding_drafts_pkey PRIMARY KEY (user_id);
--> statement-breakpoint
ALTER TABLE ONLY public.onboarding_events
    ADD CONSTRAINT onboarding_events_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.onboarding_submissions
    ADD CONSTRAINT onboarding_submissions_pkey PRIMARY KEY (id);
--> statement-breakpoint
CREATE INDEX onboarding_drafts_expires_at_idx ON public.onboarding_drafts USING btree (expires_at) WHERE (expires_at IS NOT NULL);
--> statement-breakpoint
CREATE INDEX onboarding_drafts_updated_at_idx ON public.onboarding_drafts USING btree (updated_at);
--> statement-breakpoint
CREATE INDEX onboarding_events_event_idx ON public.onboarding_events USING btree (event_type, created_at);
--> statement-breakpoint
CREATE INDEX onboarding_events_retention_idx ON public.onboarding_events USING btree (created_at, id);
--> statement-breakpoint
CREATE INDEX onboarding_events_user_id_idx ON public.onboarding_events USING btree (user_id);
--> statement-breakpoint
CREATE INDEX onboarding_events_user_idx ON public.onboarding_events USING btree (user_id, created_at);
--> statement-breakpoint
CREATE INDEX onboarding_submissions_repair_queue_idx ON public.onboarding_submissions USING btree (status, claims_repaired_at, updated_at);
--> statement-breakpoint
CREATE INDEX onboarding_submissions_status_updated_idx ON public.onboarding_submissions USING btree (status, updated_at);
--> statement-breakpoint
CREATE INDEX onboarding_submissions_user_id_idx ON public.onboarding_submissions USING btree (user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX onboarding_submissions_user_key_unique ON public.onboarding_submissions USING btree (user_id, idempotency_key);
--> statement-breakpoint
CREATE TRIGGER onboarding_drafts_updated_at_trigger BEFORE UPDATE ON public.onboarding_drafts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
--> statement-breakpoint
CREATE TRIGGER onboarding_submissions_updated_at_trigger BEFORE UPDATE ON public.onboarding_submissions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
--> statement-breakpoint
ALTER TABLE ONLY public.onboarding_drafts
    ADD CONSTRAINT onboarding_drafts_user_id_profiles_id_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.onboarding_events
    ADD CONSTRAINT onboarding_events_user_id_profiles_id_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.onboarding_submissions
    ADD CONSTRAINT onboarding_submissions_user_id_profiles_id_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.onboarding_drafts TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.onboarding_events TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.onboarding_submissions TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE public.onboarding_drafts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY onboarding_drafts_all_own ON public.onboarding_drafts USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
--> statement-breakpoint
ALTER TABLE public.onboarding_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY onboarding_events_select_own ON public.onboarding_events FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));
--> statement-breakpoint
ALTER TABLE public.onboarding_submissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY onboarding_submissions_insert_own ON public.onboarding_submissions FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
--> statement-breakpoint
CREATE POLICY onboarding_submissions_select_own ON public.onboarding_submissions FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));
--> statement-breakpoint
CREATE POLICY onboarding_submissions_update_own ON public.onboarding_submissions FOR UPDATE USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.onboarding_drafts TO anon;
GRANT MAINTAIN ON TABLE public.onboarding_drafts TO authenticated;
GRANT ALL ON TABLE public.onboarding_drafts TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.onboarding_drafts TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.onboarding_events TO anon;
GRANT MAINTAIN ON TABLE public.onboarding_events TO authenticated;
GRANT ALL ON TABLE public.onboarding_events TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.onboarding_events TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.onboarding_slo_daily TO anon;
GRANT MAINTAIN ON TABLE public.onboarding_slo_daily TO authenticated;
GRANT ALL ON TABLE public.onboarding_slo_daily TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.onboarding_slo_daily TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.onboarding_submissions TO anon;
GRANT MAINTAIN ON TABLE public.onboarding_submissions TO authenticated;
GRANT ALL ON TABLE public.onboarding_submissions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.onboarding_submissions TO nb_app;
