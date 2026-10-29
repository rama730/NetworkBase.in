import {
  requireAuthenticatedUser,
  jsonSuccess,
  jsonError,
  getRequestId,
} from "@/app/api/v1/_shared";
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
    const page = await listFileVersionsPage(input.projectId, input.nodeId, {
      limit: 50,
      beforeVersion: input.beforeVersion,
    });
    return jsonSuccess({
      ...page,
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
