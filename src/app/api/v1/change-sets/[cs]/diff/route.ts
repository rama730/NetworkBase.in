import { changeSetRoute } from "@/app/api/v1/change-sets/_route";
import { diffItem } from "@/lib/domain/change-sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ cs: string }> };

/** One file's diff in a change set (report G7 route 8). */
export async function GET(request: Request, context: Ctx) {
  const { cs } = await context.params;
  return changeSetRoute(request, { limit: "read", changeSetId: cs }, (auth, req) => diffItem(auth, cs, new URL(req.url).searchParams.get("path") ?? ""));
}
