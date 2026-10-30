-- The trust and safety console, live and conflict-safe (Trust & Safety Console Redesign, R6 and S1–S14).
-- Cases get a version that rises with every real change (S2), claims become short leases (S3), staff can assign
-- and escalate (S11), the moderation log becomes the live cursor (S1) and announces each entry on a staff-only
-- channel the moment it commits, and message templates per rule and per appeal outcome replace the generic text (S13).

ALTER TABLE public.moderation_cases
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN claimed_until timestamptz,
  ADD COLUMN claim_seen_at timestamptz,
  ADD COLUMN assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN escalated_at timestamptz;
--> statement-breakpoint
CREATE INDEX moderation_cases_assigned_idx ON public.moderation_cases (assigned_to) WHERE assigned_to IS NOT NULL;
--> statement-breakpoint
CREATE INDEX moderation_cases_open_severity_idx ON public.moderation_cases (severity) WHERE state IN ('open', 'in_review');
--> statement-breakpoint
CREATE INDEX moderation_cases_target_history_idx ON public.moderation_cases (target_kind, target_id, created_at DESC);
--> statement-breakpoint
-- Who is reviewing (claims, leases, open/in review) shows live on its own; only a change to the case itself raises
-- the version, so a claim or release never makes someone else's open form stale.
CREATE FUNCTION app_private.moderation_case_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
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
CREATE TRIGGER moderation_cases_version BEFORE UPDATE ON public.moderation_cases
  FOR EACH ROW EXECUTE FUNCTION app_private.moderation_case_version();
--> statement-breakpoint
-- The log's order is the live cursor: a screen that missed events asks for everything after the last seq it saw.
ALTER TABLE public.moderation_events ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;
--> statement-breakpoint
CREATE UNIQUE INDEX moderation_events_seq_idx ON public.moderation_events (seq);
--> statement-breakpoint
CREATE INDEX moderation_events_kind_time_idx ON public.moderation_events (kind, created_at DESC);
--> statement-breakpoint
CREATE INDEX content_reports_reporter_status_idx ON public.content_reports (reporter_id, status);
--> statement-breakpoint
-- The opening message for each rule and the reply for each appeal outcome (S13, R10), editable by admins.
CREATE TABLE public.moderation_message_templates (
  key text PRIMARY KEY CONSTRAINT moderation_message_templates_key_check CHECK (key ~ '^(rule:([1-9]|1[0-5])|appeal:(upheld|reduced|reversed))$'),
  message text NOT NULL CONSTRAINT moderation_message_templates_message_check CHECK (char_length(message) BETWEEN 1 AND 4000),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX moderation_message_templates_updated_by_idx ON public.moderation_message_templates (updated_by) WHERE updated_by IS NOT NULL;
--> statement-breakpoint
REVOKE ALL ON public.moderation_message_templates FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
ALTER TABLE public.moderation_message_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Staff on the live channel: the admin or moderator role, signed in with their authenticator (F16).
CREATE FUNCTION app_private.nb_is_trust_staff() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') IN ('admin', 'moderator'), false)
     AND coalesce((SELECT auth.jwt()) ->> 'aal', '') = 'aal2';
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_is_trust_staff() FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.nb_is_trust_staff() TO authenticated;
--> statement-breakpoint
CREATE POLICY trust_console_read ON realtime.messages FOR SELECT TO authenticated
  USING ((SELECT realtime.topic()) = 'trust:console' AND (SELECT app_private.nb_is_trust_staff()));
--> statement-breakpoint
CREATE POLICY trust_console_send ON realtime.messages FOR INSERT TO authenticated
  WITH CHECK ((SELECT realtime.topic()) = 'trust:console' AND extension = 'presence' AND (SELECT app_private.nb_is_trust_staff()));
--> statement-breakpoint
-- Every log entry is announced when it commits, whoever wrote it (a report, a decision, a job). Only ids and the
-- case version travel; screens fetch the rest. A failed announcement never fails the change: screens catch up
-- from the log (S1).
CREATE FUNCTION app_private.moderation_event_broadcast() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
REVOKE ALL ON FUNCTION app_private.moderation_case_version(), app_private.moderation_event_broadcast() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER moderation_events_broadcast AFTER INSERT ON public.moderation_events
  FOR EACH ROW EXECUTE FUNCTION app_private.moderation_event_broadcast();
