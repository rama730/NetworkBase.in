import { eq } from "drizzle-orm";

import {
  requireAuthenticatedUser,
  jsonSuccess,
  jsonError,
  getRequestId,
  idempotentWrite,
} from "@/app/api/v1/_shared";
import { recordUndo } from "@/lib/agents/policy";
import { db } from "@/lib/db";
import { workspaceNodes } from "@/lib/db/schema";
import { ActiveVersionChangedError, activateFileVersion } from "@/lib/files/activate-file-version";
import { withTransientFileLease } from "@/lib/files/file-lock-service";
import { assertWorkspaceWriteAccess } from "@/lib/files/internal-helpers";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { validateCsrf } from "@/lib/security/csrf";
import { routeErrorResponse } from "@/app/api/v1/_error";
import {
  listFileVersionsPage,
  getFileVersionContentAction,
} from "@/app/actions/files/versions";
import { z } from "zod";
import { readVersionBytes } from "@/lib/files/read-version-bytes";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const parsed = z
      .object({
        projectId: z.string().uuid(),
        nodeId: z.string().uuid(),
        version: z.coerce.number().int().positive().optional(),
        encoding: z.enum(["utf8", "base64"]).default("utf8"),
        beforeVersion: z.coerce.number().int().positive().optional(),
      })
      .safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success)
      return jsonError("Invalid file history query", 400, "BAD_REQUEST");
    const input = parsed.data;
    if (input.version) {
      const value = await readVersionBytes({
        projectId: input.projectId,
        nodeId: input.nodeId,
        version: input.version,
        userId: auth.user.id,
        maxBytes: 2 * 1024 * 1024,
      });
      return jsonSuccess({
        content:
          input.encoding === "base64"
            ? Buffer.from(value.bytes).toString("base64")
            : new TextDecoder().decode(value.bytes),
        encoding: input.encoding,
        hash: value.hash,
        size: value.size,
      });
    }
    const [page, node] = await Promise.all([
      listFileVersionsPage(input.projectId, input.nodeId, { limit: 50, beforeVersion: input.beforeVersion }),
      db.query.workspaceNodes.findFirst({ where: eq(workspaceNodes.id, input.nodeId), columns: { currentVersion: true } }),
    ]);
    return jsonSuccess({
      ...page,
      // Which version is active (report C3); "based on" is on each version.
      activeVersion: node?.currentVersion ?? null,
      versions: page.versions.map(({ s3Key, assetId, ...v }) => v),
    });
  } catch (error) {
    return routeErrorResponse(error, {
      requestId: getRequestId(request),
      scope: "api/v1/extension/file-history",
      fallback: "Couldn’t load file history",
    });
  }
}

const useSchema = z.object({ projectId: z.string().uuid(), nodeId: z.string().uuid(), version: z.number().int().positive(), expectActive: z.number().int().positive().optional() });

/** `nb file use <file> v1` (report C3): the app's "Use this version". Nothing is copied; the next save is based on it. */
async function handlePost(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const parsed = useSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Which version?", 400, "BAD_REQUEST");
    const { projectId, nodeId, version, expectActive } = parsed.data;
    const userId = auth.user.id;
    await assertWorkspaceWriteAccess(projectId, userId, { nodeId });
    if (!(await consumeRateLimit(`files-versions:${userId}`, 30, 60)).allowed) return jsonError("Too many attempts. Try again in a minute.", 429, "RATE_LIMITED");
    const result = await withTransientFileLease({ projectId, nodeId, userId }, (lease) =>
      activateFileVersion({ projectId, nodeId, actorUserId: userId, version, lease, expectActive }));
    const undoToken = result.previousVersion !== version
      ? await recordUndo(auth, { workspaceId: projectId, operation: "file.use", summary: `Made v${version} of ${result.node.name} active (was v${result.previousVersion})`, inverse: { kind: "files.restore", projectId, use: true, files: [{ nodeId, created: false, version, previousVersion: result.previousVersion }] } })
      : null;
    return jsonSuccess({ nodeId, path: result.node.path, activeVersion: version, previousVersion: result.previousVersion, undoToken });
  } catch (error) {
    if (error instanceof ActiveVersionChangedError) return jsonError("Someone saved a newer version since. Look at nb file history again.", 409, "VERSION_CONFLICT");
    if (error instanceof Error && error.message === "Version not found") return jsonError("That file has no such version", 404, "NOT_FOUND");
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/extension/file-history", fallback: "Couldn’t use that version" });
  }
}

export async function POST(request: Request) {
  return idempotentWrite(request, "extension.file-use", handlePost);
}
