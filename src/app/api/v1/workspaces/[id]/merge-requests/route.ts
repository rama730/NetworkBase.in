import { jsonSuccess } from "@/app/api/v1/_shared";
import { changeSetRoute, readJson } from "@/app/api/v1/change-sets/_route";
import { createMergeRequest, listMergeRequests } from "@/lib/domain/merge-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? v.split(",") : null);

/** Merge requests (report H14): `state` open (with drafts), merged or closed; `review=1` waiting on you; `mine=1`. */
export async function GET(request: Request, context: Ctx) {
  const { id } = await context.params;
  return changeSetRoute(request, { limit: "read", workspaceId: id }, async (auth, req) => {
    const q = new URL(req.url).searchParams;
    return listMergeRequests(auth, id, { state: q.get("state"), reviewRequested: q.get("review") === "1", mine: q.get("mine") === "1" });
  });
}

/** Opens one: `{ source, target?, title?, description?, taskId?, draft?, reviewers? }` (into main; pre-filled). */
export async function POST(request: Request, context: Ctx) {
  const { id } = await context.params;
  return changeSetRoute(request, { limit: "other", workspaceId: id }, async (auth, req) => {
    const b = await readJson(req);
    return jsonSuccess(await createMergeRequest(auth, id, {
      source: String(b.source ?? ""), target: b.target ?? null, title: b.title ?? null, description: b.description ?? null, taskId: b.taskId ?? null,
      draft: b.draft === true, reviewers: list(b.reviewers),
    }), undefined, { status: 201 });
  });
}
