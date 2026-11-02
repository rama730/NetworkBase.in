-- Report §42.15 problem 48 and decision 156: in a read-only (archived, suspended or deleting) workspace, posts and
-- comments can't be edited, pinned, re-audienced or have their reply setting changed, not only not created. Only the
-- columns people change: counters the system keeps (likes, comment counts) still move during account deletion.
CREATE TRIGGER workspace_updates_read_only_edit_guard
    BEFORE UPDATE OF content, update_type, visibility, reply_policy, entity_refs, media, is_pinned, audience, pinned_until, shared_to_org_at
    ON public.workspace_updates FOR EACH ROW EXECUTE FUNCTION app_private.nb_workspace_read_only_guard();
--> statement-breakpoint
CREATE TRIGGER workspace_update_comments_read_only_edit_guard
    BEFORE UPDATE OF content ON public.workspace_update_comments FOR EACH ROW EXECUTE FUNCTION app_private.nb_workspace_read_only_guard();
