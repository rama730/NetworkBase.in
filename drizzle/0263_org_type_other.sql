-- 0263: an "Other" organization type (report §34.2, decision 176); its label lives in org_settings.typeLabel.
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_org_type_check;
--> statement-breakpoint
ALTER TABLE public.projects ADD CONSTRAINT projects_org_type_check
  CHECK (org_type IS NULL OR org_type IN ('education', 'company', 'community', 'research', 'club', 'other'));
