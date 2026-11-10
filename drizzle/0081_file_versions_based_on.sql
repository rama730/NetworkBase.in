-- File versions only ever grow (2026-11-11): saving adds a version, and Restore moves the node's active pointer
-- (workspace_nodes.current_version) instead of copying an old version forward. A version saved while an older one is
-- active records which one it was based on, so the history reads "v4 based on v1".

ALTER TABLE public.file_versions ADD COLUMN based_on_version integer;
--> statement-breakpoint
ALTER TABLE public.file_versions ADD CONSTRAINT file_versions_based_on_version_check CHECK (based_on_version IS NULL OR based_on_version >= 1);
