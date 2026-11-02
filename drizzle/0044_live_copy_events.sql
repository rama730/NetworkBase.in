-- Report §42.13 problem 30 and decision 145: an organization's assignment copies no longer announce themselves on the
-- organization's board topic, which every member can hear. Their people get the event on their own user topic, and
-- the copy's own live:task: topic still follows the task's read rule. Main assignments and other tasks are unchanged.
CREATE OR REPLACE FUNCTION app_private.live_task_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  v_workspace uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
  v_copy boolean := (CASE WHEN TG_OP = 'DELETE' THEN OLD.assignment_id ELSE NEW.assignment_id END) IS NOT NULL;
  v_payload jsonb := jsonb_build_object('op', TG_OP, 'id', v_id);
  v_person uuid;
BEGIN
  IF v_copy AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = v_workspace AND w.kind = 'organization') THEN
    -- Old and new holders both hear it, so a reassigned copy leaves one board and reaches the other.
    FOR v_person IN
      SELECT DISTINCT person FROM (
        SELECT CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.assignee_id END AS person
        UNION ALL SELECT CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.assignee_id END
        UNION ALL SELECT tm.user_id FROM public.task_team_members tm WHERE tm.task_id = v_id
      ) people WHERE person IS NOT NULL
    LOOP
      PERFORM app_private.live_send('chat:user:' || v_person::text, 'task.changed', v_payload || jsonb_build_object('workspace_id', v_workspace));
    END LOOP;
  ELSE
    PERFORM app_private.live_send('live:tasks:' || v_workspace::text, 'task.changed', v_payload);
  END IF;
  PERFORM app_private.live_send('live:task:' || v_id::text, 'task.changed', v_payload);
  RETURN NULL;
END
$$;
