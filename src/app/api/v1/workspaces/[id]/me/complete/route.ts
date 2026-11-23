import { routeErrorResponse } from "@/app/api/v1/_error";
import { idOfUsername, journeyError, signedIn } from "@/app/api/v1/_member-journey";
import { getRequestId, idempotentWrite, jsonError, jsonSuccess } from "@/app/api/v1/_shared";
import { completePartSchema } from "@/lib/api/v1-schemas";
import { completePart } from "@/lib/workspaces/member-journey";

export const runtime = "nodejs";

/** Complete your part (member settings §3): you stay a member, read-only, until you reopen it. Returns an undo id. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return idempotentWrite(request, "workspaces.me.complete", async (req) => {
    try {
      const { response, user, id } = await signedIn(req, context, { csrf: true });
      if (response) return response;
      const parsed = completePartSchema.safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) return jsonError("A note up to 280 characters, and tasks: keep, give or unassign", 400, "BAD_REQUEST", parsed.error.flatten());
      const giveTo = await idOfUsername(parsed.data.giveTo);
      if (parsed.data.giveTo && !giveTo) return jsonError(`No one called @${parsed.data.giveTo.replace(/^@/, "")}`, 404, "NOT_FOUND");
      const reviewsTo = await idOfUsername(parsed.data.reviewsTo);
      if (parsed.data.reviewsTo && !reviewsTo) return jsonError(`No one called @${parsed.data.reviewsTo.replace(/^@/, "")}`, 404, "NOT_FOUND");
      const done = await completePart(user!.id, id, user!.id, { note: parsed.data.note ?? null, tasks: parsed.data.tasks, giveTo, reviewsTo });
      return jsonSuccess(done, undefined, done.undoId ? { headers: { "x-nb-undo": done.undoId } } : undefined);
    } catch (error) {
      try { return journeyError(error); } catch { return routeErrorResponse(error, { requestId: getRequestId(req), scope: "api/v1/workspaces/me/complete", fallback: "Couldn’t complete your part" }); }
    }
  });
}
