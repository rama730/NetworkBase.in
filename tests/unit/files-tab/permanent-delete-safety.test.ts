import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { parseWorkspaceFileKey } from "../../../src/lib/storage/workspace-file-key";

const project = "11111111-1111-4111-8111-111111111111";
const source = readFileSync("src/lib/files/permanent-delete.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

// Run the real cleanup control flow with an in-memory DB/storage boundary.
// No credential, network request, or project file is touched by these tests.
function fixture(
  options: {
    active?: boolean;
    system?: boolean;
    foreignKey?: boolean;
    alias?: boolean;
    missingIntent?: boolean;
    scopeChanged?: boolean;
    missing?: boolean;
    count?: number;
    unregistered?: boolean;
  } = {},
) {
  const events: string[] = [];
  const removed: string[] = [];
  const node = {
    id: "root",
    projectId: project,
    deletedAt: options.active ? null : new Date(),
    s3Key: `${options.foreignKey ? "22222222-2222-4222-8222-222222222222" : project}/current`,
    assetId: options.unregistered ? null : "asset-current",
    metadata: {
      isSystem: options.system,
      permanentDeleteRoot: options.missingIntent ? undefined : "root",
    },
  };
  const nodes = options.missing
    ? []
    : [
        node,
        ...(options.scopeChanged
          ? [{ ...node, id: "child", metadata: {} }]
          : []),
      ];
  const table = (name: string) =>
    new Proxy(
      { table: name },
      {
        get: (object, key: string) =>
          key === "table" ? object.table : `${name}.${key}`,
      },
    );
  const schema = {
    workspaceNodes: table("nodes"),
    fileVersions: table("versions"),
    workspaces: table("projects"),
    workspaceDocuments: table("docs"),
    taskNodeLinks: table("links"),
    storageAssets: table("assets"),
  };
  const tx = {
    execute: async () =>
      options.count
        ? Array.from({ length: options.count }, (_, index) => ({
            id: String(index),
          }))
        : nodes.map((n) => ({ id: n.id })),
    query: {
      workspaceNodes: {
        findMany: async () => nodes,
        findFirst: async (input: unknown) =>
          JSON.stringify(input).includes("canonicalNodeId")
            ? options.alias
              ? { id: "dependent" }
              : undefined
            : nodes[0],
      },
      fileVersions: {
        findMany: async () => [
          { s3Key: `${project}/old`, assetId: options.unregistered ? null : "asset-old" },
          { s3Key: `${project}/shared`, assetId: options.unregistered ? null : "asset-shared" },
        ],
      },
    },
    select: () => ({
      from: (target: { table: string }) => ({
        where: () => {
          if (target.table === "projects")
            return {
              for: async () => {
                events.push("lock");
                return [{ id: project }];
              },
            };
          if (target.table === "nodes")
            return Promise.resolve([{ key: `${project}/shared` }]);
          if (target.table === "versions")
            return Promise.resolve([{ key: `${project}/current` }]);
          return Promise.resolve([{ count: 1 }]);
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        events.push("delete");
      },
    }),
    update: (target: { table: string }) => ({
      set: () => ({
        where: async () => {
          if (target.table === "assets") events.push("schedule");
        },
      }),
    }),
  };
  const orm = Object.fromEntries(
    ["and", "eq", "inArray", "notInArray"].map((name) => [
      name,
      (...args: unknown[]) => ({ [name]: args }),
    ]),
  );
  const dependencies: Record<string, unknown> = {
    "drizzle-orm": { ...orm, sql: (...args: unknown[]) => args },
    "@/lib/db/schema": schema,
    "@/lib/db": {
      db: {
        transaction: async (run: (tx: unknown) => Promise<unknown>) => run(tx),
      },
    },
    "@/lib/storage/workspace-file-key": { parseWorkspaceFileKey },
    "@/lib/storage/asset-deletion": {
      scheduleAssetDeletionIfUnreferenced: async (_tx: unknown, ids: string[]) => {
        events.push("schedule");
        return ids;
      },
    },
    "./internal-helpers": {
      recordNodeEvent: async (_p: unknown, _actor: unknown, id: unknown) => {
        assert.equal(id, null, "audit survives target deletion");
        events.push("audit");
      },
    },
  };
  const serviceModule = {
    exports: {} as {
      finishPermanentDelete: (
        project: string,
        id: string,
      ) => Promise<{ deletedIds: string[] }>;
    },
  };
  runInNewContext(compiled, {
    module: serviceModule,
    exports: serviceModule.exports,
    require: (id: string) => {
      assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
      return dependencies[id];
    },
  });
  return {
    run: () => serviceModule.exports.finishPermanentDelete(project, "root"),
    events,
    removed,
  };
}

test("purge detaches rows and schedules registered assets for fenced cleanup", async () => {
  const f = fixture();
  assert.deepEqual(Array.from((await f.run()).deletedIds), ["root"]);
  assert.deepEqual(f.removed, []);
  assert.deepEqual(f.events, ["lock", "audit", "delete", "schedule"]);
});

test("provider I/O never runs while the permanent-delete transaction is locked", async () => {
  const f = fixture();
  await f.run();
  assert.equal(f.events.includes("storage"), false);
  assert.deepEqual(f.events, ["lock", "audit", "delete", "schedule"]);
});

test("repeating a completed deletion is an idempotent no-op", async () => {
  const f = fixture({ missing: true });
  assert.equal((await f.run()).deletedIds.length, 0);
  assert.deepEqual(f.removed, []);
  assert.deepEqual(f.events, ["lock"]);
});

for (const [options, message] of [
  [{ active: true }, /Only items already in Trash/],
  [{ system: true }, /System folders/],
  [{ foreignKey: true }, /storage key/],
  [{ alias: true }, /depends on this original/],
  [{ missingIntent: true }, /not authorized/],
  [{ scopeChanged: true }, /would be deleted has changed/],
  [{ unregistered: true }, /registration is still pending/],
  [{ count: 501 }, /more than 500/],
] as const)
  test(`purge rejects unsafe scope: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    await assert.rejects(f.run(), message);
    assert.deepEqual(f.removed, []);
    assert.deepEqual(f.events, ["lock"]);
  });
