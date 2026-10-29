import { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { UUID_RE } from "@/app/actions/files/_constants";
import { jsonError } from "@/app/api/v1/_envelope";
import { enforceRouteLimit } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import { prepareSubmissionsExport, streamFolderExport } from "@/lib/files/folder-export";
import { safeContentDisposition } from "@/lib/storage/private-object-response";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; taskId: string }> };

/** An org admin may download an assignment's submissions (report §23.4 Download all). */
async function orgAdminOf(orgId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const access = await getProjectAccessById(orgId, user.id);
  return access.project?.kind === "organization" && (access.isOwner || access.memberRole === "admin") ? user.id : null;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { id: orgId, taskId } = await context.params;
  if (!UUID_RE.test(orgId) || !UUID_RE.test(taskId)) return jsonError("Not found", 404, "NOT_FOUND");
  const userId = await orgAdminOf(orgId);
  const limited = await enforceRouteLimit(request, "files:export", 10, 600, "default", userId ?? undefined);
  if (limited) return limited;
  if (!userId) return jsonError("You don’t have access to this", 403, "FORBIDDEN");
  const [master] = await db.select({ title: tasks.title }).from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, orgId), eq(tasks.kind, "assignment"), isNull(tasks.deletedAt))).limit(1);
  if (!master) return jsonError("Not found", 404, "NOT_FOUND");

  let prepared;
  try {
    prepared = await prepareSubmissionsExport({ masterId: taskId });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Couldn’t prepare the download", 409, "CONFLICT");
  }
  const reauthorize = async () => {
    if ((await orgAdminOf(orgId)) !== userId) throw new Error("Export session expired");
  };
  const filename = `${master.title.replace(/[\\/\0]/g, "_").slice(0, 160)} submissions.zip`;
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
