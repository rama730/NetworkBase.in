import { z } from "zod";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { and, eq, inArray } from "drizzle-orm";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import {
  checksumSchema,
  parseExtensionLeaseMetadata,
  resolveWritableExtensionFile,
  assertNoExtensionWriteConflict,
} from "@/app/api/v1/extension/_file-revision";
import { db } from "@/lib/db";
import { uploadIntents } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import { createAdminClient } from "@/lib/supabase/server";
import { applyFileRevision } from "@/lib/files/apply-file-revision";
import { finalizeUploadIntent } from "@/lib/upload/upload-intents";
import { FILE_REVISION_MODES, normalizeRevisionComment, parseFileRevisionMode } from "@/lib/files/revision-policy";
import { validateCsrf } from "@/lib/security/csrf";
import { recordExtensionMetric } from "@/lib/extension/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bulkFinalizeItemSchema = z.object({
  path: z.string().min(1).max(2_048),
  uploadIntentId: z.string().uuid(),
  checksum: checksumSchema,
  revisionMode: z.enum(FILE_REVISION_MODES).optional(),
  comment: z.string().max(500).optional().nullable(),
});

const bulkFinalizeSchema = z.object({
  projectId: z.string().uuid(),
  uploadSessionId: z.string().optional().nullable(),
  files: z.array(bulkFinalizeItemSchema).min(1).max(50),
});

function readIntentMetadata(intent: typeof uploadIntents.$inferSelect): Record<string, unknown> {
  return intent.metadata && typeof intent.metadata === "object" && !Array.isArray(intent.metadata)
    ? (intent.metadata as Record<string, unknown>)
    : {};
}

async function markIntentFailed(uploadIntentId: string, failureReason: string) {
  await db
    .update(uploadIntents)
    .set({
      status: "failed",
      failureReason,
      updatedAt: new Date(),
    })
    .where(eq(uploadIntents.id, uploadIntentId));
}

export async function POST(request: Request) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response || !auth.user || !auth.extensionSessionId) {
      return auth.response ?? jsonError("An active extension session is required", 401, "UNAUTHORIZED");
    }
    const user = auth.user;

    const body = await request.json().catch(() => null);
    const parsed = bulkFinalizeSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError("Invalid bulk finalize request", 400, "BAD_REQUEST");
    }

    const { projectId, files, uploadSessionId } = parsed.data;

    const access = await getProjectAccessById(projectId, user.id);
    if (!access.project) return jsonError("Project not found", 404, "NOT_FOUND");
    if (!access.canWrite) return jsonError("Forbidden", 403, "FORBIDDEN");

    const adminClient = await createAdminClient();
    const finalizedResults: Array<{
      path: string;
      nodeId: string;
      version: number;
      size: number;
      contentHash: string;
    }> = [];

    if (new Set(files.map((item) => item.uploadIntentId)).size !== files.length) {
      return jsonError("Duplicate upload intent", 400, "BAD_REQUEST");
    }
    const intents = new Map(
      (await db.query.uploadIntents.findMany({
        where: and(
          inArray(uploadIntents.id, files.map((item) => item.uploadIntentId)),
          eq(uploadIntents.userId, user.id),
        ),
      })).map((intent) => [intent.id, intent]),
    );

    for (const item of files) {
      const intent = intents.get(item.uploadIntentId);

      if (!intent) {
        return jsonError(`Upload intent not found for ${item.path}`, 404, "NOT_FOUND");
      }

      const metadata = readIntentMetadata(intent);
      const nodeId = typeof metadata.nodeId === "string" ? metadata.nodeId : "";
      const contentHash = typeof metadata.contentHash === "string" ? metadata.contentHash.toLowerCase() : "";

      if (!nodeId || contentHash !== item.checksum.toLowerCase()) {
        if (intent.status === "pending") {
          await markIntentFailed(intent.id, "Upload intent metadata mismatch");
        }
        return jsonError(`Upload intent metadata mismatch for ${item.path}`, 400, "BAD_REQUEST");
      }

      if (intent.status !== "pending" && intent.status !== "finalized") {
        return jsonError(`Upload intent is not pending for ${item.path}`, 409, "CONFLICT");
      }

      if (intent.status === "pending" && intent.expiresAt.getTime() <= Date.now()) {
        await markIntentFailed(intent.id, "Upload intent expired");
        return jsonError(`Upload intent expired for ${item.path}`, 409, "CONFLICT");
      }

      const lease = parseExtensionLeaseMetadata(metadata);
      if (!lease) {
        await markIntentFailed(intent.id, "Missing editing lease metadata");
        return jsonError(`Valid editing lease required for ${item.path}`, 409, "CONFLICT");
      }

      const resolved = await resolveWritableExtensionFile(projectId, item.path, user.id);
      if (resolved.response || !resolved.node) {
        return resolved.response || jsonError(`File node not found for ${item.path}`, 404, "NOT_FOUND");
      }
      // A retried batch reports files it already applied instead of re-checking
      // their (now advanced) base version.
      if (intent.status === "finalized" && intent.assetId && resolved.node.assetId === intent.assetId) {
        finalizedResults.push({
          path: item.path,
          nodeId: resolved.node.id,
          version: resolved.node.currentVersion ?? 1,
          size: resolved.node.size ?? intent.expectedSize,
          contentHash,
        });
        continue;
      }

      const baseVersion = typeof metadata.baseVersion === "number" ? metadata.baseVersion : null;
      const baseHash = typeof metadata.baseHash === "string" ? metadata.baseHash : null;
      const conflict = await assertNoExtensionWriteConflict({
        node: resolved.node,
        baseVersion,
        baseHash,
      });
      if (conflict) {
        if (intent.status === "pending") await markIntentFailed(intent.id, "Write conflict during finalize");
        return conflict;
      }

      // Server-side verification registers the verified asset and its digest
      // (idempotent for an already finalized intent) (COR-004).
      const verifiedIntent = await finalizeUploadIntent({
        intentId: intent.id,
        bucket: intent.bucket,
        storageKey: intent.storageKey,
        userId: user.id,
        projectId,
        expectedScope: "project_file",
        expectedKind: "file",
      }).catch(async (error: unknown) => {
        if (intent.status === "pending") await markIntentFailed(intent.id, error instanceof Error ? error.message : "Upload verification failed");
        return null;
      });
      if (!verifiedIntent?.assetId) {
        return jsonError(`Uploaded file could not be verified for ${item.path}`, 409, "CONFLICT");
      }
      // A retry after a successful revision reports it instead of re-applying.
      if (resolved.node.assetId === verifiedIntent.assetId) {
        finalizedResults.push({
          path: item.path,
          nodeId: resolved.node.id,
          version: resolved.node.currentVersion ?? 1,
          size: resolved.node.size ?? intent.expectedSize,
          contentHash,
        });
        continue;
      }

      const revisionMode = parseFileRevisionMode(item.revisionMode || (metadata.revisionMode as any));
      const comment = normalizeRevisionComment(item.comment || (metadata.comment as any));

      const result = await applyFileRevision({
        projectId,
        nodeId,
        actorUserId: user.id,
        storageKey: intent.storageKey,
        assetId: verifiedIntent.assetId,
        size: verifiedIntent.finalizedSize ?? intent.expectedSize,
        mimeType: verifiedIntent.finalizedMimeType ?? intent.expectedMimeType,
        contentHash,
        mode: revisionMode,
        comment,
        baseVersion,
        baseHash,
        lease,
        eventType: "extension_file_saved",
        eventMetadata: {
          uploadIntentId: intent.id,
          uploadSessionId: uploadSessionId || null,
          transfer: "bulk_signed_upload",
        },
        syncStatus: "merged",
      });

      finalizedResults.push({
        path: item.path,
        nodeId: result.node.id,
        version: result.version.version,
        size: result.node.size ?? intent.expectedSize,
        contentHash,
      });

      recordExtensionMetric("extension.bulk_finalize.file", {
        action: "bulk_finalize",
        success: true,
        userId: user.id,
        projectId,
        nodeId,
        uploadIntentId: intent.id,
        path: item.path,
        sizeBytes: intent.expectedSize,
      });
    }

    return jsonSuccess({
      uploadSessionId: uploadSessionId || null,
      finalizedCount: finalizedResults.length,
      files: finalizedResults,
    });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/extension/bulk-finalize", fallback: "Failed to finalize bulk uploads" });
  }
}
