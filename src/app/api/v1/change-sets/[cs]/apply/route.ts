import { requireTokenScope } from "@/app/api/v1/_shared";
import { changeSetRoute, readJson } from "@/app/api/v1/change-sets/_route";
import { ChangeSetError, applyChangeSet } from "@/lib/domain/change-sets";
import { changeSetStepUp } from "@/lib/security/change-set-step-up";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ cs: string }> };

/** Apply all items in one transaction, or only some (route 9). */
export async function POST(request: Request, context: Ctx) {
  const { cs } = await context.params;
  return changeSetRoute(request, { limit: "apply", changeSetId: cs }, async (auth, req) => {
    const body = await readJson(req);
    // A browser session applying final files or a doc verifies it's you first, as in the app (G12).
    const stepUp = await changeSetStepUp(auth, cs);
    if (stepUp) throw new ChangeSetError("These files include final files or a doc: verify it’s you first", 403, "STEP_UP_REQUIRED", { stepUp });
    return applyChangeSet(auth, req, cs, {
      confirmToken: typeof body.confirmToken === "string" ? body.confirmToken : null,
      only: Array.isArray(body.only) ? body.only : null,
      checkScope: (scope) => requireTokenScope(auth, scope),
    });
  });
}
