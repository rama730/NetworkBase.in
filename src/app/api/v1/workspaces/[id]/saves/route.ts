import { changeSetRoute } from "@/app/api/v1/change-sets/_route";
import { listSaves } from "@/lib/domain/saves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Main's history (report H3, H14): 50 saves a page, newest first; filter by path, author or agent, or one by `number`. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return changeSetRoute(request, { limit: "read", workspaceId: id }, async (auth, req) => {
    const q = new URL(req.url).searchParams;
    return listSaves(auth, id, { branch: q.get("branch"), path: q.get("path"), author: q.get("author"), agent: q.get("agent"), number: q.get("number") ? Number(q.get("number")) : null, cursor: q.get("cursor"), limit: q.get("limit") ? Number(q.get("limit")) : undefined });
  });
}
