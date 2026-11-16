"use server";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import {
  ChangeSetError, applyChangeSet, askForChanges, copyChangeSet, diffItem, discardChangeSet, getChangeSet, listChangeSets, conflictSides, openChangeSetsFor, resolveItem, undoChangeSet, updateDraft, type Actor,
} from "@/lib/domain/change-sets";
import { changeSetStepUp } from "@/lib/security/change-set-step-up";
import type { SecurityStepUpMethod } from "@/lib/security/step-up-methods";
import { createClient } from "@/lib/supabase/server";

/** The Changes view in the Files tab (report G12): the signed-in person, through the same rules as the API. */
async function actor(): Promise<Actor> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new ChangeSetError("Sign in to continue", 401, "UNAUTHORIZED");
  return { user: { id: user.id }, tokenKind: null, tokenScopes: null };
}

type Result<T> = { success: true; data: T } | { success: false; error: string; code: string; details?: Record<string, unknown>; stepUp?: { methods: SecurityStepUpMethod[]; factorId?: string } };
async function run<T>(fn: (a: Actor) => Promise<T>): Promise<Result<T>> {
  try {
    return { success: true, data: await fn(await actor()) };
  } catch (error) {
    if (error instanceof ChangeSetError) {
      const stepUp = error.details?.stepUp as { methods: SecurityStepUpMethod[]; factorId?: string } | undefined;
      return { success: false, error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}), ...(stepUp ? { stepUp } : {}) };
    }
    throw error;
  }
}

/** Whether the workspace has change sets on, and its change sets newest first. */
export async function listChangeSetsAction(projectId: string, status?: string) {
  return run(async (a) => {
    // Access first (listChangeSets refuses a workspace you can't read), so the flag never answers for anyone else's.
    const list = await listChangeSets(a, projectId, { status: status ?? null });
    const [row] = await db.select({ on: workspaces.changeSetsEnabled }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
    return row?.on ? { enabled: true, ...list } : { enabled: false, changeSets: [], nextCursor: null };
  });
}
export const getChangeSetAction = async (id: string, cursor?: string | null) => run((a) => getChangeSet(a, id, { cursor }));
export const changeSetDiffAction = async (id: string, path: string) => run((a) => diffItem(a, id, path));
/** Apply (G12): one click, with "Verify it's you" first when the files include finals or docs. */
export async function applyChangeSetAction(id: string, only?: string[] | null): Promise<Result<Awaited<ReturnType<typeof applyChangeSet>>>> {
  return run(async (a) => {
    const stepUp = await changeSetStepUp(a, id);
    if (stepUp) throw new ChangeSetError("These files include final files or a doc: verify it’s you first", 403, "STEP_UP_REQUIRED", { stepUp });
    return applyChangeSet(a, new Request("https://app.local/change-sets"), id, { only: only?.length ? only : null });
  });
}
export const discardChangeSetAction = async (id: string) => run((a) => discardChangeSet(a, id));
export const undoChangeSetAction = async (id: string, partial = false) => run((a) => undoChangeSet(a, id, { partial }));
export const copyChangeSetAction = async (id: string) => run((a) => copyChangeSet(a, id));
export const askForChangesAction = async (id: string, text: string) => run((a) => askForChanges(a, id, text));
export const updateDraftAction = async (id: string) => run((a) => updateDraft(a, id));
export const resolveItemAction = async (id: string, path: string, choice: "mine" | "theirs" | "content", text?: string) => run((a) => resolveItem(a, id, { path, choice, text }));
export const conflictSidesAction = async (id: string, path: string) => run((a) => conflictSides(a, id, path));
/** Open drafts on a task or a file, for the presence lines (G15). */
export const openChangeSetsForAction = async (projectId: string, where: { taskId?: string | null; path?: string | null }) => run((a) => openChangeSetsFor(a, projectId, where));
