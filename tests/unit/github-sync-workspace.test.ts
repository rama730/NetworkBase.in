import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
  contentHashes,
  detectOutgoingRenames,
  type SyncFile,
  type SyncManifest,
  type SyncRunView,
} from "../../src/lib/github/sync-contract";
import { isValidGithubBranchName } from "../../src/lib/github/repo-validation";
import {
  authFailureText,
  canRetryRun,
  eligibleSyncFile,
  formatSyncDate,
  needsRunAttention,
  readSyncDraft,
  restoreSyncChoices,
  runProgress,
  selectionProblem,
  setupProblem,
  type SyncDraft,
} from "../../src/lib/github/sync-workspace";

const file = (overrides: Partial<SyncFile> = {}): SyncFile => ({
  path: "README.md",
  nodeId: null,
  version: null,
  storageKey: null,
  localHash: "local",
  localBlobSha: "localblob",
  remoteSha: "remote",
  baseSha: "base",
  baseCommit: null,
  baseSequence: 0,
  size: 100,
  mimeType: "text/plain",
  mode: "100644",
  change: "modify",
  blocked: null,
  contributors: [],
  ...overrides,
});
const manifest = (files = [file()]): SyncManifest => ({
  repository: "https://github.com/team/research",
  repositoryId: 1,
  branch: "develop",
  headSha: "a".repeat(40),
  connectionVersion: 1,
  sequence: 1,
  direction: "push",
  mode: "pr",
  message: "Reviewed changes",
  files,
});
const run = (overrides: Partial<SyncRunView> = {}): SyncRunView => ({
  id: "run",
  status: "failed",
  stage: "Synchronization needs attention",
  error: "Network unavailable",
  direction: "push",
  createdAt: new Date().toISOString(),
  manifest: manifest(),
  result: {},
  ...overrides,
});
const draft = (): SyncDraft => ({
  version: 1,
  projectId: "project",
  viewerId: "owner",
  savedAt: Date.now(),
  setup: {
    repository: "https://github.com/team/research",
    branch: "develop",
    direction: "push",
    mode: "pr",
  },
  message: "Retained message",
  selected: [
    { path: "README.md", localHash: "local", remoteSha: "remote", choice: {} },
  ],
});

test("setup validates destinations, branch roles and new-repository direction", () => {
  const base = draft().setup;
  assert.equal(setupProblem(base), "");
  assert.match(
    setupProblem({ ...base, repository: "not github" }),
    /repository/,
  );
  assert.match(setupProblem({ ...base, branch: "" }), /branch/);
  assert.match(
    setupProblem({ ...base, newBranch: { base: "develop" } }),
    /different/,
  );
  assert.match(
    setupProblem({
      ...base,
      branch: "feature/new",
      newBranch: { base: "develop" },
      direction: "pull",
    }),
    /starting branch/,
  );
  assert.equal(
    setupProblem({
      ...base,
      branch: "feature/new",
      newBranch: { base: "develop" },
    }),
    "",
  );
  assert.match(
    setupProblem({
      ...base,
      direction: "pull",
      newRepository: {
        owner: "team",
        name: "repo",
        private: true,
        organization: true,
      },
    }),
    /first publication/i,
  );
});
test("branch syntax agrees with Git including Unicode, reserved names and nested lock segments", () => {
  for (const name of [
    "main",
    "develop",
    "feature/日本語",
    "release/2026.10",
    "@",
    "HEAD",
    "-bad",
    "bad name",
    "a..b",
    "a//b",
    ".secret",
    "a/.secret",
    "a.lock/b",
    "a/b.lock",
    "a.",
    "a/",
    "/a",
    "a@{1}",
    "a\\b",
    "a[b",
    "a?b",
  ])
    assert.equal(
      isValidGithubBranchName(name),
      spawnSync("git", ["check-ref-format", "--branch", name]).status === 0,
      name,
    );
});
test("selection includes deliberate deletes and renames but excludes blocked, clean and unresolved files", () => {
  for (const change of ["add", "modify", "delete", "rename"] as const)
    assert.equal(eligibleSyncFile(file({ change })), true);
  assert.equal(eligibleSyncFile(file({ blocked: "Secret" })), false);
  assert.equal(eligibleSyncFile(file({ change: "conflict" })), false);
  assert.match(selectionProblem(manifest(), {}, "message"), /Select/);
  assert.equal(
    selectionProblem(manifest(), { "README.md": {} }, "message"),
    "",
  );
  assert.match(
    selectionProblem(
      manifest([file({ blocked: "Secret" })]),
      { "README.md": {} },
      "message",
    ),
    /excluded/,
  );
  const conflict = manifest([file({ change: "conflict" })]);
  assert.match(
    selectionProblem(conflict, { "README.md": {} }, "message"),
    /Resolve/,
  );
  assert.equal(
    selectionProblem(
      conflict,
      { "README.md": { resolution: "edge" } },
      "message",
    ),
    "",
  );
  assert.match(
    selectionProblem(
      conflict,
      { "README.md": { resolution: "github" } },
      "message",
    ),
    /destination/,
  );
  conflict.direction = "pull";
  assert.equal(
    selectionProblem(
      conflict,
      { "README.md": { resolution: "github" } },
      "message",
    ),
    "",
  );
  assert.match(
    selectionProblem(
      conflict,
      { "README.md": { resolution: "edge" } },
      "message",
    ),
    /destination/,
  );
  assert.match(
    selectionProblem(
      conflict,
      { "README.md": { resolution: "merge" } },
      "message",
    ),
    /combined/,
  );
  assert.match(
    selectionProblem(
      manifest([file({ size: 513 * 1024 * 1024 })]),
      { "README.md": {} },
      "message",
    ),
    /512 MB/,
  );
});
test("OAuth draft restoration is scoped, expiring and rechecks each selected revision", () => {
  const saved = draft();
  assert.deepEqual(
    readSyncDraft(JSON.stringify(saved), "project", "owner"),
    saved,
  );
  assert.equal(readSyncDraft(JSON.stringify(saved), "other", "owner"), null);
  assert.equal(readSyncDraft(JSON.stringify(saved), "project", "other"), null);
  assert.equal(readSyncDraft("invalid", "project", "owner"), null);
  assert.equal(
    readSyncDraft(
      JSON.stringify({ ...saved, savedAt: Date.now() - 31 * 60_000 }),
      "project",
      "owner",
    ),
    null,
  );
  assert.deepEqual(restoreSyncChoices(manifest(), saved), {
    choices: { "README.md": {} },
    changed: 0,
  });
  assert.deepEqual(
    restoreSyncChoices(manifest([file({ remoteSha: "changed" })]), saved),
    { choices: {}, changed: 1 },
  );
  assert.equal(
    restoreSyncChoices(manifest([file({ blocked: "Secret" })]), saved).changed,
    1,
  );
  assert.match(authFailureText("account_mismatch"), /different GitHub account/);
  assert.match(authFailureText("access_denied"), /not granted/);
  assert.match(authFailureText("invalid"), /not be verified/);
});
test("recovery uses durable status and partial results rather than treating queued as completed", () => {
  for (const status of [
    "review",
    "queued",
    "running",
    "failed",
    "needs_review",
  ] as const)
    assert.equal(needsRunAttention(run({ status })), true);
  assert.equal(needsRunAttention(run({ status: "completed" })), false);
  const old = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  assert.equal(canRetryRun(run({ createdAt: old })), false);
  assert.equal(
    canRetryRun(run({ createdAt: old, result: { repositoryCreated: true } })),
    true,
  );
  assert.equal(
    canRetryRun(
      run({ createdAt: old, result: { pushed: true, commitSha: "recorded" } }),
    ),
    true,
  );
  assert.equal(
    canRetryRun(
      run({
        createdAt: old,
        direction: "pull",
        result: { applied: ["README.md"] },
      }),
    ),
    true,
  );
  assert.equal(
    canRetryRun(
      run({ status: "needs_review", result: { applied: ["README.md"] } }),
    ),
    false,
  );
  assert.equal(runProgress(run({ status: "queued" })).index, 0);
  assert.equal(
    runProgress(run({ status: "running", stage: "Preparing reviewed files" }))
      .index,
    1,
  );
  assert.equal(
    runProgress(
      run({ status: "running", stage: "Pushing reviewed changes to GitHub" }),
    ).index,
    2,
  );
  assert.equal(
    runProgress(run({ status: "running", stage: "Opening pull request" }))
      .index,
    3,
  );
  const partial = run({
    direction: "pull",
    status: "running",
    stage: "Applying README.md",
    manifest: manifest([file(), file({ path: "other" })]),
    result: { applied: ["README.md"] },
  });
  assert.equal(runProgress(partial).applied, 1);
  assert.equal(runProgress(partial).total, 2);
  assert.equal(formatSyncDate("bad"), "—");
});
test("outgoing rename detection only consolidates one exact source and one destination", () => {
  const old = file({
    path: "old.md",
    change: "delete",
    localBlobSha: null,
    remoteSha: "same",
    baseSha: "same",
  });
  const added = file({
    path: "new.md",
    change: "add",
    localBlobSha: "same",
    remoteSha: null,
  });
  const result = detectOutgoingRenames([old, added]);
  assert.equal(result[1]?.change, "rename");
  assert.equal(result[1]?.renamedFrom, "old.md");
  assert.equal(result[0]?.change, "unchanged");
  assert.equal(
    detectOutgoingRenames([old, added, { ...added, path: "copy.md" }])[1]
      ?.change,
    "add",
  );
  assert.equal(
    detectOutgoingRenames([old, { ...added, localBlobSha: "edited" }])[1]
      ?.change,
    "add",
  );
  assert.ok(contentHashes(Buffer.from("file")).hash);
});

test("literal prototype-like filenames are never selected by default or dropped on restoration", async () => {
  const { syncChoice, selectEligibleChanges } =
    await import("../../src/lib/github/sync-workspace");
  for (const path of ["__proto__", "constructor", "toString"])
    assert.equal(syncChoice({}, path), undefined);
  const files = ["__proto__", "constructor", "toString"].map((path) =>
    file({ path }),
  );
  const choices = selectEligibleChanges(files, {});
  assert.equal(Object.keys(choices).length, 3);
  assert.deepEqual(Object.getPrototypeOf(choices), Object.prototype);
  const saved = {
    ...draft(),
    selected: files.map((value) => ({
      path: value.path,
      localHash: value.localHash,
      remoteSha: value.remoteSha,
      choice: {},
    })),
  };
  assert.equal(
    Object.keys(restoreSyncChoices(manifest(files), saved).choices).length,
    3,
  );
});
