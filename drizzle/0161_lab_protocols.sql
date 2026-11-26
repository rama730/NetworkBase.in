-- Plan B6.2a (report 35.5 calls 1, 6): a lab's protocols are its documents with versions Draft → Approved → Retired —
-- only an Approved version is run, and approving a new one retires the old — plus training sign-offs by a trainer.
-- Version text is frozen when it's asked to be approved. Server only.

CREATE TABLE public.lab_protocols (
    doc_id uuid PRIMARY KEY REFERENCES public.workspace_documents(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    needs_training boolean DEFAULT false NOT NULL,
    trainers jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lab_protocols_trainers CHECK (jsonb_typeof(trainers) = 'array' AND jsonb_array_length(trainers) <= 20)
);
--> statement-breakpoint
CREATE INDEX lab_protocols_workspace_idx ON public.lab_protocols (workspace_id);
--> statement-breakpoint
CREATE TABLE public.lab_protocol_versions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    doc_id uuid NOT NULL REFERENCES public.workspace_documents(id) ON DELETE CASCADE,
    version integer NOT NULL,
    state text NOT NULL,
    content text NOT NULL,
    requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lab_protocol_versions_state CHECK (state IN ('draft', 'approved', 'retired')),
    CONSTRAINT lab_protocol_versions_version CHECK (version BETWEEN 1 AND 10000),
    CONSTRAINT lab_protocol_versions_content CHECK (char_length(content) <= 200000),
    UNIQUE (doc_id, version)
);
--> statement-breakpoint
CREATE UNIQUE INDEX lab_protocol_versions_one_approved ON public.lab_protocol_versions (doc_id) WHERE state = 'approved';
--> statement-breakpoint
CREATE UNIQUE INDEX lab_protocol_versions_one_draft ON public.lab_protocol_versions (doc_id) WHERE state = 'draft';
--> statement-breakpoint
CREATE INDEX lab_protocol_versions_workspace_idx ON public.lab_protocol_versions (workspace_id);
--> statement-breakpoint
CREATE INDEX lab_protocol_versions_requested_by_idx ON public.lab_protocol_versions (requested_by) WHERE requested_by IS NOT NULL;
--> statement-breakpoint
CREATE INDEX lab_protocol_versions_approved_by_idx ON public.lab_protocol_versions (approved_by) WHERE approved_by IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.lab_trainings (
    doc_id uuid NOT NULL REFERENCES public.workspace_documents(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    trainer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    signed_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (doc_id, user_id)
);
--> statement-breakpoint
CREATE INDEX lab_trainings_user_idx ON public.lab_trainings (user_id);
--> statement-breakpoint
CREATE INDEX lab_trainings_workspace_idx ON public.lab_trainings (workspace_id);
--> statement-breakpoint
CREATE INDEX lab_trainings_trainer_idx ON public.lab_trainings (trainer_id) WHERE trainer_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.lab_protocols ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.lab_protocol_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.lab_trainings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lab_protocols FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lab_protocol_versions FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lab_trainings FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lab_protocols TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lab_protocol_versions TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lab_trainings TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.lab_protocols TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.lab_protocol_versions TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.lab_trainings TO service_role;
