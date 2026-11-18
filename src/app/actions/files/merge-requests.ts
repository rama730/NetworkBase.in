"use server";

import { headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { workspaceNodes } from "@/lib/db/schema";

import { getProtection, protectedFromDb, setProtection, type Protection } from "@/lib/domain/branch-protection";
import type { ProtectedChange } from "@/lib/domain/branches";
import { ChangeSetError, type Actor } from "@/lib/domain/change-sets";
import {
  applySuggestion, commentOnMergeRequest, createMergeRequest, getMergeRequest, listMergeRequests, listMyReviews, mergeMergeRequest, reviewMergeRequest, updateMergeRequest,
} from "@/lib/domain/merge-requests";
import { personStepUp } from "@/lib/security/change-set-step-up";
import { createClient } from "@/lib/supabase/server";

/** Merge requests in the Files tab (report H4): the signed-in person, through the same rules as the API. */
async function actor(): Promise<Actor> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new ChangeSetError("Sign in to continue", 401, "UNAUTHORIZED");
  return { user: { id: user.id }, tokenKind: null, tokenScopes: null };
}

type StepUp = { methods: string[]; factorId?: string };
type Result<T> = { success: true; data: T } | { success: false; error: string; code: string; details?: Record<string, unknown>; stepUp?: StepUp };
async function run<T>(fn: (a: Actor) => Promise<T>): Promise<Result<T>> {
  try {
    return { success: true, data: await fn(await actor()) };
  } catch (error) {
    error = protectedFromDb(error) ?? error;
    if (error instanceof ChangeSetError) {
      const stepUp = (error.details as { stepUp?: StepUp } | undefined)?.stepUp;
      return { success: false, error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}), ...(stepUp ? { stepUp } : {}) };
    }
    throw error;
  }
}

export const listMergeRequestsAction = async (projectId: string, state: string, reviewRequested = false) => run((a) => listMergeRequests(a, projectId, { state, reviewRequested }));
export const getMergeRequestAction = async (projectId: string, n: number) => run((a) => getMergeRequest(a, projectId, n));
export const createMergeRequestAction = async (projectId: string, input: { source: string; title?: string | null; description?: string | null; draft?: boolean }) =>
  run((a) => createMergeRequest(a, projectId, input));
export const updateMergeRequestAction = async (projectId: string, n: number, patch: { title?: string; description?: string; draft?: boolean; state?: "open" | "closed" }) =>
  run((a) => updateMergeRequest(a, projectId, n, patch));
export const reviewMergeRequestAction = async (projectId: string, n: number, state: "approve" | "request_changes" | "comment", body: string) =>
  run((a) => reviewMergeRequest(a, projectId, n, { state, body }));
export const commentMergeRequestAction = async (projectId: string, n: number, input: { body: string; path?: string | null; line?: number | null; endLine?: number | null; suggestion?: string | null }) =>
  run((a) => commentOnMergeRequest(a, projectId, n, input));
export const applySuggestionAction = async (projectId: string, n: number, commentId: string) => run((a) => applySuggestion(a, projectId, n, commentId));
/** The request the security log reads (address, browser), for an owner's Merge without approval and protection changes. */
const appRequest = async () => new Request("https://app.local/merge-requests", { headers: new Headers(Object.fromEntries((await headers()).entries())) });

export const mergeMergeRequestAction = async (projectId: string, n: number, method: "merge" | "squash", confirmSecrets = false, override = false) =>
  run(async (a) => mergeMergeRequest(a, await appRequest(), projectId, n, { method, confirmSecrets, override }));

// ── Main's protection (H5) ────────────────────────────────────────────────────────────────────────────────────────

export const getProtectionAction = async (projectId: string) => run((a) => getProtection(a, projectId));
/** Loosening the rules asks "Verify it's you" first: the error carries the methods, as a merge's step-up does. */
export const setProtectionAction = async (projectId: string, patch: Partial<Protection>) =>
  run(async (a) => {
    const stepUp = await personStepUp(a);
    try {
      return { rules: (await setProtection(a, projectId, patch, { verified: !stepUp, request: await appRequest() })).rules };
    } catch (error) {
      if (error instanceof ChangeSetError && error.code === "STEP_UP_REQUIRED" && stepUp) throw new ChangeSetError(error.message, 403, "STEP_UP_REQUIRED", { stepUp });
      throw error;
    }
  });

/** On a protected main (H5, H24): the edit, version or restore goes on a new branch with a merge request instead. */
export const saveToNewBranchAction = async (projectId: string, input: { name: string; title: string; change: ProtectedChange }) =>
  run(async (a) => (await import("@/lib/domain/branches")).saveToNewBranch(a, projectId, input));

/**
 * Task files stay on main (H8): after a merge, an explicit "Attach as final file" puts one of the merged files on the
 * merge request's task as a final file, through the task's own link rules.
 */
export const attachMergeResultAction = async (projectId: string, n: number, path: string) => run(async (a) => {
  const { mergeRequest: mr } = await getMergeRequest(a, projectId, n);
  if (mr.state !== "merged" || !mr.task) throw new ChangeSetError("Only a merged merge request with a task can attach its result", 409, "NOT_AVAILABLE");
  const [node] = await db.select({ id: workspaceNodes.id }).from(workspaceNodes)
    .where(and(eq(workspaceNodes.projectId, projectId), eq(workspaceNodes.path, path), eq(workspaceNodes.type, "file"), isNull(workspaceNodes.deletedAt))).limit(1);
  if (!node) throw new ChangeSetError(`${path} isn't in main any more`, 404, "NOT_FOUND");
  const { linkNodeToTask } = await import("@/app/actions/files/links");
  await linkNodeToTask(mr.task.id, node.id, { role: "deliverable" });
  return { path, task: mr.task.number };
});

/** "My reviews" across workspaces (H23), for the inbox tab. */
export const myReviewsAction = async () => run((a) => listMyReviews(a));
