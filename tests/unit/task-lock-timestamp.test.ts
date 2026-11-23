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

function load(file: string, mocks: Record<string, unknown> = {}) {
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
    require: (name: string) => {
      if (name === "drizzle-orm") {
        return {
          sql,
          and: (...args: unknown[]) => args,
          eq: (...args: unknown[]) => args,
          inArray: (...args: unknown[]) => args,
          isNull: (value: unknown) => value,
          max: (value: unknown) => value,
        };
      }
      return mocks[name] || {};
    },
    Date,
    Error,
    console,
  });
  return exports;
}

test("lockTaskForWrite parses string updated_at into a valid Date object with working getTime()", async () => {
  const { lockTaskForWrite } = load("src/lib/workspaces/task-transition-service.ts", { "@/lib/organizations/permissions": load("src/lib/organizations/permissions.ts"), "@/lib/workspaces/role-abilities": load("src/lib/workspaces/role-abilities.ts") });
  const timestampStr = "2026-10-21 21:05:00+00";
  const mockTx: any = {
    execute: async () => [
      {
        id: "task-1",
        project_id: "proj-1",
        workflow_column_id: "col-1",
        assignee_id: "user-1",
        task_number: 42,
        status: "in_progress",
        review_status: "none",
        updated_at: timestampStr, // Raw SQL returns string from Postgres driver
        owner_id: "owner-1",
        task_review_required: false,
        task_completion_policy_version: 1,
        review_content_hash: null,
        slug: "proj-slug",
        key: "PRJ",
        member_role: "admin",
        deleted_at: null,
        task_deleted_at: null,
      },
    ],
  };

  const locked = await lockTaskForWrite(mockTx, "task-1", "user-1");

  assert.ok(locked.currentUpdatedAt instanceof Date, "currentUpdatedAt must be an instance of Date");
  assert.equal(typeof locked.currentUpdatedAt.getTime, "function", "currentUpdatedAt.getTime must be a function");
  assert.equal(locked.currentUpdatedAt.getTime(), new Date(timestampStr).getTime());
});

test("lockTaskForWrite keeps Date updated_at unchanged if driver returns a Date instance", async () => {
  const { lockTaskForWrite } = load("src/lib/workspaces/task-transition-service.ts", { "@/lib/organizations/permissions": load("src/lib/organizations/permissions.ts"), "@/lib/workspaces/role-abilities": load("src/lib/workspaces/role-abilities.ts") });
  const dateObj = new Date("2026-10-21T21:05:00.000Z");
  const mockTx: any = {
    execute: async () => [
      {
        id: "task-2",
        project_id: "proj-1",
        workflow_column_id: "col-1",
        assignee_id: "user-1",
        task_number: 43,
        status: "in_progress",
        review_status: "none",
        updated_at: dateObj,
        owner_id: "owner-1",
        task_review_required: false,
        task_completion_policy_version: 1,
        review_content_hash: null,
        slug: "proj-slug",
        key: "PRJ",
        member_role: "admin",
        deleted_at: null,
        task_deleted_at: null,
      },
    ],
  };

  const locked = await lockTaskForWrite(mockTx, "task-2", "user-1");

  assert.ok(locked.currentUpdatedAt instanceof Date);
  assert.equal(locked.currentUpdatedAt.getTime(), dateObj.getTime());
});
