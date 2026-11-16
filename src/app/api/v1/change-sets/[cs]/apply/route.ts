import { requireTokenScope } from "@/app/api/v1/_shared";
import { changeSetRoute, readJson } from "@/app/api/v1/change-sets/_route";
import { applyChangeSet } from "@/lib/domain/change-sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ cs: string }> };

/** Apply all items in one transaction, or only some (route 9). */
export async function POST(request: Request, context: Ctx) {
  const { cs } = await context.params;
  return changeSetRoute(request, { limit: "apply", changeSetId: cs }, async (auth, req) => {
    const body = await readJson(req);
    return applyChangeSet(auth, req, cs, {
      confirmToken: typeof body.confirmToken === "string" ? body.confirmToken : null,
      only: Array.isArray(body.only) ? body.only : null,
      checkScope: (scope) => requireTokenScope(auth, scope),
    });
  });
}
