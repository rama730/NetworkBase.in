-- Additive, server-only transactional email queue. Sending remains disabled by default.
CREATE TABLE public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL,
  kind text NOT NULL CONSTRAINT email_outbox_kind_check CHECK (kind IN ('welcome', 'task_assignment')),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_id uuid,
  project_id uuid,
  task_id uuid,
  status text NOT NULL DEFAULT 'pending' CONSTRAINT email_outbox_status_check CHECK (status IN ('pending', 'processing', 'accepted', 'dropped', 'failed', 'needs_review')),
  due_at timestamptz NOT NULL DEFAULT now(),
  lease_id uuid,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CONSTRAINT email_outbox_attempts_check CHECK (attempts >= 0),
  first_attempt_at timestamptz,
  payload jsonb,
  provider_id uuid,
  delivery_state text CONSTRAINT email_outbox_delivery_check CHECK (delivery_state IN ('accepted', 'delivered', 'failed', 'bounced', 'complained')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX email_outbox_event_idx ON public.email_outbox(event_key);
--> statement-breakpoint
CREATE UNIQUE INDEX email_outbox_provider_idx ON public.email_outbox(provider_id);
--> statement-breakpoint
CREATE INDEX email_outbox_due_idx ON public.email_outbox(due_at) WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX email_outbox_lease_idx ON public.email_outbox(lease_expires_at) WHERE status = 'processing';
--> statement-breakpoint
CREATE TABLE public.email_webhook_events (
  id text PRIMARY KEY,
  provider_id uuid NOT NULL,
  state text NOT NULL CONSTRAINT email_webhook_events_state_check CHECK (state IN ('accepted', 'delivered', 'failed', 'bounced', 'complained')),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX email_webhook_events_provider_idx ON public.email_webhook_events(provider_id);
--> statement-breakpoint
CREATE TABLE public.email_suppressions (
  email text PRIMARY KEY,
  reason text NOT NULL CONSTRAINT email_suppressions_reason_check CHECK (reason IN ('hard_bounce', 'complaint')),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.email_webhook_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.email_outbox, public.email_webhook_events, public.email_suppressions FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT ALL ON public.email_outbox, public.email_webhook_events, public.email_suppressions TO service_role;
