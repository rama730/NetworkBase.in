-- 0269: reporting and moderation across the app (docs/trust-and-safety-concept.md). Reports group into numbered
-- cases; decisions, restrictions and strikes are actions; one appeal per case; an append-only event log; a block
-- list for ban evasion. All server-only: no browser role reads or writes these tables.
CREATE TABLE public.moderation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number bigint GENERATED ALWAYS AS IDENTITY (START WITH 1001) UNIQUE,
  target_kind text NOT NULL,
  target_id uuid NOT NULL,
  -- A chat message is its channel id plus its sequence number.
  target_seq bigint,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  org_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  subject_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  severity text NOT NULL CONSTRAINT moderation_cases_severity_check CHECK (severity IN ('urgent', 'high', 'normal')),
  reason text NOT NULL,
  source text NOT NULL DEFAULT 'report' CONSTRAINT moderation_cases_source_check CHECK (source IN ('report', 'email', 'staff', 'legal')),
  state text NOT NULL DEFAULT 'open' CONSTRAINT moderation_cases_state_check CHECK (state IN ('open', 'in_review', 'decided', 'closed')),
  outcome text CONSTRAINT moderation_cases_outcome_check CHECK (outcome IS NULL OR outcome IN ('no_violation', 'actioned', 'duplicate', 'gone')),
  routed_to text NOT NULL DEFAULT 'staff' CONSTRAINT moderation_cases_routed_check CHECK (routed_to IN ('org', 'staff')),
  assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  deadline_at timestamptz NOT NULL,
  org_deadline_at timestamptz,
  auto_hidden_at timestamptz,
  pile_on boolean NOT NULL DEFAULT false,
  legal_hold boolean NOT NULL DEFAULT false,
  snapshot jsonb,
  details text CONSTRAINT moderation_cases_details_check CHECK (details IS NULL OR char_length(details) <= 4000),
  merged_into uuid REFERENCES public.moderation_cases(id) ON DELETE SET NULL,
  decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX moderation_cases_one_open_idx ON public.moderation_cases (target_kind, target_id, (COALESCE(target_seq, 0))) WHERE state IN ('open', 'in_review');
--> statement-breakpoint
CREATE INDEX moderation_cases_queue_idx ON public.moderation_cases (deadline_at) WHERE state IN ('open', 'in_review');
--> statement-breakpoint
CREATE INDEX moderation_cases_subject_idx ON public.moderation_cases (subject_id) WHERE subject_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX moderation_cases_workspace_idx ON public.moderation_cases (workspace_id) WHERE workspace_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX moderation_cases_org_idx ON public.moderation_cases (org_id) WHERE org_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX moderation_cases_assignee_idx ON public.moderation_cases (assignee_id) WHERE assignee_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX moderation_cases_decided_by_idx ON public.moderation_cases (decided_by) WHERE decided_by IS NOT NULL;
--> statement-breakpoint
CREATE INDEX moderation_cases_merged_idx ON public.moderation_cases (merged_into) WHERE merged_into IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.moderation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES public.moderation_cases(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_scope text NOT NULL DEFAULT 'staff' CONSTRAINT moderation_actions_scope_check CHECK (actor_scope IN ('staff', 'org')),
  org_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  subject_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_kind text NOT NULL,
  target_id uuid,
  target_seq bigint,
  action text NOT NULL CONSTRAINT moderation_actions_action_check CHECK (action IN (
    'hide', 'remove', 'reset_profile', 'hold_handle', 'remove_verified',
    'hide_discover', 'restrict', 'suspend_workspace', 'remove_workspace',
    'warning', 'limit', 'suspension', 'ban')),
  rule smallint CONSTRAINT moderation_actions_rule_check CHECK (rule IS NULL OR rule BETWEEN 1 AND 15),
  message text CONSTRAINT moderation_actions_message_check CHECK (message IS NULL OR char_length(message) <= 4000),
  restore jsonb,
  strike boolean NOT NULL DEFAULT false,
  strike_expires_at timestamptz,
  ends_at timestamptz,
  appeal_until timestamptz,
  notify_after timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  lifted_at timestamptz,
  paused_at timestamptz,
  undone_at timestamptz,
  reversed_at timestamptz,
  reversed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  replaced_by uuid REFERENCES public.moderation_actions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX moderation_actions_case_idx ON public.moderation_actions (case_id) WHERE case_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX moderation_actions_subject_idx ON public.moderation_actions (subject_id, created_at DESC) WHERE subject_id IS NOT NULL;
--> statement-breakpoint
-- The write-path check: an account's restriction in force.
CREATE INDEX moderation_actions_restriction_idx ON public.moderation_actions (subject_id)
  WHERE action IN ('limit', 'suspension', 'ban') AND lifted_at IS NULL AND undone_at IS NULL AND reversed_at IS NULL;
--> statement-breakpoint
CREATE INDEX moderation_actions_pending_notice_idx ON public.moderation_actions (notify_after) WHERE notified_at IS NULL AND undone_at IS NULL;
--> statement-breakpoint
CREATE INDEX moderation_actions_actor_idx ON public.moderation_actions (actor_id) WHERE actor_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX moderation_actions_org_idx ON public.moderation_actions (org_id) WHERE org_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX moderation_actions_reversed_by_idx ON public.moderation_actions (reversed_by) WHERE reversed_by IS NOT NULL;
--> statement-breakpoint
CREATE INDEX moderation_actions_replaced_by_idx ON public.moderation_actions (replaced_by) WHERE replaced_by IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.moderation_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL UNIQUE REFERENCES public.moderation_cases(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  body text NOT NULL CONSTRAINT moderation_appeals_body_check CHECK (char_length(body) BETWEEN 1 AND 1000),
  fixed boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'pending' CONSTRAINT moderation_appeals_state_check CHECK (state IN ('pending', 'in_review', 'upheld', 'reduced', 'reversed', 'withdrawn')),
  assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deadline_at timestamptz NOT NULL,
  reply text CONSTRAINT moderation_appeals_reply_check CHECK (reply IS NULL OR char_length(reply) <= 4000),
  decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX moderation_appeals_queue_idx ON public.moderation_appeals (deadline_at) WHERE state IN ('pending', 'in_review');
--> statement-breakpoint
CREATE INDEX moderation_appeals_subject_idx ON public.moderation_appeals (subject_id) WHERE subject_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX moderation_appeals_assignee_idx ON public.moderation_appeals (assignee_id) WHERE assignee_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX moderation_appeals_decided_by_idx ON public.moderation_appeals (decided_by) WHERE decided_by IS NOT NULL;
--> statement-breakpoint
-- The audit log, case history and internal notes. Append-only; retention deletes old rows in bulk.
CREATE TABLE public.moderation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES public.moderation_cases(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX moderation_events_case_idx ON public.moderation_events (case_id, created_at) WHERE case_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX moderation_events_actor_idx ON public.moderation_events (actor_id, created_at DESC) WHERE actor_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX moderation_events_time_idx ON public.moderation_events (created_at DESC);
--> statement-breakpoint
CREATE FUNCTION app_private.moderation_events_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'moderation_events_append_only';
END
$$;
--> statement-breakpoint
CREATE TRIGGER moderation_events_no_update BEFORE UPDATE ON public.moderation_events
  FOR EACH ROW EXECUTE FUNCTION app_private.moderation_events_append_only();
--> statement-breakpoint
-- Ban evasion (F15): hashed email addresses and sign-in identities that can't sign up again.
CREATE TABLE public.moderation_blocked_identities (
  hash text PRIMARY KEY,
  kind text NOT NULL CONSTRAINT moderation_blocked_identities_kind_check CHECK (kind IN ('email', 'identity')),
  action_id uuid REFERENCES public.moderation_actions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX moderation_blocked_identities_action_idx ON public.moderation_blocked_identities (action_id) WHERE action_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.content_reports
  ADD COLUMN target_seq bigint,
  ADD COLUMN case_id uuid REFERENCES public.moderation_cases(id) ON DELETE SET NULL,
  ADD COLUMN snapshot jsonb,
  ADD COLUMN also_blocked boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE INDEX content_reports_case_idx ON public.content_reports (case_id) WHERE case_id IS NOT NULL;
--> statement-breakpoint
DROP INDEX public.content_reports_one_open_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX content_reports_one_open_idx ON public.content_reports (reporter_id, target_kind, target_id, (COALESCE(target_seq, 0))) WHERE status = 'open';
--> statement-breakpoint
ALTER TABLE public.content_reports DROP CONSTRAINT content_reports_kind_check,
  ADD CONSTRAINT content_reports_kind_check CHECK (target_kind IN ('project', 'person', 'update', 'update_comment', 'doc', 'task', 'task_comment',
    'file', 'chat_message', 'chat_channel', 'role', 'application', 'invitation', 'connection_request', 'contribution'));
--> statement-breakpoint
ALTER TABLE public.content_reports DROP CONSTRAINT content_reports_reason_check,
  ADD CONSTRAINT content_reports_reason_check CHECK (reason IN ('threat', 'self_harm', 'child_safety', 'intimate_images', 'private_info',
    'harassment', 'hate_speech', 'impersonation', 'scam', 'inappropriate', 'spam', 'other'));
--> statement-breakpoint
ALTER TABLE public.workspaces ADD COLUMN restricted_at timestamptz;
--> statement-breakpoint
REVOKE ALL ON public.moderation_cases, public.moderation_actions, public.moderation_appeals, public.moderation_events,
  public.moderation_blocked_identities FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
ALTER TABLE public.moderation_cases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.moderation_appeals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.moderation_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.moderation_blocked_identities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- An account's restriction in force (F14): 'ban', 'suspension' or 'limit', the strongest first, else null.
CREATE FUNCTION app_private.moderation_restriction(p_user_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.action FROM public.moderation_actions a
  WHERE a.subject_id = p_user_id AND a.action IN ('limit', 'suspension', 'ban')
    AND a.lifted_at IS NULL AND a.undone_at IS NULL AND a.reversed_at IS NULL AND a.paused_at IS NULL
    AND (a.ends_at IS NULL OR a.ends_at > now())
  ORDER BY CASE a.action WHEN 'ban' THEN 3 WHEN 'suspension' THEN 2 ELSE 1 END DESC
  LIMIT 1;
$$;
--> statement-breakpoint
-- Every write path, including the ones that skip the app's own checks: suspended and banned accounts write nothing;
-- limited accounts don't reach people outside their workspaces and connections (docs/trust-and-safety-concept.md §7.3).
CREATE FUNCTION app_private.moderation_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
CREATE TRIGGER chat_messages_moderation_guard BEFORE INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION app_private.moderation_write_guard();
--> statement-breakpoint
CREATE TRIGGER workspace_updates_moderation_guard BEFORE INSERT ON public.workspace_updates FOR EACH ROW EXECUTE FUNCTION app_private.moderation_write_guard();
--> statement-breakpoint
CREATE TRIGGER workspace_update_comments_moderation_guard BEFORE INSERT ON public.workspace_update_comments FOR EACH ROW EXECUTE FUNCTION app_private.moderation_write_guard();
--> statement-breakpoint
CREATE TRIGGER task_comments_moderation_guard BEFORE INSERT ON public.task_comments FOR EACH ROW EXECUTE FUNCTION app_private.moderation_write_guard();
--> statement-breakpoint
CREATE TRIGGER workspace_invitations_moderation_guard BEFORE INSERT ON public.workspace_invitations FOR EACH ROW EXECUTE FUNCTION app_private.moderation_write_guard();
--> statement-breakpoint
CREATE TRIGGER role_applications_moderation_guard BEFORE INSERT ON public.role_applications FOR EACH ROW EXECUTE FUNCTION app_private.moderation_write_guard();
--> statement-breakpoint
CREATE TRIGGER connections_moderation_guard BEFORE INSERT ON public.connections FOR EACH ROW EXECUTE FUNCTION app_private.moderation_write_guard();
--> statement-breakpoint
CREATE TRIGGER workspaces_moderation_guard BEFORE INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION app_private.moderation_write_guard();
--> statement-breakpoint
-- Staff are accounts with role admin or moderator in auth metadata (T15); the app can't read auth.users directly.
CREATE FUNCTION app_private.moderation_staff() RETURNS TABLE (id uuid, role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY SELECT u.id, u.raw_app_meta_data->>'role' FROM auth.users u
    WHERE u.raw_app_meta_data->>'role' IN ('admin', 'moderator') AND u.deleted_at IS NULL;
END;
$$;
--> statement-breakpoint
-- The Staff list (F17): admin, moderator, or null to remove. Callers check that an admin is asking.
CREATE FUNCTION app_private.moderation_set_staff_role(p_user_id uuid, p_role text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
-- A suspension or ban signs the person out everywhere (F14): sessions and their refresh tokens go.
CREATE FUNCTION app_private.moderation_sign_out_everywhere(p_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM auth.sessions s WHERE s.user_id = p_user_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.moderation_restriction(uuid), app_private.moderation_write_guard(),
  app_private.moderation_events_append_only(), app_private.moderation_staff(), app_private.moderation_set_staff_role(uuid, text),
  app_private.moderation_sign_out_everywhere(uuid)
FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.moderation_restriction(uuid), app_private.moderation_staff(),
  app_private.moderation_set_staff_role(uuid, text), app_private.moderation_sign_out_everywhere(uuid)
TO nb_app;
