-- Report Part H, phase H-2 (M8): a branch's own files (only paths that differ from its base on main), change sets
-- that target a branch, and save changes that compare content (a branch file has no version of its own).
-- docs/superpowers/plans/2026-11-17-m8-h2-branches.md
CREATE TABLE public.branch_files (
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    path text NOT NULL,
    state text NOT NULL CHECK (state IN ('present', 'deleted')),
    content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
    asset_id uuid REFERENCES public.storage_assets(id) ON DELETE SET NULL,
    size bigint,
    mime_type text,
    executable boolean,
    updated_save_id uuid REFERENCES public.saves(id) ON DELETE SET NULL,
    PRIMARY KEY (branch_id, path),
    CHECK (state = 'deleted' OR content_hash IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX branch_files_content_hash_idx ON public.branch_files (content_hash) WHERE content_hash IS NOT NULL;
--> statement-breakpoint
-- Storage clean-up keeps content a branch or its history refers to (asset-deletion.ts).
CREATE INDEX branch_files_asset_idx ON public.branch_files (asset_id) WHERE asset_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX save_changes_asset_idx ON public.save_changes (asset_id) WHERE asset_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.change_sets ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.save_changes ADD COLUMN IF NOT EXISTS previous_content_hash text;
--> statement-breakpoint
ALTER TABLE public.save_changes DROP COLUMN op;
--> statement-breakpoint
ALTER TABLE public.save_changes ADD COLUMN op text GENERATED ALWAYS AS (CASE
    WHEN before_path IS NULL AND after_path IS NOT NULL THEN 'add'
    WHEN before_path IS NOT NULL AND after_path IS NULL THEN 'delete'
    WHEN before_path IS NULL THEN 'none'
    WHEN before_path <> after_path THEN 'rename'
    WHEN version IS DISTINCT FROM previous_version OR content_hash IS DISTINCT FROM previous_content_hash THEN 'change'
    ELSE 'none' END) STORED;
--> statement-breakpoint
ALTER TABLE public.branch_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.branch_files FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.branch_files TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.branch_files TO service_role;
