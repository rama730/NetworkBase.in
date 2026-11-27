-- Plan B7.3a (report 36.4 call 2): members propose items for a club's general meeting until its agenda deadline; an
-- officer accepts or holds each one. Server only.

CREATE TABLE public.club_agenda_requests (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    doc_id uuid NOT NULL REFERENCES public.workspace_documents(id) ON DELETE CASCADE,
    proposed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    title text NOT NULL,
    state text DEFAULT 'proposed' NOT NULL,
    decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    CONSTRAINT club_agenda_requests_title CHECK (char_length(title) BETWEEN 1 AND 200),
    CONSTRAINT club_agenda_requests_state CHECK (state IN ('proposed', 'accepted', 'held'))
);
--> statement-breakpoint
CREATE INDEX club_agenda_requests_doc_idx ON public.club_agenda_requests (doc_id, created_at);
--> statement-breakpoint
CREATE INDEX club_agenda_requests_org_idx ON public.club_agenda_requests (org_id);
--> statement-breakpoint
CREATE INDEX club_agenda_requests_proposed_by_idx ON public.club_agenda_requests (proposed_by) WHERE proposed_by IS NOT NULL;
--> statement-breakpoint
CREATE INDEX club_agenda_requests_decided_by_idx ON public.club_agenda_requests (decided_by) WHERE decided_by IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.club_agenda_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.club_agenda_requests FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.club_agenda_requests TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.club_agenda_requests TO service_role;
