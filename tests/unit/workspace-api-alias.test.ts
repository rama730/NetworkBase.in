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
