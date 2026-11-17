import "server-only";
/**
 * Workspace admin from the terminal (report F3, M7): create, see and change the basic settings, archive, and link or
 * unlink docs. Each reuses the app's action, so the rules, limits and notifications are the same.
 */
import { and, eq, isNull } from "drizzle-orm";

import { linkWorkspaceDocAction, unlinkWorkspaceDocAction } from "@/app/actions/workspace/doc";
import { db } from "@/lib/db";
import { branchProtection, branches, workspaceNodes, workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { archiveWorkspaceAction, createWorkspaceAction, updateWorkspace } from "@/lib/workspaces/server/lifecycle";

export class WorkspaceCliError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}
const fail = (message: string, status: number, code: string): never => { throw new WorkspaceCliError(message, status, code); };

export async function createWorkspaceFromCli(input: { title: string; description?: string | null; visibility?: "public" | "private" }) {
  const title = input.title.trim();
  const description = input.description?.trim() || `A workspace for ${title}.`;
  if (description.length < 20) fail("A description needs at least 20 characters (-m \"…\")", 400, "BAD_REQUEST");
  const res = await createWorkspaceAction({ title, description, project_type: "other", visibility: input.visibility ?? "private" } as never);
  if (!res.success) fail(res.error ?? "Couldn't create the workspace", 400, "BAD_REQUEST");
  const made = res as unknown as { project?: { id: string; slug: string; title: string }; projectId?: string; slug?: string };
  return { workspace: made.project ?? { id: made.projectId, slug: made.slug, title } };
}

/** What `nb workspace settings` shows: the basics, agents, history and main's protection. Members can read it. */
export async function workspaceSettings(userId: string, workspaceId: string) {
  const access = await getWorkspaceAccessById(workspaceId, userId);
  if (!access.project || !access.canRead) fail("Workspace not found", 404, "NOT_FOUND");
  const [ws] = await db.select({
    title: workspaces.title, slug: workspaces.slug, description: workspaces.description, visibility: workspaces.visibility,
    agentPolicy: workspaces.agentPolicy, agentsPausedAt: workspaces.agentsPausedAt, branchesEnabled: workspaces.branchesEnabled, status: workspaces.status,
  }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const [protection] = ws?.branchesEnabled ? await db.select({ requireMergeRequest: branchProtection.requireMergeRequest, approvals: branchProtection.approvals, agentsOnBranches: branchProtection.agentsOnBranches })
    .from(branchProtection).innerJoin(branches, eq(branches.id, branchProtection.branchId)).where(and(eq(branches.workspaceId, workspaceId), eq(branches.isDefault, true))).limit(1) : [];
  return {
    settings: { ...ws!, agentsPaused: Boolean(ws!.agentsPausedAt), agentsPausedAt: ws!.agentsPausedAt?.toISOString() ?? null, protection: protection ?? null },
    canChange: access.isOwner || access.memberRole === "admin",
  };
}

export async function changeWorkspaceSettings(workspaceId: string, patch: { title?: string; description?: string }) {
  await updateWorkspace(workspaceId, { ...(patch.title ? { title: patch.title } : {}), ...(patch.description !== undefined ? { description: patch.description } : {}) } as never);
}

export async function archiveWorkspaceFromCli(workspaceId: string) {
  const res = await archiveWorkspaceAction(workspaceId);
  if (!res.success) fail(res.message, res.errorCode === "UNAUTHORIZED" ? 401 : 403, res.errorCode === "UNAUTHORIZED" ? "UNAUTHORIZED" : "FORBIDDEN");
  return { archived: true, message: res.message };
}

/** `nb doc add <path>`: a file becomes a workspace doc (the file stays where it is). */
export async function addDocFromCli(userId: string, workspaceId: string, path: string) {
  // Access first, and the same answer for "no access" and "no file", so nothing about the files leaks.
  const access = await getWorkspaceAccessById(workspaceId, userId);
  if (!access.project || !access.canWrite) fail("Workspace not found", 404, "NOT_FOUND");
  const full = path.startsWith("/") ? path : `/${path}`;
  const [node] = await db.select({ id: workspaceNodes.id }).from(workspaceNodes)
    .where(and(eq(workspaceNodes.projectId, workspaceId), eq(workspaceNodes.path, full), eq(workspaceNodes.type, "file"), isNull(workspaceNodes.deletedAt))).limit(1);
  if (!node) fail(`No file ${full} here`, 404, "NOT_FOUND");
  const res = await linkWorkspaceDocAction(workspaceId, node!.id);
  if (!res.success) fail(res.error ?? "Couldn't add the doc", 403, "FORBIDDEN");
  return res;
}

/** `nb doc remove <slug>`: unlinks the doc; its file stays. */
export async function removeDocFromCli(workspaceId: string, slug: string) {
  const res = await unlinkWorkspaceDocAction(workspaceId, slug);
  if (!res.success) fail(res.error ?? "Couldn't remove the doc", 403, "FORBIDDEN");
  return res;
}
