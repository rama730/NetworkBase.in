import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("GitHub Sync Fast Diff & Query Architecture Contract", () => {
  const actionsPath = path.resolve(
    process.cwd(),
    "src/app/actions/github-sync.ts",
  );
  const workspacePath = path.resolve(
    process.cwd(),
    "src/components/workspaces/v2/files-tab/RepositorySync.tsx",
  );

  it("github-sync.ts exports getSingleFileDiff with 1MB ceiling and precomputed SHA fast-path", () => {
    const source = readFileSync(actionsPath, "utf-8");

    // Must export getSingleFileDiff
    assert.match(source, /export async function getSingleFileDiff\(/);

    // Must check size ceiling (1MB) immediately before downloading
    assert.match(source, /if \(typeof size === "number" && size > 1024 \* 1024\)/);

    // Must check buffer sizes after downloading
    assert.match(source, /const isOversized = \[edge, github, base\]\.some/);

    // Must return binary fallback for oversized files
    assert.match(source, /return \{ binary: true, edge: "", github: "", base: "" \}/);

    // Must fetch blobs directly in parallel using Promise.all
    assert.match(source, /const \[edge, github, baseBuffer\] = await Promise\.all\(\[/);
  });

  it("github-sync.ts getGitHubSyncState prunes columns and queries in parallel", () => {
    const source = readFileSync(actionsPath, "utf-8");

    // Must query runs, identity, files count, and members in parallel
    assert.match(source, /const \[runs, identityRow, filesCountResult, membersResult\] =\s*await Promise\.all\(\[/);

    // Must prune columns on githubSyncRuns (no select * without arguments)
    assert.match(source, /id:\s*githubSyncRuns\.id/);
    assert.match(source, /status:\s*githubSyncRuns\.status/);
  });

  it("RepositorySync.tsx routes inspectFile through getSingleFileDiff", () => {
    const source = readFileSync(workspacePath, "utf-8");

    // Must call getSingleFileDiff with pre-computed SHAs
    assert.match(source, /sync\.getSingleFileDiff\(projectId,/);
    assert.match(source, /storageKey:\s*file\.storageKey/);
    assert.match(source, /remoteSha:\s*file\.remoteSha/);
    assert.match(source, /baseSha:\s*file\.baseSha/);
    assert.match(source, /size:\s*file\.size/);
  });
});
