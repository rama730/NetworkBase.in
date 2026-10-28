import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";

import { UUID_RE } from "@/app/actions/files/_constants";
import { jsonError } from "@/app/api/v1/_envelope";
import { enforceRouteLimit } from "@/app/api/v1/_shared";
import {
  assertProjectFileReadAccess,
  canReadProjectTaskFiles,
  orgFileAccessSql,
} from "@/lib/files/internal-helpers";
import { prepareFolderExport, streamFolderExport } from "@/lib/files/folder-export";
import { safeContentDisposition } from "@/lib/storage/private-object-response";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function exportFilename(value: string | null) {
  const safe = value?.trim().replace(/[\\/\0]/g, "_").slice(0, 180) || "Project Files";
  return `${safe}_Export.zip`;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { id: projectId } = await context.params;
  const folderId = request.nextUrl.searchParams.get("folderId");
  if (!UUID_RE.test(projectId) || (folderId !== null && !UUID_RE.test(folderId))) {
    return jsonError("Not found", 404, "NOT_FOUND");
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Exports lock and pin every asset in the tree; signed-out viewers share an IP bucket.
  const limited = await enforceRouteLimit(request, "files:export", 10, 600, "default", user?.id);
  if (limited) return limited;
  const access = await assertProjectFileReadAccess(projectId, user?.id ?? null).catch(() => null);
  if (!access) return jsonError("Forbidden", 403, "FORBIDDEN");
  // In an organization the zip holds only what this viewer may open: no Admins-only folders or other people's copies.
  const nodeFilter = orgFileAccessSql(access)
    ? (alias: "n" | "child") => orgFileAccessSql(access, { projectId: sql.raw(`${alias}.project_id`), path: sql.raw(`${alias}.path`), taskId: sql.raw(`${alias}.task_id`) })
    : undefined;

  let prepared;
  try {
    prepared = await prepareFolderExport({
      projectId,
      folderId,
      canReadTaskFiles: canReadProjectTaskFiles(access),
      nodeFilter,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to prepare folder export";
    const status = message.includes("limited") ? 413 : message.includes("not found") ? 404 : 409;
    const errorCode = status === 404 ? "NOT_FOUND" : status === 409 ? "CONFLICT" : "BAD_REQUEST";
    return jsonError(message, status, errorCode);
  }

  const reauthorize = async () => {
    const currentClient = await createClient();
    const { data: { user: currentUser } } = await currentClient.auth.getUser();
    if (currentUser?.id !== user?.id) throw new Error("Export session expired");
    const currentAccess = await assertProjectFileReadAccess(projectId, currentUser?.id ?? null);
    if (prepared.requiresTaskAccess && !canReadProjectTaskFiles(currentAccess)) {
      throw new Error("Task-file access was revoked");
    }
  };
  const filename = exportFilename(request.nextUrl.searchParams.get("name"));
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
