DO $archive$
BEGIN
  IF to_regclass('public.profile_interests') IS NOT NULL THEN
    EXECUTE 'INSERT INTO app_private.retired_domain_archive (source_table, source_key, payload)
SELECT ''profile_interests'', row_data.id::text, to_jsonb(row_data)
FROM public.profile_interests AS row_data
ON CONFLICT (source_table, source_key) DO NOTHING';
  END IF;
END
$archive$;
--> statement-breakpoint
DO $archive$
BEGIN
  IF to_regclass('public.saved_projects') IS NOT NULL THEN
    EXECUTE 'INSERT INTO app_private.retired_domain_archive (source_table, source_key, payload)
SELECT ''saved_projects'', row_data.id::text, to_jsonb(row_data)
FROM public.saved_projects AS row_data
ON CONFLICT (source_table, source_key) DO NOTHING';
  END IF;
END
$archive$;
--> statement-breakpoint
DO $archive$
BEGIN
  IF to_regclass('public.collection_projects') IS NOT NULL THEN
    EXECUTE 'INSERT INTO app_private.retired_domain_archive (source_table, source_key, payload)
SELECT ''collection_projects'', row_data.collection_id::text || '':'' || row_data.project_id::text, to_jsonb(row_data)
FROM public.collection_projects AS row_data
ON CONFLICT (source_table, source_key) DO NOTHING';
  END IF;
END
$archive$;
--> statement-breakpoint
DO $archive$
BEGIN
  IF to_regclass('public.skill_popularity_snapshots') IS NOT NULL THEN
    EXECUTE 'INSERT INTO app_private.retired_domain_archive (source_table, source_key, payload)
SELECT ''skill_popularity_snapshots'', row_data.id::text, to_jsonb(row_data)
FROM public.skill_popularity_snapshots AS row_data
ON CONFLICT (source_table, source_key) DO NOTHING';
  END IF;
END
$archive$;
--> statement-breakpoint
DROP TABLE IF EXISTS public.collection_projects;
--> statement-breakpoint
DROP TABLE IF EXISTS public.saved_projects;
--> statement-breakpoint
DROP TABLE IF EXISTS public.skill_popularity_snapshots;
--> statement-breakpoint
DROP TABLE IF EXISTS public.profile_interests;
--> statement-breakpoint
DROP VIEW IF EXISTS public.onboarding_funnel_dimensions_daily;
