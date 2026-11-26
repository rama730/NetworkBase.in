-- Plan B6.5a (report 35.6 calls 1–2): a research lab's weekly lab meeting. It shares the reading group's sessions (a
-- kind on each row, so the rotation, swaps and notices are one piece of code): a talk with a presenter in turn, an
-- announcements line, discussion notes, and an optional updates round — one block per person (Since last time · Next ·
-- Stuck on), never attendance. Server only.

ALTER TABLE public.lab_reading_sessions
    ADD COLUMN kind text DEFAULT 'reading_group' NOT NULL,
    ADD COLUMN talk_title text DEFAULT '' NOT NULL,
    ADD COLUMN announcements text DEFAULT '' NOT NULL,
    ADD COLUMN updates_notice_at timestamp with time zone,
    ADD CONSTRAINT lab_reading_sessions_kind CHECK (kind IN ('reading_group', 'lab_meeting')),
    ADD CONSTRAINT lab_reading_sessions_talk CHECK (char_length(talk_title) <= 200),
    ADD CONSTRAINT lab_reading_sessions_announcements CHECK (char_length(announcements) <= 4000);
--> statement-breakpoint
ALTER TABLE public.lab_reading_sessions DROP CONSTRAINT lab_reading_sessions_one_per_slot;
--> statement-breakpoint
ALTER TABLE public.lab_reading_sessions ADD CONSTRAINT lab_reading_sessions_one_per_slot UNIQUE (org_id, kind, starts_at);
--> statement-breakpoint
CREATE TABLE public.lab_meeting_updates (
    session_id uuid NOT NULL REFERENCES public.lab_reading_sessions(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    since_last text DEFAULT '' NOT NULL,
    next text DEFAULT '' NOT NULL,
    stuck_on text DEFAULT '' NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (session_id, user_id),
    CONSTRAINT lab_meeting_updates_lengths CHECK (char_length(since_last) <= 1000 AND char_length(next) <= 1000 AND char_length(stuck_on) <= 1000)
);
--> statement-breakpoint
CREATE INDEX lab_meeting_updates_user_idx ON public.lab_meeting_updates (user_id);
--> statement-breakpoint
ALTER TABLE public.lab_meeting_updates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lab_meeting_updates FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lab_meeting_updates TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.lab_meeting_updates TO service_role;
