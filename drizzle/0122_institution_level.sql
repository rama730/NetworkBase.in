-- Workflow tabs B0.1 (report 29.2, correction recorded there): an Education organization can be an institution, and a
-- class organization links to one with institution_id (not parent_id, which would give the institution's admins
-- inherited read of student work). Organizations only; institutions don't nest.

ALTER TABLE public.workspaces ADD COLUMN org_level text;
--> statement-breakpoint
ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_org_level_check CHECK (org_level IS NULL OR (org_level = 'institution' AND kind = 'organization'));
--> statement-breakpoint
ALTER TABLE public.workspaces ADD COLUMN institution_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_institution_link_check CHECK (institution_id IS NULL OR (kind = 'organization' AND org_level IS NULL AND institution_id <> id));
--> statement-breakpoint
CREATE INDEX workspaces_institution_idx ON public.workspaces (institution_id) WHERE institution_id IS NOT NULL;
