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
  Code2,
  Folder,
  FolderOpen,
} from "@/components/ui/icons";
import { cn } from "@/lib/utils";

// Exact filename mappings (normalized to lowercase for case-insensitivity)
const EXACT_FILES: Record<string, { icon: React.ElementType; color: string }> = {
  ".gitignore": { icon: GitGraph, color: "text-[#D14E24] dark:text-orange-400" },
  ".gitattributes": { icon: GitGraph, color: "text-[#D14E24] dark:text-orange-400" },
  ".gitmodules": { icon: GitGraph, color: "text-[#D14E24] dark:text-orange-400" },
  ".env": { icon: Settings, color: "text-[#4C5A61] dark:text-zinc-400" },
  ".env.local": { icon: Settings, color: "text-[#4C5A61] dark:text-zinc-400" },
  ".env.production": { icon: Settings, color: "text-[#4C5A61] dark:text-zinc-400" },
  ".env.development": { icon: Settings, color: "text-[#4C5A61] dark:text-zinc-400" },
  "package.json": { icon: Package, color: "text-[#2F6B4F] dark:text-emerald-400" },
  "package-lock.json": { icon: Package, color: "text-[#2F6B4F] dark:text-emerald-400" },
  "pnpm-lock.yaml": { icon: Package, color: "text-[#2F6B4F] dark:text-emerald-400" },
  "yarn.lock": { icon: Package, color: "text-[#2F6B4F] dark:text-emerald-400" },
  "bun.lockb": { icon: Package, color: "text-[#2F6B4F] dark:text-emerald-400" },
  "tsconfig.json": { icon: FileCode, color: "text-[#2563C9] dark:text-blue-400" },
  "jsconfig.json": { icon: FileCode, color: "text-[#2563C9] dark:text-blue-400" },
  "next.config.js": { icon: Box, color: "text-[#141A1E] dark:text-zinc-100" },
  "next.config.mjs": { icon: Box, color: "text-[#141A1E] dark:text-zinc-100" },
  "next.config.ts": { icon: Box, color: "text-[#141A1E] dark:text-zinc-100" },
  "tailwind.config.js": { icon: Box, color: "text-[#4C5A61] dark:text-zinc-400" },
  "tailwind.config.ts": { icon: Box, color: "text-[#4C5A61] dark:text-zinc-400" },
  "postcss.config.js": { icon: Box, color: "text-[#4C5A61] dark:text-zinc-400" },
  "postcss.config.mjs": { icon: Box, color: "text-[#4C5A61] dark:text-zinc-400" },
  "dockerfile": { icon: Box, color: "text-[#2563C9] dark:text-blue-400" },
  "docker-compose.yml": { icon: Box, color: "text-[#2563C9] dark:text-blue-400" },
  "docker-compose.yaml": { icon: Box, color: "text-[#2563C9] dark:text-blue-400" },
};

// Mapping of extensions to icons and drafting tokens
const EXT_ICONS: Record<string, { icon: React.ElementType; color: string }> = {
  ...Object.fromEntries(["pdf", "doc", "docx", "odt", "rtf"].map(ext => [ext, { icon: FileText, color: "text-[#2563C9] dark:text-blue-400" }])),
  ...Object.fromEntries(["mp4", "mov", "webm", "mkv", "avi"].map(ext => [ext, { icon: FileVideo, color: "text-[#4C5A61] dark:text-zinc-400" }])),
  ...Object.fromEntries(["mp3", "wav", "ogg", "m4a", "flac"].map(ext => [ext, { icon: FileAudio, color: "text-[#4C5A61] dark:text-zinc-400" }])),
  ...Object.fromEntries(["zip", "tar", "gz", "7z", "rar"].map(ext => [ext, { icon: FileArchive, color: "text-[#9A6B00] dark:text-amber-400" }])),
  ...Object.fromEntries(["csv", "xls", "xlsx", "ods"].map(ext => [ext, { icon: FileSpreadsheet, color: "text-[#2F6B4F] dark:text-emerald-400" }])),
  ...Object.fromEntries(["ppt", "pptx", "odp"].map(ext => [ext, { icon: Presentation, color: "text-[#D14E24] dark:text-orange-400" }])),
  ...Object.fromEntries(["webp", "gif", "avif", "heic", "bmp", "tiff", "png", "jpg", "jpeg", "svg"].map(ext => [ext, { icon: FileImage, color: "text-[#9A6B00] dark:text-amber-400" }])),
  ts: { icon: FileCode, color: "text-[#2563C9] dark:text-blue-400" },
  tsx: { icon: Code2, color: "text-[#2563C9] dark:text-blue-400" },
  js: { icon: FileCode, color: "text-[#9A6B00] dark:text-amber-400" },
  jsx: { icon: Code2, color: "text-[#9A6B00] dark:text-amber-400" },
  css: { icon: Hash, color: "text-[#2563C9] dark:text-blue-400" },
  scss: { icon: Hash, color: "text-[#2563C9] dark:text-blue-400" },
  html: { icon: Globe, color: "text-[#D14E24] dark:text-orange-400" },
  json: { icon: FileJson, color: "text-[#2F6B4F] dark:text-emerald-400" },
  yaml: { icon: FileJson, color: "text-[#2F6B4F] dark:text-emerald-400" },
  yml: { icon: FileJson, color: "text-[#2F6B4F] dark:text-emerald-400" },
  toml: { icon: FileJson, color: "text-[#2F6B4F] dark:text-emerald-400" },
  md: { icon: FileText, color: "text-[#4C5A61] dark:text-zinc-400" },
  mdx: { icon: FileText, color: "text-[#4C5A61] dark:text-zinc-400" },
  txt: { icon: FileText, color: "text-[#4C5A61] dark:text-zinc-400" },
  sql: { icon: Database, color: "text-[#2563C9] dark:text-blue-400" },
  py: { icon: FileCode, color: "text-[#2563C9] dark:text-blue-400" },
  rs: { icon: Settings, color: "text-[#D14E24] dark:text-orange-400" },
  go: { icon: Box, color: "text-[#2563C9] dark:text-blue-400" },
  sh: { icon: FileCode, color: "text-[#2F6B4F] dark:text-emerald-400" },
  bash: { icon: FileCode, color: "text-[#2F6B4F] dark:text-emerald-400" },
  zsh: { icon: FileCode, color: "text-[#2F6B4F] dark:text-emerald-400" },
};

export function FileIcon({
  name,
  mimeType,
  isFolder,
  isOpen,
  size = "w-4 h-4",
  className,
}: {
  name: string;
  mimeType?: string | null;
  isFolder?: boolean;
  isOpen?: boolean;
  size?: string;
  className?: string;
  type?: string;
}) {
  if (isFolder) {
    return (
      <div aria-hidden="true" className={cn(size, className, "relative flex items-center justify-center shrink-0")}>
        {isOpen ? (
          <FolderOpen
            strokeWidth={1.75}
            className={cn(size, "text-[#D14E24] dark:text-[#E0633A] fill-[#FCF0EA] dark:fill-[#D14E24]/20")}
          />
        ) : (
          <Folder
            strokeWidth={1.75}
            className={cn(size, "text-[#D14E24] dark:text-[#E0633A] fill-[#FCF0EA] dark:fill-[#D14E24]/20")}
          />
        )}
      </div>
    );
  }

  const lowerName = (name || "").toLowerCase().trim();

  // License / legal files (matches LICENSE, LICENCE, LICENSE.md, LICENSE.txt, COPYING, etc.)
  if (/^licen[sc]e(\.|$)/i.test(lowerName) || /^copying(\.|$)/i.test(lowerName) || /^patents(\.|$)/i.test(lowerName)) {
    return (
      <FileBadge
        aria-hidden="true"
        strokeWidth={1.75}
        className={cn(size, "text-[#9A6B00] dark:text-amber-400 shrink-0", className)}
      />
    );
  }

  // Readme documentation files
  if (/^readme(\.|$)/i.test(lowerName)) {
    return (
      <BookOpen
        aria-hidden="true"
        strokeWidth={1.75}
        className={cn(size, "text-[#2563C9] dark:text-blue-400 shrink-0", className)}
      />
    );
  }

  // Security policy files
  if (/^security(\.|$)/i.test(lowerName)) {
    return (
      <ShieldCheck
        aria-hidden="true"
        strokeWidth={1.75}
        className={cn(size, "text-[#2F6B4F] dark:text-emerald-400 shrink-0", className)}
      />
    );
  }

  // Contributing and Community files
  if (/^contributing(\.|$)/i.test(lowerName) || /^code_of_conduct(\.|$)/i.test(lowerName)) {
    return (
      <BookOpen
        aria-hidden="true"
        strokeWidth={1.75}
        className={cn(size, "text-[#2563C9] dark:text-blue-400 shrink-0", className)}
      />
    );
  }

  // Exact known filenames
  const exact = EXACT_FILES[lowerName];
  if (exact) {
    const Icon = exact.icon;
    return (
      <Icon
        aria-hidden="true"
        strokeWidth={1.75}
        className={cn(size, exact.color, "shrink-0", className)}
      />
    );
  }

  // Extension matching
  const parts = lowerName.split(".");
  const ext = parts.length > 1 ? parts.pop()?.toLowerCase() : "";
  const match = ext ? EXT_ICONS[ext] : null;

  if (match) {
    const Icon = match.icon;
    return (
      <Icon
        aria-hidden="true"
        strokeWidth={1.75}
        className={cn(size, match.color, "shrink-0", className)}
      />
    );
  }

  // MIME fallback rescues extensionless uploads
  const mime = mimeType?.split(";", 1)[0]?.trim().toLowerCase() || "";
  const MimeIcon = mime.startsWith("image/") ? FileImage
    : mime.startsWith("video/") ? FileVideo
    : mime.startsWith("audio/") ? FileAudio
    : /spreadsheet|excel|csv/.test(mime) ? FileSpreadsheet
    : /presentation|powerpoint/.test(mime) ? Presentation
    : /zip|compressed|tar|gzip/.test(mime) ? FileArchive
    : mime.includes("json") ? FileJson
    : mime.startsWith("text/") || /pdf|document|msword/.test(mime) ? FileText
    : File;

  return (
    <MimeIcon
      aria-hidden="true"
      strokeWidth={1.75}
      className={cn(size, "text-[#4C5A61] dark:text-zinc-400 shrink-0", className)}
    />
  );
}

export function extOf(filename: string): string {
  const clean = (filename || "").trim().toLowerCase();
  const lastDot = clean.lastIndexOf(".");
  return lastDot > 0 ? clean.slice(lastDot + 1) : "";
}
