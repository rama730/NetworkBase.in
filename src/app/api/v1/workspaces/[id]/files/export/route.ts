import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";

import { UUID_RE } from "@/app/actions/files/_constants";
import { jsonError } from "@/app/api/v1/_envelope";
import { enforceRouteLimit } from "@/app/api/v1/_shared";
import {
  assertWorkspaceFileReadAccess,
  canReadWorkspaceTaskFiles,
  orgFileAccessSql,
} from "@/lib/files/internal-helpers";
import { prepareFolderExport, streamFolderExport, exportEntriesStillVisible } from "@/lib/files/folder-export";
import { safeContentDisposition } from "@/lib/storage/private-object-response";
import { createClient } from "@/lib/supabase/server";
import { recordDownloadNow } from "@/lib/files/download-history";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const MAX_SELECTED_ITEMS = 100;

function exportFilename(value: string | null) {
  const safe = value?.trim().replace(/[\\/\0]/g, "_").slice(0, 180) || "All files";
  return `${safe}.zip`;
}

async function handle(request: NextRequest, context: RouteContext) {
  const { id: projectId } = await context.params;
  const isCheck = request.method === "HEAD";
  const folderId = request.nextUrl.searchParams.get("folderId");
  const idsParam = request.nextUrl.searchParams.get("ids");
  const nodeIds = idsParam === null ? undefined : [...new Set(idsParam.split(","))];
  if (
    !UUID_RE.test(projectId)
    || (folderId !== null && !UUID_RE.test(folderId))
    || (nodeIds && (nodeIds.length === 0 || !nodeIds.every((id) => UUID_RE.test(id))))
  ) {
    return jsonError("Not found", 404, "NOT_FOUND");
  }
  if (nodeIds && nodeIds.length > MAX_SELECTED_ITEMS) {
    return jsonError(`Downloads are limited to ${MAX_SELECTED_ITEMS} selected items`, 413, "BAD_REQUEST");
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Exports lock and pin every asset in the tree; signed-out viewers share an IP bucket.
  // The check runs out before the zip does, so the app can say so instead of the browser saving an error.
  const limited = isCheck
    ? await enforceRouteLimit(request, "files:export-check", 8, 600, "default", user?.id)
    : await enforceRouteLimit(request, "files:export", 10, 600, "default", user?.id);
  if (limited) return limited;
  const access = await assertWorkspaceFileReadAccess(projectId, user?.id ?? null).catch(() => null);
  if (!access) return jsonError("You don’t have access to this", 403, "FORBIDDEN");
  // In an organization the zip holds only what this viewer may open: no Admins-only folders or other people's copies.
  const nodeFilter = orgFileAccessSql(access)
    ? (alias: "n" | "child") => orgFileAccessSql(access, { projectId: sql.raw(`${alias}.workspace_id`), path: sql.raw(`${alias}.path`), taskId: sql.raw(`${alias}.task_id`) })
    : undefined;

  let prepared;
  try {
    prepared = await prepareFolderExport({
      projectId,
      folderId,
      nodeIds,
      dryRun: isCheck,
      canReadTaskFiles: canReadWorkspaceTaskFiles(access),
      nodeFilter,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn’t prepare folder export";
    const status = message.includes("limited") ? 413 : message.includes("not found") ? 404 : message.startsWith("No files") ? 422 : 409;
    const errorCode = status === 404 ? "NOT_FOUND" : status === 409 ? "CONFLICT" : "BAD_REQUEST";
    return jsonError(message, status, errorCode);
  }

  if (isCheck) {
    return new Response(null, {
      status: 200,
      headers: { "Cache-Control": "private, no-store", ...(prepared.skippedFiles > 0 ? { "X-Download-Skipped": String(prepared.skippedFiles) } : {}) },
    });
  }

  const reauthorize = async () => {
    const currentClient = await createClient();
    const { data: { user: currentUser } } = await currentClient.auth.getUser();
    if (currentUser?.id !== user?.id) throw new Error("Export session expired");
    const currentAccess = await assertWorkspaceFileReadAccess(projectId, currentUser?.id ?? null);
    if (prepared.requiresTaskAccess && !canReadWorkspaceTaskFiles(currentAccess)) {
      throw new Error("Task-file access was revoked");
    }
    // Org folder rules can change mid-download: stop rather than keep sending what this person may no longer open.
    if (nodeFilter && !(await exportEntriesStillVisible(prepared.entries, nodeFilter))) {
      throw new Error("Folder access changed");
    }
  };
  const filename = exportFilename(request.nextUrl.searchParams.get("name"));
  recordDownloadNow({
    workspaceId: projectId,
    nodeId: prepared.historyNodeId,
    actorId: user?.id ?? null,
    fileName: prepared.historyName,
    kind: nodeIds ? "selection_zip" : "folder_zip",
    fileCount: prepared.entries.filter((entry) => entry.type === "file").length,
  });
  return new Response(streamFolderExport({ prepared, requestSignal: request.signal, reauthorize }), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": safeContentDisposition(filename, "attachment"),
      "Content-Type": "application/zip",
      "X-Content-Type-Options": "nosniff",
      Vary: "Cookie, Authorization",
    },
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function HEAD(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}
