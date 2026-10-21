import type { ProjectNode } from "@/lib/db/schema";

export type FileKind = "folder" | "text" | "image" | "video" | "audio" | "pdf" | "doc" | "binary";

/** Lower-case extension without the dot; "" when the name has none. */
export function extOf(name: string) {
  const parts = name.split(".");
  return parts.length > 1 ? (parts[parts.length - 1]?.toLowerCase() || "") : "";
}

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "yml",
  "yaml",
  "toml",
  "xml",
  "csv",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "php",
  "sql",
  "css",
  "scss",
  "html",
  "htm",
  "sh",
  "bash",
  "dockerfile",
  "gitignore",
]);

const DOC_MIME_PREFIXES = [
  "application/vnd.openxmlformats-officedocument",
  "application/vnd.ms-",
];

const DOC_MIMES = new Set([
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
]);

const EXTENSIONLESS_TEXT_FILES = new Set([
  "license",
  "licence",
  "copying",
  "patents",
  "unlicense",
  "readme",
  "contributing",
  "code_of_conduct",
  "authors",
  "contributors",
  "changelog",
  "history",
  "notice",
  "todo",
  "makefile",
  "dockerfile",
  "procfile",
  "gemfile",
  "vagrantfile",
  ".gitignore",
  ".gitattributes",
  ".gitmodules",
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "hub",
]);

export function isTextLike(node: Pick<ProjectNode, "type" | "name" | "mimeType">): boolean {
  if (node.type !== "file") return false;
  const mime = (node.mimeType || "").toLowerCase();
  if (mime.startsWith("text/")) return true;
  if (mime === "application/json" || mime === "application/xml") return true;

  const cleanName = (node.name || "").toLowerCase().trim();
  if (
    EXTENSIONLESS_TEXT_FILES.has(cleanName) ||
    cleanName.startsWith(".env") ||
    /^licen[sc]e(\.|$)/i.test(cleanName) ||
    /^readme(\.|$)/i.test(cleanName)
  ) {
    return true;
  }

  const ext = extOf(node.name);
  if (!ext) return false;
  return TEXT_EXTENSIONS.has(ext);
}

export function isAssetLike(node: Pick<ProjectNode, "type" | "name" | "mimeType">): boolean {
  if (node.type !== "file") return false;
  const mime = (node.mimeType || "").toLowerCase();

  if (mime.startsWith("image/")) return true;
  if (mime.startsWith("video/")) return true;
  if (mime.startsWith("audio/")) return true;
  if (mime === "application/pdf") return true;

  if (DOC_MIMES.has(mime)) return true;
  if (DOC_MIME_PREFIXES.some((p) => mime.startsWith(p))) return true;

  // If unknown mime but has an obviously-previewable extension, treat as asset.
  const ext = extOf(node.name);
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "mp4", "mov", "webm", "mp3", "wav", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext)) {
    return true;
  }

  return false;
}

export function fileKind(node: Pick<ProjectNode, "type" | "name" | "mimeType">): FileKind {
  if (node.type === "folder") return "folder";

  const mime = (node.mimeType || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";

  if (isTextLike(node)) return "text";

  const ext = extOf(node.name);
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "m4v", "ogv"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (DOC_MIMES.has(mime) || DOC_MIME_PREFIXES.some((p) => mime.startsWith(p))) return "doc";
  if (["doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext)) return "doc";

  return "binary";
}

export type UniversalPreviewType =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "docx"
  | "sheet"
  | "archive"
  | "markdown"
  | "text"
  | "binary";

export function resolvePreviewType(
  node: Pick<ProjectNode, "type" | "name" | "mimeType">,
): UniversalPreviewType {
  if (node.type === "folder") return "binary";

  const ext = extOf(node.name);
  const mime = (node.mimeType || "").toLowerCase();

  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";

  if (
    ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"].includes(ext) ||
    mime.startsWith("image/")
  ) {
    return "image";
  }

  if (["mp4", "mov", "webm", "m4v", "ogv"].includes(ext) || mime.startsWith("video/")) {
    return "video";
  }

  if (["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(ext) || mime.startsWith("audio/")) {
    return "audio";
  }

  if (
    ext === "docx" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }

  if (
    ["xlsx", "xls", "csv", "tsv", "ods"].includes(ext) ||
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    mime === "text/csv" ||
    mime === "text/tab-separated-values"
  ) {
    return "sheet";
  }

  if (["zip"].includes(ext) || mime === "application/zip" || mime === "application/x-zip-compressed") {
    return "archive";
  }

  if (isTextLike(node)) {
    return "text";
  }

  return "binary";
}

