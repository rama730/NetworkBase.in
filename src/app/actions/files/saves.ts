"use server";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { ChangeSetError, type Actor } from "@/lib/domain/change-sets";
import { filesAtSave, getSave, listSaves, revertSave, saveDiff, saveOfVersion, setBranchesEnabled } from "@/lib/domain/saves";
import { createClient } from "@/lib/supabase/server";

/** History in the Files tab (report H3): the signed-in person, through the same rules as the API. */
async function actor(): Promise<Actor> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new ChangeSetError("Sign in to continue", 401, "UNAUTHORIZED");
  return { user: { id: user.id }, tokenKind: null, tokenScopes: null };
}

type Result<T> = { success: true; data: T } | { success: false; error: string; code: string; details?: Record<string, unknown> };
async function run<T>(fn: (a: Actor) => Promise<T>): Promise<Result<T>> {
  try {
    return { success: true, data: await fn(await actor()) };
  } catch (error) {
    if (error instanceof ChangeSetError) return { success: false, error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) };
    throw error;
  }
}

/** Whether History is on here, for the workspace's people (the setting itself is no secret to them). */
export const branchesSettingAction = async (projectId: string) => run(async (a) => {
  const access = await getWorkspaceAccessById(projectId, a.user!.id);
  const member = Boolean(access.project && (access.isOwner || access.isMember || access.isInheritedAdmin));
  const [row] = member ? await db.select({ on: workspaces.branchesEnabled }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1) : [];
  return {
    enabled: Boolean(row?.on),
    canChange: member && (access.isOwner || access.memberRole === "admin" || access.isInheritedAdmin) && access.project?.kind !== "organization" && !access.project?.parentId,
  };
});
export const setBranchesEnabledAction = async (projectId: string, enabled: boolean) => run((a) => setBranchesEnabled(a, projectId, enabled));
export const listSavesAction = async (projectId: string, opts: { path?: string | null; author?: string | null; cursor?: string | null } = {}) => run((a) => listSaves(a, projectId, opts));
export const getSaveAction = async (saveId: string) => run((a) => getSave(a, saveId));
export const saveDiffAction = async (saveId: string, path: string) => run((a) => saveDiff(a, saveId, path));
export const filesAtSaveAction = async (saveId: string, cursor?: string | null) => run((a) => filesAtSave(a, saveId, { cursor }));
export const revertSaveAction = async (saveId: string) => run((a) => revertSave(a, new Request("https://app.local/saves"), saveId));
export const saveOfVersionAction = async (nodeId: string, version: number) => run((a) => saveOfVersion(a, nodeId, version));
