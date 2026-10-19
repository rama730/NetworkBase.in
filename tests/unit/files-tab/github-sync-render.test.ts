import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const { parseFragment } = require("parse5");
const root = process.cwd();
const workspace = path.join(
  root,
  "src/components/projects/v2/files-tab/GitHubSyncWorkspace.tsx",
);
const source = readFileSync(workspace, "utf8");
const stateNames = [...source.matchAll(/const \[(\w+),/g)].map(
  (match) => match[1],
);
const realState = React.useState;
let seed: Record<string, unknown> | null = null,
  slot = 0;
const cache = new Map<string, Record<string, unknown>>();
function load(filename: string): Record<string, unknown> {
  if (cache.has(filename)) return cache.get(filename)!;
  const code = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const cjsModule = { exports: {} };
  cache.set(filename, cjsModule.exports);
  const mockedRequire = (name: string): unknown => {
    if (name.endsWith(".css"))
      return {
        __esModule: true,
        default: new Proxy(Object.create(null), {
          get: (_, key) => `sync-${String(key)}`,
        }),
      };
    if (name === "react")
      return {
        ...React,
        useState: (initial: unknown) => {
          if (!seed) return realState(initial);
          const name = stateNames[slot++]!;
          return [
            Object.prototype.hasOwnProperty.call(seed, name)
              ? seed[name]
              : typeof initial === "function"
                ? (initial as () => unknown)()
                : initial,
            () => {},
          ];
        },
        useEffect: () => {},
        useRef: (value: unknown) => ({ current: value }),
        useCallback: (fn: unknown) => fn,
        useMemo: (fn: () => unknown) => fn(),
      };
    if (name === "@/app/actions/github-sync") return {};
    if (name === "@/stores/filesWorkspaceStore")
      return {
        useFilesWorkspaceStore: (fn: (store: unknown) => unknown) =>
          fn({ setGitSyncBadge: () => {} }),
      };
    if (name === "@/lib/github/oauth-client") return {};
    if (name === "@/components/ui/dialog")
      return {
        Dialog: ({
          open,
          children,
        }: {
          open: boolean;
          children: React.ReactNode;
        }) => (open ? children : null),
        DialogContent: ({
          children,
          role,
        }: {
          children: React.ReactNode;
          role: string;
        }) => React.createElement("div", { role }, children),
        DialogHeader: ({ children }: { children: React.ReactNode }) =>
          React.createElement("div", null, children),
        DialogTitle: ({ children }: { children: React.ReactNode }) =>
          React.createElement("h2", null, children),
        DialogDescription: ({ children }: { children: React.ReactNode }) =>
          React.createElement("p", null, children),
      };
    if (name === "@/lib/utils")
      return { cn: (...parts: unknown[]) => parts.filter(Boolean).join(" ") };
    if (name.startsWith("@/") || name.startsWith(".")) {
      const base = name.startsWith("@/")
        ? path.join(root, "src", name.slice(2))
        : path.resolve(path.dirname(filename), name);
      for (const suffix of [".tsx", ".ts", "/index.ts"])
        if (existsSync(base + suffix)) return load(base + suffix);
    }
    return require(name);
  };
  vm.runInNewContext(code, {
    module: cjsModule,
    exports: cjsModule.exports,
    require: mockedRequire,
    console,
    process,
    setTimeout,
    clearTimeout,
    URL,
    TextEncoder,
  });
  return cjsModule.exports;
}
const component = load(workspace).GitHubSyncWorkspace as (
  props: unknown,
) => React.ReactNode;
const file = {
  path: "src/components/a-very-long-name-with-日本語.tsx",
  nodeId: "node",
  version: 1,
  storageKey: null,
  localHash: "local",
  localBlobSha: "sha",
  remoteSha: "remote",
  baseSha: "base",
  baseCommit: null,
  baseSequence: 1,
  size: 1024,
  mimeType: "text/plain",
  mode: "100644",
  change: "modify",
  blocked: null,
  contributors: [],
  updated: {
    source: "project",
    at: "2026-10-17T10:00:00Z",
    person: { name: "Actual editor", avatarUrl: null },
  },
};
const manifest = {
  repository: "https://github.com/team/research",
  repositoryId: 1,
  branch: "develop",
  headSha: "a".repeat(40),
  connectionVersion: 1,
  sequence: 1,
  direction: "push",
  mode: "pr",
  message: "Reviewed files",
  files: [
    file,
    { ...file, path: ".env.production", blocked: "Potential credentials" },
    { ...file, path: "conflict.ts", change: "conflict" },
    { ...file, path: "deleted.txt", change: "delete" },
  ],
  visibility: "private",
};
const run = {
  id: "operation",
  status: "review",
  stage: "Ready for confirmation",
  error: null,
  direction: "push",
  createdAt: "2026-10-17T09:00:00Z",
  manifest,
  result: {},
};
const state = {
  viewerId: "owner",
  account: { linked: true, username: "owner" },
  canAuthenticate: true,
  connection: {
    repository: manifest.repository,
    branch: "develop",
    incomingSha: null,
  },
  runs: [],
  identity: { login: "owner", email: "owner@users.noreply.github.com" },
  teamMembers: [
    {
      userId: "member",
      name: "Unlinked member",
      avatarUrl: null,
      githubLogin: null,
    },
  ],
  filesCount: 4,
};
const setup = {
  repository: manifest.repository,
  branch: "develop",
  mode: "pr",
  direction: "push",
};
function render(values: Record<string, unknown> = {}, props = {}) {
  seed = { state, setup, ...values };
  slot = 0;
  let node;
  try {
    node = component({
      projectId: "project",
      projectName: "Research",
      canManage: true,
      access: null,
      ...props,
    });
  } finally {
    seed = null;
  }
  return renderToStaticMarkup(node);
}
function inspect(html: string) {
  const errors: unknown[] = [];
  const parsed = parseFragment(html, {
    onParseError: (error: unknown) => errors.push(error),
  });
  assert.deepEqual(errors, []);
  const ids = new Set<string>();
  const walk = (node: any, inLabel = false) => {
    const attrs = Object.fromEntries(
      (node.attrs || []).map((attr: any) => [attr.name, attr.value]),
    );
    if (attrs.id) {
      assert.ok(!ids.has(attrs.id), `Duplicate ${attrs.id}`);
      ids.add(attrs.id);
    }
    if (node.tagName === "label") assert.equal(inLabel, false, "Nested label");
    if (node.tagName === "button") {
      assert.equal(attrs.type, "button");
      assert.ok(
        attrs["aria-label"] ||
          (node.childNodes || []).some(
            (child: any) => child.nodeName === "#text" && child.value.trim(),
          ),
        "Unnamed button",
      );
    }
    for (const child of node.childNodes || [])
      walk(child, inLabel || node.tagName === "label");
  };
  walk(parsed);
  assert.doesNotMatch(html, /NaN|undefined/);
  return html;
}

test("real workspace JSX renders all principal states without invalid markup or unnamed actions", () => {
  const scenarios: Record<string, unknown>[] = [
    { state: null },
    { view: "overview" },
    { view: "connect" },
    { view: "connect", authWaiting: true },
    { view: "connect", error: "A different GitHub account returned." },
    { view: "setup" },
    {
      view: "setup",
      setup: {
        ...setup,
        newRepository: {
          owner: "owner",
          name: "research",
          private: true,
          organization: false,
        },
      },
    },
    {
      view: "setup",
      setup: {
        ...setup,
        newRepository: {
          owner: "org",
          name: "research",
          private: false,
          organization: true,
        },
      },
    },
    {
      view: "setup",
      setup: {
        ...setup,
        branch: "feature/new",
        newBranch: { base: "develop" },
      },
    },
    {
      view: "setup",
      repoStatus: "failed",
      repoError: "Repository list could not load",
    },
    { view: "setup", branchError: "Branch list failed" },
    { view: "setup", setup: { ...setup, direction: "pull" } },
    { view: "review", manifest },
    { view: "review", manifest: { ...manifest, direction: "pull" } },
    { view: "review", manifest, filter: "excluded" },
    {
      view: "review",
      manifest,
      filter: "selected",
      choices: { [file.path]: {} },
    },
    { view: "review", manifest, query: "missing" },
    {
      view: "review",
      manifest: { ...manifest, files: [{ ...file, change: "unchanged" }] },
    },
    {
      view: "review",
      manifest,
      inspectPath: "conflict.ts",
      diffError: "Diff failed",
    },
    {
      view: "review",
      manifest,
      inspectPath: file.path,
      diff: {
        path: file.path,
        edge: "local",
        github: "remote",
        base: "base",
        binary: false,
      },
    },
    { view: "confirmation", run },
    {
      view: "confirmation",
      run: {
        ...run,
        manifest: {
          ...manifest,
          newBranch: { base: "main" },
          branch: "feature/new",
        },
      },
    },
    { view: "run", run: { ...run, status: "queued" } },
    {
      view: "run",
      run: {
        ...run,
        status: "running",
        stage: "Pushing reviewed changes to GitHub",
      },
    },
    {
      view: "run",
      run: {
        ...run,
        status: "running",
        direction: "pull",
        stage: `Applying ${file.path}`,
        result: { applied: [file.path] },
      },
    },
    {
      view: "result",
      run: {
        ...run,
        status: "completed",
        result: {
          pullRequestUrl: "https://github.com/team/research/pull/1",
          branch: "feature/new",
          commitSha: "a".repeat(40),
        },
      },
    },
    {
      view: "recovery",
      run: {
        ...run,
        status: "failed",
        error: "Repository created",
        result: { repositoryCreated: true },
      },
    },
    {
      view: "recovery",
      run: {
        ...run,
        status: "needs_review",
        error: "File changed after review",
      },
    },
    {
      view: "recovery",
      run: {
        ...run,
        status: "failed",
        error: "Follow-up failed",
        result: { pushed: true, commitSha: "a".repeat(40) },
      },
    },
    { view: "settings", target: setup },
    { view: "attribution" },
    { comparing: true },
    { state: { ...state, runs: [{ ...run, status: "queued" }] } },
  ];
  for (const values of scenarios) inspect(render(values));
  inspect(render({}, { canManage: false }));
  assert.equal(scenarios.length, 33);
});
test("setup is compact and starts a read-only comparison, with initial/source/target branch roles", () => {
  const create = render({
    view: "setup",
    setup: {
      ...setup,
      newRepository: {
        owner: "owner",
        name: "research",
        private: true,
        organization: false,
      },
    },
  });
  assert.match(create, /Repository setup/);
  assert.match(create, /Compare files/);
  assert.match(create, /No files change during comparison/);
  assert.match(create, /Initial branch/);
  assert.match(create, /Create new branch/);
  assert.doesNotMatch(create, /First publication|Back to Overview/);
  const pull = render({
    view: "setup",
    setup: { ...setup, direction: "pull" },
  });
  assert.match(pull, /Source branch/);
  assert.doesNotMatch(pull, /Create new branch|Publication method/);
});
test("one overview action, explicit metadata, retained selection and truthful result semantics", () => {
  const overview = render();
  assert.equal((overview.match(/>Compare files</g) || []).length, 1);
  assert.doesNotMatch(overview, /Not compared|Review outgoing|Review incoming/);
  const review = render({ view: "review", manifest });
  for (const text of [
    "Last updated",
    "Size",
    "Updated by",
    "Actual editor",
    "Potential credentials",
  ])
    assert.ok(review.includes(text));
  assert.match(review, /aria-label="Select deleted.txt"/);
  const conflict = render({
    view: "review",
    manifest,
    inspectPath: "conflict.ts",
  });
  assert.match(conflict, /Use NetworkBase version/);
  assert.match(conflict, /Skip · keep GitHub/);
  assert.doesNotMatch(conflict, /Mine|Theirs/);
  const queued = render({ view: "run", run: { ...run, status: "queued" } });
  assert.match(queued, /Synchronization queued/);
  assert.doesNotMatch(queued, /Publication completed/);
  const recovery = render({
    view: "recovery",
    run: {
      ...run,
      status: "failed",
      error: "Follow-up failed",
      result: { pushed: true },
    },
  });
  assert.match(recovery, /already published/);
  assert.match(recovery, /Retry follow-up/);
});

// The approved preview inventory is checked against real application JSX. Transport,
// effects and Radix's portal are isolated; no browser or real GitHub request is used.
const approved = JSON.parse(
  readFileSync(
    path.join(root, "tests/fixtures/github-sync-approved-scenarios.json"),
    "utf8",
  ),
) as Record<string, Record<string, any>>;
assert.equal(Object.keys(approved).length, 85);
for (const [id, spec] of Object.entries(approved))
  test(`approved GitHub Sync scenario: ${id}`, () => {
    const list = [
      { ...file, path: "README.md" },
      { ...file, path: "src/added.tsx", change: "add" },
      {
        ...file,
        path: "docs/renamed.md",
        change: "rename",
        renamedFrom: "docs/old.md",
      },
      { ...file, path: "conflict.ts", change: "conflict" },
      { ...file, path: "deleted.txt", change: "delete" },
      { ...file, path: "image.png", mimeType: "image/png" },
      { ...file, path: ".env.production", blocked: "Potential credentials" },
      { ...file, path: ".github/workflows/ci.yml", change: "modify" },
    ];
    const names: Record<string, string> = {
      readme: "README.md",
      added: "src/added.tsx",
      rename: "docs/renamed.md",
      conflict: "conflict.ts",
      deleted: "deleted.txt",
      binary: "image.png",
      blocked: ".env.production",
      workflow: ".github/workflows/ci.yml",
    };
    let files = spec.empty
      ? list.map((value) => ({ ...value, change: "unchanged", blocked: null }))
      : spec.onlyBlocked
        ? list.filter((value) => value.blocked)
        : list;
    if (spec.missingMetadata)
      files = files.map((value) => ({ ...value, updated: undefined }));
    if (spec.extraLongPaths)
      files = [
        ...files,
        { ...file, path: "مشاريع/日本語/" + "long-path-".repeat(20) + ".tsx" },
      ];
    if (spec.limit === "files")
      files = Array.from({ length: 5001 }, (_, index) => ({
        ...file,
        path: `file-${index}.txt`,
      }));
    if (spec.limit === "bytes")
      files = Array.from({ length: 55 }, (_, index) => ({
        ...file,
        path: `large-${index}.txt`,
        size: 10 * 1024 * 1024,
      }));
    if (id === "lastpage")
      files = Array.from({ length: 1133 }, (_, index) => ({
        ...file,
        path: `unchanged-${index + 1}.txt`,
        change: "unchanged",
        blocked: null,
      }));
    const chosen = spec.limit
      ? files.map((value) => value.path)
      : (
          spec.selected ||
          (["run", "success", "recovery"].includes(spec.scene)
            ? ["readme", "added", "rename"]
            : [])
        ).map((value: string) => names[value]);
    const configuration = {
      ...setup,
      direction: spec.direction || "push",
      mode: spec.mode || (spec.setup === "create" ? "direct" : "pr"),
      branch: spec.branch || "main",
      repository: spec.repo
        ? "https://github.com/" + spec.repo
        : setup.repository,
      ...(spec.newBranch ? { newBranch: { base: spec.newBranch.base } } : {}),
      ...(spec.setup === "create"
        ? {
            newRepository: {
              owner: "owner",
              name: "research",
              organization: false,
              private: spec.private !== false,
            },
          }
        : {}),
    };
    const comparison = { ...manifest, ...configuration, files };
    const effects =
      spec.recovery === "partialpull"
        ? { applied: ["README.md"] }
        : spec.recovery === "repocreated"
          ? { repositoryCreated: true }
          : spec.recovery === "publishedpartial"
            ? { pushed: true, commitSha: "b".repeat(40) }
            : spec.scene === "success"
              ? {
                  commitSha: "b".repeat(40),
                  branch: configuration.branch,
                  ...(configuration.direction === "push" &&
                  configuration.mode === "pr"
                    ? {
                        pullRequestUrl:
                          "https://github.com/team/research/pull/1",
                      }
                    : {}),
                }
              : {};
    const failure =
      (
        {
          stale: "GitHub changed after review.",
          local: "File changed after review.",
          expired: "Review expired.",
          partialpull: "Import interrupted.",
          repocreated: "Repository created; publication interrupted.",
          publishedpartial: "Published to GitHub; follow-up failed.",
          protected: "Branch protection requires a pull request.",
          workflow:
            "GitHub workflow permission is required to publish files in .github/workflows. Authorize workflow publishing, then retry this reviewed operation.",
          rate: "GitHub rate limit reached.",
          offline: "Network disconnected.",
          branchcreate: "The new branch already exists. Choose another name.",
        } as Record<string, string>
      )[spec.recovery] || "Synchronization interrupted.";
    const operation = {
      ...run,
      direction: configuration.direction,
      manifest: {
        ...comparison,
        files: files.filter((value) => chosen.includes(value.path)),
      },
      result: effects,
      status:
        spec.scene === "success"
          ? "completed"
          : spec.scene === "recovery"
            ? ["stale", "local", "expired"].includes(spec.recovery)
              ? "needs_review"
              : "failed"
            : spec.scene === "run"
              ? (spec.phase || 0) === 0
                ? "queued"
                : "running"
              : "review",
      stage:
        spec.scene === "run"
          ? [
              "Queued for synchronization",
              "Preparing reviewed files",
              configuration.direction === "pull"
                ? "Applying README.md"
                : "Pushing reviewed changes to GitHub",
              "Recording synchronization result",
            ][spec.phase || 0]
          : run.stage,
      error: spec.scene === "recovery" ? failure : null,
    };
    const values: Record<string, unknown> = {
      setup: configuration,
      view:
        (
          {
            success: "result",
            management: "settings",
            compare: "overview",
            readonly: "overview",
            loading: "overview",
            loaderror: "overview",
          } as Record<string, string>
        )[spec.scene] || spec.scene,
      manifest: spec.scene === "review" ? comparison : null,
      choices: Object.fromEntries(chosen.map((value: string) => [value, {}])),
      query: spec.query || "",
      run: ["run", "success", "recovery", "confirmation"].includes(spec.scene)
        ? operation
        : null,
      target: setup,
      branches: ["main", "develop"],
      repositoryWritable: spec.branchForbidden ? false : true,
    };
    if (spec.scene === "loading") values.state = null;
    if (spec.scene === "loaderror") {
      values.state = null;
      values.error = "GitHub Sync could not load.";
    }
    if (spec.scene === "compare") values.comparing = true;
    if (spec.scene === "connect") {
      values.authWaiting = spec.auth === "waiting";
      if (spec.auth && spec.auth !== "waiting")
        values.error =
          spec.auth === "mismatch"
            ? "A different GitHub account returned."
            : spec.auth === "orgpending"
              ? "Organization approval is pending."
              : spec.auth === "expired"
                ? "Repository access expired."
                : "GitHub sign-in did not complete. Your setup is retained.";
    }
    if (spec.setupError) {
      if (spec.setupError === "loading") values.repoStatus = "loading";
      else if (spec.setupError === "failed") {
        values.repoStatus = "failed";
        values.repoError = "Repository list could not load.";
      } else if (spec.setupError === "empty") values.repoStatus = "empty";
      else if (spec.setupError === "branch") {
        values.setup = { ...configuration, branch: "" };
        values.branchError = "Selected branch is no longer available.";
      } else
        values.error = (
          {
            url: "Use a valid repository URL.",
            name: "This owner already has a repository with that name.",
            org: "Organization authorization required.",
            access: "Repository is unavailable.",
          } as Record<string, string>
        )[spec.setupError];
    }
    if (spec.inspect) {
      values.inspectPath = names[spec.inspect];
      values.diff = spec.diffState
        ? null
        : {
            path: names[spec.inspect],
            edge: "project version",
            github: "GitHub version",
            base: "common base",
            binary: spec.inspect === "binary",
          };
      if (spec.diffState === "loading") values.diffLoading = true;
      if (spec.diffState === "failed")
        values.diffError = "File comparison could not load.";
    }
    if (spec.runWarning === "offline")
      values.pollError = "Connection interrupted.";
    if (spec.runWarning === "cancelrace")
      values.error =
        "This operation is already running. Cancellation was not applied.";
    if (id === "lastpage") {
      values.cleanOpen = true;
      values.cleanPage = 56;
    }
    if (spec.showHistory) values.modal = "history";
    if (spec.management === "disconnect") values.modal = "disconnect";
    const html = inspect(
      render(values, { canManage: spec.scene !== "readonly" }),
    );
    if (spec.scene === "run")
      assert.doesNotMatch(html, /Publication completed|Import completed/);
    if (spec.scene === "recovery")
      assert.match(html, /Synchronization needs attention/);
    if (spec.branchForbidden) assert.match(html, /write access/);
    if (spec.scene === "setup" && spec.direction === "pull")
      assert.doesNotMatch(html, /Create new branch/);
    if (id === "lastpage") {
      assert.match(html, /1,121–1,133/);
      assert.doesNotMatch(html, /unchanged-1134/);
    }
  });
