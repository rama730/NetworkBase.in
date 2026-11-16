import { changeSetRoute, readJson } from "@/app/api/v1/change-sets/_route";
import { addComment, listComments, resolveComment } from "@/lib/domain/change-sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ cs: string }> };

/** A change set's review comments (report G12). */
export async function GET(request: Request, context: Ctx) {
  const { cs } = await context.params;
  return changeSetRoute(request, { limit: "read", changeSetId: cs }, async (auth) => ({ comments: await listComments(auth, cs) }));
}

/** Add a comment on a file, optionally a line: `{ path, line?, body }`; or `{ id, resolved }` to mark one done. */
export async function POST(request: Request, context: Ctx) {
  const { cs } = await context.params;
  return changeSetRoute(request, { limit: "items", changeSetId: cs }, async (auth, req) => {
    const body = await readJson(req);
    if (typeof body.id === "string") return resolveComment(auth, cs, body.id, body.resolved !== false);
    return addComment(auth, cs, { path: String(body.path ?? ""), line: body.line ?? null, body: String(body.body ?? "") });
  });
}
