import assert from "node:assert/strict";
import test from "node:test";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { contentHashes } from "../../../src/lib/github/sync-contract";

// Next aliases this marker to its empty server module; use the same boundary in this server test.
const loader = Module as unknown as {
  _load: (request: string, ...args: unknown[]) => unknown;
};
const originalLoad = loader._load;
loader._load = (request, ...args) =>
  request === "server-only" ? {} : originalLoad(request, ...args);
const {
  assertGithubWorkflowPermission,
  requireExistingOrEmptyBranch,
  readGitHubBlob,
  readGitHubTree,
  syncGithub,
} = createRequire(import.meta.url)(
  path.resolve(process.cwd(), "src/lib/github/sync-api"),
) as typeof import("../../../src/lib/github/sync-api");
loader._load = originalLoad;
test("a missing branch cannot silently initialize an unrelated history", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes("/branches?")
            ? [{ name: "main" }]
            : { message: "Not Found" },
        ),
        { status: String(url).includes("/branches?") ? 200 : 404 },
      );
    await assert.rejects(
      requireExistingOrEmptyBranch(
        "test",
        "https://github.com/example/repo",
        "typo",
      ),
      /branch does not exist/,
    );
    globalThis.fetch = async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes("/branches?") ? [] : { message: "Not Found" },
        ),
        { status: String(url).includes("/branches?") ? 200 : 404 },
      );
    assert.equal(
      await requireExistingOrEmptyBranch(
        "test",
        "https://github.com/example/repo",
        "main",
      ),
      null,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("downloaded GitHub content must match the reviewed blob identity", async () => {
  const original = globalThis.fetch;
  const bytes = Buffer.from("reviewed content\n");
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          encoding: "base64",
          size: bytes.length,
          content: bytes.toString("base64"),
        }),
      );
    assert.deepEqual(
      await readGitHubBlob(
        "test",
        "https://github.com/example/repo",
        contentHashes(bytes).blobSha,
      ),
      bytes,
    );
    await assert.rejects(
      readGitHubBlob("test", "https://github.com/example/repo", "0".repeat(40)),
      /integrity/,
    );
    // Oversized blob rejection (>10MB)
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          encoding: "base64",
          size: 11 * 1024 * 1024,
          content: "",
        }),
      );
    await assert.rejects(
      readGitHubBlob("test", "https://github.com/example/repo", "1".repeat(40)),
      /oversized/i,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("workflow publication fails before git when the OAuth grant lacks workflow", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(null, { headers: { "x-oauth-scopes": "repo, user:email" } });
    await assert.rejects(
      assertGithubWorkflowPermission("test", [".github/workflows/ci.yml"]),
      /workflow permission is required/i,
    );
    globalThis.fetch = async () =>
      new Response(null, {
        headers: { "x-oauth-scopes": "repo, workflow, user:email" },
      });
    await assert.doesNotReject(
      assertGithubWorkflowPermission("test", [".github/workflows/ci.yml"]),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("readGitHubTree returns direct tree blobs when not truncated", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      return new Response(
        JSON.stringify({
          truncated: false,
          tree: [
            { path: "README.md", type: "blob", sha: "sha_readme", mode: "100644" },
            { path: "src", type: "tree", sha: "sha_dir", mode: "040000" },
            { path: "src/index.ts", type: "blob", sha: "sha_index", mode: "100644" },
          ],
        }),
        { status: 200 },
      );
    };

    const entries = await readGitHubTree("token", "https://github.com/example/repo", "head_sha");
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((e) => e.path), ["README.md", "src/index.ts"]);
  } finally {
    globalThis.fetch = original;
  }
});

test("readGitHubTree performs hierarchical sub-tree recovery when truncated", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("head_sha?recursive=1")) {
        // Initial recursive request returns truncated
        return new Response(
          JSON.stringify({
            truncated: true,
            tree: [{ path: "root_truncated.txt", type: "blob", sha: "sha_trunc", mode: "100644" }],
          }),
          { status: 200 },
        );
      }
      if (urlStr.endsWith("/git/trees/head_sha")) {
        // Root non-recursive request
        return new Response(
          JSON.stringify({
            truncated: false,
            tree: [
              { path: "package.json", type: "blob", sha: "sha_pkg", mode: "100644" },
              { path: "src", type: "tree", sha: "sha_src_dir", mode: "040000" },
            ],
          }),
          { status: 200 },
        );
      }
      if (urlStr.includes("sha_src_dir?recursive=1")) {
        // Subtree recursive request
        return new Response(
          JSON.stringify({
            truncated: false,
            tree: [
              { path: "main.ts", type: "blob", sha: "sha_main", mode: "100644" },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ message: "Not found" }), { status: 404 });
    };

    const entries = await readGitHubTree("token", "https://github.com/example/repo", "head_sha");
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((e) => e.path), ["package.json", "src/main.ts"]);
  } finally {
    globalThis.fetch = original;
  }
});

test("syncGithub retries once on secondary rate limit 429 and succeeds", async () => {
  const original = globalThis.fetch;
  let attempts = 0;
  try {
    globalThis.fetch = async () => {
      attempts++;
      if (attempts === 1) {
        return new Response(JSON.stringify({ message: "Too many attempts. Try again in a minute." }), {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const result = await syncGithub<{ ok: boolean }>("test-token", "/user");
    assert.equal(attempts, 2);
    assert.deepEqual(result, { ok: true });
  } finally {
    globalThis.fetch = original;
  }
});
