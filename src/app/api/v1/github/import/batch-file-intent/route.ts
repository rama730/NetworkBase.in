import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { importJobs, importJobFiles } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope';
import { validateCsrf } from '@/lib/security/csrf';
import { assertProjectWriteAccess } from '@/lib/files/internal-helpers';
import { enforceRouteLimit, requireAuthenticatedUser } from '@/app/api/v1/_shared';
import { z } from 'zod';
import { buildProjectFileKey } from '@/lib/storage/workspace-file-key';
import { createUploadIntents } from '@/lib/upload/upload-intents';
import {
  normalizeAndValidateFileSize,
  normalizeAndValidateMimeType,
  normalizeAndValidateUploadRelativePath,
  PROJECT_UPLOAD_MAX_FILE_BYTES,
} from '@/lib/upload/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const batchFileIntentSchema = z.object({
  jobId: z.string().uuid(),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        size: z.number().int().nonnegative(),
        mimeType: z.string().min(1),
        checksum: z.string().length(64), // SHA-256 hex
      }),
    )
    .min(1)
    .max(50),
});

/**
 * POST /api/v1/github/import/batch-file-intent
 * Registers up to 50 file upload intents in one bounded operation.
 */
export async function POST(request: NextRequest) {
  try {
    const csrfError = validateCsrf(request);
    if (csrfError) return csrfError;

    const limitResponse = await enforceRouteLimit(
      request,
      'api:v1:github:import:batch-file-intent',
      200,
      60,
    );
    if (limitResponse) return limitResponse;

    const auth = await requireAuthenticatedUser();
    if (auth.response || !auth.user) {
      return auth.response ?? jsonError('Sign in to continue', 401, 'UNAUTHORIZED');
    }
    const user = auth.user;

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError('Invalid JSON', 400, 'BAD_REQUEST');
    }

    const parsed = batchFileIntentSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('This request isn’t valid', 400, 'BAD_REQUEST');
    }

    const { jobId } = parsed.data;
    const files = parsed.data.files.map((file) => ({
      path: normalizeAndValidateUploadRelativePath(file.path),
      size: normalizeAndValidateFileSize(file.size, PROJECT_UPLOAD_MAX_FILE_BYTES),
      mimeType: normalizeAndValidateMimeType(file.mimeType),
      checksum: file.checksum.toLowerCase(),
    }));
    if (new Set(files.map((file) => file.path)).size !== files.length) {
      return jsonError('Duplicate file paths are not allowed', 400, 'BAD_REQUEST');
    }

    // 1. Validate active import job and user project permissions once
    const job = await db.query.importJobs.findFirst({
      where: and(eq(importJobs.id, jobId), eq(importJobs.status, 'importing')),
    });

    if (!job) {
      return jsonError('Import job not active or not found', 404, 'NOT_FOUND');
    }

    await assertProjectWriteAccess(job.projectId, user.id);

    // 2. Fetch all registered job files in a single query
    const paths = files.map((f) => f.path);
    const jobFileRows = await db.query.importJobFiles.findMany({
      where: and(
        eq(importJobFiles.jobId, jobId),
        inArray(importJobFiles.path, paths),
      ),
    });

    const jobFileByPath = new Map(jobFileRows.map((r) => [r.path, r]));
    for (const file of files) {
      const registered = jobFileByPath.get(file.path);
      if (!registered) {
        return jsonError(`File path not registered in job manifest: ${file.path}`, 404, 'NOT_FOUND');
      }
      if (registered.size !== file.size || registered.checksum.toLowerCase() !== file.checksum) {
        return jsonError(`File does not match the registered manifest: ${file.path}`, 400, 'BAD_REQUEST');
      }
    }

    // 3. Reserve immutable lifecycle identities before issuing credentials.
    const bucket = 'project-files';
    const adminClient = await createAdminClient();

    type IntentPrepared = {
      file: (typeof files)[0];
      jobFileId: string;
      storageKey: string;
      uploadIntentId: string;
      signedUrl: string;
    };

    const allocations = files.map((file) => {
      const jobFile = jobFileByPath.get(file.path)!;
      return {
        file,
        jobFileId: jobFile.id,
        storageKey: buildProjectFileKey(job.projectId, `imports/${jobId}/${jobFile.id}-${file.checksum}`),
      };
    });
    const intents = await createUploadIntents(allocations.map((item) => ({
      userId: user.id,
      projectId: job.projectId,
      bucket,
      storageKey: item.storageKey,
      scope: 'project_file' as const,
      kind: 'file' as const,
      expectedMimeType: item.file.mimeType,
      expectedSize: item.file.size,
      idempotencyKey: `github-import:${jobId}:${item.jobFileId}:${item.file.checksum}`,
      metadata: {
        jobId,
        path: item.file.path,
        checksum: item.file.checksum,
        jobFileId: item.jobFileId,
      },
    })));
    const intentByStorageKey = new Map(intents.map((intent) => [intent.storageKey, intent.id]));
    const prepared: IntentPrepared[] = [];
    for (let i = 0; i < allocations.length; i += 10) {
      const urlResults = await Promise.all(allocations.slice(i, i + 10).map(async (item) => {
          const { data: session, error } = await adminClient.storage
            .from(bucket)
            .createSignedUploadUrl(item.storageKey, { upsert: false });

          if (error || !session?.signedUrl) {
            throw new Error(`Couldn’t generate signed URL for ${item.file.path}: ${error?.message || 'unknown'}`);
          }
          return {
            ...item,
            uploadIntentId: intentByStorageKey.get(item.storageKey)!,
            signedUrl: session.signedUrl,
          };
        }));
      prepared.push(...urlResults);
    }

    await db.transaction(async (tx) => {
      for (const item of prepared) {
        await tx.update(importJobFiles).set({
          status: 'uploading',
          uploadIntentId: item.uploadIntentId,
          s3Key: item.storageKey,
          errorMessage: null,
        }).where(eq(importJobFiles.id, item.jobFileId));
      }
    });

    const results = prepared.map((item) => ({
      path: item.file.path,
      uploadIntentId: item.uploadIntentId,
      signedUrl: item.signedUrl,
      storagePath: item.storageKey,
    }));

    return jsonSuccess({ items: results });
  } catch (error) {
    console.error('[github-import-batch-file-intent] error:', error);
    return jsonError('Internal error', 500, 'INTERNAL_ERROR');
  }
}
