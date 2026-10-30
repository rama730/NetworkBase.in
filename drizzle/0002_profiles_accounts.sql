-- Profiles, usernames, account security, deletion, legal acceptance, the auth.users trigger.
SET LOCAL check_function_bodies = off;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', true);
--> statement-breakpoint
CREATE FUNCTION app_private.nb_session_delete(p_session_id uuid, p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  DELETE FROM auth.sessions s WHERE s.id = p_session_id AND s.user_id = p_user_id;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.nb_session_set_device(p_session_id uuid, p_user_agent text, p_ip inet) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  UPDATE auth.sessions s
  SET user_agent = CASE WHEN replaceable THEN p_user_agent ELSE s.user_agent END,
      ip = CASE WHEN replaceable THEN COALESCE(p_ip, s.ip) ELSE COALESCE(s.ip, p_ip) END
  FROM (
    SELECT p_user_agent IS NOT NULL AND (
      x.user_agent IS NULL OR btrim(x.user_agent) IN ('', 'Unknown device')
      OR x.user_agent ~* '^(node|undici|node-fetch|axios|got|deno|bun|next\.js)\M'
    ) AS replaceable
    FROM auth.sessions x WHERE x.id = p_session_id
  ) r
  WHERE s.id = p_session_id;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.nb_user_has_password(p_user_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  RETURN (SELECT u.encrypted_password IS NOT NULL AND u.encrypted_password <> '' FROM auth.users u WHERE u.id = p_user_id);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.nb_user_has_verified_mfa(p_user_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = p_user_id AND f.status::text = 'verified');
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.nb_user_identities(p_user_id uuid) RETURNS TABLE(id uuid, provider text, provider_id text, identity_data jsonb, last_sign_in_at timestamp with time zone, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  RETURN QUERY SELECT i.id, i.provider, i.provider_id, i.identity_data, i.last_sign_in_at, i.created_at
    FROM auth.identities i WHERE i.user_id = p_user_id;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.nb_user_sessions(p_user_id uuid) RETURNS TABLE(id uuid, ip inet, user_agent text, created_at timestamp with time zone, updated_at timestamp with time zone, refreshed_at timestamp with time zone, aal text, not_after timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  RETURN QUERY SELECT s.id, s.ip, s.user_agent, s.created_at, s.updated_at, s.refreshed_at::timestamptz, s.aal::text, s.not_after
    FROM auth.sessions s WHERE s.user_id = p_user_id;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.sync_email_verified_claim() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  NEW.raw_app_meta_data := coalesce(NEW.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('email_verified', NEW.email_confirmed_at IS NOT NULL);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.enforce_profile_username_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
        begin
            if new.username is null then
                return new;
            end if;

            new.username := lower(trim(new.username));

            if new.username !~ '^[a-z0-9_]{3,20}$' then
                raise exception using errcode = '23514', message = 'Invalid username format';
            end if;

            if exists (
                select 1 from public.reserved_usernames where username = new.username
            ) then
                raise exception using errcode = '23514', message = 'Username is reserved';
            end if;

            return new;
        end;
        $_$;
--> statement-breakpoint
CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.sync_profile_to_auth_user_metadata() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_fields jsonb := jsonb_build_object('avatar_url', NEW.avatar_url, 'full_name', NEW.full_name, 'username', NEW.username);
BEGIN
  UPDATE auth.users
  SET raw_user_meta_data =
    (coalesce(raw_user_meta_data, '{}'::jsonb)
      - ARRAY(SELECT key FROM jsonb_each(v_fields) WHERE value = 'null'::jsonb))
    || jsonb_strip_nulls(v_fields)
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TABLE public.account_deletions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    email text NOT NULL,
    username text,
    reason text,
    scheduled_at timestamp with time zone DEFAULT now() NOT NULL,
    hard_delete_at timestamp with time zone NOT NULL,
    cancelled_at timestamp with time zone,
    completed_at timestamp with time zone,
    cleanup_status text DEFAULT 'pending'::text NOT NULL,
    cleanup_details jsonb DEFAULT '{}'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    legal_retention_until timestamp with time zone NOT NULL,
    CONSTRAINT account_deletions_cleanup_status_check CHECK ((cleanup_status = ANY (ARRAY['pending'::text, 'storage_running'::text, 'storage_scheduled'::text, 'db_deleted'::text, 'completed'::text, 'failed'::text])))
);
--> statement-breakpoint
CREATE TABLE public.legal_acceptances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    terms_version text NOT NULL,
    eula_version text NOT NULL,
    privacy_notice_version text NOT NULL,
    context text NOT NULL,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    accepted_at timestamp with time zone DEFAULT now() NOT NULL,
    retention_expires_at timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.profile_audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    event_type text NOT NULL,
    previous_value jsonb DEFAULT 'null'::jsonb,
    next_value jsonb DEFAULT 'null'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.profile_security_states (
    user_id uuid NOT NULL,
    security_recovery_codes jsonb DEFAULT '[]'::jsonb NOT NULL,
    recovery_codes_generated_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    recovery_codes_factor_id text,
    recovery_codes_generation integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    username text,
    full_name text,
    avatar_url text,
    banner_url text,
    bio text,
    headline text,
    location text,
    website text,
    skills jsonb DEFAULT '[]'::jsonb,
    interests jsonb DEFAULT '[]'::jsonb,
    social_links jsonb DEFAULT '{}'::jsonb,
    visibility text DEFAULT 'public'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    experience jsonb DEFAULT '[]'::jsonb,
    education jsonb DEFAULT '[]'::jsonb,
    open_to jsonb DEFAULT '[]'::jsonb,
    message_privacy text DEFAULT 'connections'::text,
    connections_count integer DEFAULT 0 NOT NULL,
    workspaces_count integer DEFAULT 0 NOT NULL,
    followers_count integer DEFAULT 0 NOT NULL,
    files_layout jsonb DEFAULT 'null'::jsonb,
    deleted_at timestamp with time zone,
    experience_level text,
    hours_per_week text,
    gender_identity text,
    pronouns text,
    my_work_inbox_count integer DEFAULT 0 NOT NULL,
    my_work_due_today_count integer DEFAULT 0 NOT NULL,
    my_work_overdue_count integer DEFAULT 0 NOT NULL,
    my_work_in_progress_count integer DEFAULT 0 NOT NULL,
    connection_privacy text DEFAULT 'everyone'::text,
    last_active_at timestamp with time zone,
    notification_preferences jsonb DEFAULT '{"tasks": true, "mentions": true, "messages": true, "projects": true, "workflows": true, "connections": true, "mutedScopes": [], "pausedUntil": null, "applications": true}'::jsonb,
    onboarding_status text DEFAULT 'not_started'::text NOT NULL,
    onboarding_completed_at timestamp with time zone,
    onboarding_version integer DEFAULT 1 NOT NULL,
    open_to_custom_roles text[] DEFAULT '{}'::text[] NOT NULL,
    preferred_categories text[] DEFAULT '{}'::text[] NOT NULL,
    social_link_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    avatar_asset_id uuid,
    banner_asset_id uuid,
    show_activity boolean DEFAULT true NOT NULL,
    status_text text,
    status_expires_at timestamp with time zone,
    status_set_at timestamp with time zone,
    status_pauses_notifications boolean DEFAULT false NOT NULL,
    status_visibility text DEFAULT 'network'::text NOT NULL,
    status_emoji text,
    open_to_collaborate boolean DEFAULT false NOT NULL,
    CONSTRAINT profiles_connection_privacy_check CHECK ((connection_privacy = ANY (ARRAY['everyone'::text, 'mutuals_only'::text, 'nobody'::text]))),
    CONSTRAINT profiles_experience_level_check CHECK (((experience_level IS NULL) OR (experience_level = ANY (ARRAY['student'::text, 'junior'::text, 'mid'::text, 'senior'::text, 'lead'::text])))),
    CONSTRAINT profiles_gender_identity_check CHECK (((gender_identity IS NULL) OR (gender_identity = ANY (ARRAY['male'::text, 'female'::text, 'non_binary'::text, 'prefer_not_to_say'::text, 'other'::text])))),
    CONSTRAINT profiles_hours_per_week_check CHECK (((hours_per_week IS NULL) OR (hours_per_week = ANY (ARRAY['lt_5'::text, 'h_5_10'::text, 'h_10_20'::text, 'h_20_40'::text, 'h_40_plus'::text])))),
    CONSTRAINT profiles_onboarding_shape_check CHECK ((((full_name IS NULL) OR ((char_length(TRIM(BOTH FROM full_name)) >= 2) AND (char_length(TRIM(BOTH FROM full_name)) <= 80))) AND ((headline IS NULL) OR (char_length(headline) <= 120)) AND ((bio IS NULL) OR (char_length(bio) <= 500)) AND ((location IS NULL) OR (char_length(location) <= 120)) AND ((website IS NULL) OR ((char_length(website) <= 200) AND (website ~ '^https?://'::text))) AND ((visibility IS NULL) OR (visibility = ANY (ARRAY['public'::text, 'connections'::text, 'private'::text]))) AND ((skills IS NULL) OR ((jsonb_typeof(skills) = 'array'::text) AND (jsonb_array_length(skills) <= 25))) AND ((interests IS NULL) OR ((jsonb_typeof(interests) = 'array'::text) AND (jsonb_array_length(interests) <= 25))))),
    CONSTRAINT profiles_onboarding_status_check CHECK ((onboarding_status = ANY (ARRAY['not_started'::text, 'in_progress'::text, 'completed'::text]))),
    CONSTRAINT profiles_onboarding_version_check CHECK ((onboarding_version > 0)),
    CONSTRAINT profiles_pronouns_length_check CHECK (((pronouns IS NULL) OR (char_length(TRIM(BOTH FROM pronouns)) <= 60))),
    CONSTRAINT profiles_status_emoji_check CHECK (((status_emoji IS NULL) OR ((char_length(status_emoji) >= 1) AND (char_length(status_emoji) <= 16)))),
    CONSTRAINT profiles_status_text_check CHECK (((status_text IS NULL) OR (char_length(status_text) <= 80))),
    CONSTRAINT profiles_status_visibility_check CHECK ((status_visibility = ANY (ARRAY['everyone'::text, 'network'::text, 'team'::text]))),
    CONSTRAINT profiles_username_format_check CHECK (((username IS NULL) OR (username ~ '^[a-z0-9_]{3,20}$'::text)))
);
--> statement-breakpoint
CREATE TABLE public.recovery_code_redemptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    code_id text NOT NULL,
    redeemed_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.reserved_usernames (
    username text NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.username_aliases (
    username text NOT NULL,
    user_id uuid NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    replaced_at timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE ONLY public.account_deletions
    ADD CONSTRAINT account_deletions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.legal_acceptances
    ADD CONSTRAINT legal_acceptances_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.legal_acceptances
    ADD CONSTRAINT legal_acceptances_user_versions_unique UNIQUE (user_id, terms_version, eula_version, privacy_notice_version);
--> statement-breakpoint
ALTER TABLE ONLY public.profile_audit_events
    ADD CONSTRAINT profile_audit_events_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.profile_security_states
    ADD CONSTRAINT profile_security_states_pkey PRIMARY KEY (user_id);
--> statement-breakpoint
ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_email_unique UNIQUE (email);
--> statement-breakpoint
ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_username_unique UNIQUE (username);
--> statement-breakpoint
ALTER TABLE ONLY public.recovery_code_redemptions
    ADD CONSTRAINT recovery_code_redemptions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.reserved_usernames
    ADD CONSTRAINT reserved_usernames_pkey PRIMARY KEY (username);
--> statement-breakpoint
ALTER TABLE ONLY public.username_aliases
    ADD CONSTRAINT username_aliases_pkey PRIMARY KEY (username);
--> statement-breakpoint
CREATE INDEX account_deletions_hard_delete_idx ON public.account_deletions USING btree (hard_delete_at, completed_at);
--> statement-breakpoint
CREATE INDEX account_deletions_legal_retention_idx ON public.account_deletions USING btree (legal_retention_until, completed_at);
--> statement-breakpoint
CREATE INDEX account_deletions_user_idx ON public.account_deletions USING btree (user_id);
--> statement-breakpoint
CREATE INDEX legal_acceptances_expiry_idx ON public.legal_acceptances USING btree (retention_expires_at);
--> statement-breakpoint
CREATE INDEX legal_acceptances_user_accepted_idx ON public.legal_acceptances USING btree (user_id, accepted_at);
--> statement-breakpoint
CREATE UNIQUE INDEX profile_audit_events_contribution_batch_key_unique ON public.profile_audit_events USING btree (user_id, ((metadata ->> 'idempotencyKey'::text))) WHERE ((event_type = 'profile_contribution_batch_saved'::text) AND (NULLIF((metadata ->> 'idempotencyKey'::text), ''::text) IS NOT NULL));
--> statement-breakpoint
CREATE INDEX profile_audit_events_retention_idx ON public.profile_audit_events USING btree (created_at, id);
--> statement-breakpoint
CREATE UNIQUE INDEX profile_audit_events_story_request_unique ON public.profile_audit_events USING btree (user_id, ((metadata ->> 'requestId'::text))) WHERE (event_type = 'contribution_story_saved'::text);
--> statement-breakpoint
CREATE INDEX profile_audit_events_user_created_idx ON public.profile_audit_events USING btree (user_id, created_at);
--> statement-breakpoint
CREATE INDEX profile_audit_events_user_event_idx ON public.profile_audit_events USING btree (user_id, event_type, created_at);
--> statement-breakpoint
CREATE INDEX profile_audit_events_user_id_idx ON public.profile_audit_events USING btree (user_id);
--> statement-breakpoint
CREATE INDEX profile_security_states_generated_at_idx ON public.profile_security_states USING btree (recovery_codes_generated_at);
--> statement-breakpoint
CREATE INDEX profiles_avatar_asset_idx ON public.profiles USING btree (avatar_asset_id);
--> statement-breakpoint
CREATE INDEX profiles_banner_asset_idx ON public.profiles USING btree (banner_asset_id);
--> statement-breakpoint
CREATE INDEX profiles_connections_count_idx ON public.profiles USING btree (connections_count);
--> statement-breakpoint
CREATE INDEX profiles_created_at_idx ON public.profiles USING btree (created_at);
--> statement-breakpoint
CREATE INDEX profiles_custom_roles_gin_idx ON public.profiles USING gin (open_to_custom_roles);
--> statement-breakpoint
CREATE INDEX profiles_full_name_search_idx ON public.profiles USING gin (full_name extensions.gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX profiles_interests_idx ON public.profiles USING gin (interests);
--> statement-breakpoint
CREATE INDEX profiles_last_active_at_idx ON public.profiles USING btree (last_active_at);
--> statement-breakpoint
CREATE INDEX profiles_onboarding_status_idx ON public.profiles USING btree (onboarding_status, updated_at);
--> statement-breakpoint
CREATE INDEX profiles_search_trgm_idx ON public.profiles USING gin (full_name extensions.gin_trgm_ops, username extensions.gin_trgm_ops) WHERE ((deleted_at IS NULL) AND (onboarding_status = 'completed'::text));
--> statement-breakpoint
CREATE INDEX profiles_skills_idx ON public.profiles USING gin (skills);
--> statement-breakpoint
CREATE INDEX profiles_username_search_idx ON public.profiles USING gin (username extensions.gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX profiles_workspaces_count_idx ON public.profiles USING btree (workspaces_count);
--> statement-breakpoint
CREATE UNIQUE INDEX recovery_code_redemptions_user_code_unique ON public.recovery_code_redemptions USING btree (user_id, code_id);
--> statement-breakpoint
CREATE INDEX recovery_code_redemptions_user_redeemed_idx ON public.recovery_code_redemptions USING btree (user_id, redeemed_at);
--> statement-breakpoint
CREATE INDEX username_aliases_user_claimed_at_idx ON public.username_aliases USING btree (user_id, claimed_at);
--> statement-breakpoint
CREATE INDEX username_aliases_user_primary_idx ON public.username_aliases USING btree (user_id, is_primary);
--> statement-breakpoint
CREATE UNIQUE INDEX username_aliases_user_primary_unique_idx ON public.username_aliases USING btree (user_id) WHERE (is_primary = true);
--> statement-breakpoint
CREATE TRIGGER profiles_sync_auth_metadata AFTER INSERT OR UPDATE OF avatar_url, full_name, username ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.sync_profile_to_auth_user_metadata();
--> statement-breakpoint
CREATE TRIGGER profiles_username_rules_trigger BEFORE INSERT OR UPDATE OF username ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_username_rules();
--> statement-breakpoint
ALTER TABLE ONLY public.profile_audit_events
    ADD CONSTRAINT profile_audit_events_user_id_profiles_id_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.profile_security_states
    ADD CONSTRAINT profile_security_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_auth_users_fk FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE ONLY public.recovery_code_redemptions
    ADD CONSTRAINT recovery_code_redemptions_user_id_profiles_id_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.username_aliases
    ADD CONSTRAINT username_aliases_user_id_profiles_id_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.account_deletions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY account_deletions_select_own ON public.account_deletions FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.account_deletions TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.legal_acceptances TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.profile_audit_events TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.profile_security_states TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.profiles TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.recovery_code_redemptions TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.reserved_usernames TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.username_aliases TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE public.profile_audit_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY profile_audit_events_select_own ON public.profile_audit_events FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));
--> statement-breakpoint
ALTER TABLE public.profile_security_states ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY profile_security_states_delete_own ON public.profile_security_states FOR DELETE USING ((( SELECT auth.uid() AS uid) = user_id));
--> statement-breakpoint
CREATE POLICY profile_security_states_insert_own ON public.profile_security_states FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
--> statement-breakpoint
CREATE POLICY profile_security_states_select_own ON public.profile_security_states FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));
--> statement-breakpoint
CREATE POLICY profile_security_states_update_own ON public.profile_security_states FOR UPDATE USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
--> statement-breakpoint
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = id));
--> statement-breakpoint
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE USING (((( SELECT auth.uid() AS uid) = id) AND (deleted_at IS NULL))) WITH CHECK ((( SELECT auth.uid() AS uid) = id));
--> statement-breakpoint
ALTER TABLE public.recovery_code_redemptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY recovery_code_redemptions_insert_own ON public.recovery_code_redemptions FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
--> statement-breakpoint
CREATE POLICY recovery_code_redemptions_select_own ON public.recovery_code_redemptions FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));
--> statement-breakpoint
ALTER TABLE public.reserved_usernames ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.username_aliases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY username_aliases_delete_own ON public.username_aliases FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
CREATE POLICY username_aliases_insert_own ON public.username_aliases FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
CREATE POLICY username_aliases_select_own ON public.username_aliases FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
CREATE POLICY username_aliases_update_own ON public.username_aliases FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_session_delete(p_session_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_session_delete(p_session_id uuid, p_user_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_session_set_device(p_session_id uuid, p_user_agent text, p_ip inet) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_session_set_device(p_session_id uuid, p_user_agent text, p_ip inet) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_user_has_password(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_user_has_password(p_user_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_user_has_verified_mfa(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_user_has_verified_mfa(p_user_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_user_identities(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_user_identities(p_user_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_user_sessions(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_user_sessions(p_user_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.sync_email_verified_claim() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.sync_email_verified_claim() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_profile_username_rules() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_profile_username_rules() TO service_role;
GRANT ALL ON FUNCTION public.enforce_profile_username_rules() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO service_role;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sync_profile_to_auth_user_metadata() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_profile_to_auth_user_metadata() TO service_role;
GRANT ALL ON FUNCTION public.sync_profile_to_auth_user_metadata() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.account_deletions TO anon;
GRANT MAINTAIN ON TABLE public.account_deletions TO authenticated;
GRANT ALL ON TABLE public.account_deletions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.account_deletions TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.legal_acceptances TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.legal_acceptances TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.profile_audit_events TO anon;
GRANT MAINTAIN ON TABLE public.profile_audit_events TO authenticated;
GRANT ALL ON TABLE public.profile_audit_events TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.profile_audit_events TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.profile_security_states TO anon;
GRANT MAINTAIN ON TABLE public.profile_security_states TO authenticated;
GRANT ALL ON TABLE public.profile_security_states TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.profile_security_states TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.profiles TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.profiles TO nb_app;
--> statement-breakpoint
GRANT SELECT(id) ON TABLE public.profiles TO anon;
GRANT SELECT(id) ON TABLE public.profiles TO authenticated;
--> statement-breakpoint
GRANT SELECT(username) ON TABLE public.profiles TO anon;
GRANT SELECT(username) ON TABLE public.profiles TO authenticated;
--> statement-breakpoint
GRANT SELECT(full_name) ON TABLE public.profiles TO anon;
GRANT SELECT(full_name) ON TABLE public.profiles TO authenticated;
--> statement-breakpoint
GRANT SELECT(avatar_url) ON TABLE public.profiles TO anon;
GRANT SELECT(avatar_url) ON TABLE public.profiles TO authenticated;
--> statement-breakpoint
GRANT SELECT(visibility) ON TABLE public.profiles TO anon;
GRANT SELECT(visibility) ON TABLE public.profiles TO authenticated;
--> statement-breakpoint
GRANT SELECT(created_at) ON TABLE public.profiles TO anon;
GRANT SELECT(created_at) ON TABLE public.profiles TO authenticated;
--> statement-breakpoint
GRANT SELECT(updated_at) ON TABLE public.profiles TO anon;
GRANT SELECT(updated_at) ON TABLE public.profiles TO authenticated;
--> statement-breakpoint
GRANT SELECT(deleted_at) ON TABLE public.profiles TO anon;
GRANT SELECT(deleted_at) ON TABLE public.profiles TO authenticated;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.recovery_code_redemptions TO anon;
GRANT MAINTAIN ON TABLE public.recovery_code_redemptions TO authenticated;
GRANT ALL ON TABLE public.recovery_code_redemptions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.recovery_code_redemptions TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.reserved_usernames TO anon;
GRANT MAINTAIN ON TABLE public.reserved_usernames TO authenticated;
GRANT ALL ON TABLE public.reserved_usernames TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.reserved_usernames TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.username_aliases TO anon;
GRANT MAINTAIN ON TABLE public.username_aliases TO authenticated;
GRANT ALL ON TABLE public.username_aliases TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.username_aliases TO nb_app;
--> statement-breakpoint
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
--> statement-breakpoint
CREATE TRIGGER nb_sync_email_verified_claim BEFORE INSERT OR UPDATE OF email_confirmed_at, raw_app_meta_data ON auth.users FOR EACH ROW EXECUTE FUNCTION app_private.sync_email_verified_claim();
--> statement-breakpoint
INSERT INTO public.reserved_usernames SELECT * FROM jsonb_populate_recordset(NULL::public.reserved_usernames, '[{"reason": "system", "username": "admin", "created_at": "2026-02-20T07:54:31.612118+00:00"}, {"reason": "system", "username": "api", "created_at": "2026-02-20T07:54:31.612118+00:00"}, {"reason": "auth", "username": "auth", "created_at": "2026-02-20T07:54:31.612118+00:00"}, {"reason": "brand", "username": "edge", "created_at": "2026-02-20T07:54:31.612118+00:00"}, {"reason": "system", "username": "help", "created_at": "2026-02-20T07:54:31.612118+00:00"}, {"reason": "auth", "username": "login", "created_at": "2026-02-20T07:54:31.612118+00:00"}, {"reason": "system", "username": "mail", "created_at": "2026-02-20T07:54:31.612118+00:00"}, {"reason": "brand", "username": "networkbase", "created_at": "2026-10-20T21:41:46.305728+00:00"}, {"reason": "system", "username": "onboarding", "created_at": "2026-02-20T07:54:31.612118+00:00"}, {"reason": "system", "username": "profile", "created_at": "2026-02-20T07:54:31.612118+00:00"}, {"reason": "system", "username": "settings", "created_at": "2026-02-20T07:54:31.612118+00:00"}, {"reason": "auth", "username": "signup", "created_at": "2026-02-20T07:54:31.612118+00:00"}, {"reason": "system", "username": "support", "created_at": "2026-02-20T07:54:31.612118+00:00"}, {"reason": "system", "username": "www", "created_at": "2026-02-20T07:54:31.612118+00:00"}]');
