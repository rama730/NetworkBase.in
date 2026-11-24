"use client";

import React from "react";
import {
  FileCode,
  FileJson,
  FileText,
  FileImage,
  Box,
  Settings,
  File,
  Database,
  Globe,
  Package,
  Hash,
  BookOpen,
  FileBadge,
  ShieldCheck,
  FileVideo,
  FileAudio,
  FileArchive,
  FileSpreadsheet,
  Presentation,
  GitGraph,
  Folder,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { extOf } from "@/components/workspaces/v2/explorer/FileIcons";

export type FileTypeMark = "DOC" | "XLS" | "IMG" | "PDF" | "SRC" | "URL" | "TXT" | "BIN" | "MEDIA" | "LIC";

export function resolveFileTypeMark(name: string, mimeType?: string | null): FileTypeMark {
  const cleanName = (name || "").trim().toLowerCase();
  const mime = (mimeType || "").trim().toLowerCase();
  const ext = extOf(cleanName);

  // 1. License & Legal agreements
  if (
    cleanName === "license" ||
    cleanName === "licence" ||
    cleanName === "copying" ||
    cleanName === "patents" ||
    cleanName === "unlicense" ||
    /^licen[sc]e(\.|$)/i.test(cleanName) ||
    /^copying(\.|$)/i.test(cleanName)
  ) {
    return "LIC";
  }

  // 2. URL
  if (cleanName.endsWith(".url") || cleanName.endsWith(".webloc") || mime.includes("uri-list")) {
    return "URL";
  }

  // 3. Spreadsheets
  if (["xls", "xlsx", "csv", "tsv", "ods", "numbers"].includes(ext) || /spreadsheet|excel|csv/.test(mime)) {
    return "XLS";
  }

  // 4. PDF
  if (ext === "pdf" || mime === "application/pdf") {
    return "PDF";
  }

  // 5. Images
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico", "tiff", "heic"].includes(ext) || mime.startsWith("image/")) {
    return "IMG";
  }

  // 6. Audio / Video
  if (["mp4", "mov", "webm", "mkv", "avi", "mp3", "wav", "ogg", "m4a", "flac"].includes(ext) || mime.startsWith("video/") || mime.startsWith("audio/")) {
    return "MEDIA";
  }

  // 7. Documents & Presentations
  if (["doc", "docx", "odt", "rtf", "ppt", "pptx", "odp", "key"].includes(ext) || /msword|wordprocessingml|presentation|powerpoint/.test(mime)) {
    return "DOC";
  }

  // 8. Source Code & Tooling
  if (
    [
      "ts", "tsx", "js", "jsx", "mjs", "cjs",
      "py", "rb", "go", "rs", "java", "kt", "swift",
      "c", "cpp", "h", "hpp", "cs", "php", "sql",
      "html", "htm", "css", "scss", "sass", "less",
      "sh", "bash", "zsh", "dockerfile", "yaml", "yml",
      "toml", "json", "xml", "graphql", "proto",
    ].includes(ext) ||
    cleanName.startsWith(".env") ||
    cleanName === "dockerfile" ||
    cleanName === "makefile" ||
    cleanName === "procfile" ||
    cleanName === "gemfile" ||
    cleanName === "vagrantfile" ||
    cleanName === ".gitignore" ||
    cleanName === ".gitattributes" ||
    cleanName === ".gitmodules"
  ) {
    return "SRC";
  }

  // 9. Plain Text / Markdown / Documentation
  if (
    ["txt", "md", "mdx", "markdown", "log", "rst", "conf", "ini"].includes(ext) ||
    mime.startsWith("text/") ||
    cleanName === "readme" ||
    cleanName === "contributing" ||
    cleanName === "code_of_conduct" ||
    cleanName === "changelog" ||
    cleanName === "authors" ||
    cleanName === "notice" ||
    cleanName === "todo" ||
    cleanName === "hub"
  ) {
    return "TXT";
  }

  return "BIN";
}

export function resolveFileIcon(name: string, mimeType?: string | null): {
  Icon: React.ElementType;
  iconColor: string;
} {
  const cleanName = (name || "").trim().toLowerCase();
  const mime = (mimeType || "").trim().toLowerCase();
  const parts = cleanName.split(".");
  const ext = parts.length > 1 ? (parts.pop() || "") : "";

  // 1. License & Legal
  if (/^licen[sc]e(\.|$)/i.test(cleanName) || /^copying(\.|$)/i.test(cleanName) || /^patents(\.|$)/i.test(cleanName)) {
    return { Icon: FileBadge, iconColor: "text-[#9A6B00] dark:text-amber-400" };
  }

  // 2. Security policy
  if (/^security(\.|$)/i.test(cleanName)) {
    return { Icon: ShieldCheck, iconColor: "text-[#2F6B4F] dark:text-emerald-400" };
  }

  // 3. Documentation (Readme / Contributing / Code of conduct)
  if (/^readme(\.|$)/i.test(cleanName) || /^contributing(\.|$)/i.test(cleanName) || /^code_of_conduct(\.|$)/i.test(cleanName)) {
    return { Icon: BookOpen, iconColor: "text-[#2563C9] dark:text-blue-400" };
  }

  // 4. Git configs
  if (cleanName === ".gitignore" || cleanName === ".gitattributes" || cleanName === ".gitmodules") {
    return { Icon: GitGraph, iconColor: "text-[#D14E24] dark:text-orange-400" };
  }

  // 5. Packages & Dependencies
  if (["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"].includes(cleanName)) {
    return { Icon: Package, iconColor: "text-[#2F6B4F] dark:text-emerald-400" };
  }

  // 6. Environment configs
  if (cleanName.startsWith(".env")) {
    return { Icon: Settings, iconColor: "text-[#4C5A61] dark:text-muted-foreground" };
  }

  // 7. Tooling & Containers
  if (cleanName === "dockerfile" || cleanName.startsWith("docker-compose") || cleanName === "makefile") {
    return { Icon: Box, iconColor: "text-[#2563C9] dark:text-[#60A5FA]" };
  }

  // 8. Spreadsheets
  if (["xls", "xlsx", "csv", "tsv", "ods", "numbers"].includes(ext) || /spreadsheet|excel|csv/.test(mime)) {
    return { Icon: FileSpreadsheet, iconColor: "text-[#2F6B4F] dark:text-emerald-400" };
  }

  // 9. Images
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico", "tiff", "heic"].includes(ext) || mime.startsWith("image/")) {
    return { Icon: FileImage, iconColor: "text-[#9A6B00] dark:text-amber-400" };
  }

  // 10. Audio & Video
  if (["mp4", "mov", "webm", "mkv", "avi"].includes(ext) || mime.startsWith("video/")) {
    return { Icon: FileVideo, iconColor: "text-[#4C5A61] dark:text-muted-foreground" };
  }
  if (["mp3", "wav", "ogg", "m4a", "flac"].includes(ext) || mime.startsWith("audio/")) {
    return { Icon: FileAudio, iconColor: "text-[#4C5A61] dark:text-muted-foreground" };
  }

  // 11. Archives
  if (["zip", "tar", "gz", "7z", "rar"].includes(ext) || /zip|compressed|tar|gzip/.test(mime)) {
    return { Icon: FileArchive, iconColor: "text-[#9A6B00] dark:text-amber-400" };
  }

  // 12. Presentations
  if (["ppt", "pptx", "odp", "key"].includes(ext) || /presentation|powerpoint/.test(mime)) {
    return { Icon: Presentation, iconColor: "text-[#D14E24] dark:text-orange-400" };
  }

  // 13. Source code
  if (["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "c", "cpp", "h", "cs", "php", "rb", "sh", "bash"].includes(ext)) {
    return { Icon: FileCode, iconColor: "text-[#D14E24] dark:text-orange-400" };
  }

  // 14. Data / JSON / DB
  if (["json", "yaml", "yml", "toml", "xml"].includes(ext) || mime.includes("json")) {
    return { Icon: FileJson, iconColor: "text-[#2F6B4F] dark:text-emerald-400" };
  }
  if (ext === "sql") {
    return { Icon: Database, iconColor: "text-[#2563C9] dark:text-[#60A5FA]" };
  }

  // 15. Styles & Web
  if (["css", "scss", "sass", "less"].includes(ext)) {
    return { Icon: Hash, iconColor: "text-[#2563C9] dark:text-[#60A5FA]" };
  }
  if (["html", "htm"].includes(ext)) {
    return { Icon: Globe, iconColor: "text-[#D14E24] dark:text-orange-400" };
  }

  // 16. Documents (PDF, Word, Text, Markdown)
  if (ext === "pdf" || mime === "application/pdf") {
    return { Icon: FileText, iconColor: "text-[#96201A] dark:text-red-400" };
  }
  if (["doc", "docx", "odt", "rtf"].includes(ext) || /msword|wordprocessingml/.test(mime)) {
    return { Icon: FileText, iconColor: "text-[#141A1E] dark:text-foreground" };
  }
  if (["txt", "md", "mdx", "markdown", "log", "rst"].includes(ext) || mime.startsWith("text/")) {
    return { Icon: FileText, iconColor: "text-[#374349] dark:text-foreground/90" };
  }

  return { Icon: File, iconColor: "text-[#6B7880] dark:text-muted-foreground" };
}

const CHIP_STYLES: Record<FileTypeMark, string> = {
  // Document: warm ink / paper well tint
  DOC: "bg-[#F3F0EA] border-[#DBD5C8] dark:bg-white/10 dark:border-white/15",
  // License: amber legal soft tint matching FileBadge
  LIC: "bg-[#FBF4E2] border-[#F6E7C2] dark:bg-amber-950/40 dark:border-amber-800/40",
  // Spreadsheet: moss soft tint
  XLS: "bg-[#EDF5F0] border-[#D8E8DF] dark:bg-emerald-950/40 dark:border-emerald-800/40",
  // PDF: red soft tint
  PDF: "bg-[#FCEDEB] border-[#F6DAD7] dark:bg-red-950/40 dark:border-red-800/40",
  // Image / Media: amber soft tint
  IMG: "bg-[#FBF4E2] border-[#F6E7C2] dark:bg-amber-950/40 dark:border-amber-800/40",
  MEDIA: "bg-[#FBF4E2] border-[#F6E7C2] dark:bg-amber-950/40 dark:border-amber-800/40",
  // Source: brand clay soft tint
  SRC: "bg-[#FCF0EA] border-[#F7DFD5] dark:bg-[#D14E24]/15 dark:border-[#D14E24]/30",
  // URL: cobalt soft tint
  URL: "bg-[#EEF4FD] border-[#DCE7F8] dark:bg-blue-950/40 dark:border-blue-800/40",
  // Text: neutral well
  TXT: "bg-[#F3F0EA] border-[#DBD5C8] dark:bg-white/10 dark:border-white/15",
  // Binary: neutral well
  BIN: "bg-[#F3F0EA] border-[#DBD5C8] dark:bg-white/10 dark:border-white/15",
};

export interface FileTypeChipProps {
  name: string;
  mimeType?: string | null;
  isFolder?: boolean;
  isOpen?: boolean;
  className?: string;
}

export function FileTypeChip({
  name,
  mimeType,
  isFolder = false,
  isOpen = false,
  className,
}: FileTypeChipProps): React.JSX.Element {
  if (isFolder) {
    return (
      <div
        aria-hidden="true"
        className={cn(
          "size-7 shrink-0 rounded-[3px] flex items-center justify-center bg-[#F3F0EA] border border-[#DBD5C8] dark:bg-white/10 dark:border-white/15",
          className,
        )}
      >
        {isOpen ? (
          <FolderOpen strokeWidth={1.75} className="size-4 text-[#D14E24] fill-[#FCF0EA] dark:fill-[#D14E24]/20" />
        ) : (
          <Folder strokeWidth={1.75} className="size-4 text-[#D14E24] fill-[#FCF0EA] dark:fill-[#D14E24]/20" />
        )}
      </div>
    );
  }

  const mark = resolveFileTypeMark(name, mimeType);
  const style = CHIP_STYLES[mark];
  const { Icon, iconColor } = resolveFileIcon(name, mimeType);

  return (
    <div
      aria-hidden="true"
      data-testid="files-tab-file-type-chip"
      data-file-mark={mark}
      title={`${mark} — ${name}`}
      className={cn(
        "size-7 shrink-0 rounded-[3px] border flex items-center justify-center select-none transition-colors",
        style,
        className,
      )}
    >
      <Icon strokeWidth={1.75} className={cn("size-4 shrink-0", iconColor)} />
    </div>
  );
}

export default FileTypeChip;

