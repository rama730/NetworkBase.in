import { z } from "zod";
import { jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import {
  buildExtensionRevisionStorageKey,
  checksumSchema,
  resolveWritableExtensionFile,
} from "@/app/api/v1/extension/_file-revision";
import { getProjectAccessById } from "@/lib/data/project-access";
import { createAdminClient } from "@/lib/supabase/server";
import { createUploadIntent } from "@/lib/upload/upload-intents";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bulkIntentItemSchema = z.object({
  path: z.string().min(1).max(2_048),
  size: z.number().int().nonnegative(),
  mimeType: z.string().min(1).max(180),
  contentHash: checksumSchema,
  leaseId: z.string().uuid(),
  fencingToken: z.number().int().positive(),
  comment: z.string().max(500).optional().nullable(),
});

const bulkIntentSchema = z.object({
  projectId: z.string().uuid(),
  clientSessionId: z.string().uuid(),
  operationId: z.string().min(8).max(200).optional().nullable(),
  files: z.array(bulkIntentItemSchema).min(1).max(50),
});

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
    const parsed = bulkIntentSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError("Invalid bulk intent request", 400, "BAD_REQUEST");
    }

    const { projectId, files, clientSessionId, operationId } = parsed.data;

    // 1. Verify project write access
    const access = await getProjectAccessById(projectId, user.id);
    if (!access.project) return jsonError("Project not found", 404, "NOT_FOUND");
    if (!access.canWrite) return jsonError("Forbidden", 403, "FORBIDDEN");

    const uploadSessionId = crypto.randomUUID();
    const adminClient = await createAdminClient();

    // 2. Resolve all files and generate presigned S3 upload URLs concurrently in 1 round trip
    const results = await Promise.all(
      files.map(async (file) => {
        const resolved = await resolveWritableExtensionFile(projectId, file.path, user.id);
        if (resolved.response || !resolved.node) {
          throw new Error(`Failed to resolve file: ${file.path}`);
        }
        const node = resolved.node;
        const storageKey = buildExtensionRevisionStorageKey(projectId, node.id, file.path, file.contentHash);

        const intent = await createUploadIntent({
          userId: user.id,
          projectId,
          bucket: "project-files",
          storageKey,
          scope: "project_file",
          kind: "file",
          expectedMimeType: file.mimeType,
          expectedSize: file.size,
          metadata: {
            nodeId: node.id,
            path: file.path,
            contentHash: file.contentHash.toLowerCase(),
            leaseId: file.leaseId,
            clientSessionId,
            fencingToken: file.fencingToken,
            operationId: operationId ?? uploadSessionId,
            comment: file.comment ?? null,
          },
        });

        const { data: signed, error: signedError } = await adminClient.storage
          .from("project-files")
          .createSignedUploadUrl(storageKey);

        if (signedError || !signed) {
          throw new Error(`Failed to create signed URL for ${file.path}: ${signedError?.message}`);
        }

        return {
          path: file.path,
          nodeId: node.id,
          uploadIntentId: intent.id,
          storageKey,
          uploadUrl: signed.signedUrl,
          token: signed.token,
        };
      }),
    );

    return jsonSuccess({
      uploadSessionId,
      files: results,
    });
  } catch (error: any) {
    return jsonError(error?.message || "Failed to create bulk upload intents", 500, "INTERNAL_ERROR");
  }
}
