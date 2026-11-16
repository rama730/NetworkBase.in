import { changeSetRoute } from "@/app/api/v1/change-sets/_route";
import { updateDraft } from "@/lib/domain/change-sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ cs: string }> };

/** Update the draft: merge the workspace's newer versions into it now (report G7 route 10). */
export async function POST(request: Request, context: Ctx) {
  const { cs } = await context.params;
  return changeSetRoute(request, { limit: "other", changeSetId: cs }, (auth) => updateDraft(auth, cs));
}
