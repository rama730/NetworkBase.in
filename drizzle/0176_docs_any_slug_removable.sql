-- Any doc, README included, can be removed from the Docs tab.
DROP TRIGGER IF EXISTS project_docs_prevent_delete ON public.project_docs;
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.prevent_primary_doc_delete();
