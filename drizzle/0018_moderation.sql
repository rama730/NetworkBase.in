-- Reports, cases, actions, appeals, the event log, templates, blocked identities, staff functions and console rules.
SET LOCAL check_function_bodies = off;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', true);
--> statement-breakpoint
CREATE FUNCTION app_private.moderation_case_version() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF ROW(NEW.outcome, NEW.severity, NEW.reason, NEW.deadline_at, NEW.org_deadline_at, NEW.routed_to, NEW.assigned_to, NEW.escalated_at,
         NEW.legal_hold, NEW.merged_into, NEW.decided_by, NEW.decided_at, NEW.pile_on, NEW.auto_hidden_at, NEW.state IN ('decided', 'closed'))
     IS DISTINCT FROM
     ROW(OLD.outcome, OLD.severity, OLD.reason, OLD.deadline_at, OLD.org_deadline_at, OLD.routed_to, OLD.assigned_to, OLD.escalated_at,
         OLD.legal_hold, OLD.merged_into, OLD.decided_by, OLD.decided_at, OLD.pile_on, OLD.auto_hidden_at, OLD.state IN ('decided', 'closed')) THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.moderation_event_broadcast() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
    BEGIN
      PERFORM realtime.send(
        jsonb_build_object('seq', NEW.seq, 'caseId', NEW.case_id, 'kind', NEW.kind, 'actorId', NEW.actor_id, 'at', NEW.created_at,
          'version', (SELECT c.version FROM public.moderation_cases c WHERE c.id = NEW.case_id)),
        'event', 'trust:console', true);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.moderation_events_append_only() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.id = OLD.id AND NEW.kind = OLD.kind AND NEW.data = OLD.data AND NEW.created_at = OLD.created_at
    AND (NEW.actor_id IS NULL OR NEW.actor_id = OLD.actor_id)
    AND (NEW.case_id IS NULL OR NEW.case_id = OLD.case_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'moderation_events_append_only';
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.moderation_restriction(p_user_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT a.action FROM public.moderation_actions a
  WHERE a.subject_id = p_user_id AND a.action IN ('limit', 'suspension', 'ban')
    AND a.lifted_at IS NULL AND a.undone_at IS NULL AND a.reversed_at IS NULL AND a.paused_at IS NULL
    AND (a.ends_at IS NULL OR a.ends_at > now())
  ORDER BY CASE a.action WHEN 'ban' THEN 3 WHEN 'suspension' THEN 2 ELSE 1 END DESC
  LIMIT 1;
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.moderation_set_staff_role(p_user_id uuid, p_role text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF p_role IS NOT NULL AND p_role NOT IN ('admin', 'moderator') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_staff_role';
  END IF;
  UPDATE auth.users u SET raw_app_meta_data = CASE WHEN p_role IS NULL THEN coalesce(u.raw_app_meta_data, '{}'::jsonb) - 'role'
    ELSE coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', p_role) END
  WHERE u.id = p_user_id;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.moderation_sign_out_everywhere(p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  DELETE FROM auth.sessions s WHERE s.user_id = p_user_id;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.moderation_staff() RETURNS TABLE(id uuid, role text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  RETURN QUERY SELECT u.id, u.raw_app_meta_data->>'role' FROM auth.users u
    WHERE u.raw_app_meta_data->>'role' IN ('admin', 'moderator');
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.moderation_write_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user uuid;
  v_workspace uuid;
  v_restriction text;
BEGIN
  IF TG_TABLE_NAME = 'chat_messages' THEN
    IF NEW.kind <> 'user' THEN RETURN NEW; END IF;
    v_user := NEW.author_id;
  ELSIF TG_TABLE_NAME = 'workspace_updates' THEN v_user := NEW.author_id; v_workspace := NEW.workspace_id;
  ELSIF TG_TABLE_NAME = 'workspace_update_comments' THEN v_user := NEW.user_id; v_workspace := NEW.workspace_id;
  ELSIF TG_TABLE_NAME = 'task_comments' THEN
    v_user := NEW.user_id;
    SELECT t.workspace_id INTO v_workspace FROM public.tasks t WHERE t.id = NEW.task_id;
  ELSIF TG_TABLE_NAME = 'workspace_invitations' THEN v_user := NEW.inviter_id;
  ELSIF TG_TABLE_NAME = 'role_applications' THEN v_user := NEW.applicant_id;
  ELSIF TG_TABLE_NAME = 'connections' THEN v_user := NEW.requester_id;
  ELSIF TG_TABLE_NAME = 'workspaces' THEN v_user := NEW.owner_id;
  END IF;
  IF v_user IS NULL THEN RETURN NEW; END IF;
  v_restriction := app_private.moderation_restriction(v_user);
  IF v_restriction IS NULL THEN RETURN NEW; END IF;
  IF v_restriction IN ('suspension', 'ban') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'account_suspended';
  END IF;
  -- Limited: reaching new people is blocked; their own workspaces and connections still work.
  IF TG_TABLE_NAME IN ('workspace_invitations', 'role_applications', 'connections', 'workspaces') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'account_limited';
  END IF;
  IF TG_TABLE_NAME = 'chat_messages' THEN
    IF EXISTS (
      SELECT 1 FROM public.chat_channels c JOIN public.chat_channel_members m ON m.channel_id = c.id AND m.user_id <> v_user
      WHERE c.id = NEW.channel_id AND c.kind = 'dm'
        AND NOT EXISTS (SELECT 1 FROM public.connections k WHERE k.status = 'accepted'
          AND ((k.requester_id = v_user AND k.addressee_id = m.user_id) OR (k.addressee_id = v_user AND k.requester_id = m.user_id)))
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'account_limited';
    END IF;
    RETURN NEW;
  END IF;
  IF v_workspace IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workspaces w WHERE w.id = v_workspace AND (w.owner_id = v_user
      OR EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = w.id AND m.user_id = v_user))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'account_limited';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.nb_is_trust_staff() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT coalesce(((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') IN ('admin', 'moderator'), false)
     AND coalesce((SELECT auth.jwt()) ->> 'aal', '') = 'aal2';
$$;
--> statement-breakpoint
CREATE TABLE public.content_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reporter_id uuid,
    target_kind text NOT NULL,
    target_id uuid NOT NULL,
    workspace_id uuid,
    reason text NOT NULL,
    details text,
    status text DEFAULT 'open'::text NOT NULL,
    action text,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    target_seq bigint,
    case_id uuid,
    snapshot jsonb,
    also_blocked boolean DEFAULT false NOT NULL,
    CONSTRAINT content_reports_action_check CHECK (((action IS NULL) OR (action = ANY (ARRAY['hidden'::text, 'removed'::text, 'suspended'::text])))),
    CONSTRAINT content_reports_details_check CHECK (((details IS NULL) OR (char_length(details) <= 2000))),
    CONSTRAINT content_reports_kind_check CHECK ((target_kind = ANY (ARRAY['project'::text, 'person'::text, 'update'::text, 'update_comment'::text, 'doc'::text, 'task'::text, 'task_comment'::text, 'file'::text, 'chat_message'::text, 'chat_channel'::text, 'role'::text, 'application'::text, 'invitation'::text, 'connection_request'::text, 'contribution'::text]))),
    CONSTRAINT content_reports_reason_check CHECK ((reason = ANY (ARRAY['threat'::text, 'self_harm'::text, 'child_safety'::text, 'intimate_images'::text, 'private_info'::text, 'harassment'::text, 'hate_speech'::text, 'impersonation'::text, 'evading_block'::text, 'scam'::text, 'inappropriate'::text, 'spam'::text, 'other'::text]))),
    CONSTRAINT content_reports_status_check CHECK ((status = ANY (ARRAY['open'::text, 'dismissed'::text, 'actioned'::text])))
);
--> statement-breakpoint
CREATE TABLE public.moderation_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    case_id uuid,
    actor_id uuid,
    actor_scope text DEFAULT 'staff'::text NOT NULL,
    org_id uuid,
    subject_id uuid,
    target_kind text NOT NULL,
    target_id uuid,
    target_seq bigint,
    action text NOT NULL,
    rule smallint,
    message text,
    restore jsonb,
    strike boolean DEFAULT false NOT NULL,
    strike_expires_at timestamp with time zone,
    ends_at timestamp with time zone,
    appeal_until timestamp with time zone,
    notify_after timestamp with time zone DEFAULT now() NOT NULL,
    notified_at timestamp with time zone,
    lifted_at timestamp with time zone,
    paused_at timestamp with time zone,
    undone_at timestamp with time zone,
    reversed_at timestamp with time zone,
    reversed_by uuid,
    replaced_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT moderation_actions_action_check CHECK ((action = ANY (ARRAY['hide'::text, 'remove'::text, 'reset_profile'::text, 'hold_handle'::text, 'remove_verified'::text, 'hide_discover'::text, 'restrict'::text, 'suspend_workspace'::text, 'remove_workspace'::text, 'warning'::text, 'limit'::text, 'suspension'::text, 'ban'::text]))),
    CONSTRAINT moderation_actions_message_check CHECK (((message IS NULL) OR (char_length(message) <= 4000))),
    CONSTRAINT moderation_actions_rule_check CHECK (((rule IS NULL) OR ((rule >= 1) AND (rule <= 15)))),
    CONSTRAINT moderation_actions_scope_check CHECK ((actor_scope = ANY (ARRAY['staff'::text, 'org'::text])))
);
--> statement-breakpoint
CREATE TABLE public.moderation_appeals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    case_id uuid NOT NULL,
    subject_id uuid,
    body text NOT NULL,
    fixed boolean DEFAULT false NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    assignee_id uuid,
    deadline_at timestamp with time zone NOT NULL,
    reply text,
    decided_by uuid,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT moderation_appeals_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 1000))),
    CONSTRAINT moderation_appeals_reply_check CHECK (((reply IS NULL) OR (char_length(reply) <= 4000))),
    CONSTRAINT moderation_appeals_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'in_review'::text, 'upheld'::text, 'reduced'::text, 'reversed'::text, 'withdrawn'::text])))
);
--> statement-breakpoint
CREATE TABLE public.moderation_blocked_identities (
    hash text NOT NULL,
    kind text NOT NULL,
    action_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT moderation_blocked_identities_kind_check CHECK ((kind = ANY (ARRAY['email'::text, 'identity'::text])))
);
--> statement-breakpoint
CREATE TABLE public.moderation_cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number bigint NOT NULL,
    target_kind text NOT NULL,
    target_id uuid NOT NULL,
    target_seq bigint,
    workspace_id uuid,
    org_id uuid,
    subject_id uuid,
    severity text NOT NULL,
    reason text NOT NULL,
    source text DEFAULT 'report'::text NOT NULL,
    state text DEFAULT 'open'::text NOT NULL,
    outcome text,
    routed_to text DEFAULT 'staff'::text NOT NULL,
    assignee_id uuid,
    claimed_at timestamp with time zone,
    deadline_at timestamp with time zone NOT NULL,
    org_deadline_at timestamp with time zone,
    auto_hidden_at timestamp with time zone,
    pile_on boolean DEFAULT false NOT NULL,
    legal_hold boolean DEFAULT false NOT NULL,
    snapshot jsonb,
    details text,
    merged_into uuid,
    decided_by uuid,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    claimed_until timestamp with time zone,
    claim_seen_at timestamp with time zone,
    assigned_to uuid,
    escalated_at timestamp with time zone,
    CONSTRAINT moderation_cases_details_check CHECK (((details IS NULL) OR (char_length(details) <= 4000))),
    CONSTRAINT moderation_cases_outcome_check CHECK (((outcome IS NULL) OR (outcome = ANY (ARRAY['no_violation'::text, 'actioned'::text, 'duplicate'::text, 'gone'::text])))),
    CONSTRAINT moderation_cases_routed_check CHECK ((routed_to = ANY (ARRAY['org'::text, 'staff'::text]))),
    CONSTRAINT moderation_cases_severity_check CHECK ((severity = ANY (ARRAY['urgent'::text, 'high'::text, 'normal'::text]))),
    CONSTRAINT moderation_cases_source_check CHECK ((source = ANY (ARRAY['report'::text, 'email'::text, 'staff'::text, 'legal'::text]))),
    CONSTRAINT moderation_cases_state_check CHECK ((state = ANY (ARRAY['open'::text, 'in_review'::text, 'decided'::text, 'closed'::text])))
);
--> statement-breakpoint
ALTER TABLE public.moderation_cases ALTER COLUMN number ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.moderation_cases_number_seq
    START WITH 1001
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.moderation_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    case_id uuid,
    actor_id uuid,
    kind text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    seq bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE public.moderation_events ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.moderation_events_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--> statement-breakpoint
CREATE TABLE public.moderation_message_templates (
    key text NOT NULL,
    message text NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT moderation_message_templates_key_check CHECK ((key ~ '^(rule:([1-9]|1[0-5])|appeal:(upheld|reduced|reversed))$'::text)),
    CONSTRAINT moderation_message_templates_message_check CHECK (((char_length(message) >= 1) AND (char_length(message) <= 4000)))
);
--> statement-breakpoint
ALTER TABLE ONLY public.content_reports
    ADD CONSTRAINT content_reports_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_appeals
    ADD CONSTRAINT moderation_appeals_case_id_key UNIQUE (case_id);
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_appeals
    ADD CONSTRAINT moderation_appeals_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_blocked_identities
    ADD CONSTRAINT moderation_blocked_identities_pkey PRIMARY KEY (hash);
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_cases
    ADD CONSTRAINT moderation_cases_number_key UNIQUE (number);
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_cases
    ADD CONSTRAINT moderation_cases_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_events
    ADD CONSTRAINT moderation_events_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_message_templates
    ADD CONSTRAINT moderation_message_templates_pkey PRIMARY KEY (key);
--> statement-breakpoint
CREATE INDEX content_reports_case_idx ON public.content_reports USING btree (case_id) WHERE (case_id IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX content_reports_one_open_idx ON public.content_reports USING btree (reporter_id, target_kind, target_id, COALESCE(target_seq, (0)::bigint)) WHERE (status = 'open'::text);
--> statement-breakpoint
CREATE INDEX content_reports_open_idx ON public.content_reports USING btree (created_at DESC) WHERE (status = 'open'::text);
--> statement-breakpoint
CREATE INDEX content_reports_reporter_idx ON public.content_reports USING btree (reporter_id) WHERE (reporter_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX content_reports_reporter_status_idx ON public.content_reports USING btree (reporter_id, status);
--> statement-breakpoint
CREATE INDEX content_reports_resolved_by_idx ON public.content_reports USING btree (resolved_by) WHERE (resolved_by IS NOT NULL);
--> statement-breakpoint
CREATE INDEX content_reports_target_idx ON public.content_reports USING btree (target_kind, target_id);
--> statement-breakpoint
CREATE INDEX content_reports_workspace_idx ON public.content_reports USING btree (workspace_id) WHERE (workspace_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX moderation_actions_actor_idx ON public.moderation_actions USING btree (actor_id) WHERE (actor_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX moderation_actions_case_idx ON public.moderation_actions USING btree (case_id) WHERE (case_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX moderation_actions_org_idx ON public.moderation_actions USING btree (org_id) WHERE (org_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX moderation_actions_pending_notice_idx ON public.moderation_actions USING btree (notify_after) WHERE ((notified_at IS NULL) AND (undone_at IS NULL));
--> statement-breakpoint
CREATE INDEX moderation_actions_replaced_by_idx ON public.moderation_actions USING btree (replaced_by) WHERE (replaced_by IS NOT NULL);
--> statement-breakpoint
CREATE INDEX moderation_actions_restriction_idx ON public.moderation_actions USING btree (subject_id) WHERE ((action = ANY (ARRAY['limit'::text, 'suspension'::text, 'ban'::text])) AND (lifted_at IS NULL) AND (undone_at IS NULL) AND (reversed_at IS NULL));
--> statement-breakpoint
CREATE INDEX moderation_actions_reversed_by_idx ON public.moderation_actions USING btree (reversed_by) WHERE (reversed_by IS NOT NULL);
--> statement-breakpoint
CREATE INDEX moderation_actions_subject_idx ON public.moderation_actions USING btree (subject_id, created_at DESC) WHERE (subject_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX moderation_appeals_assignee_idx ON public.moderation_appeals USING btree (assignee_id) WHERE (assignee_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX moderation_appeals_decided_by_idx ON public.moderation_appeals USING btree (decided_by) WHERE (decided_by IS NOT NULL);
--> statement-breakpoint
CREATE INDEX moderation_appeals_queue_idx ON public.moderation_appeals USING btree (deadline_at) WHERE (state = ANY (ARRAY['pending'::text, 'in_review'::text]));
--> statement-breakpoint
CREATE INDEX moderation_appeals_subject_idx ON public.moderation_appeals USING btree (subject_id) WHERE (subject_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX moderation_blocked_identities_action_idx ON public.moderation_blocked_identities USING btree (action_id) WHERE (action_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX moderation_cases_assigned_idx ON public.moderation_cases USING btree (assigned_to) WHERE (assigned_to IS NOT NULL);
--> statement-breakpoint
CREATE INDEX moderation_cases_assignee_idx ON public.moderation_cases USING btree (assignee_id) WHERE (assignee_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX moderation_cases_decided_by_idx ON public.moderation_cases USING btree (decided_by) WHERE (decided_by IS NOT NULL);
--> statement-breakpoint
CREATE INDEX moderation_cases_merged_idx ON public.moderation_cases USING btree (merged_into) WHERE (merged_into IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX moderation_cases_one_open_idx ON public.moderation_cases USING btree (target_kind, target_id, COALESCE(target_seq, (0)::bigint)) WHERE (state = ANY (ARRAY['open'::text, 'in_review'::text]));
--> statement-breakpoint
CREATE INDEX moderation_cases_open_severity_idx ON public.moderation_cases USING btree (severity) WHERE (state = ANY (ARRAY['open'::text, 'in_review'::text]));
--> statement-breakpoint
CREATE INDEX moderation_cases_org_idx ON public.moderation_cases USING btree (org_id) WHERE (org_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX moderation_cases_queue_idx ON public.moderation_cases USING btree (deadline_at) WHERE (state = ANY (ARRAY['open'::text, 'in_review'::text]));
--> statement-breakpoint
CREATE INDEX moderation_cases_subject_idx ON public.moderation_cases USING btree (subject_id) WHERE (subject_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX moderation_cases_target_history_idx ON public.moderation_cases USING btree (target_kind, target_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX moderation_cases_workspace_idx ON public.moderation_cases USING btree (workspace_id) WHERE (workspace_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX moderation_events_actor_idx ON public.moderation_events USING btree (actor_id, created_at DESC) WHERE (actor_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX moderation_events_case_idx ON public.moderation_events USING btree (case_id, created_at) WHERE (case_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX moderation_events_kind_time_idx ON public.moderation_events USING btree (kind, created_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX moderation_events_seq_idx ON public.moderation_events USING btree (seq);
--> statement-breakpoint
CREATE INDEX moderation_events_time_idx ON public.moderation_events USING btree (created_at DESC);
--> statement-breakpoint
CREATE INDEX moderation_message_templates_updated_by_idx ON public.moderation_message_templates USING btree (updated_by) WHERE (updated_by IS NOT NULL);
--> statement-breakpoint
CREATE TRIGGER chat_messages_moderation_guard BEFORE INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION app_private.moderation_write_guard();
--> statement-breakpoint
CREATE TRIGGER connections_moderation_guard BEFORE INSERT ON public.connections FOR EACH ROW EXECUTE FUNCTION app_private.moderation_write_guard();
--> statement-breakpoint
CREATE TRIGGER moderation_cases_version BEFORE UPDATE ON public.moderation_cases FOR EACH ROW EXECUTE FUNCTION app_private.moderation_case_version();
--> statement-breakpoint
CREATE TRIGGER moderation_events_broadcast AFTER INSERT ON public.moderation_events FOR EACH ROW EXECUTE FUNCTION app_private.moderation_event_broadcast();
--> statement-breakpoint
CREATE TRIGGER moderation_events_no_update BEFORE UPDATE ON public.moderation_events FOR EACH ROW EXECUTE FUNCTION app_private.moderation_events_append_only();
--> statement-breakpoint
CREATE TRIGGER role_applications_moderation_guard BEFORE INSERT ON public.role_applications FOR EACH ROW EXECUTE FUNCTION app_private.moderation_write_guard();
--> statement-breakpoint
CREATE TRIGGER task_comments_moderation_guard BEFORE INSERT ON public.task_comments FOR EACH ROW EXECUTE FUNCTION app_private.moderation_write_guard();
--> statement-breakpoint
CREATE TRIGGER workspace_invitations_moderation_guard BEFORE INSERT ON public.workspace_invitations FOR EACH ROW EXECUTE FUNCTION app_private.moderation_write_guard();
--> statement-breakpoint
CREATE TRIGGER workspace_update_comments_moderation_guard BEFORE INSERT ON public.workspace_update_comments FOR EACH ROW EXECUTE FUNCTION app_private.moderation_write_guard();
--> statement-breakpoint
CREATE TRIGGER workspace_updates_moderation_guard BEFORE INSERT ON public.workspace_updates FOR EACH ROW EXECUTE FUNCTION app_private.moderation_write_guard();
--> statement-breakpoint
CREATE TRIGGER workspaces_moderation_guard BEFORE INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION app_private.moderation_write_guard();
--> statement-breakpoint
ALTER TABLE ONLY public.content_reports
    ADD CONSTRAINT content_reports_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.moderation_cases(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.content_reports
    ADD CONSTRAINT content_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.content_reports
    ADD CONSTRAINT content_reports_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.content_reports
    ADD CONSTRAINT content_reports_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.moderation_cases(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_replaced_by_fkey FOREIGN KEY (replaced_by) REFERENCES public.moderation_actions(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_reversed_by_fkey FOREIGN KEY (reversed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_appeals
    ADD CONSTRAINT moderation_appeals_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_appeals
    ADD CONSTRAINT moderation_appeals_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.moderation_cases(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_appeals
    ADD CONSTRAINT moderation_appeals_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_appeals
    ADD CONSTRAINT moderation_appeals_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_blocked_identities
    ADD CONSTRAINT moderation_blocked_identities_action_id_fkey FOREIGN KEY (action_id) REFERENCES public.moderation_actions(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_cases
    ADD CONSTRAINT moderation_cases_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_cases
    ADD CONSTRAINT moderation_cases_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_cases
    ADD CONSTRAINT moderation_cases_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_cases
    ADD CONSTRAINT moderation_cases_merged_into_fkey FOREIGN KEY (merged_into) REFERENCES public.moderation_cases(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_cases
    ADD CONSTRAINT moderation_cases_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_cases
    ADD CONSTRAINT moderation_cases_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_cases
    ADD CONSTRAINT moderation_cases_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_events
    ADD CONSTRAINT moderation_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_events
    ADD CONSTRAINT moderation_events_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.moderation_cases(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.moderation_message_templates
    ADD CONSTRAINT moderation_message_templates_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.moderation_appeals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.moderation_blocked_identities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.moderation_cases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.moderation_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.moderation_message_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.content_reports TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.moderation_actions TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.moderation_appeals TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.moderation_blocked_identities TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.moderation_cases TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.moderation_events TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.moderation_message_templates TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.moderation_case_version() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.moderation_case_version() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.moderation_event_broadcast() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.moderation_event_broadcast() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.moderation_events_append_only() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.moderation_events_append_only() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.moderation_restriction(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.moderation_restriction(p_user_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.moderation_set_staff_role(p_user_id uuid, p_role text) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.moderation_set_staff_role(p_user_id uuid, p_role text) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.moderation_sign_out_everywhere(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.moderation_sign_out_everywhere(p_user_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.moderation_staff() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.moderation_staff() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.moderation_write_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.moderation_write_guard() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_is_trust_staff() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_is_trust_staff() TO nb_app;
GRANT ALL ON FUNCTION app_private.nb_is_trust_staff() TO authenticated;
--> statement-breakpoint
GRANT ALL ON TABLE public.content_reports TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.content_reports TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.moderation_actions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.moderation_actions TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.moderation_appeals TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.moderation_appeals TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.moderation_blocked_identities TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.moderation_blocked_identities TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.moderation_cases TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.moderation_cases TO nb_app;
--> statement-breakpoint
GRANT ALL ON SEQUENCE public.moderation_cases_number_seq TO service_role;
GRANT ALL ON SEQUENCE public.moderation_cases_number_seq TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.moderation_events TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.moderation_events TO nb_app;
--> statement-breakpoint
GRANT ALL ON SEQUENCE public.moderation_events_seq_seq TO service_role;
GRANT ALL ON SEQUENCE public.moderation_events_seq_seq TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.moderation_message_templates TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.moderation_message_templates TO nb_app;
--> statement-breakpoint
CREATE POLICY trust_console_read ON realtime.messages AS PERMISSIVE FOR SELECT TO authenticated USING (((( SELECT realtime.topic() AS topic) = 'trust:console'::text) AND ( SELECT app_private.nb_is_trust_staff() AS nb_is_trust_staff)));
--> statement-breakpoint
CREATE POLICY trust_console_send ON realtime.messages AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((( SELECT realtime.topic() AS topic) = 'trust:console'::text) AND (extension = 'presence'::text) AND ( SELECT app_private.nb_is_trust_staff() AS nb_is_trust_staff)));
