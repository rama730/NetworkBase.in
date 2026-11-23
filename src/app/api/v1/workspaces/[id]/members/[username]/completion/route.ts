import { routeErrorResponse } from "@/app/api/v1/_error";
import { idOfUsername, journeyError, signedIn } from "@/app/api/v1/_member-journey";
import { getRequestId, idempotentWrite, jsonError, jsonSuccess } from "@/app/api/v1/_shared";
import { completionDecisionSchema } from "@/lib/api/v1-schemas";
import { decideCompletion } from "@/lib/workspaces/member-journey";

export const runtime = "nodejs";

/** The owner's answer to a completed part (member settings §3): confirm, or not yet with a note. */
export async function POST(request: Request, context: { params: Promise<{ id: string; username: string }> }) {
  return idempotentWrite(request, "workspaces.members.completion", async (req) => {
    try {
      const { response, user, id } = await signedIn(req, context, { csrf: true });
      if (response) return response;
      const { username } = await context.params;
      const target = await idOfUsername(decodeURIComponent(username));
      if (!target) return jsonError(`No one called @${decodeURIComponent(username).replace(/^@/, "")}`, 404, "NOT_FOUND");
      const parsed = completionDecisionSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return jsonError("Confirm or not_yet?", 400, "BAD_REQUEST");
      return jsonSuccess(await decideCompletion(user!.id, id, target, parsed.data.decision, parsed.data.note ?? null));
    } catch (error) {
      try { return journeyError(error); } catch { return routeErrorResponse(error, { requestId: getRequestId(req), scope: "api/v1/workspaces/members/completion", fallback: "Couldn’t save your answer" }); }
    }
  });
}
