import { changeSetRoute } from "@/app/api/v1/change-sets/_route";
import { listMyReviews } from "@/lib/domain/merge-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "My reviews" (report H23): open merge requests waiting on your review, across your workspaces. Your own terminal
 * sign-in only: tokens tied to one workspace (agents, workspace tokens) are refused by the token route list.
 */
export async function GET(request: Request) {
  return changeSetRoute(request, { limit: "read" }, (auth) => listMyReviews(auth));
}
