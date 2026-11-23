-- Workflow tabs A4.1 (report 38.11 D1): meetings. A meeting is a document in the Meetings section; a series makes the
-- next one on Finish; document reminders ride the hourly due job beside task reminders; a personal .ics feed token.
-- Server only (no browser grants), like the other workflow tables.

CREATE TABLE public.workspace_meeting_series (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    meeting_type text NOT NULL,
    title text NOT NULL,
    rule text NOT NULL,
    starts_time text NOT NULL,
    length_minutes integer NOT NULL,
    attendee_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    board_size integer,
    ended_at timestamp with time zone,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_meeting_series_rule_check CHECK (rule = ANY (ARRAY['weekly'::text, 'biweekly'::text, 'weekdays'::text, 'monthly'::text])),
    CONSTRAINT workspace_meeting_series_time_check CHECK (starts_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    CONSTRAINT workspace_meeting_series_length_check CHECK (length_minutes BETWEEN 5 AND 600),
    CONSTRAINT workspace_meeting_series_title_length CHECK (char_length(title) BETWEEN 1 AND 120),
    CONSTRAINT workspace_meeting_series_type_check CHECK (meeting_type ~ '^[a-z_]{1,40}$'),
    CONSTRAINT workspace_meeting_series_attendees_max CHECK (cardinality(attendee_ids) <= 100)
);
--> statement-breakpoint
CREATE INDEX workspace_meeting_series_workspace_idx ON public.workspace_meeting_series (workspace_id) WHERE ended_at IS NULL;
--> statement-breakpoint
ALTER TABLE public.workspace_meeting_series ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.workspace_meeting_series FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspace_meeting_series TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.workspace_meeting_series TO service_role;
--> statement-breakpoint
CREATE TABLE public.workspace_document_reminders (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    doc_id uuid NOT NULL REFERENCES public.workspace_documents(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    remind_at timestamp with time zone NOT NULL,
    kind text DEFAULT 'meeting_start'::text NOT NULL,
    sent_at timestamp with time zone,
    claim_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_document_reminders_kind_check CHECK (kind ~ '^[a-z_]{1,40}$')
);
--> statement-breakpoint
CREATE INDEX workspace_document_reminders_due_idx ON public.workspace_document_reminders (remind_at) WHERE sent_at IS NULL;
--> statement-breakpoint
CREATE INDEX workspace_document_reminders_doc_idx ON public.workspace_document_reminders (doc_id);
--> statement-breakpoint
ALTER TABLE public.workspace_document_reminders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.workspace_document_reminders FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspace_document_reminders TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.workspace_document_reminders TO service_role;
--> statement-breakpoint
-- W10: one read-only, revocable .ics token per person (only its SHA-256 is kept).
CREATE TABLE public.meeting_feed_tokens (
    user_id uuid NOT NULL PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE public.meeting_feed_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.meeting_feed_tokens FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meeting_feed_tokens TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.meeting_feed_tokens TO service_role;
