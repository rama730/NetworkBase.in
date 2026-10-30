import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

test("file lease migration adds session identity, fencing, realtime, and RLS hardening", () => {
  const migration = read("drizzle/0009_files.sql");
  assert.match(migration, /CREATE SEQUENCE public\.workspace_node_lock_fencing_seq/);
  assert.match(migration, /session_id uuid NOT NULL/);
  assert.match(migration, /lease_id uuid DEFAULT gen_random_uuid\(\) NOT NULL/);
  assert.match(migration, /fencing_token bigint DEFAULT nextval\('public\.workspace_node_lock_fencing_seq'::regclass\) NOT NULL/);
  assert.match(migration, /ALTER TABLE ONLY public\.workspace_node_locks REPLICA IDENTITY FULL/);
  assert.doesNotMatch(migration, /CREATE POLICY workspace_node_locks_write/);
  assert.doesNotMatch(migration, /GRANT [^;]*\b(INSERT|UPDATE|DELETE|ALL)\b[^;]* ON TABLE public\.workspace_node_locks TO (anon|authenticated)/);
});

test("canonical service performs atomic session-scoped acquisition and fenced writes", () => {
  const service = read("src/lib/files/file-lock-service.ts");
  assert.match(service, /ON CONFLICT \(node_id\) DO UPDATE/);
  assert.match(service, /locked_by = EXCLUDED\.locked_by[\s\S]*session_id = EXCLUDED\.session_id/);
  assert.match(service, /nextval\('workspace_node_lock_fencing_seq'\)/);
  assert.match(service, /lease_id = \$\{input\.credentials\.leaseId\}/);
  assert.match(service, /fencing_token = \$\{input\.credentials\.fencingToken\}/);
  assert.match(service, /FOR UPDATE/);
});

test("browser edit mode waits for a lease and preserves a dirty buffer after lease loss", () => {
  const view = read("src/components/workspaces/v2/files-tab/file/FileView.tsx");
  const editor = read("src/components/workspaces/v2/files-tab/file/TextViewer.tsx");
  const hook = read("src/components/workspaces/v2/files-tab/hooks/useFileLease.ts");
  assert.match(view, /fileLease\.acquire\(\)[\s\S]*setMode\("edit"\)/);
  assert.match(editor, /leaseStatus === "lost"/);
  assert.match(editor, /unsaved buffer is preserved/);
  assert.match(editor, /beforeunload/);
  assert.match(hook, /renewBrowserFileLease/);
  assert.match(hook, /releaseBrowserFileLease\(current, \{ keepalive: true \}\)/);
});

test("project realtime subscription reconciles canonical lease snapshots", () => {
  const sql = read("drizzle/0034_live_row_events.sql");
  const rootView = read("src/components/workspaces/v2/files-tab/FilesTabRoot.tsx");
  const store = read("src/stores/files/editorSlice.ts");
  assert.match(sql, /'live:files:' \|\| v_workspace::text, 'lock\.changed'/);
  assert.match(sql, /live_file_lock_event AFTER INSERT OR UPDATE OR DELETE ON public\.workspace_node_locks/);
  assert.match(rootView, /fetchWorkspaceFileLeases/);
  assert.match(rootView, /event === "lock\.changed"\) reconcileLocks\(\)/);
  assert.match(store, /const nextLocks: Record<string, SoftLock> = \{\}/);
});

// The extension is a sibling repo; CI checks out only nb-s3, so this runs locally.
const extensionRoot = path.resolve(root, "../workspace-extensions/nb-vscode-sync");
test("the current extension uses single-flight activation sessions and lease credentials for every publish path", { skip: !fs.existsSync(extensionRoot) && "sibling repo ../workspace-extensions not checked out" }, () => {
  const extension = fs.readFileSync(path.join(extensionRoot, "src/extension.ts"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"));
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
  assert.match(
    extension,
    /_pendingLeases = new Map<string, Promise<ExtensionFileLease>>\(\)/,
  );
  assert.match(extension, /let request = this\._pendingLeases\.get\(key\)/);
  assert.match(extension, /await pendingAcquisition/);
  assert.match(extension, /_clientSessionId = crypto\.randomUUID\(\)/);
  assert.match(extension, /action: 'renew'/);
  assert.match(extension, /'X-NB-Lease-Id': lease\.leaseId/);
  assert.match(extension, /'X-NB-Fencing-Token': String\(lease\.fencingToken\)/);
  assert.match(extension, /await this\.acquireLock\(uri, true[,\)]/);
  assert.match(extension, /releaseAllLocks/);
  assert.match(extension, /(vscode\.FilePermission\.Readonly|permissions:\s*undefined)/);
});

test("background writers defer instead of overwriting active editors", () => {
  const gitSync = read("src/inngest/functions/git-sync.ts");
  const sandboxMerge = read("src/lib/workspaces/merge-sandbox.ts");
  assert.match(gitSync, /Repository sync waits because a member is editing a file/);
  assert.match(sandboxMerge, /The task waits because a member is editing one of its files/);
  assert.doesNotMatch(sandboxMerge, /DELETE FROM workspace_node_locks/);
});
