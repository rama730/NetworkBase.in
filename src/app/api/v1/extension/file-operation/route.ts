import { validateCsrf } from "@/lib/security/csrf";
import {
  requireAuthenticatedUser,
  jsonSuccess,
  jsonError,
  getRequestId, denyOutsideTokenWorkspace
} from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import {
  renameNode,
  moveWorkspaceNodes,
  bulkTrashNodes,
} from "@/app/actions/files/mutations";
import { z } from "zod";
import { fileOperationSchema } from "@/lib/api/v1-schemas";
import { agentGate } from "@/lib/agents/policy";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const parsed = fileOperationSchema.safeParse(await request.json());
    if (!parsed.success)
      return jsonError("Invalid file operation", 400, "BAD_REQUEST");
    const i = parsed.data;
    const outside = await denyOutsideTokenWorkspace(auth, { projectId: i.projectId });
    if (outside) return outside;
    // Moving, renaming and deleting files changes what everyone sees: an agent's person agrees first (report §26.6).
    const held = await agentGate(auth, request, i, { workspaceId: i.projectId, kinds: ["file-move"], summary: i.kind === "trash" ? "Move a file to the Trash" : i.kind === "rename" ? `Rename a file to ${i.name}` : "Move a file" });
    if (held) return held;
    if (i.kind === "move")
      return jsonSuccess(
        await moveWorkspaceNodes([i.nodeId], i.parentId, i.projectId, {
          expectedUpdatedAtByNode: { [i.nodeId]: i.expectedUpdatedAt },
        }),
      );
    return jsonSuccess(
      i.kind === "rename"
        ? await renameNode(i.nodeId, i.name, i.projectId, i.expectedUpdatedAt)
        : await bulkTrashNodes([i.nodeId], i.projectId, {
            [i.nodeId]: i.expectedUpdatedAt,
          }),
    );
  } catch (error) {
    return routeErrorResponse(error, {
      requestId: getRequestId(request),
      scope: "api/v1/extension/file-operation",
      fallback: "File operation failed",
    });
  }
}
