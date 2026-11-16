-- Report G14 (M6): the text of text files, keyed by content (not by file), so every file, version and change set
-- with that content shares one entry. Search narrows with the trigram index, then finds exact lines in code.
-- content NULL: not text (binary or too big), so it is never read again. Filled when a search needs it (docs/superpowers/plans/2026-11-17-m6-cloud-git.md, decision 1).
CREATE TABLE IF NOT EXISTS public.file_text_index (
    content_hash text PRIMARY KEY CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    content text,
    bytes integer NOT NULL,
    indexed_at timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS file_text_index_content_trgm ON public.file_text_index USING gin (content extensions.gin_trgm_ops);
--> statement-breakpoint
ALTER TABLE public.file_text_index ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.file_text_index FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.file_text_index TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.file_text_index TO service_role;
--> statement-breakpoint
-- The daily clean-up keeps entries a draft still refers to (change-set-fs.ts, pruneTextIndex).
CREATE INDEX IF NOT EXISTS change_set_items_content_hash_idx ON public.change_set_items (content_hash);
