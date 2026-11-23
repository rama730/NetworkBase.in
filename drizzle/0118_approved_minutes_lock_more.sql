-- Workflow tabs A4.9, security review of 0117: approved minutes also keep their document (no unlinking, no pointing it
-- at another file, no removing the approval) and their file (no trashing, no deleting). Deleting a whole workspace
-- still cascades: when the workspace row is already gone, the guards step aside.

CREATE FUNCTION app_private.approved_minutes_doc_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT (OLD.settings ? 'approvedAt') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = OLD.workspace_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'MINUTES_APPROVED: approved minutes stay in Documents' USING ERRCODE = 'P0001', HINT = 'minutes_approved';
  END IF;
  IF NEW.linked_node_id IS DISTINCT FROM OLD.linked_node_id OR NOT (NEW.settings ? 'approvedAt') THEN
    RAISE EXCEPTION 'MINUTES_APPROVED: approved minutes keep their file and their approval' USING ERRCODE = 'P0001', HINT = 'minutes_approved';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.approved_minutes_doc_guard() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER workspace_documents_approved_minutes BEFORE UPDATE OR DELETE ON public.workspace_documents
  FOR EACH ROW EXECUTE FUNCTION app_private.approved_minutes_doc_guard();
--> statement-breakpoint
CREATE FUNCTION app_private.approved_minutes_file_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = OLD.workspace_id) THEN RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM public.workspace_documents d WHERE d.linked_node_id = OLD.id AND d.settings ? 'approvedAt') THEN
    RAISE EXCEPTION 'MINUTES_APPROVED: approved minutes can''t be trashed or deleted' USING ERRCODE = 'P0001', HINT = 'minutes_approved';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.approved_minutes_file_guard() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER workspace_nodes_approved_minutes_delete BEFORE DELETE ON public.workspace_nodes
  FOR EACH ROW EXECUTE FUNCTION app_private.approved_minutes_file_guard();
--> statement-breakpoint
CREATE TRIGGER workspace_nodes_approved_minutes_trash BEFORE UPDATE OF deleted_at ON public.workspace_nodes
  FOR EACH ROW WHEN (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) EXECUTE FUNCTION app_private.approved_minutes_file_guard();
