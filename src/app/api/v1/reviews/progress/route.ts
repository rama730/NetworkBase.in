import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { listAssignmentsAction, readAssignmentRosterAction } from "@/app/actions/assignments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A class's progress (`nb class progress`, report F1): `?org=<id>` lists the assignments with their counts;
 * `&assignment=<id or words of the title>` adds every student's row (handed in, late, returned, approved, missing).
 * The app's roster, same rules: names for those allowed to see the roster, counts for the rest.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const url = new URL(request.url);
    const org = z.string().uuid().safeParse(url.searchParams.get("org"));
    if (!org.success) return jsonError("Which organization? Pass ?org=<id>", 400, "BAD_REQUEST");
    const list = await listAssignmentsAction(org.data);
    if (!list.success) return jsonError("Organization not found", 404, "NOT_FOUND");
    const ref = (url.searchParams.get("assignment") ?? "").trim().toLowerCase();
    const assignments = list.rows.map((r) => ({ id: r.masterId, title: r.title, dueDate: r.dueDate, status: r.status, counts: r.counts }));
    if (!ref) return jsonSuccess({ assignments });
    const matches = assignments.filter((a) => a.id === ref || a.title.toLowerCase() === ref);
    const hits = matches.length ? matches : assignments.filter((a) => a.title.toLowerCase().includes(ref));
    if (!hits.length) return jsonError(`No assignment matches ${ref}`, 404, "NOT_FOUND");
    if (hits.length > 1) return jsonError(`${hits.length} assignments match ${ref}: ${hits.slice(0, 4).map((h) => h.title).join(", ")}`, 409, "CONFLICT");
    const roster = await readAssignmentRosterAction(hits[0]!.id);
    if (!roster.success) return jsonError("You can't see this class's progress", 403, "FORBIDDEN");
    return jsonSuccess({
      assignment: hits[0], counts: roster.counts, closed: roster.closed,
      rows: roster.rows.map((r) => ({ name: r.label, state: r.state, late: r.late, approved: Boolean(r.approved), submittedAt: r.submittedAt, version: r.version })),
      withoutCopy: roster.withoutCopy.map((p) => p.name),
    }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/reviews/progress", fallback: "Couldn’t read the class's progress" });
  }
}
