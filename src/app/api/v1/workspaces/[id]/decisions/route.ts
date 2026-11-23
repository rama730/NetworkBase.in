import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { listWorkspaceDocsAction } from "@/app/actions/workspace/doc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Report 38.11 W12 (`nb decisions list`, networkbase_decision_list, plan A4.1b): decisions this person may read, by D-number. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const id = (await context.params).id;
    if (!z.string().uuid().safeParse(id).success) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
    const outside = await denyOutsideTokenWorkspace(auth, { projectId: id });
    if (outside) return outside;
    const r = await listWorkspaceDocsAction(id);
    if (!r.success) return jsonError("Not found", 404, "NOT_FOUND");
    const label = (n?: number) => (n ? `D-${String(n).padStart(3, "0")}` : null);
    const byId = new Map(r.docs.map((d) => [d.id, d]));
    const decisions = r.docs.filter((d) => d.section === "decisions" && d.decisionNumber).sort((a, b) => (b.decisionNumber ?? 0) - (a.decisionNumber ?? 0))
      .map((d) => ({ number: d.decisionNumber, label: label(d.decisionNumber), title: d.title ?? d.filename.replace(/\.md$/i, ""), status: d.decisionStatus ?? "decided", date: d.date ?? null, slug: d.slug,
        // A4.2: what replaced it, and why it was reversed.
        supersededBy: label(d.supersededBy ? byId.get(d.supersededBy)?.decisionNumber : undefined), reverseReason: d.reverseReason ?? null }));
    return jsonSuccess({ decisions });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/decisions", fallback: "Couldn’t read decisions" });
  }
}
