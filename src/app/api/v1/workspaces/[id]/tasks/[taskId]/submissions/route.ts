import { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { UUID_RE } from "@/app/actions/files/_constants";
import { jsonError } from "@/app/api/v1/_envelope";
import { enforceRouteLimit } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { prepareSubmissionsExport, streamFolderExport } from "@/lib/files/folder-export";
import { safeContentDisposition } from "@/lib/storage/private-object-response";
import { createClient } from "@/lib/supabase/server";
import { recordDownload } from "@/lib/files/download-history";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; taskId: string }> };

/** An org admin may download an assignment's submissions (report §23.4 Download all). */
async function orgAdminOf(orgId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const access = await getWorkspaceAccessById(orgId, user.id);
  return access.project?.kind === "organization" && (access.isOwner || access.memberRole === "admin") ? user.id : null;
}

async function handle(request: NextRequest, context: RouteContext) {
  const isCheck = request.method === "HEAD";
  const { id: orgId, taskId } = await context.params;
  if (!UUID_RE.test(orgId) || !UUID_RE.test(taskId)) return jsonError("Not found", 404, "NOT_FOUND");
  const userId = await orgAdminOf(orgId);
  const limited = isCheck
    ? await enforceRouteLimit(request, "files:submissions-check", 60, 600, "default", userId ?? undefined)
    : await enforceRouteLimit(request, "files:submissions", 10, 600, "default", userId ?? undefined);
  if (limited) return limited;
  if (!userId) return jsonError("You don’t have access to this", 403, "FORBIDDEN");
  const [master] = await db.select({ title: tasks.title }).from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, orgId), eq(tasks.kind, "assignment"), isNull(tasks.deletedAt))).limit(1);
  if (!master) return jsonError("Not found", 404, "NOT_FOUND");

  let prepared;
  try {
    prepared = await prepareSubmissionsExport({ masterId: taskId, dryRun: isCheck });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn’t prepare the download";
    const status = message.includes("limited") ? 413 : message.startsWith("No submitted") ? 422 : 409;
    return jsonError(message, status, status === 409 ? "CONFLICT" : "BAD_REQUEST");
  }
  if (isCheck) {
    return new Response(null, {
      status: 200,
      headers: { "Cache-Control": "private, no-store", ...(prepared.skippedFiles > 0 ? { "X-Download-Skipped": String(prepared.skippedFiles) } : {}) },
    });
  }

  const reauthorize = async () => {
    if ((await orgAdminOf(orgId)) !== userId) throw new Error("Export session expired");
  };
  const filename = `${master.title.replace(/[\\/\0]/g, "_").slice(0, 160)} submissions.zip`;
  recordDownload({
    workspaceId: orgId,
    actorId: userId,
    fileName: filename,
    kind: "submissions_zip",
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
