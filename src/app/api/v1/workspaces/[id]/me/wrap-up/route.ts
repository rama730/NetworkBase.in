import { routeErrorResponse } from "@/app/api/v1/_error";
import { journeyError, signedIn } from "@/app/api/v1/_member-journey";
import { getRequestId, jsonSuccess } from "@/app/api/v1/_shared";
import { previewWrapUp } from "@/lib/workspaces/member-journey";

export const runtime = "nodejs";

/** What's still open before you complete your part or leave (member settings §3, §4). Changes nothing. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { response, user, id } = await signedIn(request, context, { csrf: false });
    if (response) return response;
    return jsonSuccess(await previewWrapUp(id, user!.id));
  } catch (error) {
    try { return journeyError(error); } catch { return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/me/wrap-up", fallback: "Couldn’t check what's open" }); }
  }
}
