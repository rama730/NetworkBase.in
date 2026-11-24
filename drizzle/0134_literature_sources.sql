-- Plan B1.8b (report 30.6 W5 layer 3): a thesis workspace's literature — one row per source (title, authors, year,
-- link or DOI, key issues, summary, an optional PDF from Files). BibTeX is read and written in the browser; nothing
-- is fetched from a DOI on the server. Server only (no browser grants).

CREATE TABLE public.literature_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    title text NOT NULL,
    authors text,
    year integer,
    link text,
    doi text,
    key_issues text[] DEFAULT '{}'::text[] NOT NULL,
    summary text,
    node_id uuid REFERENCES public.workspace_nodes(id) ON DELETE SET NULL,
    added_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT literature_sources_title_length CHECK (char_length(title) BETWEEN 1 AND 500),
    CONSTRAINT literature_sources_year CHECK (year IS NULL OR year BETWEEN 1000 AND 3000),
    CONSTRAINT literature_sources_summary_length CHECK (summary IS NULL OR char_length(summary) <= 5000)
);
--> statement-breakpoint
CREATE INDEX literature_sources_workspace_idx ON public.literature_sources (workspace_id, created_at);
--> statement-breakpoint
ALTER TABLE public.literature_sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.literature_sources FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.literature_sources TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.literature_sources TO service_role;
