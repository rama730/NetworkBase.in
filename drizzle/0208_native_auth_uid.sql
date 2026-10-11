-- 0208: Policies resolve the caller with native auth.uid() (SQL-001).
-- app_private.get_auth_uid() read only the legacy request.jwt.claim.sub setting; current PostgREST
-- sets only the JSON request.jwt.claims, so owners could not read their own private contribution
-- rows from the browser. setup-database.ts no longer redefines the helper outside the journal
-- (MIG-004); these four policies were its last dependents, so it is dropped.
ALTER POLICY profile_collaboration_summaries_select_visible ON public.profile_collaboration_summaries USING (((profile_id = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = profile_collaboration_summaries.profile_id) AND (p.deleted_at IS NULL) AND (p.visibility = 'public'::text))))));
--> statement-breakpoint
ALTER POLICY profile_contribution_skills_select_visible ON public.profile_contribution_skills USING ((EXISTS ( SELECT 1
   FROM (profile_project_contributions contribution
     LEFT JOIN projects project ON ((project.id = contribution.project_id)))
  WHERE ((contribution.id = profile_contribution_skills.contribution_id) AND (contribution.deleted_at IS NULL) AND ((contribution.profile_id = (SELECT auth.uid())) OR ((contribution.visibility = 'public'::text) AND (((contribution.project_id IS NULL) AND (contribution.external_key IS NOT NULL)) OR ((project.deleted_at IS NULL) AND (project.visibility = ANY (ARRAY['public'::text, 'unlisted'::text])) AND (project.status <> 'draft'::status_project)))))))));
--> statement-breakpoint
ALTER POLICY profile_contribution_stages_read_authorized ON public.profile_project_contribution_stages USING (((profile_id = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM (profile_project_contributions contribution
     LEFT JOIN projects project ON ((project.id = contribution.project_id)))
  WHERE ((contribution.id = profile_project_contribution_stages.contribution_id) AND (contribution.deleted_at IS NULL) AND (contribution.visibility = 'public'::text) AND (((contribution.project_id IS NULL) AND (contribution.external_key IS NOT NULL)) OR ((project.deleted_at IS NULL) AND (project.visibility = ANY (ARRAY['public'::text, 'unlisted'::text])) AND (project.status <> 'draft'::status_project))))))));
--> statement-breakpoint
ALTER POLICY profile_contributions_read_authorized ON public.profile_project_contributions USING (((profile_id = (SELECT auth.uid())) OR ((visibility = 'public'::text) AND (deleted_at IS NULL) AND (((project_id IS NULL) AND (external_key IS NOT NULL)) OR (EXISTS ( SELECT 1
   FROM projects project
  WHERE ((project.id = profile_project_contributions.project_id) AND (project.deleted_at IS NULL) AND (project.visibility = ANY (ARRAY['public'::text, 'unlisted'::text])) AND (project.status <> 'draft'::status_project))))))));
--> statement-breakpoint
DROP FUNCTION IF EXISTS app_private.get_auth_uid();
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.get_auth_uid();
