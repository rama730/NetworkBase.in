import { changeSetRoute } from "@/app/api/v1/change-sets/_route";
import { getChangeSet } from "@/lib/domain/change-sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ cs: string }> };

/** One change set with its items, 500 a page (report G7 route 3). */
export async function GET(request: Request, context: Ctx) {
  const { cs } = await context.params;
  return changeSetRoute(request, { limit: "read", changeSetId: cs }, (auth, req) => getChangeSet(auth, cs, { cursor: new URL(req.url).searchParams.get("cursor") }));
}
