import { validateCsrf } from "@/lib/security/csrf";
import {
  requireAuthenticatedUser,
  jsonSuccess,
  jsonError,
  getRequestId,
} from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import {
  renameNode,
  moveProjectNodes,
  bulkTrashNodes,
} from "@/app/actions/files/mutations";
import { z } from "zod";
export const runtime = "nodejs";
const schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("move"),
    projectId: z.string().uuid(),
    nodeId: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    expectedUpdatedAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("rename"),
    projectId: z.string().uuid(),
    nodeId: z.string().uuid(),
    name: z.string().min(1).max(255),
    expectedUpdatedAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("trash"),
    projectId: z.string().uuid(),
    nodeId: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime(),
  }),
]);
export async function POST(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Not authenticated", 401, "UNAUTHORIZED");
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success)
      return jsonError("Invalid file operation", 400, "BAD_REQUEST");
    const i = parsed.data;
    if (i.kind === "move")
      return jsonSuccess(
        await moveProjectNodes([i.nodeId], i.parentId, i.projectId, {
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
