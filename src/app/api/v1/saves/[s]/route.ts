import { changeSetRoute } from "@/app/api/v1/change-sets/_route";
import { getSave } from "@/lib/domain/saves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One save (report H3, H14): its message, author and files. */
export async function GET(request: Request, context: { params: Promise<{ s: string }> }) {
  const { s } = await context.params;
  return changeSetRoute(request, { limit: "read", saveId: s }, (auth) => getSave(auth, s));
}
