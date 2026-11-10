import { and, eq, isNull } from "drizzle-orm";

import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { readWorkspaceDocAction } from "@/app/actions/workspace/doc";
import { db } from "@/lib/db";
import { workspaceNodes } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One doc with its Markdown (report §18.2, §21 flow C: "change the workspace README"). A doc backed by a
 * workspace file also returns that file's path and current version: an edit is a new version of the file
 * through POST /api/v1/files/place with `versionOf` + `baseVersion`, so a teammate's newer save is a
 * conflict, not an overwrite.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string; slug: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const { id, slug } = await context.params;
    const result = await readWorkspaceDocAction(id, slug);
    if (!result.success) {
      const status = result.code === "NOT_FOUND" ? 404 : result.code === "FORBIDDEN" ? 403 : 400;
      return jsonError(result.error, status, result.code ?? "BAD_REQUEST");
    }
    const doc = result.data;
    const file = doc.linkedNodeId
      ? (
          await db
            .select({ nodeId: workspaceNodes.id, path: workspaceNodes.path, version: workspaceNodes.currentVersion })
            .from(workspaceNodes)
            .where(and(eq(workspaceNodes.id, doc.linkedNodeId), eq(workspaceNodes.projectId, id), isNull(workspaceNodes.deletedAt)))
            .limit(1)
        )[0] ?? null
      : null;
    return jsonSuccess(
      {
        slug: doc.docSlug,
        canEdit: doc.canEdit,
        content: doc.version?.content ?? "",
        contentHash: doc.version?.contentHash ?? null,
        /** The name its file has, or gets on the first edit of a doc with no file yet (POST files/place with linkDoc). */
        filename: doc.docs.find((d) => d.slug === doc.docSlug)?.filename ?? "README.md",
        file,
      },
      undefined,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/docs/slug", fallback: "Couldn’t read the doc" });
  }
}
