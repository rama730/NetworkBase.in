/**
 * upload-validator.ts
 *
 * Strict upload security & selection validation for files and folder uploads.
 * Prevents:
 * 1. Root drive uploads (Macintosh HD, /, C:\, etc.)
 * 2. Operating system and sensitive directories (Applications, Library, System, Users, usr, bin, node_modules, .git)
 * 3. Empty or OS-junk-only file selections (.DS_Store, Thumbs.db, etc.)
 * 4. Dangerous path traversals (.., leading /, null bytes)
 * 5. Excessive payload sizes exceeding client safety ceilings (e.g. >5,000 files)
 */

import { isToolOutputPath } from "@/lib/import/import-filters";
import { DEFAULT_WORKSPACE_UPLOAD_MAX_FILE_BYTES } from "@/lib/upload/security";

export { DEFAULT_WORKSPACE_UPLOAD_MAX_FILE_BYTES };

export interface UploadValidationOptions {
  isFolder?: boolean;
  maxFiles?: number;
  maxFileBytes?: number;
}

export interface UploadValidationResult {
  valid: boolean;
  error?: string;
  files: File[];
  folderName?: string;
}

const OS_JUNK_NAMES = new Set([
  ".ds_store",
  "thumbs.db",
  "desktop.ini",
  "ehthumbs.db",
]);

/**
 * Forbidden root and system directory names across macOS, Linux, and Windows.
 * Lowercase comparison.
 */
export const FORBIDDEN_ROOT_DIRS = new Set([
  // macOS Root & Volumes
  "macintosh hd",
  "system",
  "library",
  "applications",
  "users",
  "volumes",
  "private",
  "cores",
  ".trash",
  ".trashes",
  ".spotlight-v100",
  ".fseventsd",

  // Unix / Linux Root
  "bin",
  "sbin",
  "usr",
  "etc",
  "var",
  "dev",
  "opt",
  "tmp",
  "boot",
  "proc",
  "sys",
  "root",
  "home",

  // Windows Root & System
  "c:",
  "d:",
  "windows",
  "winnt",
  "program files",
  "program files (x86)",
  "programdata",
  "appdata",
  "system32",
  "syswow64",
  "$recycle.bin",
  "recovery",

  // Developer & Dependency Folders (Disastrous if uploaded recursively)
  "node_modules",
  ".git",
  ".svn",
  ".hg",
]);

export const EXE_BLOCKLIST = new Set([
  "exe",
  "bat",
  "cmd",
  "sh",
  "vbs",
  "ps1",
  "scr",
  "com",
  "msi",
  "jar",
  "vbe",
  "wsf",
  "cpl",
]);


export const KNOWN_USER_DIR_NAMES = new Set([
  "user",
  "users",
  "home",
  "admin",
  "administrator",
  "root",
]);

export const USER_HOME_INDICATORS = new Set([
  "desktop",
  "documents",
  "downloads",
  "library",
  "pictures",
  "movies",
  "music",
  "public",
  ".config",
  ".local",
  ".ssh",
  ".bash_profile",
  ".zshrc",
  ".bash_history",
  ".gitconfig",
]);

/**
 * Clean OS-specific metadata and junk files from an array of files.
 */
export function stripOsJunkFiles(files: File[]): File[] {
  return files.filter((f) => {
    const lower = f.name.toLowerCase();
    if (OS_JUNK_NAMES.has(lower)) return false;
    if (lower.startsWith("._")) return false;
    if (lower === "__macosx") return false;
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath?.toLowerCase() || "";
    // Below the chosen folder only: picking node_modules itself gets the clearer system-directory error.
    if (isToolOutputPath(rel.slice(rel.indexOf("/") + 1)) || rel.includes("/__macosx/")) return false;
    if (rel.includes("/.ds_store") || rel.includes("/thumbs.db")) return false;
    return true;
  });
}

/**
 * Validates a file or folder upload selection before any mutation or network request.
 */
export function validateUploadSelection(
  rawFiles: File[] | FileList | null | undefined,
  options: UploadValidationOptions = {}
): UploadValidationResult {
  const filesArray = rawFiles ? Array.from(rawFiles) : [];

  if (filesArray.length === 0) {
    return {
      valid: false,
      error: "No files were selected for upload. Select a specific file or folder.",
      files: [],
    };
  }

  // Filter OS junk and metadata files
  const cleanFiles = stripOsJunkFiles(filesArray);
  if (cleanFiles.length === 0) {
    return {
      valid: false,
      error: "The selected folder contains no valid files for upload.",
      files: [],
    };
  }

  const maxFiles = options.maxFiles ?? 5000;
  if (cleanFiles.length > maxFiles) {
    return {
      valid: false,
      error: `Folder contains too many files (${cleanFiles.length.toLocaleString()}). Upload limit is ${maxFiles.toLocaleString()} files at a time. Select a smaller, specific folder.`,
      files: [],
    };
  }

  // Path traversal and safety checks
  for (const file of cleanFiles) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    if (rel) {
      if (rel.includes("\0")) {
        return {
          valid: false,
          error: "Invalid file path detected: null character.",
          files: [],
        };
      }
      const parts = rel.split("/");
      if (parts.some((p) => p === "..")) {
        return {
          valid: false,
          error: "Invalid file path: directory traversal is prohibited.",
          files: [],
        };
      }
    }
  }

  // Check for folder upload safety
  const isFolderUpload = options.isFolder || cleanFiles.some((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath?.includes("/"));
  let detectedFolderName: string | undefined;

  if (isFolderUpload) {
    // Collect distinct top-level directories
    const topLevelFolders = new Set<string>();

    for (const file of cleanFiles) {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      if (rel && rel.includes("/")) {
        const topSeg = rel.split("/")[0]!.trim();
        if (topSeg) {
          topLevelFolders.add(topSeg);
          if (!detectedFolderName) detectedFolderName = topSeg;
        }
      }
    }

    // 1. Check if multiple root-level directories are present in the upload.
    // In macOS Safari/Chrome, selecting Macintosh HD (root disk) yields files spanning
    // "Applications/...", "Library/...", "System/...", "Users/..." simultaneously.
    if (topLevelFolders.size > 1) {
      const names = Array.from(topLevelFolders).map((n) => n.toLowerCase());
      const hasSystemDir = names.some((n) => FORBIDDEN_ROOT_DIRS.has(n));
      if (hasSystemDir) {
        return {
          valid: false,
          error: "Cannot upload root disk or system directories (such as Macintosh HD, Applications, or System). Select a specific folder.",
          files: [],
        };
      }
    }

    // 2. Check each top-level directory against forbidden system directories
    for (const folder of topLevelFolders) {
      const lower = folder.toLowerCase();
      if (FORBIDDEN_ROOT_DIRS.has(lower)) {
        return {
          valid: false,
          error: `Cannot upload system directory "${folder}". Select a specific folder.`,
          files: [],
        };
      }
    }

    // 3. Check if the uploaded folder is a user home directory (e.g. /Users/chrama, CH Rama, or any user home profile).
    // In macOS Finder, clicking a user account in the sidebar yields files like:
    // chrama/Desktop/..., chrama/Documents/..., chrama/Downloads/..., chrama/Library/...
    const topFolderChildSegments = new Set<string>();
    for (const file of cleanFiles) {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      if (rel) {
        const segments = rel.split("/");
        if (segments.length >= 2) {
          topFolderChildSegments.add(segments[1]!.toLowerCase().trim());
        }
      }
    }

    let userHomeMatches = 0;
    for (const seg of topFolderChildSegments) {
      if (USER_HOME_INDICATORS.has(seg)) {
        userHomeMatches++;
      }
    }

    if (
      userHomeMatches >= 2 ||
      (detectedFolderName && KNOWN_USER_DIR_NAMES.has(detectedFolderName.toLowerCase()))
    ) {
      return {
        valid: false,
        error: `Cannot upload user home directory (${detectedFolderName || "User home"}). Select a specific folder inside your workspace.`,
        files: [],
      };
    }

    // 4. Check for sub-path root indicators (e.g. if the user chose a folder that directly nests system root paths)
    for (const file of cleanFiles) {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      if (rel) {
        const segments = rel.split("/").map((s) => s.toLowerCase().trim());
        if (segments[0] === "users" && segments.length > 2 && FORBIDDEN_ROOT_DIRS.has(segments[2] || "")) {
          return {
            valid: false,
            error: "Cannot upload operating system directories. Select a specific folder.",
            files: [],
          };
        }
      }
    }
  }

  // Check for forbidden executable / script extensions
  for (const file of cleanFiles) {
    const name = file.name.toLowerCase();
    const dotIdx = name.lastIndexOf(".");
    if (dotIdx !== -1) {
      const ext = name.slice(dotIdx + 1);
      if (EXE_BLOCKLIST.has(ext)) {
        return {
          valid: false,
          error: `Uploading executable or script files (.${ext}) is prohibited for security reasons.`,
          files: [],
        };
      }
    }
  }

  // The largest file one upload may hold (25 MB default)
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_WORKSPACE_UPLOAD_MAX_FILE_BYTES;
  for (const file of cleanFiles) {
    if (typeof file.size === "number" && file.size > maxFileBytes) {
      const mb = Math.floor(maxFileBytes / (1024 * 1024));
      return {
        valid: false,
        error: cleanFiles.length === 1
          ? `"${file.name}" exceeds the maximum upload size limit of ${mb}MB.`
          : `"${file.name}" exceeds the maximum upload size limit of ${mb}MB. Select files smaller than ${mb}MB.`,
        files: [],
      };
    }
  }

  if (isFolderUpload) {
    return {
      valid: true,
      files: cleanFiles,
      folderName: detectedFolderName,
    };
  }

  // Single or multiple loose files upload
  return {
    valid: true,
    files: cleanFiles,
  };
}
