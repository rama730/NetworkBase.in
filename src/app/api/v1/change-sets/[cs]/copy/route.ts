import { jsonSuccess } from "@/app/api/v1/_shared";
import { changeSetRoute } from "@/app/api/v1/change-sets/_route";
import { copyChangeSet } from "@/lib/domain/change-sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ cs: string }> };

/** Copy an undone or discarded change set as a new draft (report G11, `nb change copy`). */
export async function POST(request: Request, context: Ctx) {
  const { cs } = await context.params;
  return changeSetRoute(request, { limit: "other", changeSetId: cs }, async (auth) => jsonSuccess({ changeSet: await copyChangeSet(auth, cs) }, undefined, { status: 201 }));
}
