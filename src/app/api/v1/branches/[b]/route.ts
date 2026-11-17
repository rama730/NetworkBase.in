import { changeSetRoute, readJson } from "@/app/api/v1/change-sets/_route";
import { deleteBranch, getBranch, renameBranch } from "@/lib/domain/branches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ b: string }> };

/** One branch (report H14). */
export async function GET(request: Request, context: Ctx) {
  const { b } = await context.params;
  return changeSetRoute(request, { limit: "read", branchId: b }, (auth) => getBranch(auth, b));
}

/** Rename: `{ name }`, by its creator, owners and admins; never main. */
export async function PATCH(request: Request, context: Ctx) {
  const { b } = await context.params;
  return changeSetRoute(request, { limit: "other", branchId: b }, async (auth, req) => renameBranch(auth, b, String((await readJson(req)).name ?? "")));
}

/** Delete, restorable for 30 days. */
export async function DELETE(request: Request, context: Ctx) {
  const { b } = await context.params;
  return changeSetRoute(request, { limit: "other", branchId: b }, (auth) => deleteBranch(auth, b));
}
