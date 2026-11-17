-- Report Part H, phase H-4 (M8): protecting main (H5) and agents on branches (H7)
-- (docs/superpowers/plans/2026-11-17-m8-h4-protection-agents.md). One row per protected branch; only main has one in
-- this phase. The guard below is the one place a protected main is enforced: every change to main is already a save
-- (0096), so refusing the save at commit refuses the write, whichever writer made it.
CREATE TABLE public.branch_protection (
    branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
    require_merge_request boolean NOT NULL DEFAULT false,
    approvals smallint NOT NULL DEFAULT 0 CHECK (approvals BETWEEN 0 AND 5),
    reapprove_on_new_saves boolean NOT NULL DEFAULT false,
    required_checks text[] NOT NULL DEFAULT '{}' CHECK (cardinality(required_checks) <= 20),
    merge_by text NOT NULL DEFAULT 'writers' CHECK (merge_by IN ('writers', 'admins')),
    agents_on_branches boolean NOT NULL DEFAULT true,
    allow_github_sync boolean NOT NULL DEFAULT true,
    updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE public.branch_protection ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.branch_protection FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.branch_protection TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.branch_protection TO service_role;
--> statement-breakpoint
-- A merge's apply finds its merge request by the change set it's applying (it records a merge save, which passes).
CREATE INDEX IF NOT EXISTS merge_requests_pending_set_idx ON public.merge_requests (pending_change_set_id) WHERE pending_change_set_id IS NOT NULL;
--> statement-breakpoint
-- Workspaces that already have Branches get the H5 defaults: merge requests required for teams (more than one member
-- who can write), approvals 1 when someone else can give one.
INSERT INTO public.branch_protection (branch_id, require_merge_request, approvals)
SELECT b.id, m.writers > 1, CASE WHEN m.writers > 1 THEN 1 ELSE 0 END
FROM public.branches b
JOIN public.workspaces w ON w.id = b.workspace_id AND w.branches_enabled
CROSS JOIN LATERAL (SELECT count(*) AS writers FROM (
  SELECT wm.user_id FROM public.workspace_members wm WHERE wm.workspace_id = b.workspace_id AND wm.role <> 'viewer'
  UNION SELECT w.owner_id WHERE w.owner_id IS NOT NULL) x) m
WHERE b.is_default
ON CONFLICT (branch_id) DO NOTHING;
--> statement-breakpoint
-- At commit, after the save is filled in: a protected main takes only merges and squashes (and GitHub sync while it's
-- allowed); with agents on branches, nothing an agent made. Either way the whole write rolls back.
CREATE FUNCTION app_private.save_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s public.saves%ROWTYPE;
  p public.branch_protection%ROWTYPE;
  v_ctx jsonb := nullif(current_setting('nb.save', true), '')::jsonb;
  v_kind text;
  v_agent boolean;
BEGIN
  SELECT * INTO s FROM public.saves WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO p FROM public.branch_protection WHERE branch_id = s.branch_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_kind := coalesce(v_ctx->>'kind', s.kind);
  IF v_kind IN ('merge', 'squash', 'start') THEN RETURN NULL; END IF;
  IF p.require_merge_request AND NOT (v_kind = 'sync' AND p.allow_github_sync) THEN
    RAISE EXCEPTION 'BRANCH_PROTECTED: main is protected; save to a branch and open a merge request'
      USING ERRCODE = 'P0001', HINT = 'merge_request';
  END IF;
  IF p.agents_on_branches AND v_kind <> 'sync' THEN
    v_agent := coalesce(v_ctx->>'via', s.via) = 'agent' OR EXISTS (
      SELECT 1 FROM public.save_changes c JOIN public.file_versions fv ON fv.node_id = c.node_id AND fv.version = c.version
      WHERE c.save_id = s.id AND fv.via = 'agent');
    IF v_agent THEN
      RAISE EXCEPTION 'BRANCH_PROTECTED: agents work on a branch here and open a merge request for your review'
        USING ERRCODE = 'P0001', HINT = 'agents';
    END IF;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
-- Named after saves_finish so it runs second and reads the finished save; it reads the context too, so order is safe.
CREATE CONSTRAINT TRIGGER saves_guard AFTER INSERT ON public.saves DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.txid IS NOT NULL) EXECUTE FUNCTION app_private.save_guard();
