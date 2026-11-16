import { changeSetRoute, readJson } from "@/app/api/v1/change-sets/_route";
import { finishChangeSet } from "@/lib/domain/change-sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ cs: string }> };

/** Finish: everything uploaded and checked; answers whether it applies now or needs the person's yes (route 7). */
export async function POST(request: Request, context: Ctx) {
  const { cs } = await context.params;
  return changeSetRoute(request, { limit: "other", changeSetId: cs }, async (auth, req) => {
    const body = await readJson(req);
    return finishChangeSet(auth, cs, { message: body.message ?? null, confirmSecrets: body.confirmSecrets === true });
  });
}
