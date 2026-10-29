import { createHash } from "crypto";
import { z } from "zod";
import { and, eq, isNull, gt, asc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  workspaceNodes,
  fileVersions,
  storageAssets,
  workspaceEventCounters,
} from "@/lib/db/schema";
import {
  requireAuthenticatedUser,
  jsonSuccess,
  jsonError,
  getRequestId,
} from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import {
  assertWorkspaceFileReadAccess,
  visibleFileNodesSql,
} from "@/lib/files/internal-helpers";
import { readBoundedStorageBytes } from "@/lib/storage/bounded-object-read";
import { consumeRateLimit } from "@/lib/security/rate-limit";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    if (
      !(
        await consumeRateLimit(
          `extension-content-search:${auth.user.id}`,
          10,
          60,
        )
      ).allowed
    )
      return jsonError("Too many attempts. Try again in a minute.", 429, "RATE_LIMITED");
    const parsed = z
      .object({
        projectId: z.string().uuid(),
        q: z.string().min(2).max(120),
        cursor: z.string().max(2048).optional(),
      })
      .safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success)
      return jsonError(
        "Use a literal query of 2–120 characters",
        400,
        "BAD_REQUEST",
      );
    const { projectId, q, cursor } = parsed.data;
    const access = await assertWorkspaceFileReadAccess(projectId, auth.user.id);
    const counter = await db.query.workspaceEventCounters.findFirst({
      where: eq(workspaceEventCounters.projectId, projectId),
    });
    const sequence = counter?.nextSequence ?? 0;
    let after: string | undefined;
    if (cursor) {
      try {
        const decoded = z
          .object({
            after: z.string().uuid(),
            sequence: z.number(),
            query: z.string(),
          })
          .parse(JSON.parse(Buffer.from(cursor, "base64url").toString()));
        if (decoded.sequence !== sequence || decoded.query !== q)
          return jsonError(
            "Search snapshot changed. Start the search again.",
            409,
            "CONFLICT",
          );
        after = decoded.after;
      } catch {
        return jsonError("Invalid search cursor", 400, "BAD_REQUEST");
      }
    }
    const rows = await db
      .select({
        id: workspaceNodes.id,
        path: workspaceNodes.path,
        size: fileVersions.size,
        version: fileVersions.version,
        hash: fileVersions.contentHash,
        key: storageAssets.storageKey,
        mimeType: fileVersions.mimeType,
      })
      .from(workspaceNodes)
      .innerJoin(
        fileVersions,
        and(
          eq(fileVersions.nodeId, workspaceNodes.id),
          eq(fileVersions.version, workspaceNodes.currentVersion),
        ),
      )
      .innerJoin(
        storageAssets,
        and(
          eq(storageAssets.id, fileVersions.assetId),
          eq(storageAssets.state, "verified"),
          eq(storageAssets.bucket, "project-files"),
          eq(storageAssets.projectId, projectId),
          eq(storageAssets.storageKey, fileVersions.s3Key),
        ),
      )
      .where(
        and(
          eq(workspaceNodes.projectId, projectId),
          isNull(workspaceNodes.deletedAt),
          eq(workspaceNodes.type, "file"),
          visibleFileNodesSql(access),
          after ? gt(workspaceNodes.id, after) : undefined,
          sql`${fileVersions.size}<=65536`,
          sql`(${fileVersions.mimeType} LIKE 'text/%' OR ${fileVersions.mimeType} IN ('application/json','application/javascript','application/xml'))`,
        ),
      )
      .orderBy(asc(workspaceNodes.id))
      .limit(21);
    const results: Array<{
      nodeId: string;
      path: string;
      version: number;
      hash: string | null;
      line: number;
      snippet: string;
    }> = [];
    let verified = 0;
    let unavailable = 0;
    const pageRows = rows.slice(0, 20);
    let nextRow = 0;
    // Four bounded readers keep a 20-file page within the extension request budget.
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (nextRow < pageRows.length) {
          request.signal.throwIfAborted();
          const row = pageRows[nextRow++]!;
          try {
            const bytes = await readBoundedStorageBytes({
              bucket: "project-files",
              storageKey: row.key,
              maxBytes: 65536,
              timeoutMs: 1500,
              signal: request.signal,
            });
            if (createHash("sha256").update(bytes).digest("hex") !== row.hash) {
              unavailable++;
              continue;
            }
            verified++;
            const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
            let matches = 0;
            for (let index = 0; index < lines.length && matches < 3; index++) {
              const line = lines[index]!;
              if (line.toLowerCase().includes(q.toLowerCase())) {
                results.push({
                  nodeId: row.id,
                  path: row.path,
                  version: row.version,
                  hash: row.hash,
                  line: index + 1,
                  snippet: line.slice(0, 160),
                });
                matches++;
              }
            }
          } catch {
            unavailable++;
          }
        }
      }),
    );
    request.signal.throwIfAborted();
    results.sort((a, b) => a.nodeId.localeCompare(b.nodeId) || a.line - b.line);
    const last = pageRows.at(-1);
    return jsonSuccess({
      scope: "server_content",
      query: q,
      sequence,
      eligibleFilesScanned: Math.min(rows.length, 20),
      verifiedFiles: verified,
      unavailableFiles: unavailable,
      results,
      nextCursor:
        rows.length > 20 && last
          ? Buffer.from(
              JSON.stringify({ after: last.id, sequence, query: q }),
            ).toString("base64url")
          : null,
      limits: { filesPerPage: 20, maxFileBytes: 65536, maxMatchesPerFile: 3 },
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return routeErrorResponse(error, {
      requestId: getRequestId(request),
      scope: "api/v1/extension/search-content",
      fallback: "Content search unavailable",
    });
  }
}
