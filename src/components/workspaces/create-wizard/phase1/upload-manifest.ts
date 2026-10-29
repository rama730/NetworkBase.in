import {
  PROJECT_UPLOAD_MAX_FILE_BYTES,
  normalizeAndValidateMimeType,
  normalizeAndValidateUploadRelativePath,
} from "@/lib/upload/security";

const OS_JUNK_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

export type UploadManifestEntry = {
  path: string;
  size: number;
  state: "ready" | "warning" | "blocked";
  message: string | null;
};

export type UploadManifest = {
  folderName: string;
  totalFiles: number;
  totalBytes: number;
  entries: UploadManifestEntry[];
  blockedCount: number;
  warningCount: number;
  isValid: boolean;
};

export function formatUploadBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function buildUploadManifest(files: ArrayLike<File>): UploadManifest {
  const sourceFiles = Array.from(files);
  const seenPaths = new Set<string>();
  const entries = sourceFiles.map((file): UploadManifestEntry => {
    const rawPath = file.webkitRelativePath || file.name;
    let path = rawPath;
    let state: UploadManifestEntry["state"] = "ready";
    let message: string | null = null;

    try {
      path = normalizeAndValidateUploadRelativePath(rawPath);
    } catch (error) {
      state = "blocked";
      message = error instanceof Error ? error.message : "Invalid file path";
    }

    const pathKey = path.toLocaleLowerCase();
    if (state !== "blocked" && seenPaths.has(pathKey)) {
      state = "blocked";
      message = "Duplicate file path";
    }
    seenPaths.add(pathKey);

    if (state !== "blocked") {
      try {
        normalizeAndValidateMimeType(file.type);
      } catch (error) {
        state = "blocked";
        message = error instanceof Error ? error.message : "Unsupported file type";
      }
    }

    if (state !== "blocked" && file.size > PROJECT_UPLOAD_MAX_FILE_BYTES) {
      state = "blocked";
      message = `Exceeds ${formatUploadBytes(PROJECT_UPLOAD_MAX_FILE_BYTES)} per-file limit`;
    } else if (state !== "blocked" && file.size === 0) {
      state = "warning";
      message = "Empty file";
    } else if (state !== "blocked" && OS_JUNK_NAMES.has(file.name.toLocaleLowerCase())) {
      state = "warning";
      message = "System file";
    }

    return { path, size: file.size, state, message };
  });

  const firstPath = entries[0]?.path ?? "";
  const firstSegment = firstPath.split("/")[0];
  const folderName = firstPath.includes("/") && firstSegment ? firstSegment : "Selected folder";
  const blockedCount = entries.filter((entry) => entry.state === "blocked").length;
  const warningCount = entries.filter((entry) => entry.state === "warning").length;

  return {
    folderName,
    totalFiles: entries.length,
    totalBytes: sourceFiles.reduce((sum, file) => sum + file.size, 0),
    entries,
    blockedCount,
    warningCount,
    isValid: entries.length > 0 && blockedCount === 0,
  };
}
