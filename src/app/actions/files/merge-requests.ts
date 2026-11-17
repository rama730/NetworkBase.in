"use server";

import { ChangeSetError, type Actor } from "@/lib/domain/change-sets";
import {
  applySuggestion, commentOnMergeRequest, createMergeRequest, getMergeRequest, listMergeRequests, mergeMergeRequest, reviewMergeRequest, updateMergeRequest,
} from "@/lib/domain/merge-requests";
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
export const mergeMergeRequestAction = async (projectId: string, n: number, method: "merge" | "squash", confirmSecrets = false) =>
  run((a) => mergeMergeRequest(a, new Request("https://app.local/merge-requests"), projectId, n, { method, confirmSecrets }));
