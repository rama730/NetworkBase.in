import { changeSetRoute, readJson } from "@/app/api/v1/change-sets/_route";
import { undoChangeSet } from "@/lib/domain/change-sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ cs: string }> };

/** Undo an applied change set; partial undoes the files nobody changed since (route 13). */
export async function POST(request: Request, context: Ctx) {
  const { cs } = await context.params;
  return changeSetRoute(request, { limit: "apply", changeSetId: cs }, async (auth, req) => undoChangeSet(auth, cs, { partial: (await readJson(req)).partial === true }));
}
