import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { importJobs, importJobFiles, uploadIntents } from '@/lib/db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope';
import { validateCsrf } from '@/lib/security/csrf';
import { assertProjectWriteAccess } from '@/lib/files/internal-helpers';
import { enforceRouteLimit, requireAuthenticatedUser } from '@/app/api/v1/_shared';
import { z } from 'zod';
import { randomUUID } from 'crypto';

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
    .max(200),
});

/**
 * POST /api/v1/github/import/batch-file-intent
 * Registers up to 200 file upload intents in a single batched operation,
 * reducing round-trips from ~25,000 to ~125 for large repo imports.
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
      return auth.response ?? jsonError('Unauthorized', 401, 'UNAUTHORIZED');
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
      return jsonError('Invalid request body', 400, 'BAD_REQUEST');
    }

    const { jobId, files } = parsed.data;

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
      if (!jobFileByPath.has(file.path)) {
        return jsonError(`File path not registered in job manifest: ${file.path}`, 404, 'NOT_FOUND');
      }
    }

    // 3. Generate signed upload URLs in bounded concurrent batches of 10
    const bucket = 'project-files';
    const adminClient = await createAdminClient();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    type IntentPrepared = {
      file: (typeof files)[0];
      jobFileId: string;
      fileId: string;
      storageKey: string;
      signedUrl: string;
    };

    const prepared: IntentPrepared[] = [];
    const CONCURRENCY = 10;

    for (let i = 0; i < files.length; i += CONCURRENCY) {
      const slice = files.slice(i, i + CONCURRENCY);
      const urlResults = await Promise.all(
        slice.map(async (file) => {
          const fileId = randomUUID();
          const storageKey = `imports/${jobId}/files/${fileId}-${file.checksum}`;
          const { data: session, error } = await adminClient.storage
            .from(bucket)
            .createSignedUploadUrl(storageKey);

          if (error || !session?.signedUrl) {
            throw new Error(`Failed to generate signed URL for ${file.path}: ${error?.message || 'unknown'}`);
          }

          const jobFile = jobFileByPath.get(file.path)!;
          return {
            file,
            jobFileId: jobFile.id,
            fileId,
            storageKey,
            signedUrl: session.signedUrl,
          };
        }),
      );
      prepared.push(...urlResults);
    }

    // 4. Batch insert upload intents and update import_job_files in a single atomic transaction
    const results = await db.transaction(async (tx) => {
      const intentValues = prepared.map((item) => ({
        userId: user.id,
        projectId: job.projectId,
        bucket,
        storageKey: item.storageKey,
        scope: 'project_file' as const,
        kind: 'file' as const,
        expectedMimeType: item.file.mimeType,
        expectedSize: item.file.size,
        status: 'pending' as const,
        expiresAt,
        metadata: {
          jobId,
          path: item.file.path,
          checksum: item.file.checksum,
          fileId: item.fileId,
        },
      }));

      const insertedIntents = await tx
        .insert(uploadIntents)
        .values(intentValues)
        .returning({ id: uploadIntents.id, storageKey: uploadIntents.storageKey });

      const intentByStorageKey = new Map(insertedIntents.map((it) => [it.storageKey, it.id]));

      // Single batched update for import_job_files via jsonb_to_recordset
      const updatesPayload = JSON.stringify(
        prepared.map((item) => ({
          id: item.jobFileId,
          upload_intent_id: intentByStorageKey.get(item.storageKey),
          s3_key: item.storageKey,
        })),
      );

      await tx.execute(sql`
        UPDATE import_job_files AS ijf
        SET 
          status = 'uploading',
          upload_intent_id = r.upload_intent_id::uuid,
          s3_key = r.s3_key
        FROM jsonb_to_recordset(${updatesPayload}::jsonb) AS r(
          id uuid,
          upload_intent_id uuid,
          s3_key text
        )
        WHERE ijf.id = r.id
      `);

      return prepared.map((item) => ({
        path: item.file.path,
        uploadIntentId: intentByStorageKey.get(item.storageKey)!,
        signedUrl: item.signedUrl,
        storagePath: item.storageKey,
      }));
    });

    return jsonSuccess({ items: results });
  } catch (error) {
    console.error('[github-import-batch-file-intent] error:', error);
    return jsonError('Internal error', 500, 'INTERNAL_ERROR');
  }
}
