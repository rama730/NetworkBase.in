import { changeSetRoute } from "@/app/api/v1/change-sets/_route";
import { discardChangeSet } from "@/lib/domain/change-sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ cs: string }> };

/** Discard an open or ready change set (route 12). */
export async function POST(request: Request, context: Ctx) {
  const { cs } = await context.params;
  return changeSetRoute(request, { limit: "other", changeSetId: cs }, (auth) => discardChangeSet(auth, cs));
}
