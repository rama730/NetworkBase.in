-- 0265: stored values say workspace (report §12.5; decisions 2, 9, 34, 41). Runs after 0264.
ALTER TABLE public.workspaces DROP CONSTRAINT workspaces_kind_check, DROP CONSTRAINT workspaces_org_has_no_parent;
--> statement-breakpoint
UPDATE public.workspaces SET kind = 'workspace' WHERE kind = 'project';
--> statement-breakpoint
ALTER TABLE public.workspaces ALTER COLUMN kind SET DEFAULT 'workspace',
  ADD CONSTRAINT workspaces_kind_check CHECK (kind IN ('workspace', 'organization')),
  ADD CONSTRAINT workspaces_org_has_no_parent CHECK (kind = 'workspace' OR parent_id IS NULL);
--> statement-breakpoint
-- Document visibility: inherit_project -> inherit_workspace.
UPDATE public.workspace_documents SET settings = jsonb_set(settings, '{visibilityOverride}', '"inherit_workspace"')
WHERE settings ->> 'visibilityOverride' = 'inherit_project';
--> statement-breakpoint
ALTER TABLE public.workspace_documents ALTER COLUMN settings SET DEFAULT '{"version": 1, "editPolicy": "leaders", "projectBlocks": true, "externalImages": false, "visibilityOverride": "inherit_workspace"}'::jsonb;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_doc_version_is_public(p_version_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_document_versions v
    JOIN public.workspace_documents d
      ON d.id = v.doc_id
     AND d.published_version_id = v.id
    WHERE v.id = p_version_id
      AND v.deleted_at IS NULL
      AND COALESCE(d.settings ->> 'visibilityOverride', 'inherit_workspace') IN ('inherit_workspace', 'public')
      AND app_private.nb_workspace_public_doc_visible(v.workspace_id)
  );
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_workspace_doc_member_can_read(p_project_id uuid, p_settings jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND (
        p.owner_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.workspace_members pm
          WHERE pm.workspace_id = p_project_id
            AND pm.user_id = (SELECT auth.uid())
            AND (coalesce(p_settings ->> 'visibilityOverride', 'inherit_workspace') <> 'leaders_only'
                 OR pm.role IN ('owner', 'admin'))
        )
      )
  );
$function$;
--> statement-breakpoint
ALTER POLICY workspace_documents_read ON public.workspace_documents USING (
  app_private.nb_workspace_doc_member_can_read(workspace_id, settings)
  OR (published_version_id IS NOT NULL
    AND COALESCE(settings ->> 'visibilityOverride', 'inherit_workspace') IN ('inherit_workspace', 'public')
    AND app_private.nb_workspace_public_doc_visible(workspace_id)));
--> statement-breakpoint
-- Contribution stage source and member event types.
ALTER TABLE public.profile_contribution_stages DROP CONSTRAINT profile_contribution_stages_source_check;
--> statement-breakpoint
UPDATE public.profile_contribution_stages SET source = 'workspace_invite' WHERE source = 'project_invite';
--> statement-breakpoint
ALTER TABLE public.profile_contribution_stages ADD CONSTRAINT profile_contribution_stages_source_check
  CHECK (source IN ('membership', 'application', 'owner', 'manual', 'role_change', 'workspace_invite', 'ownership_transfer', 'removal', 'backfill'));
--> statement-breakpoint
UPDATE public.workspace_node_events SET type = 'workspace_member.' || substr(type, length('project_member.') + 1)
WHERE type LIKE 'project\_member.%';
--> statement-breakpoint
-- Upload intent scopes (no check constraint; intents are short-lived).
UPDATE public.upload_intents SET scope = 'workspace_' || substr(scope, length('project_') + 1)
WHERE scope IN ('project_file', 'project_update_media', 'project_cover');
--> statement-breakpoint
-- Asset purposes are "{scope}:{kind}" and must match a re-sent intent's purpose.
UPDATE public.storage_assets SET purpose = regexp_replace(purpose, '^(legacy_)?project_(file|update_media|update_draft_media|cover):', '\1workspace_\2:')
WHERE purpose ~ '^(legacy_)?project_(file|update_media|update_draft_media|cover):';
--> statement-breakpoint
-- Founder is not an experience level (decision 34).
ALTER TABLE public.profiles DROP CONSTRAINT profiles_experience_level_check;
--> statement-breakpoint
UPDATE public.profiles SET experience_level = 'lead' WHERE experience_level = 'founder';
--> statement-breakpoint
ALTER TABLE public.profiles ADD CONSTRAINT profiles_experience_level_check
  CHECK (experience_level IS NULL OR experience_level IN ('student', 'junior', 'mid', 'senior', 'lead'));
--> statement-breakpoint
-- Guide becomes Mentor (decision 2); "&" becomes "and" in the designated categories (decision 9).
UPDATE public.workspace_mentors SET label = 'Mentor' WHERE label = 'Guide';
--> statement-breakpoint
UPDATE public.workspace_invitations SET guidance_label = 'Mentor' WHERE guidance_label = 'Guide';
--> statement-breakpoint
UPDATE public.profiles SET preferred_categories = ARRAY(SELECT CASE c WHEN 'AI & Machine Learning' THEN 'AI and Machine Learning' WHEN 'Data & Analytics' THEN 'Data and Analytics' WHEN 'Sales & Business Dev' THEN 'Sales and Business Dev' WHEN 'Community & DevRel' THEN 'Community and DevRel' WHEN 'Security & DevOps' THEN 'Security and DevOps' WHEN 'Content & Writing' THEN 'Content and Writing' WHEN 'Finance & Legal' THEN 'Finance and Legal' WHEN 'People & HR' THEN 'People and HR' WHEN 'Hardware & IoT' THEN 'Hardware and IoT' WHEN 'Web3 & Blockchain' THEN 'Web3 and Blockchain' ELSE c END FROM unnest(preferred_categories) WITH ORDINALITY AS t(c, i) ORDER BY i)
WHERE preferred_categories && ARRAY['AI & Machine Learning', 'Data & Analytics', 'Sales & Business Dev', 'Community & DevRel', 'Security & DevOps', 'Content & Writing', 'Finance & Legal', 'People & HR', 'Hardware & IoT', 'Web3 & Blockchain']::text[];
--> statement-breakpoint
-- Report reasons (decision 41).
ALTER TABLE public.content_reports DROP CONSTRAINT content_reports_reason_check,
  ADD CONSTRAINT content_reports_reason_check CHECK (reason IN ('impersonation', 'spam', 'harassment', 'hate_speech', 'inappropriate', 'other'));
