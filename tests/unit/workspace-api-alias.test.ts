import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// Decision 5: the published VS Code extension and links already sent still call the old /api/v1 addresses.
// Each old route must serve exactly the handlers (and segment config) of its new route.
const PAIRS: Array<[string, string]> = [
  ['src/app/api/v1/projects', 'src/app/api/v1/workspaces'],
  ['src/app/api/v1/discover/projects', 'src/app/api/v1/discover/workspaces'],
  ['src/app/api/v1/profiles/[id]/projects', 'src/app/api/v1/profiles/[id]/workspaces'],
  ['src/app/api/v1/profiles/[id]/project-invites', 'src/app/api/v1/profiles/[id]/workspace-invites'],
  ['src/app/api/v1/profiles/[id]/project-invite-options', 'src/app/api/v1/profiles/[id]/workspace-invite-options'],
  ['src/app/api/v1/extension/project-summary', 'src/app/api/v1/extension/workspace-summary'],
  ['src/app/api/v1/extension/project-tasks', 'src/app/api/v1/extension/workspace-tasks'],
];
// Routes made after the rename have no old callers, so they get no old address (and none may add "project").
const BORN_AFTER_RENAME = new Set([
  'src/app/api/v1/workspaces/[id]/view/route.ts',
  // CLI 2.0 and agent routes (report A2.5), 2026-11-09.
  'src/app/api/v1/workspaces/[id]/manifest/route.ts',
  'src/app/api/v1/workspaces/[id]/docs/route.ts',
  'src/app/api/v1/workspaces/[id]/docs/[slug]/route.ts',
  // CLI 2.0 workspace view, activity, sprints and updates (report A2.5, A8.7), 2026-11-09.
  'src/app/api/v1/workspaces/[id]/route.ts',
  'src/app/api/v1/workspaces/[id]/activity/route.ts',
  'src/app/api/v1/workspaces/[id]/sprints/route.ts',
  'src/app/api/v1/workspaces/[id]/updates/route.ts',
  // Starred and recent files for the CLI (report C3, 0087), 2026-11-12.
  'src/app/api/v1/workspaces/[id]/files/[nodeId]/star/route.ts',
  'src/app/api/v1/workspaces/[id]/files/mine/route.ts',
  'src/app/api/v1/workspaces/[id]/files/trash/route.ts',
  'src/app/api/v1/workspaces/[id]/updates/[updateId]/route.ts',
  'src/app/api/v1/workspaces/[id]/search/route.ts',
  // History and the Branches setting (report Part H, H-1), 2026-11-17.
  'src/app/api/v1/workspaces/[id]/saves/route.ts',
  'src/app/api/v1/workspaces/[id]/branches-setting/route.ts',
  // Branches (report Part H, H-2), 2026-11-17.
  'src/app/api/v1/workspaces/[id]/branches/route.ts',
  // Merge requests (report Part H, H-3), 2026-11-17.
  'src/app/api/v1/workspaces/[id]/merge-requests/route.ts',
  'src/app/api/v1/workspaces/[id]/merge-requests/[n]/route.ts',
  'src/app/api/v1/workspaces/[id]/merge-requests/[n]/[op]/route.ts',
  // Main's protection (report Part H, H-4), 2026-11-17.
  'src/app/api/v1/workspaces/[id]/protection/route.ts',
  // Sprints from the CLI (report F2, M7), 2026-11-17.
  'src/app/api/v1/workspaces/[id]/sprints/[sprintId]/[op]/route.ts',
  // Workspace admin from the CLI (report F3, M7), 2026-11-17.
  'src/app/api/v1/workspaces/[id]/settings/route.ts',
  'src/app/api/v1/workspaces/[id]/archive/route.ts',
  'src/app/api/v1/workspaces/[id]/export/route.ts',
  // Live document rows (workflow tabs A0.5), 2026-11-19.
  'src/app/api/v1/workspaces/[id]/docs/[slug]/rows/route.ts',
  // Workflows, read-only (workflow tabs A0.10), 2026-11-19.
  'src/app/api/v1/workspaces/[id]/workflows/route.ts',
  // Requests with their clocks, read-only (workflow tabs A2.6), 2026-11-23.
  'src/app/api/v1/workspaces/[id]/requests/route.ts',
  // Content pieces and channels, read-only (workflow tabs A2.9), 2026-11-23.
  'src/app/api/v1/workspaces/[id]/content/route.ts',
  // Roadmap items, read-only (workflow tabs A2.10), 2026-11-23.
  'src/app/api/v1/workspaces/[id]/roadmap/route.ts',
  // Launches, read-only (workflow tabs A3.1), 2026-11-23.
  'src/app/api/v1/workspaces/[id]/launches/route.ts',
  // Meetings and decisions, read-only (workflow tabs A4.1b), 2026-11-23.
  'src/app/api/v1/workspaces/[id]/meetings/route.ts',
  'src/app/api/v1/workspaces/[id]/decisions/route.ts',
]);
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const routes = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const p = path.join(dir, name);
  return statSync(p).isDirectory() ? routes(p) : name === 'route.ts' ? [p] : [];
});
const exported = (src: string) => METHODS.filter((m) => new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${m}\\b`).test(src));
const config = (src: string) => src.split('\n').filter((l) => /^export const (runtime|dynamic|maxDuration|revalidate)\s*=/.test(l)).sort();

test('every old API address re-exports the same handlers as its new address', () => {
  let checked = 0;
  for (const [oldDir, newDir] of PAIRS) {
    for (const newFile of routes(newDir)) {
      if (BORN_AFTER_RENAME.has(newFile)) {
        assert.ok(!existsSync(path.join(oldDir, path.relative(newDir, newFile))), `${newFile} is new; it needs no old address`);
        continue;
      }
      const oldFile = path.join(oldDir, path.relative(newDir, newFile));
      assert.ok(existsSync(oldFile), `missing alias ${oldFile}`);
      const oldSrc = readFileSync(oldFile, 'utf8');
      const newSrc = readFileSync(newFile, 'utf8');
      const spec = `@/${path.relative('src', newFile).replace(/\.ts$/, '')}`;
      const reexport = oldSrc.match(/export \{ ([^}]+) \} from "([^"]+)";/);
      assert.ok(reexport, `${oldFile} must re-export the new route`);
      assert.equal(reexport![2], spec, oldFile);
      assert.deepEqual(reexport![1]!.split(',').map((s) => s.trim()).sort(), exported(newSrc).sort(), oldFile);
      assert.deepEqual(config(oldSrc), config(newSrc), `${oldFile} segment config`);
      checked++;
    }
  }
  assert.ok(checked >= 16, `checked ${checked} aliases`);
});
