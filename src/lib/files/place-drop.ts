"use client";

/**
 * Places dropped or picked files without asking (report §19.2, §26.3, A10.8): same names become new versions, the
 * rest upload; one toast says what happened with Undo, and Keep both when something became a version.
 */
import type { WorkspaceNode } from "@/lib/db/schema";
import { feedbackError, toast } from "@/lib/feedback";

import { isOsJunk, keepBothName, splitSameName } from "./drop-target";

export type PlacedDrop = { created: WorkspaceNode[]; versions: Array<{ nodeId: string; name: string; previous: number; version: number }>; skipped: string[] };

/**
 * @param uploadNew uploads new files into `parentId` (folders keep their structure) and returns what it created
 */
export async function placeDrop(input: {
  projectId: string;
  parentId: string | null;
  where: string;
  files: File[];
  taskId?: string | null;
  uploadNew: (files: File[], parentId: string | null) => Promise<WorkspaceNode[]>;
  onChanged?: () => void;
}): Promise<PlacedDrop | null> {
  const { projectId, parentId, where } = input;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    toast.error("You’re offline", { description: "Nothing was uploaded. Drop the files again when you’re back online." });
    return null;
  }
  const skipped: string[] = [];
  const files = input.files.filter((f) => {
    if (isOsJunk(f.name)) return false;
    const depth = (f.webkitRelativePath || f.name).split("/").length;
    if (depth > 32) { skipped.push(`${f.webkitRelativePath || f.name} is nested too deep`); return false; }
    return true;
  });
  if (!files.length) return null;
  try {
    const { getUploadCollisionSummary } = await import("@/app/actions/files/mutations");
    const summary = await getUploadCollisionSummary(projectId, parentId, files.map((f) => f.webkitRelativePath || f.name), { taskId: input.taskId ?? null });
    const { versions, fresh } = splitSameName(files, summary.fileIdsByPath ?? {});
    const { saveFileRevision } = await import("@/hooks/useFileVersions");
    const versioned: PlacedDrop["versions"] = [];
    for (const v of versions) {
      const res = await saveFileRevision({ projectId, nodeId: v.nodeId, file: v.file, mode: "new_revision" });
      if (res.success) versioned.push({ nodeId: v.nodeId, name: v.file.name, previous: res.version.basedOnVersion ?? res.version.version - 1, version: res.version.version });
      else skipped.push(`${v.file.name}: ${res.error}`);
    }
    const created = fresh.length ? await input.uploadNew(fresh, parentId) : [];
    input.onChanged?.();
    const placed: PlacedDrop = { created, versions: versioned, skipped };
    announce(projectId, where, placed, input);
    return placed;
  } catch (error) {
    toast.error(feedbackError(error instanceof Error ? error.message : error, "Couldn’t upload files"));
    return null;
  }
}

function announce(projectId: string, where: string, placed: PlacedDrop, input: Parameters<typeof placeDrop>[0]) {
  const createdFiles = placed.created.filter((n) => n.type === "file");
  const total = createdFiles.length + placed.versions.length;
  if (!total && !placed.skipped.length) return;
  const parts = [createdFiles.length ? `${createdFiles.length} new` : "", placed.versions.length ? `${placed.versions.length} new version${placed.versions.length === 1 ? "" : "s"}` : ""].filter(Boolean);
  const description = [parts.join(", "), placed.skipped.length ? `${placed.skipped.length} skipped: ${placed.skipped.slice(0, 3).join("; ")}` : ""].filter(Boolean).join(" · ");
  toast.success(`Uploaded ${total} file${total === 1 ? "" : "s"} to ${where}`, {
    description,
    duration: 8_000,
    action: total ? { label: "Undo", onClick: () => void undoDrop(projectId, placed, input.onChanged) } : undefined,
  });
  if (placed.versions.length) {
    toast.info(`${placed.versions.length === 1 ? placed.versions[0]!.name : `${placed.versions.length} files`} replaced the file with the same name as a new version`, {
      duration: 8_000,
      action: { label: "Keep both", onClick: () => void keepBoth(projectId, placed, input) },
    });
  }
}

/** Undo a drop: each file goes back to the version that was active before (it stays in the history), new files go to Trash (A10.8). */
export async function undoDrop(projectId: string, placed: PlacedDrop, onChanged?: () => void) {
  try {
    const { restoreFileVersion } = await import("@/app/actions/files/versions");
    const { bulkTrashNodes } = await import("@/app/actions/files/mutations");
    const failed: string[] = [];
    for (const v of placed.versions) {
      if (v.previous < 1) continue;
      await restoreFileVersion(projectId, v.nodeId, v.previous, { expectActive: v.version }).catch(() => failed.push(v.name));
    }
    const roots = placed.created.filter((n) => !placed.created.some((p) => p.id === n.parentId)).map((n) => n.id);
    if (roots.length) await bulkTrashNodes(roots, projectId);
    onChanged?.();
    if (failed.length) toast.warning(`Undone, except ${failed.join(", ")}: changed since`);
    else toast.success("Undone");
  } catch (error) {
    toast.error(feedbackError(error instanceof Error ? error.message : error, "Couldn’t undo"));
  }
}

/** Keep both: the versions go back, and the dropped files upload again as `name (2).ext`. */
async function keepBoth(projectId: string, placed: PlacedDrop, input: Parameters<typeof placeDrop>[0]) {
  const byName = new Map(input.files.map((f) => [f.name, f]));
  await undoDrop(projectId, { created: [], versions: placed.versions, skipped: [] });
  const taken = new Set(input.files.map((f) => f.name));
  const renamed = placed.versions.map((v) => byName.get(v.name)).filter((f): f is File => Boolean(f)).map((f) => new File([f], keepBothName(f.name, taken), { type: f.type, lastModified: f.lastModified }));
  if (renamed.length) await input.uploadNew(renamed, input.parentId).then(() => input.onChanged?.(), (error) => toast.error(feedbackError(error, "Couldn’t upload files")));
}
