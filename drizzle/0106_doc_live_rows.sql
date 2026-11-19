-- Workflow tabs F2 (report 38.3, plan A0.5): rows of a document's live block are tasks that belong to the document and
-- the block (call 1), so adding or ticking never writes the document's text and copies start empty. Add-only.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS source_doc_id uuid REFERENCES public.workspace_documents(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS source_block text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS source_position double precision;
