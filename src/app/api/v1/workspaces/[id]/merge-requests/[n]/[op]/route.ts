import { jsonError, jsonSuccess, requireTokenScope } from "@/app/api/v1/_shared";
import { changeSetRoute, readJson } from "@/app/api/v1/change-sets/_route";
import { applySuggestion, commentOnMergeRequest, mergeMergeRequest, postCheck, reviewMergeRequest } from "@/lib/domain/merge-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; n: string; op: string }> };
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

/**
 * Report H14: `reviews` `{ state: approve|request_changes|comment, body? }`; `comments` `{ body?, path?, line?, endLine?,
 * suggestion? }`; `suggestions` `{ commentId }` applies one; `checks` `{ name, state, url?, save? }`; `merge` `{ method:
 * merge|squash, confirmToken? }` (an agent's merge waits for the person's yes, as Apply does).
 */
export async function POST(request: Request, context: Ctx) {
  const { id, n, op } = await context.params;
  return changeSetRoute(request, { limit: op === "merge" ? "apply" : "other", workspaceId: id }, async (auth, req) => {
    const b = await readJson(req);
    if (op === "reviews") {
      if (!["approve", "request_changes", "comment"].includes(b.state)) return jsonError("state is approve, request_changes or comment", 400, "BAD_REQUEST");
      return reviewMergeRequest(auth, id, n, { state: b.state, body: b.body ?? null });
    }
    if (op === "comments") {
      return jsonSuccess(await commentOnMergeRequest(auth, id, n, { body: b.body ?? null, path: b.path ?? null, line: num(b.line), endLine: num(b.endLine), suggestion: typeof b.suggestion === "string" ? b.suggestion : null }), undefined, { status: 201 });
    }
    if (op === "suggestions") return applySuggestion(auth, id, n, String(b.commentId ?? ""));
    if (op === "checks") return postCheck(auth, id, n, { name: String(b.name ?? ""), state: b.state, url: b.url ?? null, saveId: b.save ?? b.saveId ?? null });
    if (op === "merge") {
      return mergeMergeRequest(auth, req, id, n, {
        method: b.method === "squash" ? "squash" : "merge", confirmToken: typeof b.confirmToken === "string" ? b.confirmToken : null,
        checkScope: (scope) => requireTokenScope(auth, scope),
      });
    }
    return jsonError("Not found", 404, "NOT_FOUND");
  });
}
