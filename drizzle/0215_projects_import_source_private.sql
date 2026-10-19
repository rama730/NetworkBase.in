-- 0215: projects.import_source is server-only.
-- It can hold a sealed, transient import token and the hydration bookkeeping; the browser
-- reads hydration progress through a server action. Table-level SELECT would override any
-- column revoke, so browser roles get SELECT on every other column instead. Columns added
-- later stay server-only until granted here explicitly.
REVOKE SELECT ON TABLE public.projects FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DO $$
DECLARE readable text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO readable
  FROM pg_attribute
  WHERE attrelid = 'public.projects'::regclass AND attnum > 0 AND NOT attisdropped AND attname <> 'import_source';
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.projects TO anon, authenticated', readable);
END $$;
