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
  const service = load("src/lib/projects/task-transition-service.ts", {});
  const locked = {
    projectId: "p",
    isOwner: false,
    isLeader: true,
    currentStatus: "in_progress",
    reviewStatus: "none",
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
test("admin membership cannot move a pending review out of review; owner can reject it", async () => {
  const { tx, changes, service, locked } = transition();
  tx.query.projectWorkflowColumns.findFirst = async () => ({
    id: "todo-column",
    status: "todo",
    title: "Todo",
  });
  await assert.rejects(
    service.transitionTaskTx(
      tx,
      { ...locked, currentStatus: "done", reviewStatus: "pending" },
      { taskId: "t", userId: "admin", status: "todo" },
    ),
    /Only project leads/,
  );
  assert.equal(changes.length, 0);
  const result = await service.transitionTaskTx(
    tx,
    {
      ...locked,
      isOwner: true,
      currentStatus: "done",
      reviewStatus: "pending",
    },
    { taskId: "t", userId: "owner", status: "todo" },
  );
  assert.equal(result.reviewStatus, "rejected");
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
      assertProjectUploadAccessTx: async () => {},
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
