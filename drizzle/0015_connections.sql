-- Connections, suggestions, dismissals.
SET LOCAL check_function_bodies = off;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', true);
--> statement-breakpoint
CREATE FUNCTION public.prevent_connection_pair_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.requester_id IS DISTINCT FROM OLD.requester_id OR NEW.addressee_id IS DISTINCT FROM OLD.addressee_id THEN
    RAISE EXCEPTION 'Connection participants cannot be altered.';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.set_connection_acceptance_time() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
    IF NEW.status = 'accepted' THEN
        IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'accepted' THEN
            NEW.accepted_at := COALESCE(NEW.accepted_at, now());
        ELSE
            NEW.accepted_at := COALESCE(OLD.accepted_at, NEW.accepted_at, now());
        END IF;
    ELSE
        NEW.accepted_at := NULL;
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TABLE public.connection_suggestion_dismissals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    dismissed_profile_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.connection_suggestions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    suggested_user_id uuid NOT NULL,
    mutual_connections_count integer DEFAULT 0 NOT NULL,
    score integer DEFAULT 0 NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    requester_id uuid NOT NULL,
    addressee_id uuid NOT NULL,
    status public.status_connection DEFAULT 'pending'::public.status_connection NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    blocked_by uuid,
    blocked_at timestamp with time zone,
    message text,
    tags jsonb DEFAULT '[]'::jsonb,
    rejection_reason text,
    accepted_at timestamp with time zone,
    CONSTRAINT connections_blocked_status_check CHECK ((((status)::text <> 'blocked'::text) OR ((blocked_by IS NOT NULL) AND (blocked_at IS NOT NULL)))),
    CONSTRAINT connections_no_self_check CHECK ((requester_id <> addressee_id)),
    CONSTRAINT connections_status_accepted_at_check CHECK (((status <> 'accepted'::public.status_connection) OR (accepted_at IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE ONLY public.connection_suggestion_dismissals
    ADD CONSTRAINT connection_suggestion_dismissals_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.connection_suggestions
    ADD CONSTRAINT connection_suggestions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.connections
    ADD CONSTRAINT connections_pkey PRIMARY KEY (id);
--> statement-breakpoint
CREATE INDEX connection_suggestion_dismissals_profile_idx ON public.connection_suggestion_dismissals USING btree (dismissed_profile_id);
--> statement-breakpoint
CREATE INDEX connection_suggestion_dismissals_user_created_idx ON public.connection_suggestion_dismissals USING btree (user_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX connection_suggestion_dismissals_user_profile_unique ON public.connection_suggestion_dismissals USING btree (user_id, dismissed_profile_id);
--> statement-breakpoint
CREATE INDEX connection_suggestions_suggested_user_idx ON public.connection_suggestions USING btree (suggested_user_id);
--> statement-breakpoint
CREATE INDEX connection_suggestions_user_score_idx ON public.connection_suggestions USING btree (user_id, score);
--> statement-breakpoint
CREATE INDEX connection_suggestions_user_score_keyset_idx ON public.connection_suggestions USING btree (user_id, score DESC, suggested_user_id DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX connection_suggestions_user_suggested_unique ON public.connection_suggestions USING btree (user_id, suggested_user_id);
--> statement-breakpoint
CREATE INDEX connections_addressee_idx ON public.connections USING btree (addressee_id);
--> statement-breakpoint
CREATE INDEX connections_addressee_pending_created_idx ON public.connections USING btree (addressee_id, created_at DESC, id DESC) WHERE (status = 'pending'::public.status_connection);
--> statement-breakpoint
CREATE INDEX connections_addressee_stats_idx ON public.connections USING btree (addressee_id, status, updated_at);
--> statement-breakpoint
CREATE INDEX connections_blocked_by_idx ON public.connections USING btree (blocked_by, blocked_at);
--> statement-breakpoint
CREATE INDEX connections_pending_idx ON public.connections USING btree (status, created_at);
--> statement-breakpoint
CREATE INDEX connections_req_addr_status_idx ON public.connections USING btree (requester_id, addressee_id, status);
--> statement-breakpoint
CREATE INDEX connections_requester_idx ON public.connections USING btree (requester_id);
--> statement-breakpoint
CREATE INDEX connections_requester_pending_created_idx ON public.connections USING btree (requester_id, created_at DESC, id DESC) WHERE (status = 'pending'::public.status_connection);
--> statement-breakpoint
CREATE INDEX connections_requester_stats_idx ON public.connections USING btree (requester_id, status, updated_at);
--> statement-breakpoint
CREATE INDEX connections_status_addressee_idx ON public.connections USING btree (status, addressee_id);
--> statement-breakpoint
CREATE INDEX connections_status_idx ON public.connections USING btree (status);
--> statement-breakpoint
CREATE INDEX connections_status_requester_idx ON public.connections USING btree (status, requester_id);
--> statement-breakpoint
CREATE TRIGGER connections_acceptance_time BEFORE INSERT OR UPDATE ON public.connections FOR EACH ROW EXECUTE FUNCTION public.set_connection_acceptance_time();
--> statement-breakpoint
CREATE TRIGGER connections_immutability_trigger BEFORE UPDATE ON public.connections FOR EACH ROW EXECUTE FUNCTION public.prevent_connection_pair_mutation();
--> statement-breakpoint
ALTER TABLE ONLY public.connection_suggestion_dismissals
    ADD CONSTRAINT connection_suggestion_dismissals_dismissed_profile_id_profiles_ FOREIGN KEY (dismissed_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.connection_suggestion_dismissals
    ADD CONSTRAINT connection_suggestion_dismissals_user_id_profiles_id_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.connection_suggestions
    ADD CONSTRAINT connection_suggestions_suggested_user_id_profiles_id_fk FOREIGN KEY (suggested_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.connection_suggestions
    ADD CONSTRAINT connection_suggestions_user_id_profiles_id_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.connections
    ADD CONSTRAINT connections_addressee_id_profiles_id_fk FOREIGN KEY (addressee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.connections
    ADD CONSTRAINT connections_blocked_by_profiles_id_fk FOREIGN KEY (blocked_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.connections
    ADD CONSTRAINT connections_requester_id_profiles_id_fk FOREIGN KEY (requester_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.connection_suggestion_dismissals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY connection_suggestion_dismissals_all_own ON public.connection_suggestion_dismissals USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
ALTER TABLE public.connection_suggestions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY connection_suggestions_select_own ON public.connection_suggestions FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY connections_select_own ON public.connections FOR SELECT USING (((( SELECT auth.uid() AS uid) = requester_id) OR (( SELECT auth.uid() AS uid) = addressee_id)));
--> statement-breakpoint
CREATE POLICY connections_select_participant_visible ON public.connections FOR SELECT TO authenticated USING ((((auth.uid() = requester_id) OR (auth.uid() = addressee_id)) AND ((status <> 'blocked'::public.status_connection) OR (blocked_by = auth.uid()))));
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.connection_suggestion_dismissals TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.connection_suggestions TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.connections TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY profiles_select_visible ON public.profiles FOR SELECT USING (((deleted_at IS NULL) AND ((( SELECT auth.uid() AS uid) = id) OR (visibility = 'public'::text) OR ((visibility = 'connections'::text) AND (EXISTS ( SELECT 1
   FROM public.connections c
  WHERE ((c.status = 'accepted'::public.status_connection) AND (((c.requester_id = ( SELECT auth.uid() AS uid)) AND (c.addressee_id = profiles.id)) OR ((c.addressee_id = ( SELECT auth.uid() AS uid)) AND (c.requester_id = profiles.id))))))))));
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prevent_connection_pair_mutation() FROM PUBLIC;
GRANT ALL ON FUNCTION public.prevent_connection_pair_mutation() TO service_role;
GRANT ALL ON FUNCTION public.prevent_connection_pair_mutation() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.set_connection_acceptance_time() FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_connection_acceptance_time() TO service_role;
GRANT ALL ON FUNCTION public.set_connection_acceptance_time() TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.connection_suggestion_dismissals TO anon;
GRANT MAINTAIN ON TABLE public.connection_suggestion_dismissals TO authenticated;
GRANT ALL ON TABLE public.connection_suggestion_dismissals TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connection_suggestion_dismissals TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.connection_suggestions TO anon;
GRANT MAINTAIN ON TABLE public.connection_suggestions TO authenticated;
GRANT ALL ON TABLE public.connection_suggestions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connection_suggestions TO nb_app;
--> statement-breakpoint
GRANT SELECT,MAINTAIN ON TABLE public.connections TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.connections TO authenticated;
GRANT ALL ON TABLE public.connections TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connections TO nb_app;
