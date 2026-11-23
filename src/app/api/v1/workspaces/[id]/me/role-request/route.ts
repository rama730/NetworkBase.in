import { routeErrorResponse } from "@/app/api/v1/_error";
import { journeyError, signedIn } from "@/app/api/v1/_member-journey";
import { getRequestId, idempotentWrite, jsonError, jsonSuccess } from "@/app/api/v1/_shared";
import { roleRequestSchema } from "@/lib/api/v1-schemas";
import { requestRole } from "@/lib/workspaces/member-journey";

export const runtime = "nodejs";

/** Ask for a different role, with a note (member settings Part 1): the owner and admins are told. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return idempotentWrite(request, "workspaces.me.role-request", async (req) => {
    try {
      const { response, user, id } = await signedIn(req, context, { csrf: true });
      if (response) return response;
      const parsed = roleRequestSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return jsonError("Which role: admin, member or viewer?", 400, "BAD_REQUEST");
      return jsonSuccess(await requestRole(user!.id, id, parsed.data.role, parsed.data.note ?? null));
    } catch (error) {
      try { return journeyError(error); } catch { return routeErrorResponse(error, { requestId: getRequestId(req), scope: "api/v1/workspaces/me/role-request", fallback: "Couldn’t send your request" }); }
    }
  });
}
