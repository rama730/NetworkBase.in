"use server";

import { ChangeSetError, type Actor } from "@/lib/domain/change-sets";
import {
  beginUploadOnBranch, branchChanges, branchFileDiff, branchFileText, branchFolder, branchPaths, createBranch, deleteBranch, deleteOnBranch, findBranch, finishUploadOnBranch, getBranch,
  listBranches, listBranchFiles, moveOnBranch, renameBranch, restoreBranch, saveTextOnBranch, updateFromMain,
} from "@/lib/domain/branches";
import { putContent } from "@/lib/domain/change-sets";
import { listSaves } from "@/lib/domain/saves";
import { createClient } from "@/lib/supabase/server";

/** Branches in the Files tab (report H2): the signed-in person, through the same rules as the API. */
async function actor(): Promise<Actor> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new ChangeSetError("Sign in to continue", 401, "UNAUTHORIZED");
  return { user: { id: user.id }, tokenKind: null, tokenScopes: null };
}

type Result<T> = { success: true; data: T } | { success: false; error: string; code: string; details?: Record<string, unknown>; stepUp?: { methods: string[]; factorId?: string } };
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

// The Files tab on a branch (H-2b: the picker switches All files).
export const branchFolderAction = async (branchId: string, folder: string | null) => run((a) => branchFolder(a, branchId, folder));
export const branchPathsAction = async (branchId: string) => run((a) => branchPaths(a, branchId));
export const moveOnBranchAction = async (branchId: string, from: string, to: string) => run((a) => moveOnBranch(a, branchId, from, to));
export const beginUploadOnBranchAction = async (branchId: string, files: Array<{ path: string; hash: string; size: number; mimeType: string | null }>) => run((a) => beginUploadOnBranch(a, branchId, files));
/** Small files' bytes (base64, under 3 MB a call), or one large file's hash to get its upload address. */
export const uploadContentOnBranchAction = async (changeSetId: string, body: { files?: Array<{ hash: string; base64: string }>; hash?: string; confirmSecrets?: boolean }) => run((a) => putContent(a, changeSetId, body));
export const finishUploadOnBranchAction = async (changeSetId: string, confirmSecrets = false) => run((a) => finishUploadOnBranch(a, new Request("https://app.local/branches"), changeSetId, { confirmSecrets }));
