import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Zip, ZipPassThrough } from "fflate";

import { db } from "@/lib/db";
import { storageAssetPins, storageAssets } from "@/lib/db/schema";
import {
  buildFolderExportEntries,
  FOLDER_EXPORT_MAX_ENTRIES,
  type FolderExportEntry,
  type FolderExportRow,
} from "@/lib/files/folder-export-contract";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/server";

const FOLDER_EXPORT_MAX_DEPTH = 128;
const FOLDER_EXPORT_SIGNING_WINDOW = 16;
const FOLDER_EXPORT_PIN_MS = 35 * 60 * 1000;
const FOLDER_EXPORT_MAX_MS = 30 * 60 * 1000;
const FOLDER_EXPORT_IDLE_MS = 30 * 1000;

export type PreparedFolderExport = {
  operationId: string;
  entries: FolderExportEntry[];
  totalBytes: number;
  requiresTaskAccess: boolean;
};

export async function prepareFolderExport(input: {
  projectId: string;
  folderId: string | null;
  canReadTaskFiles: boolean;
}): Promise<PreparedFolderExport> {
  const operationId = randomUUID();
  const expiresAt = new Date(Date.now() + FOLDER_EXPORT_PIN_MS);
  const rows = await db.transaction(async (tx) => {
    const anchor = input.folderId
      ? sql`n.id = ${input.folderId} AND n.type = 'folder'`
      : sql`n.parent_id IS NULL`;
    const taskVisibility = input.canReadTaskFiles
      ? sql`true`
      : sql`n.task_id IS NULL AND n.path NOT LIKE '/.system%'`;
    const childTaskVisibility = input.canReadTaskFiles
      ? sql`true`
      : sql`child.task_id IS NULL AND child.path NOT LIKE '/.system%'`;
    const result = await tx.execute<FolderExportRow>(sql`
      WITH RECURSIVE export_tree AS (
        SELECT n.id, n.parent_id, n.type, n.name, n.s3_key, n.asset_id, n.size,
               n.task_id, n.path, 0 AS depth
        FROM public.project_nodes n
        WHERE n.project_id = ${input.projectId}
          AND n.deleted_at IS NULL
          AND ${anchor}
          AND ${taskVisibility}
        UNION ALL
        SELECT child.id, child.parent_id, child.type, child.name, child.s3_key,
               child.asset_id, child.size, child.task_id, child.path, tree.depth + 1
        FROM public.project_nodes child
        JOIN export_tree tree ON tree.id = child.parent_id
        WHERE child.project_id = ${input.projectId}
          AND child.deleted_at IS NULL
          AND tree.depth < ${FOLDER_EXPORT_MAX_DEPTH}
          AND ${childTaskVisibility}
      )
      SELECT tree.*,
             asset.state AS asset_state,
             asset.bucket AS asset_bucket,
             asset.storage_key AS asset_storage_key,
             asset.verified_size AS asset_size
      FROM export_tree tree
      LEFT JOIN public.storage_assets asset ON asset.id = tree.asset_id
      ORDER BY tree.depth, tree.id
      LIMIT ${FOLDER_EXPORT_MAX_ENTRIES + 2}
    `);
    const found = Array.from(result);
    const exportCount = found.length - (input.folderId ? 1 : 0);
    if (exportCount > FOLDER_EXPORT_MAX_ENTRIES) {
      throw new Error("Folder exports are limited to 20,000 entries");
    }
    if (found.some((row) => row.depth >= FOLDER_EXPORT_MAX_DEPTH)) {
      throw new Error("The export folder tree is too deeply nested");
    }

    const { entries } = buildFolderExportEntries(found, input.folderId);
    const assetIds = Array.from(new Set(entries.flatMap((entry) => entry.assetId ? [entry.assetId] : []))).sort();
    if (assetIds.length > 0) {
      const locked = await tx
        .select({ id: storageAssets.id, state: storageAssets.state })
        .from(storageAssets)
        .where(inArray(storageAssets.id, assetIds))
        .orderBy(storageAssets.id)
        .for("update");
      if (locked.length !== assetIds.length || locked.some((asset) => asset.state !== "verified")) {
        throw new Error("One or more files changed while the export was being prepared");
      }
      for (let offset = 0; offset < assetIds.length; offset += 500) {
        await tx.insert(storageAssetPins).values(assetIds.slice(offset, offset + 500).map((assetId) => ({
          assetId,
          operationId,
          kind: "export" as const,
          expiresAt,
        })));
      }
    }
    return found;
  });

  const { entries, totalBytes } = buildFolderExportEntries(rows, input.folderId);
  if (entries.length === 0 || !entries.some((entry) => entry.type === "file")) {
    await releaseFolderExport(operationId);
    throw new Error("No files found to download");
  }
  return {
    operationId,
    entries,
    totalBytes,
    requiresTaskAccess: rows.some((row) => !!row.task_id || row.path.startsWith("/.system")),
  };
}

export async function releaseFolderExport(operationId: string) {
  await db.delete(storageAssetPins).where(eq(storageAssetPins.operationId, operationId));
}

async function readWithIdleDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
) {
  if (signal.aborted) throw signal.reason ?? new Error("Export cancelled");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("A file download stalled")), FOLDER_EXPORT_IDLE_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function streamFolderExport(input: {
  prepared: PreparedFolderExport;
  requestSignal: AbortSignal;
  reauthorize: () => Promise<void>;
}) {
  const abortController = new AbortController();
  const overallTimeout = setTimeout(
    () => abortController.abort(new Error("Folder export exceeded 30 minutes")),
    FOLDER_EXPORT_MAX_MS,
  );
  input.requestSignal.addEventListener(
    "abort",
    () => abortController.abort(input.requestSignal.reason),
    { once: true },
  );
  if (input.requestSignal.aborted) abortController.abort(input.requestSignal.reason);
  const output = new TransformStream<Uint8Array, Uint8Array>();
  const writer = output.writable.getWriter();
  let writes = Promise.resolve();
  let terminalError: Error | null = null;
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      terminalError = error;
      writes = writes.then(() => writer.abort(error));
      return;
    }
    if (chunk?.length) writes = writes.then(() => writer.write(chunk));
    if (final) writes = writes.then(() => writer.close());
  });

  void (async () => {
    const admin = await createAdminClient();
    let lastAuthorizationAt = 0;
    let signingWindow: FolderExportEntry[] = [];
    let signedUrls = new Map<string, string>();
    let processedBytes = 0;
    try {
      for (let index = 0; index < input.prepared.entries.length; index += 1) {
        if (abortController.signal.aborted) throw abortController.signal.reason;
        if (Date.now() - lastAuthorizationAt > 3 * 60 * 1000) {
          await input.reauthorize();
          lastAuthorizationAt = Date.now();
        }
        const entry = input.prepared.entries[index]!;
        const zipEntry = new ZipPassThrough(entry.path);
        zip.add(zipEntry);
        if (entry.type === "folder") {
          zipEntry.push(new Uint8Array(), true);
          await writes;
          continue;
        }

        if (!signedUrls.has(entry.id)) {
          signingWindow = input.prepared.entries
            .slice(index)
            .filter((candidate) => candidate.type === "file" && candidate.bucket === entry.bucket)
            .slice(0, FOLDER_EXPORT_SIGNING_WINDOW);
          const { data, error } = await admin.storage
            .from(entry.bucket!)
            .createSignedUrls(signingWindow.map((candidate) => candidate.storageKey!), 10 * 60);
          if (error || !data || data.length !== signingWindow.length) {
            throw new Error("Failed to authorize export content");
          }
          signedUrls = new Map(data.map((signed, signedIndex) => {
            if (signed.error || !signed.signedUrl) throw new Error("A file is missing from storage");
            return [signingWindow[signedIndex]!.id, signed.signedUrl];
          }));
        }
        const signedUrl = signedUrls.get(entry.id);
        signedUrls.delete(entry.id);
        if (!signedUrl) throw new Error("Failed to authorize an export file");

        const fetchController = new AbortController();
        const forwardAbort = () => fetchController.abort(abortController.signal.reason);
        abortController.signal.addEventListener("abort", forwardAbort, { once: true });
        const firstByteTimeout = setTimeout(
          () => fetchController.abort(new Error("A file download stalled")),
          FOLDER_EXPORT_IDLE_MS,
        );
        let response: Response;
        try {
          response = await fetch(signedUrl, {
            cache: "no-store",
            signal: fetchController.signal,
          });
        } catch (error) {
          abortController.signal.removeEventListener("abort", forwardAbort);
          throw error;
        } finally {
          clearTimeout(firstByteTimeout);
        }
        if (!response.ok || !response.body) {
          abortController.signal.removeEventListener("abort", forwardAbort);
          throw new Error(`A file is unavailable (${response.status})`);
        }
        const reader = response.body.getReader();
        let fileBytes = 0;
        try {
          while (true) {
            const { done, value } = await readWithIdleDeadline(reader, abortController.signal);
            if (done) break;
            fileBytes += value.byteLength;
            processedBytes += value.byteLength;
            if (fileBytes > entry.size || processedBytes > input.prepared.totalBytes) {
              throw new Error("Stored file size exceeds verified export metadata");
            }
            zipEntry.push(value, false);
            await writes;
          }
        } finally {
          await reader.cancel().catch(() => undefined);
          abortController.signal.removeEventListener("abort", forwardAbort);
        }
        if (fileBytes !== entry.size) throw new Error("Stored file size does not match verified export metadata");
        zipEntry.push(new Uint8Array(), true);
        await writes;
        if (terminalError) throw terminalError;
      }
      zip.end();
      await writes;
      logger.metric("storage.folder_export.complete", {
        module: "storage",
        entries: input.prepared.entries.length,
        bytes: processedBytes,
      });
    } catch (error) {
      zip.terminate();
      await writer.abort(error).catch(() => undefined);
      logger.error("storage.folder_export.failed", {
        module: "storage",
        error: error instanceof Error ? error.message : "unknown",
      });
    } finally {
      clearTimeout(overallTimeout);
      await releaseFolderExport(input.prepared.operationId).catch((error) => {
        logger.error("storage.folder_export.pin_release_failed", {
          module: "storage",
          error: error instanceof Error ? error.message : "unknown",
        });
      });
    }
  })();

  return output.readable;
}
