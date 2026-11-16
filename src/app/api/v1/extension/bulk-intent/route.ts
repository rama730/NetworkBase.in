import { z } from "zod";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser, denyOutsideTokenWorkspace } from "@/app/api/v1/_shared";
import {
  buildExtensionRevisionStorageKey,
  checksumSchema,
  resolveWritableExtensionFile,
} from "@/app/api/v1/extension/_file-revision";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { createAdminClient } from "@/lib/supabase/server";
import { createUploadIntents } from "@/lib/upload/upload-intents";
import { discardUnsavedFileNodes } from "@/lib/files/discard-unsaved";
import { validateCsrf } from "@/lib/security/csrf";
import { bulkIntentSchema } from "@/lib/api/v1-schemas";
import { agentGate, BATCH_LIMIT } from "@/lib/agents/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;
  // New file entries made before a later file failed go again (0.8 #14).
  const created: string[] = [];
  const createdBy = { id: "" };
  const since = new Date();

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

    const { projectId, files, operationId } = parsed.data;
    const outside = await denyOutsideTokenWorkspace(auth, { projectId });
    if (outside) return outside;
    const held = await agentGate(auth, request, parsed.data, { workspaceId: projectId, kinds: [files.length > BATCH_LIMIT ? "batch" : "small"], summary: `Upload ${files.length} large file${files.length === 1 ? "" : "s"}`, preview: files.slice(0, 30).map((f) => f.path).join("\n") });
    if (held) return held;
    const clientSessionId = parsed.data.clientSessionId ?? crypto.randomUUID();

    // 1. Verify project write access
    const access = await getWorkspaceAccessById(projectId, user.id);
    if (!access.project) return jsonError("Workspace not found", 404, "NOT_FOUND");
    if (!access.canWrite) return jsonError("You don’t have access to this", 403, "FORBIDDEN");

    const uploadSessionId = crypto.randomUUID();
    const adminClient = await createAdminClient();

    const resolvedFiles: Array<{
      file: (typeof files)[number];
      node: NonNullable<Awaited<ReturnType<typeof resolveWritableExtensionFile>>["node"]>;
      storageKey: string;
    }> = [];
    for (let offset = 0; offset < files.length; offset += 8) {
      resolvedFiles.push(...await Promise.all(files.slice(offset, offset + 8).map(async (file) => {
        const resolved = await resolveWritableExtensionFile(projectId, file.path, user.id, { createIfMissing: true });
        if (resolved.response || !resolved.node) {
          throw new Error(`Couldn’t resolve file: ${file.path}`);
        }
        const node = resolved.node;
        if (resolved.created) { created.push(node.id); createdBy.id = user.id; }
        const operationIdentity = operationId ?? uploadSessionId;
        const storageKey = buildExtensionRevisionStorageKey(projectId, node.id, file.path, file.contentHash, operationIdentity);
        return { file, node, storageKey };
      })));
    }
    const intents = await createUploadIntents(resolvedFiles.map(({ file, node, storageKey }) => ({
          userId: user.id,
          projectId,
          bucket: "project-files",
          storageKey,
          scope: "workspace_file",
          kind: "file",
          expectedMimeType: file.mimeType,
          expectedSize: file.size,
          idempotencyKey: `extension:${user.id}:${projectId}:${node.id}:${operationId ?? uploadSessionId}:${file.contentHash.toLowerCase()}`,
          metadata: {
            nodeId: node.id,
            path: file.path,
            contentHash: file.contentHash.toLowerCase(),
            leaseId: file.leaseId ?? null,
            clientSessionId,
            fencingToken: file.fencingToken ?? null,
            operationId: operationId ?? uploadSessionId,
            comment: file.comment ?? null,
          },
        })));
    const intentByStorageKey = new Map(intents.map((intent) => [intent.storageKey, intent]));
    const results: Array<{
      path: string;
      nodeId: string;
      uploadIntentId: string;
      storageKey: string;
      uploadUrl: string;
      token: string;
    }> = [];
    for (let offset = 0; offset < resolvedFiles.length; offset += 10) {
      results.push(...await Promise.all(resolvedFiles.slice(offset, offset + 10).map(async ({ file, node, storageKey }) => {
        const intent = intentByStorageKey.get(storageKey);
        if (!intent) throw new Error(`Upload intent allocation failed for ${file.path}`);
        const { data: signed, error: signedError } = await adminClient.storage
          .from("project-files")
          .createSignedUploadUrl(storageKey, { upsert: false });

        if (signedError || !signed) {
          throw new Error(`Couldn’t create signed URL for ${file.path}: ${signedError?.message}`);
        }

        return {
          path: file.path,
          nodeId: node.id,
          uploadIntentId: intent.id,
          storageKey,
          uploadUrl: signed.signedUrl,
          token: signed.token,
        };
      })));
    }

    return jsonSuccess({
      uploadSessionId,
      files: results,
    });
  } catch (error) {
    if (created.length && createdBy.id) await discardUnsavedFileNodes(created, since, { userId: createdBy.id });
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/extension/bulk-intent", fallback: "Couldn’t create bulk upload intents" });
  }
}
