import { jsonSuccess } from "@/app/api/v1/_shared";
import { changeSetRoute, readJson } from "@/app/api/v1/change-sets/_route";
import { createBranch, listBranches } from "@/lib/domain/branches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Branches (report H14): main first, with ahead, behind and the last save. `status`: active, stale, merged, deleted. */
export async function GET(request: Request, context: Ctx) {
  const { id } = await context.params;
  return changeSetRoute(request, { limit: "read", workspaceId: id }, async (auth, req) => {
    const q = new URL(req.url).searchParams;
    return listBranches(auth, id, { status: q.get("status"), mine: q.get("mine") === "1" });
  });
}

/** A new branch: `{ name, from?, taskId? }`, from main unless `from` names another branch. */
export async function POST(request: Request, context: Ctx) {
  const { id } = await context.params;
  return changeSetRoute(request, { limit: "other", workspaceId: id }, async (auth, req) => {
    const body = await readJson(req);
    return jsonSuccess(await createBranch(auth, id, { name: String(body.name ?? ""), from: body.from ?? null, taskId: body.taskId ?? null }), undefined, { status: 201 });
  });
}
