"use server";

import { ChangeSetError, type Actor } from "@/lib/domain/change-sets";
import {
  branchChanges, branchFileDiff, branchFileText, createBranch, deleteBranch, deleteOnBranch, findBranch, getBranch, listBranches, listBranchFiles, renameBranch, restoreBranch, saveTextOnBranch, updateFromMain,
} from "@/lib/domain/branches";
import { listSaves } from "@/lib/domain/saves";
import { createClient } from "@/lib/supabase/server";

/** Branches in the Files tab (report H2): the signed-in person, through the same rules as the API. */
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

export const listBranchesAction = async (projectId: string, status?: string) => run((a) => listBranches(a, projectId, { status: status ?? "active" }));
export const createBranchAction = async (projectId: string, name: string, from?: string | null) => run((a) => createBranch(a, projectId, { name, from: from ?? null }));
/** A branch by its name (the address carries the name, H2). */
export const branchByNameAction = async (projectId: string, name: string) => run(async (a) => getBranch(a, (await findBranch(a, projectId, name)).id));
export const renameBranchAction = async (branchId: string, name: string) => run((a) => renameBranch(a, branchId, name));
export const deleteBranchAction = async (branchId: string) => run((a) => deleteBranch(a, branchId));
export const restoreBranchAction = async (branchId: string) => run((a) => restoreBranch(a, branchId));
export const updateBranchAction = async (branchId: string, resolutions?: Record<string, "branch" | "main">) => run((a) => updateFromMain(a, branchId, { resolutions }));
export const branchChangesAction = async (branchId: string) => run((a) => branchChanges(a, branchId));
export const branchDiffAction = async (branchId: string, path: string) => run((a) => branchFileDiff(a, branchId, path));
export const branchFilesAction = async (branchId: string, cursor?: string | null) => run((a) => listBranchFiles(a, branchId, { cursor }));
export const branchFileTextAction = async (branchId: string, path: string) => run((a) => branchFileText(a, branchId, path));
export const saveOnBranchAction = async (branchId: string, input: { path: string; text: string; expectedHash?: string | null; message?: string | null }) => run((a) => saveTextOnBranch(a, branchId, input));
export const deleteOnBranchAction = async (branchId: string, path: string) => run((a) => deleteOnBranch(a, branchId, path));
export const branchSavesAction = async (projectId: string, branchId: string, cursor?: string | null) => run((a) => listSaves(a, projectId, { branch: branchId, cursor }));
