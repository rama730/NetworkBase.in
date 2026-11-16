import { changeSetRoute } from "@/app/api/v1/change-sets/_route";
import { jsonError } from "@/app/api/v1/_shared";
import { listFiles, readFiles, searchFiles } from "@/lib/domain/change-set-fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; op: string }> };

/**
 * Routes 14–16 (report G14): list, read and search the workspace's files, as a change set's draft sees them when
 * `changeSet` is given. read takes `path` up to 50 times.
 */
export async function GET(request: Request, context: Ctx) {
  const { id, op } = await context.params;
  return changeSetRoute(request, { limit: "read", workspaceId: id }, async (auth, req) => {
    const q = new URL(req.url).searchParams;
    const changeSet = q.get("changeSet");
    const limit = q.get("limit") ? Number(q.get("limit")) : undefined;
    if (op === "list") return listFiles(auth, id, { changeSet, glob: q.get("glob"), limit });
    if (op === "read") return readFiles(auth, id, { changeSet, paths: q.getAll("path") });
    if (op === "search") return searchFiles(auth, id, { changeSet, query: q.get("query") ?? "", regex: q.get("regex") === "true", caseSensitive: q.get("caseSensitive") === "true", glob: q.get("glob"), limit });
    return jsonError("Not found", 404, "NOT_FOUND");
  });
}
