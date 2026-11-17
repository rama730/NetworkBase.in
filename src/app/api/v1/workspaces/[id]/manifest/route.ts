import { and, asc, eq, gt, isNull, notLike, sql } from "drizzle-orm";
import { z } from "zod";

import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { db } from "@/lib/db";
import { fileVersions, workspaceNodes } from "@/lib/db/schema";
import { assertWorkspaceFileReadAccess, visibleFileNodesSql } from "@/lib/files/internal-helpers";
import { WORKSPACE_UPLOAD_MAX_FILE_BYTES } from "@/lib/upload/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = 5000;

/**
 * Every file the caller may see, with its version and hash, in pages of 5,000 (report A2.5, A12.8,
 * finding 64). The CLI compares this with its local state to decide what to pull and push, in a few
 * requests instead of a search loop that stopped after five pages. Task working files (/.system) are
 * listed per task, not here (A1.4).
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const { id } = await context.params;
    // A branch's files (report H14): the resolver, with each file's revision as its version (the CLI compares
    // versions and hashes, so its planner works unchanged). Paged by path.
    const branchRef = new URL(request.url).searchParams.get("branch");
    if (branchRef && branchRef.toLowerCase() !== "main") {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
      const { findBranch, listBranchFiles } = await import("@/lib/domain/branches");
      const { ChangeSetError } = await import("@/lib/domain/change-sets");
      try {
        const actor = auth as unknown as import("@/lib/domain/change-sets").Actor;
        const branch = await findBranch(id, branchRef);
        if (branch.status !== "active") return jsonError(`The branch ${branch.name} was deleted`, 410, "BRANCH_DELETED" as never);
        const page = await listBranchFiles(actor, branch.id, { cursor: new URL(request.url).searchParams.get("cursor") });
        const access = await assertWorkspaceFileReadAccess(id, auth.user.id);
        return jsonSuccess({
          files: page.files.map((f) => ({ nodeId: f.nodeId ?? "", path: f.path, version: f.revision, contentHash: f.contentHash, size: f.size ?? 0, updatedAt: null, ...(f.executable ? { executable: true } : {}) })),
          nextCursor: page.nextCursor, canWrite: access.canWrite, branch: { id: branch.id, name: branch.name },
          limits: { largestFileBytes: WORKSPACE_UPLOAD_MAX_FILE_BYTES },
        }, undefined, { headers: { "Cache-Control": "private, no-store" } });
      } catch (error) {
        if (error instanceof ChangeSetError) return jsonError(error.message, error.status, error.code as never, error.details);
        throw error;
      }
    }
    const query = z
      .object({ projectId: z.string().uuid(), after: z.string().uuid().optional() })
      .safeParse({ projectId: id, after: new URL(request.url).searchParams.get("cursor") ?? undefined });
    if (!query.success) return jsonError("Invalid workspace or cursor", 400, "BAD_REQUEST");
    const { projectId, after } = query.data;

    const access = await assertWorkspaceFileReadAccess(projectId, auth.user.id);
    const rows = await db
      .select({
        nodeId: workspaceNodes.id,
        path: workspaceNodes.path,
        version: workspaceNodes.currentVersion,
        contentHash: fileVersions.contentHash,
        size: workspaceNodes.size,
        updatedAt: workspaceNodes.updatedAt,
        // The executable bit (report G16): only sent when set, so the manifest stays the same size.
        executable: sql<boolean | null>`nullif((${workspaceNodes.metadata}->>'executable')::boolean, false)`,
      })
      .from(workspaceNodes)
      .leftJoin(fileVersions, and(eq(fileVersions.nodeId, workspaceNodes.id), eq(fileVersions.version, workspaceNodes.currentVersion)))
      .where(
        and(
          eq(workspaceNodes.projectId, projectId),
          eq(workspaceNodes.type, "file"),
          isNull(workspaceNodes.deletedAt),
          notLike(workspaceNodes.path, "/.system%"),
          visibleFileNodesSql(access),
          after ? gt(workspaceNodes.id, after) : undefined,
        ),
      )
      .orderBy(asc(workspaceNodes.id))
      .limit(PAGE + 1);

    const files = rows.slice(0, PAGE).map(({ executable, ...f }) => (executable ? { ...f, executable } : f));
    return jsonSuccess(
      {
        files,
        nextCursor: rows.length > PAGE ? files[files.length - 1]!.nodeId : null,
        canWrite: access.canWrite,
        limits: { largestFileBytes: WORKSPACE_UPLOAD_MAX_FILE_BYTES },
      },
      undefined,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/manifest", fallback: "Couldn’t list workspace files" });
  }
}
