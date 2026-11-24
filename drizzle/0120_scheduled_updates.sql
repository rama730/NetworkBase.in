-- Workflow tabs A7.4 (report 38.17 O2 calls 1–3): Updates that post themselves at a set time, as their author, if the
-- author may still post then. Drafts stay one per person; these are their own rows. Server only, like the other
-- workflow tables.

CREATE TABLE public.workspace_scheduled_updates (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    content text NOT NULL,
    update_type text,
    visibility text DEFAULT 'public' NOT NULL,
    media jsonb DEFAULT '[]'::jsonb NOT NULL,
    entity_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    publish_at timestamp with time zone NOT NULL,
    published_update_id uuid REFERENCES public.workspace_updates(id) ON DELETE SET NULL,
    published_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    failed_reason text,
    claim_expires_at timestamp with time zone,
    source_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_scheduled_updates_content_length CHECK (char_length(content) <= 20000),
    CONSTRAINT workspace_scheduled_updates_visibility_check CHECK (visibility IN ('public', 'members'))
);
--> statement-breakpoint
CREATE INDEX workspace_scheduled_updates_due_idx ON public.workspace_scheduled_updates (publish_at)
    WHERE published_at IS NULL AND cancelled_at IS NULL AND failed_reason IS NULL;
--> statement-breakpoint
CREATE INDEX workspace_scheduled_updates_workspace_idx ON public.workspace_scheduled_updates (workspace_id, publish_at);
--> statement-breakpoint
ALTER TABLE public.workspace_scheduled_updates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.workspace_scheduled_updates FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspace_scheduled_updates TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.workspace_scheduled_updates TO service_role;
