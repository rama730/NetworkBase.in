import nodeCrypto from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
const sql = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
  { join: (values: unknown[]) => values },
);
const fields = (name: string) =>
  new Proxy(
    { name },
    {
      get: (obj, key) => (key === "name" ? obj.name : `${name}.${String(key)}`),
    },
  );
const schema = new Proxy({}, { get: (_, key) => fields(String(key)) });
function load(file: string, mocks: Record<string, unknown>) {
  const source = ts.transpileModule(
    fs.readFileSync(path.join(process.cwd(), file), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exports: Record<string, any> = {};
  vm.runInNewContext(source, {
    exports,
    require: (name: string) =>
      name === "drizzle-orm"
        ? {
            sql,
            and: (...args: unknown[]) => args,
            eq: (...args: unknown[]) => args,
            inArray: (...args: unknown[]) => args,
            isNull: (value: unknown) => value,
            max: (value: unknown) => value,
          }
        : name === "@/lib/db/schema"
          ? schema
          : mocks[name] || {},
    Date,
    Set,
    Map,
    JSON,
    console,
    Buffer,
  });
  return exports;
}
function transition() {
  const changes: any[] = [];
  const tx = {
    query: {
      projectWorkflowColumns: {
        findFirst: async () => ({
          id: "done-column",
          status: "done",
          title: "Done",
        }),
      },
    },
    update: (table: any) => ({
      set: (values: any) => ({
        where: async () => {
          changes.push({ table: table.name, values });
        },
      }),
    }),
    insert: (table: any) => ({
      values: (values: any) => ({
        returning: async () => {
          changes.push({ table: table.name, values });
          return [{ id: "event" }];
        },
      }),
    }),
  };
  const service = load("src/lib/workspaces/task-transition-service.ts", { "@/lib/workspaces/task-review-snapshot": { taskReviewSnapshot: async () => "snapshot" } });
  const locked = {
    projectId: "p",
    isOwner: false,
    isLeader: true,
    currentStatus: "in_progress",
    reviewStatus: "none",
    reviewRequired: true,
    policyVersion: 1,
    currentWorkflowColumnId: "working",
    title: "Task",
    taskNumber: 1,
    previousSprintId: null,
  };
  return { tx, changes, service, locked };
}
test("extension and app share the canonical transition: done means pending review, without file publication", async () => {
  const { tx, changes, service, locked } = transition();
  const result = await service.transitionTaskTx(tx, locked, {
    taskId: "t",
    userId: "u",
    status: "done",
  });
  assert.equal(result.reviewStatus, "pending");
  assert.equal(changes[0].values.status, "done");
  assert.deepEqual(
    changes.map((c) => c.table),
    ["tasks", "taskActivityEvents"],
  );
});
test("review-disabled completion is immediate and never stamps files approved", async () => {
  const { tx, changes, service, locked } = transition();
  const result = await service.transitionTaskTx(tx, { ...locked, reviewRequired: false }, { taskId: "t", userId: "u", status: "done" });
  assert.equal(result.reviewStatus, "none");
  assert.equal(result.outcome, "completed");
  assert.equal(changes[0].values.completedBy, "u");
  assert.equal(changes[0].values.completionSource, "direct");
  assert.ok(changes[0].values.completedAt instanceof Date);
  assert.ok(changes.every(change => change.table === "tasks" || change.table === "taskActivityEvents"));
});
test("pending review survives policy disable and only an explicit lead request returns work to In progress", async () => {
  const { tx, changes, service, locked } = transition();
  const pending = { ...locked, currentStatus: "done", reviewStatus: "pending", reviewRequired: false };
  const unchanged = await service.transitionTaskTx(tx, pending, { taskId: "t", userId: "u", status: "done" });
  assert.equal(unchanged.reviewStatus, "pending");
  assert.equal(changes[0].values.completedAt, undefined);
  tx.query.projectWorkflowColumns.findFirst = async () => ({ id: "progress", status: "in_progress", title: "In progress" });
  await assert.rejects(service.transitionTaskTx(tx, { ...pending, isLeader: false }, { taskId: "t", userId: "u", status: "in_progress", reviewReason: "Fix keyboard focus" }), /Only the owner and admins/);
  await assert.rejects(service.transitionTaskTx(tx, pending, { taskId: "t", userId: "lead", status: "in_progress" }), /provide a reason/);
  const requested = await service.transitionTaskTx(tx, pending, { taskId: "t", userId: "lead", status: "in_progress", reviewReason: "Fix keyboard focus" });
  assert.equal(requested.reviewStatus, "rejected");
  assert.equal(requested.outcome, "changes_requested");
  assert.equal(changes.at(-1).values.payload.reason, "Fix keyboard focus");
});
test("resubmission captures current content while preserving review even when policy is disabled", async () => {
  const { tx, changes, service, locked } = transition();
  const result = await service.transitionTaskTx(tx, { ...locked, currentStatus: "done", reviewStatus: "pending", reviewRequired: false }, { taskId: "t", userId: "u", status: "done", resubmit: true });
  assert.equal(result.reviewStatus, "pending");
  assert.equal(changes[0].values.reviewContentHash, "snapshot");
  assert.ok(changes[0].values.reviewSubmittedAt instanceof Date);
  assert.equal(changes[0].values.completedAt, null);
  assert.equal(changes[1].values.eventType, "review_submitted");
});
test("members cannot complete someone else's task or resubmit work that is not under review", async () => {
  const { tx, changes, service, locked } = transition();
  await assert.rejects(service.transitionTaskTx(tx, { ...locked, isLeader: false, previousAssigneeId: "other" }, { taskId: "t", userId: "u", status: "done" }), /Only the assignee/);
  await assert.rejects(service.transitionTaskTx(tx, locked, { taskId: "t", userId: "u", status: "done", resubmit: true }), /not pending/);
  assert.equal(changes.length, 0);
});
test("durable file operation replay returns the original committed receipt without another revision or lease write", async () => {
  let writes = 0,
    leases = 0;
  const committed = {
    nodeId: "n",
    metadata: {
      hash: "expected",
      version: 2,
      size: 8,
      revisionMode: "new_revision",
      versionIncremented: true,
    },
    createdAt: new Date("2026-10-18T00:00:00Z"),
    sequenceNumber: 7,
  };
  const tx = {
    execute: async () => [],
    query: {
      projectNodes: {
        findFirst: async () => ({
          id: "n",
          type: "file",
          currentVersion: 4,
          size: 20,
        }),
      },
      projectNodeEvents: { findFirst: async () => committed },
      fileVersions: {
        findFirst: async () => ({
          version: 2,
          contentHash: "later-active-hash",
          size: 20,
        }),
      },
    },
    update: () => {
      writes++;
      throw new Error("Unexpected mutation");
    },
    insert: () => {
      writes++;
      throw new Error("Unexpected mutation");
    },
  };
  const service = load("src/lib/files/apply-file-revision.ts", {
    "@/lib/db": { db: { transaction: (fn: any) => fn(tx) } },
    "@/lib/files/internal-helpers": {
      assertWorkspaceUploadAccessTx: async () => {},
    },
    "@/lib/files/file-lock-service": {
      assertOwnedFileLease: async () => {
        leases++;
      },
    },
  });
  const result = await service.applyFileRevision({
    projectId: "p",
    nodeId: "n",
    actorUserId: "u",
    contentHash: "expected",
    eventMetadata: { operationId: "original-operation" },
  });
  assert.equal(result.version.version, 2);
  assert.equal(result.version.contentHash, "expected");
  assert.equal(result.node.size, 8);
  assert.equal(result.sequenceNumber, 7);
  assert.equal(writes, 0);
  assert.equal(leases, 0);
  await assert.rejects(
    service.applyFileRevision({
      projectId: "p",
      nodeId: "n",
      actorUserId: "u",
      contentHash: "changed-payload",
      eventMetadata: { operationId: "original-operation" },
    }),
    /different contents/,
  );
  assert.equal(writes, 0);
});
test("invalid editor bearer never falls through to a signed-in browser cookie", async () => {
  let cookieCalls = 0;
  const chain = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    limit: async () => [],
  };
  const response = (message: string, status: number) => ({ status, message });
  const service = load("src/app/api/v1/_shared.ts", {
    "@/lib/supabase/server": {
      createClient: async () => ({
        auth: {
          getUser: async () => {
            cookieCalls++;
            return { data: { user: { id: "browser-user" } } };
          },
        },
      }),
    },
    "next/headers": {
      headers: async () => ({
        get: (key: string) =>
          key === "authorization" ? "Bearer nb_dev_invalid" : null,
      }),
    },
    "@/lib/db": { db: { select: () => chain } },
    "@/app/api/v1/_envelope": { jsonError: response },
    "@/lib/logger": { logger: { error() {} } },
    crypto: { default: nodeCrypto },
  });
  const result = await service.requireAuthenticatedUser();
  assert.equal(result.response.status, 401);
  assert.equal(result.user, null);
  assert.equal(cookieCalls, 0);
});
