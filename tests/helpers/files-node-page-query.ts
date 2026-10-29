import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as orm from "drizzle-orm";
import { projectNodes } from "../../src/lib/db/schema";
import { MAX_TREE_PAGE_SIZE, UUID_RE, normalizeSearchQuery, escapeLikePattern } from "../../src/app/actions/files/_constants";

// Exercise the actual action's query builder without auth cookies or DB writes.
const source = readFileSync("src/app/actions/files/nodes.ts", "utf8");
const start = source.indexOf("export async function getWorkspaceNodes(");
const end = source.indexOf("export async function initializeWorkspaceFilesRoot(", start);
const compiled = ts.transpileModule(source.slice(start, end), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
export async function captureNodePageQuery(projectId: string, sort: "name" | "updated" | "type", cursor?: string, query?: string, itemType?: "file" | "folder") {
  let captured: { where: orm.SQL; orderBy: orm.SQL[]; limit: number } | undefined;
  const serviceModule = { exports: {} as { getWorkspaceNodes: (...args: unknown[]) => Promise<unknown> } };
  let authorized = false;
  runInNewContext(compiled, {
    ...orm, projectNodes, Buffer, console, MAX_TREE_PAGE_SIZE, UUID_RE, normalizeSearchQuery, escapeLikePattern,
    module: serviceModule, exports: serviceModule.exports,
    createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
    assertWorkspaceFileReadAccess: async (id: string) => { if (id !== projectId) throw new Error("Wrong project"); authorized = true; return {}; },
    canReadWorkspaceTaskFiles: () => false,
    orgFileAccessSql: () => undefined,
    projectContentNodeSql: orm.sql`${projectNodes.taskId} IS NULL AND ${projectNodes.path} NOT LIKE '/.system%'`,
    enrichNodesWithLatestVersionAttribution: async (nodes: unknown[]) => nodes,
    db: { query: { projectNodes: { findMany: async (request: typeof captured) => { if (!authorized) throw new Error("Missing authorization"); captured = request; return []; } } } },
  });
  await serviceModule.exports.getWorkspaceNodes(projectId, null, query, 2, cursor, { sort, itemType });
  if (!captured) throw new Error("No query captured");
  return captured;
}
