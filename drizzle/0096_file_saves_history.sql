-- Report Part H, phase H-1 (M8): with the workspace's "Branches" setting on, every change to main's files is a save.
-- The database records them (docs/superpowers/plans/2026-11-17-m8-h1-saves.md, decision 1): statement triggers on
-- workspace_nodes add the changed files to the transaction's save, and a deferred trigger finishes it at commit.
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS branches_enabled boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE public.branches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    is_default boolean NOT NULL DEFAULT false,
    head_save_id uuid,
    base_save_id uuid,
    source_branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
    merged_from_target_save_id uuid,
    task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'deleted')),
    deleted_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX branches_name_uq ON public.branches (workspace_id, lower(name)) WHERE status <> 'deleted';
--> statement-breakpoint
CREATE UNIQUE INDEX branches_default_uq ON public.branches (workspace_id) WHERE is_default;
--> statement-breakpoint
CREATE TABLE public.saves (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    seq bigint,
    parent_save_id uuid REFERENCES public.saves(id) ON DELETE SET NULL,
    second_parent_save_id uuid REFERENCES public.saves(id) ON DELETE SET NULL,
    kind text NOT NULL DEFAULT 'save' CHECK (kind IN ('start', 'save', 'merge', 'squash', 'revert', 'sync', 'restore')),
    message text,
    author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    via text CHECK (via IN ('cli', 'agent')),
    agent_name text,
    task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
    change_set_id uuid REFERENCES public.change_sets(id) ON DELETE SET NULL,
    reverts_save_id uuid REFERENCES public.saves(id) ON DELETE SET NULL,
    files_added integer NOT NULL DEFAULT 0,
    files_changed integer NOT NULL DEFAULT 0,
    files_deleted integer NOT NULL DEFAULT 0,
    files_renamed integer NOT NULL DEFAULT 0,
    txid bigint,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX saves_tx_uq ON public.saves (workspace_id, txid) WHERE txid IS NOT NULL;
--> statement-breakpoint
CREATE INDEX saves_branch_seq_idx ON public.saves (branch_id, seq DESC);
--> statement-breakpoint
CREATE INDEX saves_change_set_idx ON public.saves (change_set_id) WHERE change_set_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.branches ADD CONSTRAINT branches_head_save_fk FOREIGN KEY (head_save_id) REFERENCES public.saves(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE public.branches ADD CONSTRAINT branches_base_save_fk FOREIGN KEY (base_save_id) REFERENCES public.saves(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE public.branches ADD CONSTRAINT branches_merged_from_fk FOREIGN KEY (merged_from_target_save_id) REFERENCES public.saves(id) ON DELETE SET NULL;
--> statement-breakpoint
-- One row per file a save touched. On main: the node and its version before and after (content lives in
-- file_versions). On other branches (H-2): the content itself. A path missing before is an add, missing after a delete.
CREATE TABLE public.save_changes (
    id bigserial PRIMARY KEY,
    save_id uuid NOT NULL REFERENCES public.saves(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    node_id uuid,
    before_path text,
    after_path text,
    previous_version integer,
    version integer,
    content_hash text,
    asset_id uuid,
    size bigint,
    mime_type text,
    path text GENERATED ALWAYS AS (coalesce(after_path, before_path)) STORED,
    op text GENERATED ALWAYS AS (CASE
        WHEN before_path IS NULL AND after_path IS NOT NULL THEN 'add'
        WHEN before_path IS NOT NULL AND after_path IS NULL THEN 'delete'
        WHEN before_path IS NULL THEN 'none'
        WHEN before_path <> after_path THEN 'rename'
        WHEN version IS DISTINCT FROM previous_version THEN 'change'
        ELSE 'none' END) STORED
);
--> statement-breakpoint
CREATE UNIQUE INDEX save_changes_node_uq ON public.save_changes (save_id, node_id) WHERE node_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX save_changes_save_idx ON public.save_changes (save_id);
--> statement-breakpoint
CREATE INDEX save_changes_path_idx ON public.save_changes (workspace_id, path);
--> statement-breakpoint
CREATE INDEX save_changes_node_version_idx ON public.save_changes (node_id, version) WHERE node_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.tree_checkpoints (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    save_id uuid NOT NULL UNIQUE REFERENCES public.saves(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE public.checkpoint_files (
    checkpoint_id uuid NOT NULL REFERENCES public.tree_checkpoints(id) ON DELETE CASCADE,
    path text NOT NULL,
    node_id uuid,
    version integer,
    content_hash text,
    asset_id uuid,
    size bigint,
    mime_type text,
    PRIMARY KEY (checkpoint_id, path)
);
--> statement-breakpoint
ALTER TABLE public.change_sets ADD COLUMN IF NOT EXISTS reverts_save_id uuid REFERENCES public.saves(id) ON DELETE SET NULL;
--> statement-breakpoint
-- A file counts when it's a project file: not a folder, not a task file, not under /.system.
CREATE TYPE app_private.save_change_row AS (workspace_id uuid, node_id uuid, before_path text, after_path text, prev integer, ver integer);
--> statement-breakpoint
CREATE FUNCTION app_private.save_capture(p_rows app_private.save_change_row[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid;
  v_branch uuid;
BEGIN
  IF p_rows IS NULL OR pg_catalog.cardinality(p_rows) = 0 THEN RETURN; END IF;
  FOR v_ws IN SELECT DISTINCT r.workspace_id FROM pg_catalog.unnest(p_rows) r LOOP
    IF EXISTS (SELECT 1 FROM public.saves s WHERE s.workspace_id = v_ws AND s.txid = pg_catalog.txid_current()) THEN CONTINUE; END IF;
    SELECT b.id INTO v_branch FROM public.branches b WHERE b.workspace_id = v_ws AND b.is_default;
    IF v_branch IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.saves (workspace_id, branch_id, txid) VALUES (v_ws, v_branch, pg_catalog.txid_current());
  END LOOP;
  INSERT INTO public.save_changes AS sc (save_id, workspace_id, node_id, before_path, after_path, previous_version, version)
  SELECT s.id, r.workspace_id, r.node_id, r.before_path, r.after_path, r.prev, r.ver
  FROM pg_catalog.unnest(p_rows) r
  JOIN public.saves s ON s.workspace_id = r.workspace_id AND s.txid = pg_catalog.txid_current()
  ON CONFLICT (save_id, node_id) WHERE node_id IS NOT NULL
  DO UPDATE SET after_path = EXCLUDED.after_path, version = EXCLUDED.version;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.save_nodes_inserted() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.save_capture(ARRAY(
    SELECT ROW(n.workspace_id, n.id, NULL, n.path, NULL, n.current_version)::app_private.save_change_row
    FROM new_rows n JOIN public.workspaces w ON w.id = n.workspace_id AND w.branches_enabled
    WHERE n.type = 'file' AND n.deleted_at IS NULL AND n.task_id IS NULL AND n.path NOT LIKE '/.system/%'));
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.save_nodes_updated() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.save_capture(ARRAY(
    SELECT ROW(n.workspace_id, n.id,
      CASE WHEN o.deleted_at IS NULL AND o.task_id IS NULL AND o.path NOT LIKE '/.system/%' THEN o.path END,
      CASE WHEN n.deleted_at IS NULL AND n.task_id IS NULL AND n.path NOT LIKE '/.system/%' THEN n.path END,
      o.current_version, n.current_version)::app_private.save_change_row
    FROM new_rows n JOIN old_rows o ON o.id = n.id JOIN public.workspaces w ON w.id = n.workspace_id AND w.branches_enabled
    WHERE n.type = 'file' AND (o.path IS DISTINCT FROM n.path OR o.current_version IS DISTINCT FROM n.current_version
      OR (o.deleted_at IS NULL) <> (n.deleted_at IS NULL) OR (o.task_id IS NULL) <> (n.task_id IS NULL))));
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.save_nodes_deleted() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.save_capture(ARRAY(
    SELECT ROW(o.workspace_id, o.id, o.path, NULL, o.current_version, NULL)::app_private.save_change_row
    FROM old_rows o JOIN public.workspaces w ON w.id = o.workspace_id AND w.branches_enabled
    WHERE o.type = 'file' AND o.deleted_at IS NULL AND o.task_id IS NULL AND o.path NOT LIKE '/.system/%'));
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER workspace_nodes_save_inserted AFTER INSERT ON public.workspace_nodes
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION app_private.save_nodes_inserted();
--> statement-breakpoint
CREATE TRIGGER workspace_nodes_save_updated AFTER UPDATE ON public.workspace_nodes
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION app_private.save_nodes_updated();
--> statement-breakpoint
CREATE TRIGGER workspace_nodes_save_deleted AFTER DELETE ON public.workspace_nodes
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION app_private.save_nodes_deleted();
--> statement-breakpoint
-- Main's files as they are now, as of save p_save (start of history, then every 100 saves).
CREATE FUNCTION app_private.save_checkpoint(p_save uuid, p_workspace uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_cp uuid;
BEGIN
  INSERT INTO public.tree_checkpoints (save_id, workspace_id) VALUES (p_save, p_workspace)
  ON CONFLICT (save_id) DO NOTHING RETURNING id INTO v_cp;
  IF v_cp IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.checkpoint_files (checkpoint_id, path, node_id, version)
  SELECT v_cp, n.path, n.id, n.current_version FROM public.workspace_nodes n
  WHERE n.workspace_id = p_workspace AND n.type = 'file' AND n.deleted_at IS NULL AND n.task_id IS NULL AND n.path NOT LIKE '/.system/%'
  ON CONFLICT (checkpoint_id, path) DO NOTHING;
  RETURN v_cp;
END
$$;
--> statement-breakpoint
-- At commit: drop a save that changed nothing; otherwise order it after main's head (under the branch row lock, so
-- writers to the same file are recorded in commit order), fill what the writer didn't say, and move the head.
CREATE FUNCTION app_private.save_finish() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s public.saves%ROWTYPE;
  v_ctx jsonb := nullif(current_setting('nb.save', true), '')::jsonb;
  v_parent uuid;
  v_seq bigint;
  v_add integer; v_chg integer; v_del integer; v_ren integer;
  v_one record;
  v_cs record;
  v_message text;
BEGIN
  SELECT * INTO s FROM public.saves WHERE id = NEW.id;
  IF NOT FOUND OR s.seq IS NOT NULL THEN RETURN NULL; END IF;
  DELETE FROM public.save_changes WHERE save_id = s.id AND op = 'none';
  SELECT count(*) FILTER (WHERE op = 'add'), count(*) FILTER (WHERE op = 'change'), count(*) FILTER (WHERE op = 'delete'), count(*) FILTER (WHERE op = 'rename')
    INTO v_add, v_chg, v_del, v_ren FROM public.save_changes WHERE save_id = s.id;
  IF v_add + v_chg + v_del + v_ren = 0 THEN
    DELETE FROM public.saves WHERE id = s.id;
    RETURN NULL;
  END IF;
  SELECT b.head_save_id INTO v_parent FROM public.branches b WHERE b.id = s.branch_id FOR UPDATE;
  SELECT coalesce((SELECT p.seq FROM public.saves p WHERE p.id = v_parent), 0) + 1 INTO v_seq;
  -- What the versions say (author, agent, change set, the editor's note) when the writer said nothing.
  SELECT c.op, c.path, c.before_path, c.previous_version, fv.uploaded_by, fv.via, fv.agent_name, fv.change_set_id, fv.comment, n.created_by, n.deleted_by
    INTO v_one
    FROM public.save_changes c
    LEFT JOIN public.file_versions fv ON fv.node_id = c.node_id AND fv.version = c.version
    LEFT JOIN public.workspace_nodes n ON n.id = c.node_id
    WHERE c.save_id = s.id ORDER BY (fv.uploaded_by IS NULL), c.id LIMIT 1;
  SELECT cs.id, cs.title, cs.task_id INTO v_cs FROM public.change_sets cs
    WHERE cs.id = coalesce((v_ctx->>'changeSetId')::uuid, v_one.change_set_id);
  v_message := coalesce(v_ctx->>'message', v_cs.title,
    CASE WHEN v_add + v_chg + v_del + v_ren = 1 THEN coalesce(CASE WHEN v_one.op = 'change' OR (v_one.op = 'add' AND v_one.previous_version IS NULL) THEN nullif(v_one.comment, '') END,
      CASE v_one.op
        WHEN 'add' THEN CASE WHEN v_one.previous_version IS NULL THEN 'Added ' ELSE 'Restored ' END || regexp_replace(v_one.path, '^.*/', '')
        WHEN 'delete' THEN 'Deleted ' || regexp_replace(v_one.path, '^.*/', '')
        WHEN 'rename' THEN CASE WHEN regexp_replace(v_one.before_path, '^.*/', '') = regexp_replace(v_one.path, '^.*/', '')
          THEN 'Moved ' || regexp_replace(v_one.path, '^.*/', '') || ' to ' || coalesce(nullif(regexp_replace(v_one.path, '/[^/]*$', ''), ''), '/')
          ELSE 'Renamed ' || regexp_replace(v_one.before_path, '^.*/', '') || ' to ' || regexp_replace(v_one.path, '^.*/', '') END
        ELSE 'Changed ' || regexp_replace(v_one.path, '^.*/', '') END)
    WHEN v_add > 0 AND v_chg + v_del + v_ren = 0 THEN 'Added ' || v_add || ' files'
    WHEN v_del > 0 AND v_add + v_chg + v_ren = 0 THEN 'Deleted ' || v_del || ' files'
    WHEN v_ren > 0 AND v_add + v_chg + v_del = 0 THEN 'Moved ' || v_ren || ' files'
    ELSE 'Changed ' || (v_add + v_chg + v_del + v_ren) || ' files' END);
  UPDATE public.saves SET
    seq = v_seq,
    parent_save_id = v_parent,
    kind = coalesce(v_ctx->>'kind', s.kind),
    message = left(v_message, 2000),
    author_id = coalesce((v_ctx->>'authorId')::uuid, CASE WHEN v_one.op = 'delete' THEN v_one.deleted_by END, v_one.uploaded_by, v_one.deleted_by, v_one.created_by),
    via = coalesce(v_ctx->>'via', v_one.via),
    agent_name = coalesce(v_ctx->>'agentName', v_one.agent_name),
    task_id = coalesce((v_ctx->>'taskId')::uuid, v_cs.task_id),
    change_set_id = v_cs.id,
    reverts_save_id = (v_ctx->>'revertsSaveId')::uuid,
    files_added = v_add, files_changed = v_chg, files_deleted = v_del, files_renamed = v_ren
  WHERE id = s.id;
  UPDATE public.branches SET head_save_id = s.id, updated_at = now() WHERE id = s.branch_id;
  IF v_seq % 100 = 0 THEN PERFORM app_private.save_checkpoint(s.id, s.workspace_id); END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER saves_finish AFTER INSERT ON public.saves DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.txid IS NOT NULL) EXECUTE FUNCTION app_private.save_finish();
--> statement-breakpoint
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.saves ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.save_changes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.tree_checkpoints ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.checkpoint_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.branches, public.saves, public.save_changes, public.tree_checkpoints, public.checkpoint_files FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.branches, public.saves, public.save_changes, public.tree_checkpoints, public.checkpoint_files TO nb_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE public.save_changes_id_seq TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.branches, public.saves, public.save_changes, public.tree_checkpoints, public.checkpoint_files TO service_role;
--> statement-breakpoint
GRANT ALL ON SEQUENCE public.save_changes_id_seq TO service_role;
