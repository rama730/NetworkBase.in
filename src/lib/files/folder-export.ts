import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { Zip, ZipPassThrough } from "fflate";

import { db } from "@/lib/db";
import { storageAssetPins, storageAssets } from "@/lib/db/schema";
import {
  buildFolderExportEntries,
  buildSelectionExportEntries,
  uniqueExportName,
  FOLDER_EXPORT_MAX_BYTES,
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
  /** Files with no stored copy, left out of the zip. */
  skippedFiles: number;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Locks and pins every asset in an export so nothing is purged while the zip streams. */
async function pinExportAssets(tx: Tx, entries: FolderExportEntry[], operationId: string, expiresAt: Date) {
  const assetIds = Array.from(new Set(entries.flatMap((entry) => entry.assetId ? [entry.assetId] : []))).sort();
  if (assetIds.length === 0) return;
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

/**
 * Download all (report §23.5): one folder per person or team with the files on their handed-in copy of one
 * assignment; excused copies are skipped. Copies in child projects (group copies) are named by project.
 */
export async function prepareSubmissionsExport(input: { masterId: string; dryRun?: boolean }): Promise<PreparedFolderExport> {
  // ponytail: streams straight to the admin; the report's background job and "ready" notice come when classes
  // outgrow the 1 GB / 20,000-entry export ceiling.
  const operationId = randomUUID();
  const expiresAt = new Date(Date.now() + FOLDER_EXPORT_PIN_MS);
  let skippedFiles = 0;
  const entries = await db.transaction(async (tx) => {
    const rows = Array.from(await tx.execute<{ copy_id: string; who: string; id: string; name: string; asset_id: string | null; s3_key: string | null; size: number | null; bucket: string | null; storage_key: string | null; verified_size: number | null }>(sql`
      SELECT c.id AS copy_id,
             coalesce(c.team_name, (SELECT p.title FROM workspaces p WHERE p.id = c.workspace_id AND p.id <> m.workspace_id),
                      (SELECT coalesce(pr.full_name, pr.username) FROM profiles pr WHERE pr.id = c.assignee_id), 'Member') AS who,
             n.id, n.name, n.asset_id, n.s3_key, n.size, a.bucket, a.storage_key, a.verified_size
      FROM tasks c JOIN tasks m ON m.id = c.assignment_id
      JOIN workspace_nodes n ON n.task_id = c.id AND n.type = 'file' AND n.deleted_at IS NULL
      LEFT JOIN storage_assets a ON a.id = n.asset_id
      WHERE c.assignment_id = ${input.masterId} AND c.deleted_at IS NULL AND c.excused_at IS NULL
        AND (c.submission IS NOT NULL OR c.review_status IN ('pending', 'approved') OR c.status = 'done')
      ORDER BY 2, n.name
      LIMIT ${FOLDER_EXPORT_MAX_ENTRIES + 1}`));
    const clean = (value: string) => value.replace(/[\/\\:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 120) || "Untitled";
    const folders = new Map<string, string>();
    const used = new Set<string>();
    const list: FolderExportEntry[] = [];
    const usedInFolder = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!(row.storage_key ?? row.s3_key)) {
        skippedFiles += 1;
        continue;
      }
      if (!folders.has(row.copy_id)) {
        let name = clean(row.who);
        for (let i = 2; used.has(name); i++) name = `${clean(row.who)} (${i})`;
        used.add(name);
        folders.set(row.copy_id, name);
        list.push({ id: row.copy_id, path: name, type: "folder", bucket: null, storageKey: null, assetId: null, size: 0 });
      }
      const usedNames = usedInFolder.get(row.copy_id) ?? new Set<string>();
      usedInFolder.set(row.copy_id, usedNames);
      list.push({
        id: row.id, path: `${folders.get(row.copy_id)}/${uniqueExportName(usedNames, clean(row.name))}`, type: "file",
        bucket: row.bucket ?? "project-files", storageKey: row.storage_key ?? row.s3_key, assetId: row.asset_id, size: Number(row.verified_size ?? row.size ?? 0),
      });
    }
    if (!list.some((entry) => entry.type === "file")) throw new Error("No submitted files to download yet");
    // Never a partial zip: the person folders count toward the entry cap too.
    if (list.length > FOLDER_EXPORT_MAX_ENTRIES) throw new Error(`Submissions are limited to ${FOLDER_EXPORT_MAX_ENTRIES.toLocaleString("en")} files per download`);
    // Checked before pinning, or a refused download would hold its files until the pins expire.
    if (list.reduce((sum, entry) => sum + entry.size, 0) > FOLDER_EXPORT_MAX_BYTES) throw new Error("Submissions are limited to 1 GB per download");
    if (!input.dryRun) await pinExportAssets(tx, list, operationId, expiresAt);
    return list;
  });
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  return { operationId, entries, totalBytes, requiresTaskAccess: true, skippedFiles };
}

export async function prepareFolderExport(input: {
  projectId: string;
  folderId: string | null;
  /** Chosen items instead of a folder: files or folders, with folder contents included. */
  nodeIds?: string[];
  /** Answers whether this export would work, for the check before a download. Pins nothing. */
  dryRun?: boolean;
  canReadTaskFiles: boolean;
  /** Org folder access per row alias (report §23.4): members' zips skip Admins-only folders and others' copies. */
  nodeFilter?: (alias: "n" | "child") => SQL | undefined;
}): Promise<PreparedFolderExport> {
  const operationId = randomUUID();
  const expiresAt = new Date(Date.now() + FOLDER_EXPORT_PIN_MS);
  const exportResult = await db.transaction(async (tx) => {
    const anchor = input.nodeIds
      ? sql`n.id IN (${sql.join(input.nodeIds.map((id) => sql`${id}::uuid`), sql`, `)})`
      : input.folderId
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
        FROM public.workspace_nodes n
        WHERE n.workspace_id = ${input.projectId}
          AND n.deleted_at IS NULL
          AND ${anchor}
          AND ${taskVisibility}
          AND ${input.nodeFilter?.("n") ?? sql`true`}
        UNION ALL
        SELECT child.id, child.parent_id, child.type, child.name, child.s3_key,
               child.asset_id, child.size, child.task_id, child.path, tree.depth + 1
        FROM public.workspace_nodes child
        JOIN export_tree tree ON tree.id = child.parent_id
        WHERE child.workspace_id = ${input.projectId}
          AND child.deleted_at IS NULL
          AND tree.depth < ${FOLDER_EXPORT_MAX_DEPTH}
          AND ${childTaskVisibility}
          AND ${input.nodeFilter?.("child") ?? sql`true`}
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

    const { entries, totalBytes, skippedFiles } = input.nodeIds ? buildSelectionExportEntries(found) : buildFolderExportEntries(found, input.folderId);
    if (entries.length === 0 || !entries.some((entry) => entry.type === "file")) {
      throw new Error("No files found to download");
    }

    if (!input.dryRun) await pinExportAssets(tx, entries, operationId, expiresAt);
    return { rows: found, entries, totalBytes, skippedFiles };
  });

  return {
    operationId,
    entries: exportResult.entries,
    totalBytes: exportResult.totalBytes,
    skippedFiles: exportResult.skippedFiles,
    requiresTaskAccess: exportResult.rows.some((row) => !!row.task_id || row.path.startsWith("/.system")),
  };
}

/** Whether every file in a running export still passes the viewer's org folder rules. */
export async function exportEntriesStillVisible(entries: FolderExportEntry[], nodeFilter: (alias: "n" | "child") => SQL | undefined) {
  const ids = entries.filter((entry) => entry.type === "file").map((entry) => entry.id);
  if (ids.length === 0) return true;
  const rows = await db.execute<{ visible: number | string }>(sql`
    SELECT count(*) AS visible FROM public.workspace_nodes n
    WHERE n.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      AND ${nodeFilter("n") ?? sql`true`}`);
  return Number(Array.from(rows)[0]?.visible ?? 0) === ids.length;
}

export async function releaseFolderExport(operationId: string) {
  await db.delete(storageAssetPins).where(eq(storageAssetPins.operationId, operationId));
}

async function readWithIdleDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
) {
  if (signal.aborted) throw signal.reason ?? new Error("Export canceled");
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
  input.requestSignal.addEventListener(
    "abort",
    () => abortController.abort(input.requestSignal.reason),
    { once: true },
  );
  if (input.requestSignal.aborted) abortController.abort(input.requestSignal.reason);
  let outputController!: TransformStreamDefaultController<Uint8Array>;
  const output = new TransformStream<Uint8Array, Uint8Array>({ start: (controller) => { outputController = controller; } });
  const writer = output.writable.getWriter();
  // A client that stops reading parks the loop on a write. Neither the abort signal nor writer.abort() can reach it,
  // because abort waits for that write to finish; erroring the stream itself does release it.
  const overallTimeout = setTimeout(() => {
    const reason = new Error("Folder export exceeded 30 minutes");
    abortController.abort(reason);
    outputController.error(reason);
  }, FOLDER_EXPORT_MAX_MS);
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
            throw new Error("Couldn’t authorize export content");
          }
          signedUrls = new Map(data.map((signed, signedIndex) => {
            if (signed.error || !signed.signedUrl) throw new Error("A file is missing from storage");
            return [signingWindow[signedIndex]!.id, signed.signedUrl];
          }));
        }
        const signedUrl = signedUrls.get(entry.id);
        signedUrls.delete(entry.id);
        if (!signedUrl) throw new Error("Couldn’t authorize an export file");

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
