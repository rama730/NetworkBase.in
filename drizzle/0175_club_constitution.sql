-- Plan B7.3b (report 36.4 calls 7–8): a club's constitution as numbered articles, one row per version. The first version
-- is written by the President; every later one comes from a passed amendment motion (the meeting document and motion are
-- kept). Members read it; visitors too when the club makes it public. Server only.

CREATE TABLE public.club_constitution_versions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    version integer NOT NULL,
    articles jsonb NOT NULL,
    changed text NOT NULL,
    season text,
    doc_id uuid REFERENCES public.workspace_documents(id) ON DELETE SET NULL,
    motion_id text,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT club_constitution_versions_articles CHECK (jsonb_typeof(articles) = 'array'),
    CONSTRAINT club_constitution_versions_changed CHECK (char_length(changed) BETWEEN 1 AND 200),
    CONSTRAINT club_constitution_versions_version CHECK (version >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX club_constitution_versions_org_version ON public.club_constitution_versions (org_id, version);
--> statement-breakpoint
CREATE INDEX club_constitution_versions_doc_idx ON public.club_constitution_versions (doc_id) WHERE doc_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX club_constitution_versions_created_by_idx ON public.club_constitution_versions (created_by) WHERE created_by IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.club_constitution_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.club_constitution_versions FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.club_constitution_versions TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.club_constitution_versions TO service_role;
