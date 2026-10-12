/**
 * Normalize folder drops into a single representation that the task Files
 * tab can hand to the resolver. Two entry points:
 *
 *   - `extractFoldersFromDataTransfer(dataTransfer)` — for Chromium
 *     drag/drop. Uses `DataTransferItem.webkitGetAsEntry()` and walks
 *     directory entries via the `FileSystemDirectoryReader` API.
 *
 *   - `extractFoldersFromWebkitInput(fileList)` — for the keyboard-
 *     triggered `<input type="file" webkitdirectory />` fallback. Groups
 *     files by their top-level `webkitRelativePath` segment.
 *
 * Both return the same `DroppedFolder[] + looseFiles[]` shape so the
 * FilesTab doesn't have to care which path produced the drop.
 *
 * Unreadable paths are reported in `unreadable` rather than dropped silently.
 *
 * Empty directories are represented as a DroppedFolder with `files: []`,
 * which is useful for the "create subfolder" intent even though we can't
 * create an empty folder via the upload flow alone. The caller decides
 * whether to materialize empty folders as bare `createFolder(...)` calls.
 *
 * ⚠ `webkitGetAsEntry` is vendor-prefixed but implemented by all major
 * browsers (including Firefox and Safari as of 2020+), so it's safe to
 * use without a polyfill for our target platforms. If the browser
 * doesn't expose it, we silently treat everything as loose files.
 */

export type DroppedFolder = {
  /** Top-level folder name as it appeared on the user's disk. */
  name: string;
  /**
   * Every file descendant (recursive). Each entry carries its path
   * relative to `name/`, WITHOUT the leading folder segment. Example:
   * dropped `assets/images/logo.png` under folder `assets` becomes
   * `{ file, relativePath: "images/logo.png" }`.
   */
  files: Array<{ file: File; relativePath: string }>;
};

export type ExtractedDrop = {
  folders: DroppedFolder[];
  /** Files dropped at the top level alongside any folders. */
  looseFiles: File[];
  /**
   * Paths the browser refused to read. They are not in `folders`/`looseFiles`; the caller must
   * show them and get an acknowledgement before uploading the rest (API-022).
   */
  unreadable: string[];
};

/** Hard ceilings for one drop, shared by every dropped root. */
export const FOLDER_DROP_LIMITS = { maxFiles: 5_000, maxEntries: 25_000, maxDepth: 64 } as const;

// -- Chromium drag/drop ------------------------------------------------------

type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => FileSystemDirectoryReaderLike;
};

type FileSystemDirectoryReaderLike = {
  readEntries: (
    cb: (entries: FileSystemEntryLike[]) => void,
    err?: (e: unknown) => void,
  ) => void;
};

type DropBudget = { entries: number; files: number; unreadable: string[]; signal?: AbortSignal };

function spend(budget: DropBudget, entries: number) {
  budget.signal?.throwIfAborted();
  budget.entries += entries;
  if (budget.entries > FOLDER_DROP_LIMITS.maxEntries) {
    throw new Error(`This drop contains more than ${FOLDER_DROP_LIMITS.maxEntries.toLocaleString()} items. Drop a smaller folder.`);
  }
}

/**
 * Streams a directory's children batch by batch (readEntries returns ~100 at a time) so enumeration
 * stops the moment the budget is exceeded instead of listing everything first (API-020).
 */
async function* readEntryBatches(
  reader: FileSystemDirectoryReaderLike,
  budget: DropBudget,
): AsyncGenerator<FileSystemEntryLike[]> {
  for (;;) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) return;
    spend(budget, batch.length);
    yield batch;
  }
}

async function readFileFromEntry(entry: FileSystemEntryLike): Promise<File | null> {
  if (!entry.file) return null;
  return new Promise<File | null>((resolve) => {
    entry.file!(
      (f) => resolve(f),
      () => resolve(null),
    );
  });
}

async function walkEntry(
  entry: FileSystemEntryLike,
  relativePrefix: string,
  acc: Array<{ file: File; relativePath: string }>,
  budget: DropBudget,
  depth: number = 0,
): Promise<void> {
  const path = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;

  if (entry.isFile) {
    if (budget.files >= FOLDER_DROP_LIMITS.maxFiles) {
      throw new Error(`Folder upload is limited to ${FOLDER_DROP_LIMITS.maxFiles.toLocaleString()} files at a time.`);
    }
    const f = await readFileFromEntry(entry);
    if (f) {
      budget.files += 1;
      acc.push({ file: f, relativePath: path });
    } else {
      budget.unreadable.push(path);
    }
    return;
  }

  if (entry.isDirectory && entry.createReader) {
    if (depth >= FOLDER_DROP_LIMITS.maxDepth) {
      throw new Error("Folder nesting is too deep to upload safely.");
    }
    // Walk children sequentially: directory readers are stateful and
    // parallelizing them can produce duplicate or missed entries.
    for await (const batch of readEntryBatches(entry.createReader(), budget)) {
      for (const child of batch) {
        await walkEntry(child, path, acc, budget, depth + 1);
      }
    }
  }
}

export async function extractFoldersFromDataTransfer(
  dataTransfer: DataTransfer,
  options: { signal?: AbortSignal } = {},
): Promise<ExtractedDrop> {
  const folders: DroppedFolder[] = [];
  const looseFiles: File[] = [];
  const budget: DropBudget = { entries: 0, files: 0, unreadable: [], signal: options.signal };

  const items = Array.from(dataTransfer.items ?? []);
  for (const item of items) {
    if (item.kind !== "file") continue;
    spend(budget, 1);

    // webkitGetAsEntry is where the directory info lives. If the browser
    // doesn't support it we fall back to `getAsFile` (treated as loose).
    const getAsEntry = (item as DataTransferItem & {
      webkitGetAsEntry?: () => FileSystemEntryLike | null;
    }).webkitGetAsEntry;
    const entry = getAsEntry ? getAsEntry.call(item) : null;

    if (!entry) {
      const file = item.getAsFile();
      if (file) looseFiles.push(file);
      continue;
    }

    if (entry.isFile) {
      const file = await readFileFromEntry(entry);
      if (file) looseFiles.push(file);
      else budget.unreadable.push(entry.name);
      continue;
    }

    if (entry.isDirectory) {
      const folder: DroppedFolder = { name: entry.name, files: [] };
      // First-level entries become `${child}` (no folder prefix), so the
      // "folder name" stays separate from the child's relativePath.
      if (entry.createReader) {
        for await (const batch of readEntryBatches(entry.createReader(), budget)) {
          for (const child of batch) {
            await walkEntry(child, "", folder.files, budget);
          }
        }
      }
      folders.push(folder);
    }
  }

  return { folders, looseFiles, unreadable: budget.unreadable };
}

// -- <input type="file" webkitdirectory /> ----------------------------------

export function extractFoldersFromWebkitInput(fileList: FileList | File[]): ExtractedDrop {
  // `webkitRelativePath` looks like `myFolder/sub/file.txt`. The top-level
  // segment is the folder the user picked. Multiple top-level segments
  // can appear if the user selected several folders in succession (not
  // typical) — we handle that case by grouping.
  const byFolder = new Map<string, DroppedFolder>();
  const looseFiles: File[] = [];

  const files = Array.from(fileList);
  for (const file of files) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    if (!rel) {
      looseFiles.push(file);
      continue;
    }

    const segments = rel.split("/");
    if (segments.length < 2) {
      looseFiles.push(file);
      continue;
    }

    const [folderName, ...rest] = segments;
    const relativePath = rest.join("/");
    if (!folderName || !relativePath) {
      looseFiles.push(file);
      continue;
    }

    let bucket = byFolder.get(folderName);
    if (!bucket) {
      bucket = { name: folderName, files: [] };
      byFolder.set(folderName, bucket);
    }
    bucket.files.push({ file, relativePath });
  }

  return {
    folders: Array.from(byFolder.values()),
    looseFiles,
    unreadable: [],
  };
}

