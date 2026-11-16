import { changeSetRoute, readJson } from "@/app/api/v1/change-sets/_route";
import { ChangeSetError, resolveItem } from "@/lib/domain/change-sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ cs: string }> };

/** Resolve one conflicted file: mine, theirs, or new content (report G7 route 11). */
export async function POST(request: Request, context: Ctx) {
  const { cs } = await context.params;
  return changeSetRoute(request, { limit: "items", changeSetId: cs }, async (auth, req) => {
    const body = await readJson(req);
    if (!["mine", "theirs", "content"].includes(body.choice)) throw new ChangeSetError("choice is mine, theirs or content", 400, "BAD_REQUEST");
    return resolveItem(auth, cs, { path: String(body.path ?? ""), choice: body.choice, contentHash: body.contentHash ?? null, text: typeof body.text === "string" ? body.text : null });
  });
}
