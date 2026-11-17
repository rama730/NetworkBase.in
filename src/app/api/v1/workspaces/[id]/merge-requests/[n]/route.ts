import { changeSetRoute, readJson } from "@/app/api/v1/change-sets/_route";
import { getMergeRequest, updateMergeRequest } from "@/lib/domain/merge-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; n: string }> };
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? v.split(",") : null);

/** One merge request: header, reviewers, checks, saves, files changed, comments and what happened (H4). */
export async function GET(request: Request, context: Ctx) {
  const { id, n } = await context.params;
  return changeSetRoute(request, { limit: "read", workspaceId: id }, async (auth) => getMergeRequest(auth, id, n));
}

/** Title, description, `draft` (true/false), `state` (closed/open), `addReviewers`, `removeReviewers`. */
export async function PATCH(request: Request, context: Ctx) {
  const { id, n } = await context.params;
  return changeSetRoute(request, { limit: "other", workspaceId: id }, async (auth, req) => {
    const b = await readJson(req);
    return updateMergeRequest(auth, id, n, {
      title: typeof b.title === "string" ? b.title : null, description: typeof b.description === "string" ? b.description : null,
      draft: typeof b.draft === "boolean" ? b.draft : null, state: b.state === "closed" || b.state === "open" ? b.state : null,
      addReviewers: list(b.addReviewers), removeReviewers: list(b.removeReviewers),
    });
  });
}
