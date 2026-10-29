import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import { z } from "zod";
import {
  completionActionLabel,
  isTaskCompleted,
} from "@/lib/workspaces/task-completion-policy";
import {
  getTaskTitlePresentation,
  calculateTaskTimeHealth,
} from "@/lib/workspaces/task-presentation";
import { patchTaskQueryData } from "@/lib/workspaces/task-cache";

const sql = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
  { join: (values: unknown[]) => values },
);
const schema = new Proxy(
  {},
  {
    get: (_, name) =>
      new Proxy(
        { name },
        {
          get: (table, key) =>
            key === "name" ? table.name : `${String(name)}.${String(key)}`,
        },
      ),
  },
);
function load(file: string, mocks: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    Date,
    Error,
    JSON,
    console,
    require: (name: string) => {
      if (name === "drizzle-orm")
        return {
          sql,
          and: (...args: unknown[]) => args,
          eq: (...args: unknown[]) => args,
          isNull: (arg: unknown) => arg,
          inArray: (...args: unknown[]) => args,
          desc: (arg: unknown) => arg,
        };
      if (name === "@/lib/db/schema") return schema;
      if (name === "zod") return { z };
      return mocks[name] ?? {};
    },
  });
  return exports;
}
const projectId = "b13cb9cf-0e92-41ee-9b03-ae68b97e459b";

test("completion labels and title/due-date treatment distinguish pending review", () => {
  assert.equal(completionActionLabel(false), "Mark as completed");
  assert.equal(completionActionLabel(true), "Submit for review");
  assert.equal(
    isTaskCompleted({ status: "done", reviewStatus: "pending" }),
    false,
  );
  assert.equal(isTaskCompleted({ status: "done", reviewStatus: "none" }), true);
  assert.equal(
    getTaskTitlePresentation({ status: "done", reviewStatus: "pending" })
      .isCompleted,
    false,
  );
  const unfinished = calculateTaskTimeHealth(
    { status: "done", reviewStatus: "pending" },
    { status: "completed" },
  );
  assert.equal(unfinished.state, "unfinished");
});

test("the review queue removes an approved task and admits a newly submitted one", () => {
  const task = {
    id: "t",
    projectId,
    title: "Task",
    status: "done",
    reviewStatus: "pending",
    updatedAt: "2026-10-20T00:00:00Z",
  };
  const queued = patchTaskQueryData([], task as any, "review");
  assert.equal((queued as any[]).length, 1);
  const completed = patchTaskQueryData(
    queued,
    { ...task, reviewStatus: "none", updatedAt: "2026-10-20T01:00:00Z" } as any,
    "review",
  );
  assert.equal((completed as any[]).length, 0);
});

function policyAction(role = "admin", ownerId = "owner") {
  const writes: any[] = [];
  const row = {
    role,
    owner_id: ownerId,
    task_review_required: false,
    task_completion_policy_version: 0,
  };
  const tx = {
    execute: async () => [row],
    update: (table: any) => ({
      set: (values: any) => ({
        where: async () => {
          writes.push({ table: table.name, values });
        },
      }),
    }),
    insert: (table: any) => ({
      values: async (values: any) => {
        writes.push({ table: table.name, values });
      },
    }),
  };
  const action = load("src/app/actions/workspace/task-completion.ts", {
    "@/app/api/v1/_shared": {
      requireAuthenticatedUser: async () => ({ user: { id: "user" } }),
    },
    "@/lib/db": { db: { transaction: (fn: any) => fn(tx) } },
    "@/lib/security/rate-limit": {
      consumeRateLimit: async () => ({ allowed: true }),
    },
    "next/cache": { revalidatePath() {} },
  });
  return { action, writes, row };
}

test("only owners or co-leaders can change policy, using a checked version and durable audit", async () => {
  for (const role of ["member", "viewer"]) {
    const h = policyAction(role);
    const denied = await h.action.updateTaskCompletionPolicyAction({
      projectId,
      reviewRequired: true,
      expectedVersion: 0,
    });
    assert.equal(denied.success, false);
    assert.equal(h.writes.length, 0);
  }
  for (const role of ["admin", "owner"]) {
    const h = policyAction(role, role === "owner" ? "user" : "owner");
    const saved = await h.action.updateTaskCompletionPolicyAction({
      projectId,
      reviewRequired: true,
      expectedVersion: 0,
    });
    assert.equal(saved.success, true);
    assert.equal(saved.version, 1);
    assert.equal(h.writes[0].values.taskReviewRequired, true);
    assert.equal(h.writes[1].table, "workspaceTaskPolicyEvents");
    assert.equal(h.writes[1].values.actorId, "user");
    assert.ok(
      h.writes.every((write) => write.table !== "tasks"),
      "changing policy never reopens/completes existing tasks",
    );
  }
});

test("stale settings writes fail without overwriting a newer lead decision", async () => {
  const h = policyAction();
  h.row.task_completion_policy_version = 3;
  const result = await h.action.updateTaskCompletionPolicyAction({
    projectId,
    reviewRequired: true,
    expectedVersion: 0,
  });
  assert.equal(result.success, false);
  assert.match(result.error, /changed elsewhere/);
  assert.equal(h.writes.length, 0);
});

function approval() {
  const writes: any[] = [];
  let sideEffects = 0;
  const locked = {
    projectId,
    isLeader: true,
    reviewStatus: "pending",
    currentStatus: "done",
    currentUpdatedAt: new Date("2026-10-20T00:00:00Z"),
    reviewContentHash: "submitted",
    previousSprintId: null,
    title: "Task",
    taskNumber: 1,
  };
  const files = [
    {
      id: "n",
      linkId: "link",
      type: "file",
      tags: ["deliverable"],
      currentVersion: 2,
      revisedAt: new Date("2026-10-20T00:00:00Z"),
    },
  ];
  const chain: any = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    for: async () => files,
  };
  const tx = {
    select: () => chain,
    update: (table: any) => ({
      set: (values: any) => ({
        where: async () => {
          writes.push({ table: table.name, values });
        },
      }),
    }),
    insert: (table: any) => ({
      values: (values: any) => ({
        returning: async () => {
          writes.push({ table: table.name, values });
          return [{ id: "event" }];
        },
      }),
    }),
  };
  let snapshot = "submitted";
  const actions = load("src/app/actions/task.ts", {
    "@/app/api/v1/_shared": {
      requireAuthenticatedUser: async () => ({ user: { id: "user" } }),
    },
    "@/lib/security/rate-limit": {
      consumeRateLimit: async () => ({ allowed: true }),
    },
    "@/lib/db": { db: { transaction: (fn: any) => fn(tx) } },
    "@/lib/workspaces/task-transition-service": {
      lockTaskForWrite: async () => locked,
      afterTaskTransition: async () => {
        sideEffects++;
      },
    },
    "@/lib/workspaces/task-review-snapshot": {
      taskReviewSnapshot: async () => snapshot,
    },
    "@/lib/workspaces/task-file-intelligence": {
      inferTaskFileRole: () => "deliverable",
      markTaskFileVersionApproved: () => ["deliverable", "approved_version:2"],
    },
    "next/cache": { revalidatePath() {} },
  });
  return {
    actions,
    writes,
    locked,
    setSnapshot: (value: string) => {
      snapshot = value;
    },
    effects: () => sideEffects,
  };
}

test("approval rejects changed content, legacy unsnapshotted work, stale task versions and unauthorized reviewers", async () => {
  for (const failure of ["changed", "legacy", "stale", "member"]) {
    const h = approval();
    if (failure === "changed") h.setSnapshot("new-files-or-requirements");
    if (failure === "legacy") h.locked.reviewContentHash = null as any;
    if (failure === "member") h.locked.isLeader = false;
    const result = await h.actions.approveTaskReviewAction(
      projectId,
      projectId,
      failure === "stale" ? "2026-10-19T00:00:00Z" : "2026-10-20T00:00:00Z",
    );
    assert.equal(result.success, false, failure);
    assert.equal(h.writes.length, 0, failure);
    assert.equal(h.effects(), 0, failure);
  }
});

test("valid co-leader approval completes the task, stamps submitted deliverables and records a separate approval event", async () => {
  const h = approval();
  const result = await h.actions.approveTaskReviewAction(
    projectId,
    projectId,
    "2026-10-20T00:00:00Z",
  );
  assert.equal(result.success, true);
  const task = h.writes.find((write) => write.table === "tasks").values;
  assert.equal(task.reviewStatus, "none");
  assert.equal(task.completionSource, "review");
  assert.equal(task.completedBy, "user");
  assert.ok(task.completedAt instanceof Date);
  assert.equal(
    h.writes.find((write) => write.table === "taskActivityEvents").values
      .eventType,
    "review_approved",
  );
  assert.ok(
    h.writes.every((write) => write.table !== "projectNodes"),
    "approval does not publish or move files",
  );
  assert.equal(h.effects(), 1);
});

test("the snapshot changes with requirements, checklist completion and active file revision", async () => {
  const helper = load("src/lib/workspaces/task-review-snapshot.ts", {
    "node:crypto": crypto,
  });
  const snapshot = {
    title: "Task",
    description: "Requirement",
    subtasks: [{ id: "s", completed: false }],
    files: [{ id: "f", version: 2, hash: "abc" }],
  };
  const calls: any[] = [];
  const reader = {
    execute: async (query: any) => {
      calls.push(query);
      return query.strings.join("").includes("AS snapshot")
        ? [{ snapshot }]
        : [];
    },
  };
  const original = await helper.taskReviewSnapshot(reader, "task", true);
  assert.match(calls[0].strings.join(""), /FOR UPDATE OF n/);
  snapshot.description = "Changed requirement";
  assert.notEqual(await helper.taskReviewSnapshot(reader, "task"), original);
  snapshot.description = "Requirement";
  snapshot.subtasks[0].completed = true;
  assert.notEqual(await helper.taskReviewSnapshot(reader, "task"), original);
  snapshot.subtasks[0].completed = false;
  snapshot.files[0].hash = "changed-same-version";
  assert.notEqual(await helper.taskReviewSnapshot(reader, "task"), original);
});
