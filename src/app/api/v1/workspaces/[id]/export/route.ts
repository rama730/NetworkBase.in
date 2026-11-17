import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { enforceRouteLimit, getRequestId, jsonError, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { agentGate } from "@/lib/agents/policy";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { branches } from "@/lib/db/schema";
import { prepareFolderExport, streamFolderExport, type PreparedFolderExport } from "@/lib/files/folder-export";
import { assertWorkspaceFileReadAccess, canReadWorkspaceTaskFiles, orgFileAccessSql } from "@/lib/files/internal-helpers";
import { requireStepUp } from "@/lib/security/cli-step-up";
import { safeContentDisposition } from "@/lib/storage/private-object-response";
import { buildExportJson } from "@/lib/workspaces/server/workspace-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `nb export` (report F8): one zip with `files/` (main), `export.json` (tasks, comments, docs) and, with Part H,
 * `branches/<name>/` for `?branch=<name>` or `?allBranches=1`. People verify it's them (F5); an agent needs a yes.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
    const limited = await enforceRouteLimit(request, "workspace:export", 5, 600, "default", auth.user.id);
    if (limited) return limited;
    const access = await assertWorkspaceFileReadAccess(id, auth.user.id).catch(() => null);
    if (!access) return jsonError("Workspace not found", 404, "NOT_FOUND");
    // A backup of everything (every task and comment, which members of an organization don't all see): owners and
    // admins only. Members download the files they can open from the Files tab.
    const role = await getWorkspaceAccessById(id, auth.user.id);
    if (!role.isOwner && role.memberRole !== "admin" && !role.isInheritedAdmin) return jsonError("Only the workspace's owners and admins export it", 403, "FORBIDDEN");
    if (auth.tokenKind === "agent") {
      const held = await agentGate(auth, request, { export: id }, { workspaceId: id, kinds: ["batch"], summary: "Export the whole workspace (files, tasks, comments, docs)" });
      if (held) return held;
    } else {
      const refused = await requireStepUp(auth, request, "export a workspace");
      if (refused) return refused;
    }
    const q = new URL(request.url).searchParams;
    const nodeFilter = orgFileAccessSql(access)
      ? (alias: "n" | "child") => orgFileAccessSql(access, { projectId: sql.raw(`${alias}.workspace_id`), path: sql.raw(`${alias}.path`), taskId: sql.raw(`${alias}.task_id`) })
      : undefined;
    const main = await prepareFolderExport({ projectId: id, folderId: null, nodeIds: undefined, canReadTaskFiles: canReadWorkspaceTaskFiles(access), nodeFilter }).catch((error: unknown) => {
      if (error instanceof Error && error.message.startsWith("No files")) return null;
      throw error;
    });
    const entries = (main?.entries ?? []).map((e) => ({ ...e, path: `files/${e.path}` }));
    // Branches (H26): each its own folder, the branch's files as they are on it.
    const wanted = q.get("allBranches") === "1" ? null : q.get("branch");
    if (q.get("allBranches") === "1" || wanted) {
      const { branchTree, loadBranch } = await import("@/lib/domain/branches");
      const list = await db.select({ id: branches.id, name: branches.name }).from(branches)
        .where(and(eq(branches.workspaceId, id), eq(branches.isDefault, false), eq(branches.status, "active")));
      const chosen = wanted ? list.filter((b) => b.name.toLowerCase() === wanted.toLowerCase()) : list;
      if (wanted && !chosen.length) return jsonError(`No branch ${wanted} here`, 404, "BRANCH_NOT_FOUND" as never);
      for (const b of chosen) {
        const { branch, main: mainRef } = await loadBranch(auth, b.id);
        let cursor: string | null = null;
        do {
          const page = await branchTree(branch, mainRef.id, { cursor });
          for (const f of page.files) if (f.storageKey) entries.push({ id: `${b.id}:${f.path}`, path: `branches/${b.name.replace(/[^A-Za-z0-9._/-]+/g, "-")}${f.path}`, type: "file", bucket: "project-files", storageKey: f.storageKey, assetId: null, size: f.size ?? 0 } as never);
          if (entries.length > 20_000) return jsonError("An export holds at most 20,000 files; export one branch with --branch", 413, "TOO_LARGE" as never);
          cursor = page.nextCursor;
        } while (cursor);
      }
    }
    const prepared: PreparedFolderExport = {
      operationId: main?.operationId ?? crypto.randomUUID(), entries, totalBytes: entries.reduce((n, e) => n + (e.size ?? 0), 0),
      requiresTaskAccess: main?.requiresTaskAccess ?? false, skippedFiles: main?.skippedFiles ?? 0, historyName: "export", historyNodeId: null,
    };
    const json = new TextEncoder().encode(JSON.stringify(await buildExportJson(id), null, 2));
    return new Response(streamFolderExport({
      prepared, requestSignal: request.signal, extraFiles: [{ path: "export.json", bytes: json }],
      reauthorize: async () => { if (!(await assertWorkspaceFileReadAccess(id, auth.user!.id).catch(() => null))) throw new Error("Access changed"); },
    }), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": safeContentDisposition("export.zip", "attachment"), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/export", fallback: "Couldn’t export the workspace" });
  }
}
