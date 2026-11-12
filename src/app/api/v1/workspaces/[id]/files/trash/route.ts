import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { getTrashPage } from "@/app/actions/files/mutations";
import { TRASH_RETENTION_DAYS } from "@/lib/files/runtime-budgets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `nb file trash` (report C3): what's in the workspace Trash, newest first, with the days left before it's gone. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const { id } = await context.params;
    if (!UUID.test(id)) return jsonError("Workspace not found", 404, "NOT_FOUND");
    const url = new URL(request.url);
    const page = await getTrashPage(id, url.searchParams.get("q") ?? "", url.searchParams.get("cursor") ?? undefined);
    const now = Date.now();
    return jsonSuccess({
      items: page.nodes.map((n) => ({
        nodeId: n.id, path: n.path, name: n.name, type: n.type, size: n.size, deletedAt: n.deletedAt, deletedBy: n.deletedByUsername ?? n.deletedByName ?? null,
        daysLeft: n.deletedAt ? Math.max(0, TRASH_RETENTION_DAYS - Math.floor((now - new Date(n.deletedAt).getTime()) / 86_400_000)) : TRASH_RETENTION_DAYS,
      })),
      nextCursor: page.nextCursor,
    }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && /access|permission|member/i.test(error.message)) return jsonError(error.message, 403, "FORBIDDEN");
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/files/trash", fallback: "Couldn’t list the Trash" });
  }
}
