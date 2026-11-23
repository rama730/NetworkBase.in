-- Workflow tabs A4.9 (report 38.11 W6), live check: approved board minutes refuse every edit. Every write path (the app,
-- the editor extension, `nb push`'s fast path, change sets, branch merges, GitHub sync, restoring a version) lands in
-- file_versions or moves workspace_nodes.current_version, so the lock lives here rather than in each path.

CREATE FUNCTION app_private.approved_minutes_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_node uuid;
BEGIN
  IF TG_TABLE_NAME = 'file_versions' THEN v_node := NEW.node_id; ELSE v_node := NEW.id; END IF;
  IF EXISTS (SELECT 1 FROM public.workspace_documents d WHERE d.linked_node_id = v_node AND d.settings ? 'approvedAt') THEN
    RAISE EXCEPTION 'MINUTES_APPROVED: these minutes are approved and can''t be edited' USING ERRCODE = 'P0001', HINT = 'minutes_approved';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.approved_minutes_guard() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER file_versions_approved_minutes BEFORE INSERT ON public.file_versions
  FOR EACH ROW EXECUTE FUNCTION app_private.approved_minutes_guard();
--> statement-breakpoint
CREATE TRIGGER workspace_nodes_approved_minutes BEFORE UPDATE OF current_version ON public.workspace_nodes
  FOR EACH ROW WHEN (NEW.current_version IS DISTINCT FROM OLD.current_version) EXECUTE FUNCTION app_private.approved_minutes_guard();
