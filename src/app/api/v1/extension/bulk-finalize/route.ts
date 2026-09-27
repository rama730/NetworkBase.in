import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
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

    for (const item of files) {
      const intent = await db.query.uploadIntents.findFirst({
        where: and(
          eq(uploadIntents.id, item.uploadIntentId),
          eq(uploadIntents.userId, user.id),
        ),
      });

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

      if (intent.status === "finalized") {
        finalizedResults.push({
          path: item.path,
          nodeId,
          version: typeof metadata.baseVersion === "number" ? metadata.baseVersion : 1,
          size: intent.finalizedSize ?? intent.expectedSize ?? 0,
          contentHash,
        });
        continue;
      }

      if (intent.status !== "pending") {
        return jsonError(`Upload intent is not pending for ${item.path}`, 409, "CONFLICT");
      }

      if (intent.expiresAt.getTime() <= Date.now()) {
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

      const baseVersion = typeof metadata.baseVersion === "number" ? metadata.baseVersion : null;
      const baseHash = typeof metadata.baseHash === "string" ? metadata.baseHash : null;
      const conflict = await assertNoExtensionWriteConflict({
        node: resolved.node,
        baseVersion,
        baseHash,
      });
      if (conflict) {
        await markIntentFailed(intent.id, "Write conflict during finalize");
        return conflict;
      }

      const { data: info, error: infoError } = await adminClient.storage
        .from(intent.bucket)
        .info(intent.storageKey);

      if (infoError || !info) {
        await markIntentFailed(intent.id, infoError?.message || "Uploaded object missing");
        return jsonError(`Uploaded object not found in storage for ${item.path}`, 404, "NOT_FOUND");
      }

      if (info.size !== intent.expectedSize) {
        await markIntentFailed(intent.id, "Uploaded object size mismatch");
        return jsonError(`File size mismatch for ${item.path}`, 400, "BAD_REQUEST");
      }

      const revisionMode = parseFileRevisionMode(item.revisionMode || (metadata.revisionMode as any));
      const comment = normalizeRevisionComment(item.comment || (metadata.comment as any));

      const result = await applyFileRevision({
        projectId,
        nodeId,
        actorUserId: user.id,
        storageKey: intent.storageKey,
        size: intent.expectedSize,
        mimeType: intent.expectedMimeType,
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
        afterMutationTx: async (tx) => {
          await tx
            .update(uploadIntents)
            .set({
              status: "finalized",
              finalizedMimeType: intent.expectedMimeType,
              finalizedSize: intent.expectedSize,
              finalizedAt: new Date(),
              failureReason: null,
              updatedAt: new Date(),
            })
            .where(eq(uploadIntents.id, intent.id));
        },
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
  } catch (error: any) {
    return jsonError(error?.message || "Failed to finalize bulk uploads", 500, "INTERNAL_ERROR");
  }
}
