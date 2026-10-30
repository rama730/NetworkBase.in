-- In-app notifications, deliveries, push, email outbox, suppressions, webhooks.
SET LOCAL check_function_bodies = off;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', true);
--> statement-breakpoint
CREATE FUNCTION public.dismiss_orphan_notifications() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  ref_key text;
  now_ts timestamptz := now();
BEGIN
  ref_key := TG_ARGV[0];
  UPDATE public.user_notifications
  SET dismissed_at = now_ts,
      read_at = COALESCE(read_at, now_ts),
      seen_at = COALESCE(seen_at, now_ts),
      updated_at = now_ts
  WHERE dismissed_at IS NULL
    AND entity_refs ->> ref_key = OLD.id::text;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TABLE public.email_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_key text NOT NULL,
    kind text NOT NULL,
    user_id uuid,
    actor_id uuid,
    workspace_id uuid,
    task_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    due_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_id uuid,
    lease_expires_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    first_attempt_at timestamp with time zone,
    payload jsonb,
    provider_id uuid,
    delivery_state text,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb,
    to_email text,
    CONSTRAINT email_outbox_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT email_outbox_delivery_check CHECK ((delivery_state = ANY (ARRAY['accepted'::text, 'delivered'::text, 'failed'::text, 'bounced'::text, 'complained'::text]))),
    CONSTRAINT email_outbox_kind_check CHECK ((kind = ANY (ARRAY['welcome'::text, 'task_assignment'::text, 'org_ready'::text, 'org_invite'::text, 'org_invite_signup'::text, 'org_welcome'::text, 'org_assignment'::text, 'org_due_soon'::text, 'org_overdue'::text, 'org_returned'::text, 'org_announcement'::text, 'org_ended'::text, 'org_digest'::text, 'org_removed'::text, 'org_ownership'::text, 'org_deleted'::text, 'security_password_changed'::text, 'security_mfa_changed'::text, 'security_token_created'::text, 'security_sessions_revoked'::text, 'security_sign_in_method_changed'::text, 'account_deletion_scheduled'::text, 'account_deletion_cancelled'::text, 'account_deletion_reminder'::text, 'account_deletion_completed'::text, 'trust_person'::text, 'trust_staff'::text]))),
    CONSTRAINT email_outbox_recipient_check CHECK (((user_id IS NOT NULL) OR (to_email IS NOT NULL))),
    CONSTRAINT email_outbox_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'accepted'::text, 'dropped'::text, 'failed'::text, 'needs_review'::text])))
);
--> statement-breakpoint
CREATE TABLE public.email_suppressions (
    email text NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_suppressions_reason_check CHECK ((reason = ANY (ARRAY['hard_bounce'::text, 'complaint'::text])))
);
--> statement-breakpoint
CREATE TABLE public.email_webhook_events (
    id text NOT NULL,
    provider_id uuid NOT NULL,
    state text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_webhook_events_state_check CHECK ((state = ANY (ARRAY['accepted'::text, 'delivered'::text, 'failed'::text, 'bounced'::text, 'complained'::text])))
);
--> statement-breakpoint
CREATE TABLE public.notification_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    notification_id uuid,
    user_id uuid NOT NULL,
    channel text NOT NULL,
    status public.status_notification NOT NULL,
    error_code text,
    error_message text,
    attempted_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    failure_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.user_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    actor_user_id uuid,
    kind text NOT NULL,
    importance text DEFAULT 'more'::text NOT NULL,
    title text NOT NULL,
    body text,
    href text,
    entity_refs jsonb,
    preview jsonb,
    dedupe_key text NOT NULL,
    aggregate_count integer DEFAULT 1 NOT NULL,
    read_at timestamp with time zone,
    seen_at timestamp with time zone,
    dismissed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    snoozed_until timestamp with time zone,
    activity_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_notifications_aggregate_count_check CHECK ((aggregate_count >= 1)),
    CONSTRAINT user_notifications_importance_check CHECK ((importance = ANY (ARRAY['important'::text, 'more'::text])))
);
--> statement-breakpoint
ALTER TABLE ONLY public.email_outbox
    ADD CONSTRAINT email_outbox_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.email_suppressions
    ADD CONSTRAINT email_suppressions_pkey PRIMARY KEY (email);
--> statement-breakpoint
ALTER TABLE ONLY public.email_webhook_events
    ADD CONSTRAINT email_webhook_events_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.user_notifications
    ADD CONSTRAINT user_notifications_pkey PRIMARY KEY (id);
--> statement-breakpoint
CREATE INDEX email_outbox_due_idx ON public.email_outbox USING btree (due_at) WHERE (status = 'pending'::text);
--> statement-breakpoint
CREATE UNIQUE INDEX email_outbox_event_idx ON public.email_outbox USING btree (event_key);
--> statement-breakpoint
CREATE INDEX email_outbox_lease_idx ON public.email_outbox USING btree (lease_expires_at) WHERE (status = 'processing'::text);
--> statement-breakpoint
CREATE UNIQUE INDEX email_outbox_provider_idx ON public.email_outbox USING btree (provider_id);
--> statement-breakpoint
CREATE INDEX email_outbox_user_idx ON public.email_outbox USING btree (user_id);
--> statement-breakpoint
CREATE INDEX email_webhook_events_provider_idx ON public.email_webhook_events USING btree (provider_id);
--> statement-breakpoint
CREATE INDEX notification_deliveries_channel_status_time_idx ON public.notification_deliveries USING btree (channel, status, attempted_at DESC);
--> statement-breakpoint
CREATE INDEX notification_deliveries_notification_idx ON public.notification_deliveries USING btree (notification_id) WHERE (notification_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX notification_deliveries_user_status_covering_idx ON public.notification_deliveries USING btree (user_id, status, attempted_at DESC) INCLUDE (id, notification_id);
--> statement-breakpoint
CREATE INDEX notification_deliveries_user_time_idx ON public.notification_deliveries USING btree (user_id, attempted_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX push_subscriptions_endpoint_unique ON public.push_subscriptions USING btree (endpoint);
--> statement-breakpoint
CREATE INDEX push_subscriptions_stale_idx ON public.push_subscriptions USING btree (last_seen_at);
--> statement-breakpoint
CREATE INDEX push_subscriptions_user_idx ON public.push_subscriptions USING btree (user_id);
--> statement-breakpoint
CREATE INDEX user_notifications_actor_user_id_idx ON public.user_notifications USING btree (actor_user_id);
--> statement-breakpoint
CREATE INDEX user_notifications_dismissed_age_idx ON public.user_notifications USING btree (dismissed_at) WHERE (dismissed_at IS NOT NULL);
--> statement-breakpoint
CREATE INDEX user_notifications_read_age_idx ON public.user_notifications USING btree (read_at) WHERE ((read_at IS NOT NULL) AND (dismissed_at IS NULL));
--> statement-breakpoint
CREATE INDEX user_notifications_tray_visible_activity_idx ON public.user_notifications USING btree (user_id, activity_at DESC) WHERE (dismissed_at IS NULL);
--> statement-breakpoint
CREATE INDEX user_notifications_tray_visible_idx ON public.user_notifications USING btree (user_id, updated_at DESC) WHERE (dismissed_at IS NULL);
--> statement-breakpoint
CREATE INDEX user_notifications_unread_idx ON public.user_notifications USING btree (user_id, importance) WHERE ((read_at IS NULL) AND (dismissed_at IS NULL));
--> statement-breakpoint
CREATE INDEX user_notifications_user_activity_idx ON public.user_notifications USING btree (user_id, activity_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX user_notifications_user_dedupe_unique ON public.user_notifications USING btree (user_id, dedupe_key);
--> statement-breakpoint
CREATE INDEX user_notifications_user_dismissed_idx ON public.user_notifications USING btree (user_id, dismissed_at);
--> statement-breakpoint
CREATE INDEX user_notifications_user_read_idx ON public.user_notifications USING btree (user_id, read_at);
--> statement-breakpoint
CREATE INDEX user_notifications_user_snoozed_idx ON public.user_notifications USING btree (user_id, snoozed_until);
--> statement-breakpoint
CREATE INDEX user_notifications_user_updated_idx ON public.user_notifications USING btree (user_id, updated_at DESC);
--> statement-breakpoint
CREATE TRIGGER user_notifications_cascade_application AFTER DELETE ON public.role_applications FOR EACH ROW EXECUTE FUNCTION public.dismiss_orphan_notifications('applicationId');
--> statement-breakpoint
CREATE TRIGGER user_notifications_cascade_connection AFTER DELETE ON public.connections FOR EACH ROW EXECUTE FUNCTION public.dismiss_orphan_notifications('connectionId');
--> statement-breakpoint
CREATE TRIGGER user_notifications_cascade_file AFTER DELETE ON public.workspace_nodes FOR EACH ROW EXECUTE FUNCTION public.dismiss_orphan_notifications('fileId');
--> statement-breakpoint
CREATE TRIGGER user_notifications_cascade_task AFTER DELETE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.dismiss_orphan_notifications('taskId');
--> statement-breakpoint
CREATE TRIGGER user_notifications_cascade_task_comment AFTER DELETE ON public.task_comments FOR EACH ROW EXECUTE FUNCTION public.dismiss_orphan_notifications('commentId');
--> statement-breakpoint
CREATE TRIGGER user_notifications_cascade_workspace AFTER DELETE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.dismiss_orphan_notifications('projectId');
--> statement-breakpoint
ALTER TABLE ONLY public.email_outbox
    ADD CONSTRAINT email_outbox_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_notification_id_user_notifications_id_f FOREIGN KEY (notification_id) REFERENCES public.user_notifications(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_user_id_profiles_id_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_profiles_id_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.user_notifications
    ADD CONSTRAINT user_notifications_actor_user_id_profiles_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.user_notifications
    ADD CONSTRAINT user_notifications_user_id_profiles_id_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.email_webhook_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.email_outbox TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.email_suppressions TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.email_webhook_events TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.notification_deliveries TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.push_subscriptions TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.user_notifications TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_deliveries_select_own ON public.notification_deliveries FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY push_subscriptions_all_own ON public.push_subscriptions USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_notifications_select_own ON public.user_notifications FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.dismiss_orphan_notifications() FROM PUBLIC;
GRANT ALL ON FUNCTION public.dismiss_orphan_notifications() TO service_role;
GRANT ALL ON FUNCTION public.dismiss_orphan_notifications() TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.email_outbox TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.email_outbox TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.email_suppressions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.email_suppressions TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.email_webhook_events TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.email_webhook_events TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.notification_deliveries TO anon;
GRANT MAINTAIN ON TABLE public.notification_deliveries TO authenticated;
GRANT ALL ON TABLE public.notification_deliveries TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notification_deliveries TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.push_subscriptions TO anon;
GRANT MAINTAIN ON TABLE public.push_subscriptions TO authenticated;
GRANT ALL ON TABLE public.push_subscriptions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.push_subscriptions TO nb_app;
--> statement-breakpoint
GRANT SELECT,MAINTAIN ON TABLE public.user_notifications TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.user_notifications TO authenticated;
GRANT ALL ON TABLE public.user_notifications TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_notifications TO nb_app;
--> statement-breakpoint
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
