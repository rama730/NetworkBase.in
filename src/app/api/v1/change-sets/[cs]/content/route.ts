import { changeSetRoute, readJson } from "@/app/api/v1/change-sets/_route";
import { putContent } from "@/lib/domain/change-sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ cs: string }> };

/** Upload content: inline up to 4 MB a call, or a signed upload URL for one larger file (route 6). */
export async function POST(request: Request, context: Ctx) {
  const { cs } = await context.params;
  return changeSetRoute(request, { limit: "content", changeSetId: cs }, async (auth, req) => putContent(auth, cs, await readJson(req)));
}
