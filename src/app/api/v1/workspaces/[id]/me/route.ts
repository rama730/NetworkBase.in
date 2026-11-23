import { routeErrorResponse } from "@/app/api/v1/_error";
import { journeyError, signedIn } from "@/app/api/v1/_member-journey";
import { getRequestId, idempotentWrite, jsonError, jsonSuccess } from "@/app/api/v1/_shared";
import { mySettingsSchema } from "@/lib/api/v1-schemas";
import { getMyPart, updateMySettings } from "@/lib/workspaces/member-journey";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/** Your part here and your settings (member settings Part 1): role, dates, status, completion, what you can do. */
export async function GET(request: Request, context: Ctx) {
  try {
    const { response, user, id } = await signedIn(request, context, { csrf: false });
    if (response) return response;
    return jsonSuccess(await getMyPart(id, user!.id));
  } catch (error) {
    try { return journeyError(error); } catch { return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/me", fallback: "Couldn’t read your part" }); }
  }
}

/** Change your settings here: only stricter than the workspace, and mandatory notifications stay on. */
export async function PATCH(request: Request, context: Ctx) {
  return idempotentWrite(request, "workspaces.me.settings", async (req) => {
    try {
      const { response, user, id } = await signedIn(req, context, { csrf: true });
      if (response) return response;
      const parsed = mySettingsSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return jsonError("Those settings don't look right", 400, "BAD_REQUEST", parsed.error.flatten());
      return jsonSuccess(await updateMySettings(user!.id, id, parsed.data));
    } catch (error) {
      try { return journeyError(error); } catch { return routeErrorResponse(error, { requestId: getRequestId(req), scope: "api/v1/workspaces/me", fallback: "Couldn’t save your settings" }); }
    }
  });
}
