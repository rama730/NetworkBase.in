/**
 * Where you drop is what it means (report §19.2, A10): one pure function decides a drop's target and the hint shown
 * while hovering, for the Files tab, the file view and the task panel. No pop-up asks.
 */
export type DropRole = "reference" | "working" | "deliverable";
export const ROLE_WORDS: Record<DropRole, string> = { reference: "reference", working: "draft", deliverable: "final" };

export type DropOver =
  | { kind: "folder"; id: string | null; path: string; readOnly?: boolean }
  | { kind: "empty"; folderId: string | null; path: string; readOnly?: boolean }
  | { kind: "file"; id: string; name: string; parentId: string | null; parentPath: string; version: number; readOnly?: boolean; lockedBy?: string | null }
  | { kind: "open-file"; id: string; name: string; version: number; readOnly?: boolean; lockedBy?: string | null }
  | { kind: "task"; taskNumber: number | null; role?: DropRole; readOnly?: boolean; handedIn?: boolean }
  | { kind: "task-file"; id: string; name: string; taskNumber: number | null; version: number; readOnly?: boolean }
  | { kind: "nowhere"; label: "Trash" | "Recent" | "Starred" };

export type DropTarget =
  | { kind: "folder"; folderId: string | null; path: string; hint: string }
  | { kind: "version"; nodeId: string; name: string; hint: string }
  | { kind: "task"; role: DropRole; hint: string }
  | { kind: "refused"; hint: string };

const ext = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");

/** @param files the dragged files' names (empty while hovering when the browser hides them: then by count only). */
export function resolveDropTarget(over: DropOver, files: Array<{ name: string }>, count = files.length): DropTarget {
  const one = count === 1;
  if (over.kind === "nowhere") return { kind: "refused", hint: `Can't drop on ${over.label}` };
  if ("readOnly" in over && over.readOnly) return { kind: "refused", hint: "Read only" };
  if ((over.kind === "file" || over.kind === "open-file") && over.lockedBy) return { kind: "refused", hint: `Locked by ${over.lockedBy}` };
  if (over.kind === "task" && over.handedIn) return { kind: "refused", hint: "Handed in" };
  switch (over.kind) {
    case "folder":
      return { kind: "folder", folderId: over.id, path: over.path, hint: `Upload to ${over.path}` };
    case "empty":
      return { kind: "folder", folderId: over.folderId, path: over.path, hint: `Upload to ${over.path}` };
    case "file": {
      // One file of the same type on a file row: a new version of it. Anything else goes into that file's folder.
      const sameType = one && (files.length === 0 || ext(files[0]!.name) === ext(over.name));
      return sameType
        ? { kind: "version", nodeId: over.id, name: over.name, hint: `New version of ${over.name} · v${over.version} → v${over.version + 1}` }
        : { kind: "folder", folderId: over.parentId, path: over.parentPath, hint: `Upload to ${over.parentPath}` };
    }
    case "open-file":
      return one ? { kind: "version", nodeId: over.id, name: over.name, hint: `New version · v${over.version} → v${over.version + 1}` } : { kind: "refused", hint: "Drop one file for a new version" };
    case "task-file":
      return one ? { kind: "version", nodeId: over.id, name: over.name, hint: `New version of ${over.name}` } : { kind: "task", role: "working", hint: `Add to ${over.taskNumber ? `#${over.taskNumber}` : "this task"} as draft` };
    case "task": {
      const role = over.role ?? "working";
      return { kind: "task", role, hint: `Add to ${over.taskNumber ? `#${over.taskNumber}` : "this task"} as ${ROLE_WORDS[role]}` };
    }
  }
}

/** `name (2).ext`, the first free one (Keep both). */
export function keepBothName(name: string, taken: Set<string>): string {
  const dot = name.lastIndexOf(".");
  const [base, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  const lower = new Set([...taken].map((t) => t.toLowerCase()));
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${extension}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

/** Splits a drop into new versions of same-named files and new files (report §26.3). */
export function splitSameName<F extends { name: string; webkitRelativePath?: string }>(files: F[], fileIdsByPath: Record<string, string>) {
  const lower = new Map(Object.entries(fileIdsByPath).map(([p, id]) => [p.toLowerCase(), id]));
  const versions: Array<{ file: F; nodeId: string }> = [];
  const fresh: F[] = [];
  for (const file of files) {
    const id = lower.get((file.webkitRelativePath || file.name).toLowerCase());
    if (id) versions.push({ file, nodeId: id });
    else fresh.push(file);
  }
  return { versions, fresh };
}

/** OS files nobody means to upload (A10.5 item 4). */
export const isOsJunk = (name: string) => /^(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(name);

/** `Pasted image 2026-11-09 14.32.png` for an unnamed pasted image (A10.4). */
export function pastedName(type: string, at = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const extension = type.split("/")[1]?.replace("jpeg", "jpg").replace(/\+xml$/, "") || "png";
  return `Pasted image ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}.${pad(at.getMinutes())}.${extension}`;
}

/**
 * Files pasted with ⌘V/Ctrl+V outside a text field (A10.4): unnamed images get a dated name; pasted text does nothing.
 * Returns null when the paste isn't for us.
 */
export function pastedFiles(event: ClipboardEvent): File[] | null {
  const target = event.target as HTMLElement | null;
  if (target?.closest?.("input, textarea, [contenteditable=''], [contenteditable='true']")) return null;
  const files = Array.from(event.clipboardData?.files ?? []);
  if (!files.length) return null;
  return files.map((f) => (/^image\.(png|jpe?g|gif|webp)$/i.test(f.name) || !f.name ? new File([f], pastedName(f.type), { type: f.type }) : f));
}
