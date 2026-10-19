import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import Module from "node:module";

// sync-api is server-only; outside Next's react-server build the marker module is a no-op.
const moduleWithLoad = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = moduleWithLoad._load;
moduleWithLoad._load = (request, parent, isMain) => (request === "server-only" ? {} : originalLoad(request, parent, isMain));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readGitHubTree, SyncGithubError } = require("../../src/lib/github/sync-api") as typeof import("../../src/lib/github/sync-api");

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

type Tree = { truncated: boolean; tree: Array<{ path: string; type: string; sha: string; mode: string }> };
const entry = (path: string, type = "blob") => ({ path, type, sha: `sha-${path}`, mode: "100644" });
function serve(routes: Record<string, Tree | number>) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input).replace("https://api.github.com/repos/o/r/git/trees/", "");
    const route = routes[url];
    if (typeof route === "number") return new Response("{}", { status: route });
    if (!route) return new Response("{}", { status: 404 });
    return Response.json(route);
  }) as typeof fetch;
}
const read = () => readGitHubTree("t", "https://github.com/o/r", "head");

// COR-005: a manifest with gaps would read as remote deletions, so it must fail instead.
test("a complete recursive tree is returned as blobs only", async () => {
  serve({ "head?recursive=1": { truncated: false, tree: [entry("a.txt"), entry("dir", "tree"), entry("dir/b.txt")] } });
  assert.deepEqual((await read()).map((e) => e.path), ["a.txt", "dir/b.txt"]);
});

test("a truncated tree is rebuilt level by level when every piece is complete", async () => {
  serve({
    "head?recursive=1": { truncated: true, tree: [entry("a.txt")] },
    head: { truncated: false, tree: [entry("a.txt"), entry("dir", "tree")] },
    "sha-dir?recursive=1": { truncated: false, tree: [entry("b.txt")] },
  });
  assert.deepEqual((await read()).map((e) => e.path).sort(), ["a.txt", "dir/b.txt"]);
});

test("a failing or truncated piece fails the read instead of returning a partial manifest", async () => {
  serve({ "head?recursive=1": { truncated: true, tree: [entry("a.txt")] }, head: { truncated: false, tree: [entry("dir", "tree")] }, "sha-dir?recursive=1": 500 });
  await assert.rejects(read(), SyncGithubError);

  serve({ "head?recursive=1": { truncated: true, tree: [] }, head: { truncated: false, tree: [entry("dir", "tree")] }, "sha-dir?recursive=1": { truncated: true, tree: [entry("x")] } });
  await assert.rejects(read(), /too large to compare completely/);

  serve({ "head?recursive=1": { truncated: true, tree: [] }, head: { truncated: true, tree: [] } });
  await assert.rejects(read(), /too large to compare completely/);
});
