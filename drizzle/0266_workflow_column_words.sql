-- 0266: default board columns use the decided task status words (report §16.8, decision 17).
-- New workspaces get "To do / In progress / Blocked / Completed"; existing default columns that still carry the
-- old default title are renamed. Columns people renamed keep their names.
CREATE OR REPLACE FUNCTION public.seed_workspace_workflow_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.workspace_workflow_columns (
    workspace_id, status, title, accent_class_name, empty_title,
    empty_description, position, is_default
  )
  VALUES
    (NEW.id, 'todo', 'To do', 'zinc', 'Tasks will appear here…', 'Tasks that are ready to start will appear here. Drag and drop your tasks here.', 0, TRUE),
    (NEW.id, 'in_progress', 'In progress', 'blue', 'Tasks will appear here…', 'Items will appear here as soon as they start. Drag and drop your tasks here.', 1, TRUE),
    (NEW.id, 'blocked', 'Blocked', 'rose', 'Tasks will appear here…', 'Tasks waiting on blockers will appear here. Drag and drop your tasks here.', 2, TRUE),
    (NEW.id, 'done', 'Completed', 'emerald', 'Tasks will appear here…', 'Finished work will appear here. Drag and drop your tasks here.', 3, TRUE)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
UPDATE public.workspace_workflow_columns SET title = CASE title
    WHEN 'To Do' THEN 'To do' WHEN 'In Progress' THEN 'In progress' WHEN 'Issues' THEN 'Blocked' WHEN 'Done' THEN 'Completed' END
WHERE is_default AND (status, title) IN (('todo', 'To Do'), ('in_progress', 'In Progress'), ('blocked', 'Issues'), ('done', 'Done'));
--> statement-breakpoint
UPDATE public.workspace_workflow_columns SET empty_title = 'Tasks will appear here…' WHERE empty_title = 'Tasks will appear here...';
