import { jsonSuccess, workspaceIdFromRef } from "@/app/api/v1/_shared";
import { changeSetRoute, readJson } from "@/app/api/v1/change-sets/_route";
import { listChangeSets, startChangeSet } from "@/lib/domain/change-sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Start a change set (report G7 route 1). */
export async function POST(request: Request, context: Ctx) {
  const workspaceId = await workspaceIdFromRef((await context.params).id);
  return changeSetRoute(request, { limit: "other", workspaceId: workspaceId ?? undefined }, async (auth, req) => {
    const body = await readJson(req);
    const changeSet = await startChangeSet(auth, { workspaceId: workspaceId ?? "", title: body.title, taskId: body.taskId ?? null, message: body.message ?? null });
    return jsonSuccess({ changeSet }, undefined, { status: 201 });
  });
}

/** The workspace's change sets, newest first (route 2). */
export async function GET(request: Request, context: Ctx) {
  const workspaceId = await workspaceIdFromRef((await context.params).id);
  return changeSetRoute(request, { limit: "read", workspaceId: workspaceId ?? undefined }, async (auth, req) => {
    const q = new URL(req.url).searchParams;
    return listChangeSets(auth, workspaceId ?? "", { status: q.get("status"), mine: q.get("mine") === "1", cursor: q.get("cursor") });
  });
}
