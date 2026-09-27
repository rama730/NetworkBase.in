CREATE TABLE public.project_node_events_single (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  project_id uuid NOT NULL,
  node_id uuid,
  actor_id uuid,
  type text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  sequence_number bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO public.project_node_events_single (id, project_id, node_id, actor_id, type, metadata, created_at, sequence_number)
SELECT id, project_id, node_id, actor_id, type, metadata, created_at, sequence_number
FROM public.project_node_events;
--> statement-breakpoint
DROP TABLE public.project_node_events;
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.create_future_partitions();
--> statement-breakpoint
ALTER TABLE public.project_node_events_single RENAME TO project_node_events;
--> statement-breakpoint
ALTER TABLE public.project_node_events
  ADD CONSTRAINT project_node_events_pkey PRIMARY KEY (id),
  ADD CONSTRAINT project_node_events_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  ADD CONSTRAINT project_node_events_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.project_nodes(id) ON DELETE SET NULL,
  ADD CONSTRAINT project_node_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX project_node_events_project_idx ON public.project_node_events (project_id, created_at);
--> statement-breakpoint
CREATE INDEX project_node_events_node_idx ON public.project_node_events (node_id, created_at);
--> statement-breakpoint
CREATE INDEX project_node_events_actor_id_idx ON public.project_node_events (actor_id);
--> statement-breakpoint
CREATE UNIQUE INDEX project_node_events_seq_idx ON public.project_node_events (project_id, sequence_number, created_at);
--> statement-breakpoint
CREATE INDEX project_node_events_reconciliation_key_idx ON public.project_node_events (project_id, (metadata->>'reconciliationKey'));
--> statement-breakpoint
CREATE TRIGGER project_node_events_sequence_before_insert
  BEFORE INSERT ON public.project_node_events
  FOR EACH ROW EXECUTE FUNCTION public.allocate_project_node_event_sequence();
--> statement-breakpoint
ALTER TABLE public.project_node_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY project_node_events_select_project_member ON public.project_node_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_node_events.project_id
        AND p.deleted_at IS NULL
        AND p.owner_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.project_id = project_node_events.project_id
        AND m.user_id = (SELECT auth.uid())
    )
  );
--> statement-breakpoint
CREATE POLICY project_node_events_insert_project_writer ON public.project_node_events
  FOR INSERT TO authenticated
  WITH CHECK (app_private.nb_project_can_write(project_id));
--> statement-breakpoint
CREATE POLICY project_node_events_update_project_writer ON public.project_node_events
  FOR UPDATE TO authenticated
  USING (app_private.nb_project_can_write(project_id))
  WITH CHECK (app_private.nb_project_can_write(project_id));
--> statement-breakpoint
CREATE POLICY project_node_events_delete_project_writer ON public.project_node_events
  FOR DELETE TO authenticated
  USING (app_private.nb_project_can_write(project_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_node_events TO authenticated, service_role;
