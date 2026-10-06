-- DB-006: the retired-domain archive had no recovery consumer or expiry; it is
-- removed (production is pre-launch, no recovery obligation), which is also its
-- erasure boundary. Unused leftovers of retired domains go with it.
DROP TABLE IF EXISTS app_private.retired_domain_archive;
--> statement-breakpoint
DROP TABLE IF EXISTS public.collections;
--> statement-breakpoint
DROP TABLE IF EXISTS public.interests;
--> statement-breakpoint
-- DB-008: no column uses it; chat_reports uses a text CHECK.
DROP TYPE IF EXISTS public.status_report;
--> statement-breakpoint
-- NAME-001: docs were renamed from markdowns; the remaining names follow.
ALTER TABLE public.project_doc_versions RENAME COLUMN markdown_id TO doc_id;
--> statement-breakpoint
ALTER INDEX public.project_doc_versions_markdown_id_id_key RENAME TO project_doc_versions_doc_id_id_key;
--> statement-breakpoint
ALTER INDEX public.project_doc_versions_markdown_version_unique RENAME TO project_doc_versions_doc_id_version_number_key;
--> statement-breakpoint
ALTER TABLE public.project_doc_versions RENAME CONSTRAINT project_doc_versions_project_id_markdown_id_fkey TO project_doc_versions_project_id_doc_id_fkey;
--> statement-breakpoint
ALTER TABLE public.project_doc_versions RENAME CONSTRAINT project_markdown_versions_created_by_profiles_id_fk TO project_doc_versions_created_by_fkey;
--> statement-breakpoint
ALTER TABLE public.project_doc_versions RENAME CONSTRAINT project_markdown_versions_project_id_projects_id_fk TO project_doc_versions_project_id_fkey;
--> statement-breakpoint
ALTER TABLE public.project_docs RENAME CONSTRAINT project_markdowns_project_id_projects_id_fk TO project_docs_project_id_fkey;
--> statement-breakpoint
-- SQL function bodies are text, so the one that named markdown_id is rewritten.
CREATE OR REPLACE FUNCTION app_private.nb_doc_version_is_public(p_version_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_doc_versions v
    JOIN public.project_docs d
      ON d.id = v.doc_id
     AND d.published_version_id = v.id
    WHERE v.id = p_version_id
      AND v.deleted_at IS NULL
      AND COALESCE(d.settings ->> 'visibilityOverride', 'inherit_project') IN ('inherit_project', 'public')
      AND app_private.nb_project_public_doc_visible(v.project_id)
  );
$$;
--> statement-breakpoint
-- Its only table is gone.
DROP FUNCTION IF EXISTS app_private.nb_collection_can_manage(uuid);
