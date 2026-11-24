-- Workflow tabs A7.2 (report 38.16 O1 call 2–3): comments on any file, optionally pinned to a spot on an image
-- ({"x","y"} within 0–1) or a moment in video or audio ({"t"} seconds). A comment belongs to the version it was made on.
-- Server only (no browser grants), like the other workflow tables.

CREATE TABLE public.file_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    node_id uuid NOT NULL REFERENCES public.workspace_nodes(id) ON DELETE CASCADE,
    version integer NOT NULL,
    anchor jsonb,
    parent_id uuid REFERENCES public.file_comments(id) ON DELETE CASCADE,
    content text NOT NULL,
    author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT file_comments_version_check CHECK (version >= 1),
    CONSTRAINT file_comments_content_length CHECK (char_length(content) BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE INDEX file_comments_node_idx ON public.file_comments (node_id, version, created_at);
--> statement-breakpoint
ALTER TABLE public.file_comments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.file_comments FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.file_comments TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.file_comments TO service_role;
