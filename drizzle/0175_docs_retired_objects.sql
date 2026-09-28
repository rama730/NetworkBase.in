DO $archive$
BEGIN
  IF to_regclass('public.project_docs') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'project_docs' AND column_name = 'draft_content') THEN
    EXECUTE 'INSERT INTO app_private.retired_domain_archive (source_table, source_key, payload)
SELECT ''project_docs.draft'', doc.id::text, jsonb_build_object(
  ''project_id'', doc.project_id,
  ''slug'', doc.slug,
  ''draft_content'', doc.draft_content,
  ''draft_updated_by'', doc.draft_updated_by,
  ''draft_updated_at'', doc.draft_updated_at
)
FROM public.project_docs AS doc
WHERE COALESCE(doc.draft_content, '''') <> ''''
ON CONFLICT (source_table, source_key) DO NOTHING';
  END IF;
END
$archive$;
--> statement-breakpoint
DO $archive$
BEGIN
  IF to_regclass('public.project_doc_assets') IS NOT NULL THEN
    EXECUTE 'INSERT INTO app_private.retired_domain_archive (source_table, source_key, payload)
SELECT ''project_doc_assets'', row_data.id::text, to_jsonb(row_data)
FROM public.project_doc_assets AS row_data
ON CONFLICT (source_table, source_key) DO NOTHING';
  END IF;
END
$archive$;
--> statement-breakpoint
DO $archive$
BEGIN
  IF to_regclass('public.project_doc_draft_contributors') IS NOT NULL THEN
    EXECUTE 'INSERT INTO app_private.retired_domain_archive (source_table, source_key, payload)
SELECT ''project_doc_draft_contributors'', row_data.markdown_id::text || '':'' || row_data.user_id::text, to_jsonb(row_data)
FROM public.project_doc_draft_contributors AS row_data
ON CONFLICT (source_table, source_key) DO NOTHING';
  END IF;
END
$archive$;
--> statement-breakpoint
DROP TABLE IF EXISTS public.project_doc_assets;
--> statement-breakpoint
DROP TABLE IF EXISTS public.project_doc_draft_contributors;
--> statement-breakpoint
DROP FUNCTION IF EXISTS app_private.nb_doc_asset_is_public(uuid);
--> statement-breakpoint
DROP TYPE IF EXISTS public.status_doc_asset;
--> statement-breakpoint
ALTER TABLE public.project_docs
  DROP COLUMN IF EXISTS draft_content,
  DROP COLUMN IF EXISTS draft_updated_by,
  DROP COLUMN IF EXISTS draft_updated_at;
--> statement-breakpoint
UPDATE public.project_docs
SET settings = settings - 'notifyOnPublish' - 'mediaUploads'
WHERE settings ?| ARRAY['notifyOnPublish', 'mediaUploads'];
--> statement-breakpoint
ALTER TABLE public.project_docs
  ALTER COLUMN settings SET DEFAULT '{"version": 1, "editPolicy": "leaders", "visibilityOverride": "inherit_project", "externalImages": false, "projectBlocks": true}'::jsonb;
--> statement-breakpoint
DROP INDEX IF EXISTS public.project_doc_versions_project_created_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS public.project_doc_versions_project_hash_idx;
