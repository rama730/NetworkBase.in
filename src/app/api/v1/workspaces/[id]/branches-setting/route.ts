import { changeSetRoute, readJson } from "@/app/api/v1/change-sets/_route";
import { jsonError } from "@/app/api/v1/_shared";
import { setBranchesEnabled } from "@/lib/domain/saves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The workspace's "Branches" setting (report H16): owners and admins, people only. `{ enabled: boolean }`. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return changeSetRoute(request, { limit: "other", workspaceId: id }, async (auth, req) => {
    const body = await readJson(req);
    if (typeof body.enabled !== "boolean") return jsonError("Send { enabled: true } or { enabled: false }", 400, "BAD_REQUEST");
    return setBranchesEnabled(auth, id, body.enabled);
  });
}
