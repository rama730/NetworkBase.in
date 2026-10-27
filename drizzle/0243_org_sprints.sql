-- 0243_org_sprints.sql
-- Org sprints (docs/organization-concept-report.md §15): a child project's sprint can sit inside an org
-- sprint; sprints can opt out of starting on their date; org sprints carry materials (docs and files).
-- Org sprints never overlapping and child sprints fitting inside are checked by the server actions,
-- which lock the project row first (browser roles cannot write sprints, 0199).
-- 0242 is held for the Discover feed index and goes in with its own journal entry.

ALTER TABLE public.project_sprints
  ADD COLUMN parent_sprint_id uuid REFERENCES public.project_sprints(id) ON DELETE SET NULL,
  ADD COLUMN auto_start boolean NOT NULL DEFAULT true,
  ADD COLUMN show_in_children boolean NOT NULL DEFAULT true;

--> statement-breakpoint

CREATE INDEX project_sprints_parent_idx ON public.project_sprints(parent_sprint_id) WHERE parent_sprint_id IS NOT NULL;

--> statement-breakpoint

-- Materials: a sprint links to org docs or files (report §15.2, §23 Sprint materials view).
CREATE TABLE public.sprint_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_id uuid NOT NULL REFERENCES public.project_sprints(id) ON DELETE CASCADE,
  node_id uuid REFERENCES public.project_nodes(id) ON DELETE CASCADE,
  doc_id uuid REFERENCES public.project_docs(id) ON DELETE CASCADE,
  added_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sprint_materials_one_target CHECK ((node_id IS NULL) <> (doc_id IS NULL))
);

--> statement-breakpoint

CREATE UNIQUE INDEX sprint_materials_node_unique ON public.sprint_materials(sprint_id, node_id) WHERE node_id IS NOT NULL;

--> statement-breakpoint

CREATE UNIQUE INDEX sprint_materials_doc_unique ON public.sprint_materials(sprint_id, doc_id) WHERE doc_id IS NOT NULL;

--> statement-breakpoint

CREATE INDEX sprint_materials_node_idx ON public.sprint_materials(node_id) WHERE node_id IS NOT NULL;

--> statement-breakpoint

CREATE INDEX sprint_materials_doc_idx ON public.sprint_materials(doc_id) WHERE doc_id IS NOT NULL;

--> statement-breakpoint

-- Server-only table: RLS on with no policies, no browser grants.
ALTER TABLE public.sprint_materials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sprint_materials FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.sprint_materials TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON public.sprint_materials TO service_role;
  END IF;
END $$;
