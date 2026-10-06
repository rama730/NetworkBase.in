-- DB-001: a reference inside a project's graph must point into the same
-- project (or the same doc / update). Each id-only FK is replaced by a composite
-- FK carrying the tenant column; ON DELETE behaviour is unchanged
-- (SET NULL lists only the reference column, PG15+). Production had no
-- cross-tenant rows when this was written.
CREATE UNIQUE INDEX IF NOT EXISTS project_nodes_project_id_id_key ON public.project_nodes (project_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS tasks_project_id_id_key ON public.tasks (project_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS project_sprints_project_id_id_key ON public.project_sprints (project_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS project_workflow_columns_project_id_id_key ON public.project_workflow_columns (project_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS project_docs_project_id_id_key ON public.project_docs (project_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS project_doc_versions_markdown_id_id_key ON public.project_doc_versions (markdown_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS project_updates_project_id_id_key ON public.project_updates (project_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS project_update_comments_update_id_id_key ON public.project_update_comments (update_id, id);
--> statement-breakpoint

ALTER TABLE public.project_nodes
  DROP CONSTRAINT project_nodes_parent_id_project_nodes_id_fk,
  ADD CONSTRAINT project_nodes_project_id_parent_id_fkey FOREIGN KEY (project_id, parent_id)
    REFERENCES public.project_nodes (project_id, id) ON DELETE CASCADE,
  DROP CONSTRAINT project_nodes_canonical_node_id_fkey,
  ADD CONSTRAINT project_nodes_project_id_canonical_node_id_fkey FOREIGN KEY (project_id, canonical_node_id)
    REFERENCES public.project_nodes (project_id, id) ON DELETE SET NULL (canonical_node_id),
  DROP CONSTRAINT project_nodes_task_id_fkey,
  ADD CONSTRAINT project_nodes_project_id_task_id_fkey FOREIGN KEY (project_id, task_id)
    REFERENCES public.tasks (project_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.tasks
  DROP CONSTRAINT tasks_sprint_id_project_sprints_id_fk,
  ADD CONSTRAINT tasks_project_id_sprint_id_fkey FOREIGN KEY (project_id, sprint_id)
    REFERENCES public.project_sprints (project_id, id) ON DELETE SET NULL (sprint_id),
  DROP CONSTRAINT tasks_timeline_origin_sprint_id_fkey,
  ADD CONSTRAINT tasks_project_id_timeline_origin_sprint_id_fkey FOREIGN KEY (project_id, timeline_origin_sprint_id)
    REFERENCES public.project_sprints (project_id, id) ON DELETE SET NULL (timeline_origin_sprint_id),
  DROP CONSTRAINT tasks_workflow_column_id_fkey,
  ADD CONSTRAINT tasks_project_id_workflow_column_id_fkey FOREIGN KEY (project_id, workflow_column_id)
    REFERENCES public.project_workflow_columns (project_id, id) ON DELETE SET NULL (workflow_column_id);
--> statement-breakpoint
ALTER TABLE public.project_docs
  DROP CONSTRAINT project_readmes_linked_node_id_fkey,
  ADD CONSTRAINT project_docs_project_id_linked_node_id_fkey FOREIGN KEY (project_id, linked_node_id)
    REFERENCES public.project_nodes (project_id, id) ON DELETE SET NULL (linked_node_id),
  DROP CONSTRAINT project_markdowns_published_version_id_project_markdown_version,
  ADD CONSTRAINT project_docs_id_published_version_id_fkey FOREIGN KEY (id, published_version_id)
    REFERENCES public.project_doc_versions (markdown_id, id) ON DELETE SET NULL (published_version_id);
--> statement-breakpoint
ALTER TABLE public.project_doc_versions
  DROP CONSTRAINT project_markdown_versions_markdown_id_project_markdowns_id_fk,
  ADD CONSTRAINT project_doc_versions_project_id_markdown_id_fkey FOREIGN KEY (project_id, markdown_id)
    REFERENCES public.project_docs (project_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.project_update_comments
  DROP CONSTRAINT project_update_comments_update_id_fkey,
  ADD CONSTRAINT project_update_comments_project_id_update_id_fkey FOREIGN KEY (project_id, update_id)
    REFERENCES public.project_updates (project_id, id) ON DELETE CASCADE,
  DROP CONSTRAINT project_update_comments_parent_id_project_update_comments_id_fk,
  ADD CONSTRAINT project_update_comments_update_id_parent_id_fkey FOREIGN KEY (update_id, parent_id)
    REFERENCES public.project_update_comments (update_id, id) ON DELETE SET NULL (parent_id);
--> statement-breakpoint
ALTER TABLE public.project_node_events
  DROP CONSTRAINT project_node_events_node_id_fkey,
  ADD CONSTRAINT project_node_events_project_id_node_id_fkey FOREIGN KEY (project_id, node_id)
    REFERENCES public.project_nodes (project_id, id) ON DELETE SET NULL (node_id);
--> statement-breakpoint
-- task_node_links has no project column: a narrow trigger keeps task and node in one project.
CREATE OR REPLACE FUNCTION app_private.nb_task_node_link_same_project()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks t JOIN public.project_nodes n ON n.project_id = t.project_id
    WHERE t.id = NEW.task_id AND n.id = NEW.node_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'task_node_links: task and node belong to different projects';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER task_node_links_before_write_same_project_trigger
  BEFORE INSERT OR UPDATE OF task_id, node_id ON public.task_node_links
  FOR EACH ROW EXECUTE FUNCTION app_private.nb_task_node_link_same_project();
