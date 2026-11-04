-- Board/review report §6 (4 Nov 2026): an organization's main sprint (a CO) and one sprint inside it run at the same
-- time. "One active sprint per workspace" becomes one per level: `nested` marks a sprint whose parent is a sprint in
-- the same workspace (a sprint inside a CO). A team workspace's sprint inside its organization's sprint isn't nested
-- here (its parent lives in another workspace), so a team still runs one sprint at a time.
ALTER TABLE public.workspace_sprints ADD COLUMN nested boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE FUNCTION app_private.nb_sprint_nested() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  NEW.nested := NEW.parent_sprint_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workspace_sprints p WHERE p.id = NEW.parent_sprint_id AND p.workspace_id = NEW.workspace_id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workspace_sprints_nested BEFORE INSERT OR UPDATE OF parent_sprint_id, workspace_id ON public.workspace_sprints
    FOR EACH ROW EXECUTE FUNCTION app_private.nb_sprint_nested();
--> statement-breakpoint
UPDATE public.workspace_sprints s SET nested = true
  WHERE s.parent_sprint_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.workspace_sprints p WHERE p.id = s.parent_sprint_id AND p.workspace_id = s.workspace_id);
--> statement-breakpoint
DROP INDEX public.workspace_sprints_one_active_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_sprints_one_active_idx ON public.workspace_sprints USING btree (workspace_id, nested) WHERE (status = 'active'::public.status_sprint);
