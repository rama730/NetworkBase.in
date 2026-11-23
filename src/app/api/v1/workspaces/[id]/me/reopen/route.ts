import { routeErrorResponse } from "@/app/api/v1/_error";
import { journeyError, signedIn } from "@/app/api/v1/_member-journey";
import { getRequestId, idempotentWrite, jsonSuccess } from "@/app/api/v1/_shared";
import { reopenPart } from "@/lib/workspaces/member-journey";

export const runtime = "nodejs";

/** Reopen your part (member settings §3): your role and write access come back; your profile starts a new period. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return idempotentWrite(request, "workspaces.me.reopen", async (req) => {
    try {
      const { response, user, id } = await signedIn(req, context, { csrf: true });
      if (response) return response;
      return jsonSuccess(await reopenPart(user!.id, id));
    } catch (error) {
      try { return journeyError(error); } catch { return routeErrorResponse(error, { requestId: getRequestId(req), scope: "api/v1/workspaces/me/reopen", fallback: "Couldn’t reopen your part" }); }
    }
  });
}
