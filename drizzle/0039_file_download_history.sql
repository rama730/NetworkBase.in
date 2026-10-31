-- Who downloaded which workspace file, for the workspace's owner and admins. Kept 90 days; no IP address.
-- Separate from workspace_node_events, which feed file sync and would be flooded by downloads.
CREATE TABLE public.workspace_download_events (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    node_id uuid REFERENCES public.workspace_nodes(id) ON DELETE SET NULL,
    actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    file_name text NOT NULL,
    kind text NOT NULL,
    file_count integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_download_events_kind_check CHECK (kind IN ('file', 'version', 'folder_zip', 'selection_zip', 'submissions_zip')),
    CONSTRAINT workspace_download_events_file_count_check CHECK (file_count >= 0)
);
--> statement-breakpoint
CREATE INDEX workspace_download_events_recent_idx ON public.workspace_download_events USING btree (workspace_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX workspace_download_events_actor_idx ON public.workspace_download_events USING btree (actor_id, created_at DESC) WHERE actor_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX workspace_download_events_node_idx ON public.workspace_download_events USING btree (node_id) WHERE node_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX workspace_download_events_expiry_idx ON public.workspace_download_events USING btree (created_at);
--> statement-breakpoint
ALTER TABLE public.workspace_download_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.workspace_download_events FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE public.workspace_download_events TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.workspace_download_events TO service_role;
