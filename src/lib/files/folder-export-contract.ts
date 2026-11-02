export const FOLDER_EXPORT_MAX_ENTRIES = 20_000;
export const FOLDER_EXPORT_MAX_BYTES = 1024 * 1024 * 1024;
/** Download all for an assignment (report §28.5): one zip up to 2 GB. */
export const SUBMISSIONS_EXPORT_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export type FolderExportRow = {
  id: string;
  parent_id: string | null;
  type: "file" | "folder";
  name: string;
  s3_key: string | null;
  asset_id: string | null;
  size: number | string | null;
  depth: number;
  task_id: string | null;
  path: string;
  asset_state: string | null;
  asset_bucket: string | null;
  asset_storage_key: string | null;
  asset_size: number | string | null;
};

export type FolderExportEntry = {
  id: string;
  path: string;
  type: "file" | "folder";
  bucket: string | null;
  storageKey: string | null;
  assetId: string | null;
  size: number;
};

function assertSafeSegment(value: string) {
  if (
    !value
    || value === "."
    || value === ".."
    || value.includes("/")
    || value.includes("\\")
    || value.includes("\0")
  ) {
    throw new Error("The export contains an unsafe file name");
  }
  return value;
}

/** Two different files can't share a path in a zip: the later one becomes `name (2).pdf`. */
export function uniqueExportName(used: Set<string>, name: string) {
  const dot = name.lastIndexOf(".");
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  let candidate = name;
  for (let copy = 2; used.has(candidate.toLowerCase()); copy += 1) candidate = `${stem} (${copy})${extension}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Chosen items sit at the top of the zip, their folders' contents under them. An item inside a chosen folder stays
 * in that folder rather than appearing twice.
 */
export function buildSelectionExportEntries(rows: FolderExportRow[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const used = new Set<string>();
  const topNames = new Map<string, string>();
  for (const row of byId.values()) {
    if (!row.parent_id || !byId.has(row.parent_id)) topNames.set(row.id, uniqueExportName(used, assertSafeSegment(row.name)));
  }
  return buildFolderExportEntries(
    [...byId.values()].map((row) => (topNames.has(row.id) ? { ...row, parent_id: null, name: topNames.get(row.id)! } : row)),
    null,
  );
}

/** A file with no verified stored copy (often linked from a GitHub import) can't go in a zip: it is left out and counted. */
export function buildFolderExportEntries(rows: FolderExportRow[], selectedFolderId: string | null) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const selected = selectedFolderId ? byId.get(selectedFolderId) : null;
  if (selectedFolderId && (!selected || selected.type !== "folder")) {
    throw new Error("Folder not found");
  }

  const entries: FolderExportEntry[] = [];
  let totalBytes = 0;
  let skippedFiles = 0;
  for (const row of rows) {
    if (row.id === selectedFolderId) continue;
    const segments: string[] = [assertSafeSegment(row.name)];
    const visited = new Set([row.id]);
    let parentId = row.parent_id;
    while (parentId && parentId !== selectedFolderId) {
      if (visited.has(parentId)) throw new Error("The export folder tree contains a cycle");
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) throw new Error("The export folder tree changed while it was being prepared");
      segments.unshift(assertSafeSegment(parent.name));
      parentId = parent.parent_id;
    }
    if (selectedFolderId && parentId !== selectedFolderId) continue;

    const sizeValue = row.asset_id ? row.asset_size : row.size;
    if (row.type === "file" && row.asset_id && row.asset_size == null) {
      throw new Error(`File ${row.name} has incomplete verified metadata`);
    }
    const size = row.type === "file" ? Number(sizeValue ?? 0) : 0;
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("The export contains an invalid file size");
    if (row.type === "file") {
      // No asset means the bytes were never verified, or there are none: every other download path refuses those too.
      if (!row.asset_id || !(row.asset_storage_key || row.s3_key)) {
        skippedFiles += 1;
        continue;
      }
      if (row.asset_state !== "verified") {
        throw new Error(`File ${row.name} is not available for export`);
      }
      totalBytes += size;
      if (totalBytes > FOLDER_EXPORT_MAX_BYTES) {
        throw new Error("Folder exports are limited to 1 GiB");
      }
    }

    entries.push({
      id: row.id,
      path: segments.join("/") + (row.type === "folder" ? "/" : ""),
      type: row.type,
      bucket: row.type === "file" ? row.asset_bucket ?? "project-files" : null,
      storageKey: row.type === "file" ? row.asset_storage_key ?? row.s3_key : null,
      assetId: row.asset_id,
      size,
    });
  }
  return { entries, totalBytes, skippedFiles };
}
