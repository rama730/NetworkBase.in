-- 0246_org_docs.sql
-- Org Docs (docs/organization-concept-report.md §19): a "has opened" record per member and doc, for the
-- New and Required labels (§19.4, §19.11). The version is the doc's re-read counter
-- (project_docs.settings.org.readVersion), so "Ask members to re-read" makes a doc New again.
-- Server-only: browser roles never read or write it.

CREATE TABLE public.doc_opens (
  doc_id uuid NOT NULL REFERENCES public.project_docs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 0,
  opened_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_id, user_id)
);

--> statement-breakpoint

CREATE INDEX doc_opens_user_idx ON public.doc_opens(user_id);

--> statement-breakpoint

ALTER TABLE public.doc_opens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doc_opens FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.doc_opens TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON public.doc_opens TO service_role;
  END IF;
END $$;
