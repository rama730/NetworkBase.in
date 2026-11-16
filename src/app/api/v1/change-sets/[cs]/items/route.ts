import { changeSetRoute, readJson } from "@/app/api/v1/change-sets/_route";
import { dropItem, upsertItems } from "@/lib/domain/change-sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ cs: string }> };

/** Add or update items, up to 200 a call; answers with the content still missing (route 4). */
export async function PUT(request: Request, context: Ctx) {
  const { cs } = await context.params;
  return changeSetRoute(request, { limit: "items", changeSetId: cs }, async (auth, req) => upsertItems(auth, cs, (await readJson(req)).items));
}

/** Drop one item: "revert this file" in the draft (route 5). */
export async function DELETE(request: Request, context: Ctx) {
  const { cs } = await context.params;
  return changeSetRoute(request, { limit: "items", changeSetId: cs }, (auth, req) => dropItem(auth, cs, new URL(req.url).searchParams.get("path") ?? ""));
}
