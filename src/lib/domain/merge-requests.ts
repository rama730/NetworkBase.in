import "server-only";
/**
 * Merge requests (report Part H, phase H-3): a branch asks to come into main. People review it (comments, line
 * comments, suggested edits, approve or request changes), builds post checks, and merging applies the branch's own
 * files to main as one Part G change set (G10: all or nothing, one undo, an agent's merge held for the person's yes).
 * docs/superpowers/plans/2026-11-17-m8-h3-merge-requests.md
 */
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  branchFiles, branches, changeSets, mergeRequestChecks, mergeRequestComments, mergeRequestEvents, mergeRequestReviews, mergeRequests, profiles, saves,
  tasks, workspaceMembers, workspaces,
} from "@/lib/db/schema";
import { labelScope } from "@/lib/agents/via-scope";
import { visibleVia } from "@/lib/agents/via-visibility";
import { branchChanges, branchFileText, findBranch, mainAt, saveTextOnBranch, seqOf, type Branch } from "@/lib/domain/branches";
import {
  ChangeSetError, applyChangeSet, finishChangeSet, startChangeSet, upsertItems, type Actor, type ItemInput,
} from "@/lib/domain/change-sets";
import { mainBranch, memberAccess, SAVE_LIMITS } from "@/lib/domain/saves";
import { enqueueNotificationFanout } from "@/lib/notifications/fanout";
import { changeSetStepUp } from "@/lib/security/change-set-step-up";
import { viaColumns } from "@/lib/server/request-via";
import { lockTaskForWrite, transitionTaskTx } from "@/lib/workspaces/task-transition-service";
import { logger } from "@/lib/logger";

const fail = (message: string, status: number, code: string, details?: Record<string, unknown>): never => {
  throw new ChangeSetError(message, status, code, details);
};
const userOf = (actor: Actor) => actor.user?.id ?? fail("Sign in to continue", 401, "UNAUTHORIZED");
const isAgent = (actor: Actor) => actor.tokenKind === "agent";

export const MR_LIMITS = { open: 200, saves: 250, comments: 500 };
export type MergeRequest = typeof mergeRequests.$inferSelect;
type Person = { id: string; name: string | null; username: string | null };
const OPEN = ["draft", "open"] as const;

// ── Finding ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** "3", "!3" or "#3". */
function numberOf(ref: string | number) {
  const n = Number(String(ref).replace(/^[!#]/, ""));
  if (!Number.isInteger(n) || n < 1 || n > 2_147_483_647) fail("Merge request not found", 404, "NOT_FOUND");
  return n;
}

/** The merge request by its number in a workspace: the workspace's people only (H15), writers for changes. */
async function loadMr(actor: Actor, workspaceId: string, ref: string | number, opts: { write?: boolean } = {}) {
  const who = await memberAccess(actor, workspaceId);
  const main = await mainBranch(workspaceId);
  const [mr] = await db.select().from(mergeRequests).where(and(eq(mergeRequests.workspaceId, workspaceId), eq(mergeRequests.number, numberOf(ref)))).limit(1);
  if (!mr) fail("Merge request not found", 404, "NOT_FOUND");
  if (opts.write && !who.canWrite) fail("You can read this workspace but not change it", 403, "FORBIDDEN");
  const [source] = await db.select().from(branches).where(eq(branches.id, mr!.sourceBranchId)).limit(1);
  return { mr: mr!, source: source!, main, ...who };
}

const stillOpen = (mr: MergeRequest) => {
  if (mr.state === "merged") fail(`!${mr.number} was merged`, 409, "MERGE_REQUEST_CLOSED");
  if (mr.state === "closed") fail(`!${mr.number} is closed; reopen it first`, 409, "MERGE_REQUEST_CLOSED");
};

async function peopleById(ids: Array<string | null | undefined>): Promise<Map<string, Person>> {
  const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const rows = list.length ? await db.select({ id: profiles.id, name: profiles.fullName, username: profiles.username }).from(profiles).where(inArray(profiles.id, list)) : [];
  return new Map(rows.map((p) => [p.id, p]));
}
const nameOf = (p: Person | undefined) => p?.name || (p?.username ? `@${p.username}` : "Someone");

/** Workspace people who can write: reviewers come from them. Ids or @usernames. */
async function writersAmong(workspaceId: string, refs: string[]) {
  const wanted = refs.map((r) => String(r).trim().replace(/^@/, "")).filter(Boolean);
  if (!wanted.length) return [] as string[];
  const rows = await db.select({ id: profiles.id, username: profiles.username, role: workspaceMembers.role }).from(workspaceMembers)
    .innerJoin(profiles, eq(profiles.id, workspaceMembers.userId)).where(eq(workspaceMembers.projectId, workspaceId));
  const [ws] = await db.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const ownerRow = ws?.ownerId && !rows.some((r) => r.id === ws.ownerId)
    ? (await db.select({ id: profiles.id, username: profiles.username }).from(profiles).where(eq(profiles.id, ws.ownerId)).limit(1)).map((p) => ({ ...p, role: "owner" as const }))
    : [];
  const all = [...rows, ...ownerRow];
  return wanted.map((w) => {
    const hit = all.find((r) => r.id === w || r.username?.toLowerCase() === w.toLowerCase());
    if (!hit) fail(`${w} isn't in this workspace`, 400, "BAD_REQUEST");
    if (hit!.role === "viewer") fail(`${w} can only read this workspace, so they can't review`, 400, "BAD_REQUEST");
    return hit!.id;
  });
}

/** Default reviewers (H4): the workspace's owners and admins, not the author. */
async function defaultReviewers(workspaceId: string, authorId: string) {
  const rows = await db.select({ id: workspaceMembers.userId }).from(workspaceMembers)
    .where(and(eq(workspaceMembers.projectId, workspaceId), inArray(workspaceMembers.role, ["owner", "admin"])));
  const [ws] = await db.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return [...new Set([...rows.map((r) => r.id), ...(ws?.ownerId ? [ws.ownerId] : [])])].filter((id) => id !== authorId);
}

// ── Notifications (H4; one kind, grouped per merge request and event: 0.8 #10) ────────────────────────────────────

type MrEvent = "review_requested" | "ready" | "comment" | "approved" | "changes_requested" | "checks_failed" | "merged" | "closed";
const EVENT_TITLE: Record<MrEvent, (who: string, ref: string) => string> = {
  review_requested: (w, r) => `${w} asked you to review ${r}`,
  ready: (w, r) => `${r} is ready for review`,
  comment: (w, r) => `${w} commented on ${r}`,
  approved: (w, r) => `${w} approved ${r}`,
  changes_requested: (w, r) => `${w} requested changes on ${r}`,
  checks_failed: (_w, r) => `Checks failed on ${r}`,
  merged: (w, r) => `${w} merged ${r}`,
  closed: (w, r) => `${w} closed ${r}`,
};

async function notify(mr: MergeRequest, event: MrEvent, actorId: string | null, recipients: Array<string | null | undefined>, sourceEventId: string) {
  const to = [...new Set(recipients.filter((id): id is string => Boolean(id) && id !== actorId))];
  if (!to.length) return;
  const who = nameOf((await peopleById([actorId])).get(actorId ?? ""));
  const ref = `!${mr.number} ${mr.title}`;
  await enqueueNotificationFanout({
    source: "merge-request",
    writes: to.map((recipientUserId) => ({
      operation: "aggregate" as const,
      input: {
        recipientUserId, actorUserId: actorId, kind: "merge_request" as const, category: "workflows" as const,
        importance: ["review_requested", "ready", "changes_requested", "checks_failed"].includes(event) ? "important" as const : "more" as const,
        title: EVENT_TITLE[event](who, ref).slice(0, 200),
        href: `/workspaces/${mr.workspaceId}?tab=files&filesView=merge-requests&mr=${mr.number}`,
        entityRefs: { projectId: mr.workspaceId, ...(mr.taskId ? { taskId: mr.taskId } : {}) },
        dedupeKey: `merge-request:${mr.id}:${event}`,
        sourceEventId,
      },
    })),
  }).catch((error: unknown) => logger.warn("merge_requests.notify_failed", { module: "merge-requests", error: error instanceof Error ? error.message : String(error) }));
}

async function event(mrId: string, actorId: string | null, kind: typeof mergeRequestEvents.$inferInsert["kind"], data: Record<string, unknown> = {}) {
  const via = await viaColumns();
  const [row] = await db.insert(mergeRequestEvents).values({ mergeRequestId: mrId, actorId, via: via.via, agentName: via.agentName, kind, data }).returning({ id: mergeRequestEvents.id });
  return String(row!.id);
}

// ── Opening (H4) ──────────────────────────────────────────────────────────────────────────────────────────────────

const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/i;
const titleFromName = (name: string) => {
  const words = (name.split("/").pop() ?? name).replace(/[-_]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : name;
};

export async function createMergeRequest(actor: Actor, workspaceId: string, input: {
  source: string; target?: string | null; title?: string | null; description?: string | null; taskId?: string | null; draft?: boolean; reviewers?: string[] | null;
}) {
  const userId = userOf(actor);
  const { canWrite } = await memberAccess(actor, workspaceId);
  if (!canWrite) fail("You can read this workspace but not change it", 403, "FORBIDDEN");
  const main = await mainBranch(workspaceId);
  if (input.target && input.target.toLowerCase() !== "main" && input.target !== main.id) fail("Merge requests go into main for now", 409, "NOT_AVAILABLE");
  const source = await findBranch(actor, workspaceId, input.source);
  if (source.isDefault) fail("Open a merge request from a branch, into main", 409, "MAIN_BRANCH");
  if (source.status !== "active") fail(`${source.name} was ${source.status}; restore it first`, 409, "BRANCH_DELETED");
  const [{ own } = { own: 0 }] = await db.select({ own: sql<number>`count(*)::int` }).from(branchFiles).where(eq(branchFiles.branchId, source.id));
  if (!own) fail("This branch has nothing that main doesn't already have", 409, "MERGE_REQUEST_EMPTY");

  const description = String(input.description ?? "").slice(0, 20_000);
  let taskId = input.taskId ?? null;
  const closes = CLOSES.exec(description);
  if (!taskId && closes) {
    const [t] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.projectId, workspaceId), eq(tasks.taskNumber, Number(closes[1])), isNull(tasks.deletedAt))).limit(1);
    taskId = t?.id ?? null;
  }
  taskId ??= source.taskId ?? null;
  let task: { id: string; title: string } | undefined;
  if (taskId) {
    [task] = await db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.projectId, workspaceId))).limit(1);
    if (!task) fail("That task isn't in this workspace", 404, "NOT_FOUND");
  }
  const title = (input.title?.trim() || task?.title || titleFromName(source.name)).slice(0, 200);
  // Pre-filled (H4): the branch's saves, newest last.
  const body = description || (await db.select({ message: saves.message }).from(saves)
    .where(and(eq(saves.branchId, source.id), sql`${saves.kind} NOT IN ('start', 'merge')`)).orderBy(asc(saves.seq)).limit(20))
    .map((s) => `- ${s.message ?? "Save"}`).join("\n");
  const reviewers = input.reviewers?.length ? (await writersAmong(workspaceId, input.reviewers)).filter((id) => id !== userId) : await defaultReviewers(workspaceId, userId);
  const via = await viaColumns();
  let made: MergeRequest;
  try {
    made = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`merge-requests:${workspaceId}`}))`);
      const [{ open } = { open: 0 }] = await tx.select({ open: sql<number>`count(*)::int` }).from(mergeRequests).where(and(eq(mergeRequests.workspaceId, workspaceId), inArray(mergeRequests.state, [...OPEN])));
      if (open >= MR_LIMITS.open) fail(`A workspace has at most ${MR_LIMITS.open} open merge requests; merge or close some first`, 409, "MERGE_REQUEST_LIMIT");
      const [{ next } = { next: 1 }] = await tx.select({ next: sql<number>`coalesce(max(${mergeRequests.number}), 0)::int + 1` }).from(mergeRequests).where(eq(mergeRequests.workspaceId, workspaceId));
      const [row] = await tx.insert(mergeRequests).values({
        workspaceId, number: next, sourceBranchId: source.id, targetBranchId: main.id, title, description: body, state: input.draft ? "draft" : "open",
        authorId: userId, via: via.via, agentName: via.agentName, taskId: task?.id ?? null,
      }).returning();
      if (reviewers.length) await tx.insert(mergeRequestReviews).values(reviewers.map((reviewerId) => ({ mergeRequestId: row!.id, reviewerId })));
      return row!;
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "23505" || (error as { cause?: { code?: string } })?.cause?.code === "23505") {
      const [open] = await db.select({ number: mergeRequests.number }).from(mergeRequests).where(and(eq(mergeRequests.sourceBranchId, source.id), eq(mergeRequests.targetBranchId, main.id), inArray(mergeRequests.state, [...OPEN]))).limit(1);
      fail(`${source.name} already has an open merge request${open ? ` (!${open.number})` : ""}`, 409, "MERGE_REQUEST_EXISTS", open ? { number: open.number } : undefined);
    }
    throw error;
  }
  const eventId = await event(made!.id, userId, "opened", { draft: Boolean(input.draft) });
  if (!input.draft) await notify(made!, "review_requested", userId, reviewers, eventId);
  return getMergeRequest(actor, workspaceId, made!.number);
}

// ── Reading ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type MergeRequestSummary = {
  id: string; number: number; title: string; state: MergeRequest["state"]; source: { id: string; name: string; status: string };
  author: Person | null; madeWith: string | null; task: { id: string; number: number | null; title: string } | null;
  approvals: number; changesRequested: number; comments: number; reviewRequested: boolean; createdAt: string; updatedAt: string;
};

export async function listMergeRequests(actor: Actor, workspaceId: string, opts: { state?: string | null; reviewRequested?: boolean; mine?: boolean } = {}) {
  const viewer = userOf(actor);
  await memberAccess(actor, workspaceId);
  await mainBranch(workspaceId);
  const state = opts.state ?? "open";
  const where = [eq(mergeRequests.workspaceId, workspaceId)];
  if (state === "open") where.push(inArray(mergeRequests.state, [...OPEN]));
  else if (state === "merged" || state === "closed") where.push(eq(mergeRequests.state, state));
  if (opts.mine) where.push(eq(mergeRequests.authorId, viewer));
  if (opts.reviewRequested) where.push(sql`EXISTS (SELECT 1 FROM merge_request_reviews r WHERE r.merge_request_id = ${mergeRequests.id} AND r.reviewer_id = ${viewer} AND r.state = 'requested')`);
  const rows = await db.select().from(mergeRequests).where(and(...where)).orderBy(desc(mergeRequests.updatedAt)).limit(MR_LIMITS.open);
  return { mergeRequests: await summaries(viewer, workspaceId, rows) };
}

async function summaries(viewer: string, workspaceId: string, rows: MergeRequest[]): Promise<MergeRequestSummary[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [stats, branchRows, taskRows, people, scope] = await Promise.all([
    db.execute<{ id: string; approvals: number; changes: number; comments: number; mine: boolean }>(sql`
      SELECT m.id,
        (SELECT count(*) FROM merge_request_reviews r WHERE r.merge_request_id = m.id AND r.state = 'approved')::int AS approvals,
        (SELECT count(*) FROM merge_request_reviews r WHERE r.merge_request_id = m.id AND r.state = 'changes_requested')::int AS changes,
        (SELECT count(*) FROM merge_request_comments c WHERE c.merge_request_id = m.id AND c.deleted_at IS NULL AND c.body <> '')::int AS comments,
        EXISTS (SELECT 1 FROM merge_request_reviews r WHERE r.merge_request_id = m.id AND r.reviewer_id = ${viewer} AND r.state = 'requested') AS mine
      FROM merge_requests m WHERE m.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`).then((r) => Array.from(r)),
    db.select({ id: branches.id, name: branches.name, status: branches.status }).from(branches).where(inArray(branches.id, rows.map((r) => r.sourceBranchId))),
    (() => { const t = rows.flatMap((r) => (r.taskId ? [r.taskId] : [])); return t.length ? db.select({ id: tasks.id, number: tasks.taskNumber, title: tasks.title }).from(tasks).where(inArray(tasks.id, t)) : Promise.resolve([]); })(),
    peopleById(rows.map((r) => r.authorId)),
    labelScope(viewer, workspaceId),
  ]);
  return rows.map((r) => {
    const s = stats.find((x) => x.id === r.id);
    const shown = visibleVia(scope, { via: r.via, agentName: r.agentName, authorId: r.authorId });
    const task = taskRows.find((t) => t.id === r.taskId);
    return {
      id: r.id, number: r.number, title: r.title, state: r.state, source: branchRows.find((b) => b.id === r.sourceBranchId)!,
      author: r.authorId ? people.get(r.authorId) ?? null : null, madeWith: shown.via === "agent" ? `with ${shown.agentName ?? "an agent"}` : shown.via === "cli" ? "from the terminal" : null,
      task: task ? { id: task.id, number: task.number ?? null, title: task.title } : null,
      approvals: s?.approvals ?? 0, changesRequested: s?.changes ?? 0, comments: s?.comments ?? 0, reviewRequested: Boolean(s?.mine),
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    };
  });
}

/** Files changed on both sides since the branch last took main in: they merge or conflict (H4 "Conflicts"). */
async function overlap(source: Branch, mainId: string) {
  const from = await seqOf(source.mergedFromTargetSaveId);
  const rows = Array.from(await db.execute<{ path: string }>(sql`
    SELECT DISTINCT p AS path FROM saves s JOIN save_changes c ON c.save_id = s.id, LATERAL (VALUES (c.before_path), (c.after_path)) v(p)
    WHERE s.branch_id = ${mainId} AND s.seq > ${from} AND c.op <> 'none' AND p IS NOT NULL
      AND EXISTS (SELECT 1 FROM branch_files f WHERE f.branch_id = ${source.id} AND f.path = p)
    ORDER BY 1 LIMIT 200`));
  return rows.map((r) => r.path);
}

export async function getMergeRequest(actor: Actor, workspaceId: string, ref: string | number) {
  const viewer = userOf(actor);
  const { mr, source, main, canWrite } = await loadMr(actor, workspaceId, ref);
  const [reviews, checks, comments, events, branchSaves, mainHeadSeq, mergedFrom] = await Promise.all([
    db.select().from(mergeRequestReviews).where(eq(mergeRequestReviews.mergeRequestId, mr.id)),
    source.headSaveId ? db.select().from(mergeRequestChecks).where(and(eq(mergeRequestChecks.mergeRequestId, mr.id), eq(mergeRequestChecks.saveId, source.headSaveId))).orderBy(asc(mergeRequestChecks.name)) : Promise.resolve([]),
    db.select().from(mergeRequestComments).where(and(eq(mergeRequestComments.mergeRequestId, mr.id), isNull(mergeRequestComments.deletedAt))).orderBy(asc(mergeRequestComments.createdAt)).limit(MR_LIMITS.comments),
    db.select().from(mergeRequestEvents).where(eq(mergeRequestEvents.mergeRequestId, mr.id)).orderBy(asc(mergeRequestEvents.id)).limit(500),
    db.select().from(saves).where(and(eq(saves.branchId, source.id), ne(saves.kind, "start"))).orderBy(desc(saves.seq)).limit(MR_LIMITS.saves + 1),
    seqOf(main.headSaveId),
    seqOf(source.mergedFromTargetSaveId),
  ]);
  const people = await peopleById([mr.authorId, mr.mergedBy, ...reviews.map((r) => r.reviewerId), ...comments.map((c) => c.authorId), ...events.map((e) => e.actorId), ...branchSaves.map((s) => s.authorId)]);
  const scope = await labelScope(viewer, workspaceId);
  const madeWith = (row: { via: "cli" | "agent" | null; agentName: string | null; authorId: string | null }) => {
    const shown = visibleVia(scope, row);
    return shown.via === "agent" ? `with ${shown.agentName ?? "an agent"}` : shown.via === "cli" ? "from the terminal" : null;
  };
  const [task] = mr.taskId ? await db.select({ id: tasks.id, number: tasks.taskNumber, title: tasks.title, status: tasks.status }).from(tasks).where(eq(tasks.id, mr.taskId)).limit(1) : [];
  const files = mr.state === "merged" || source.status === "deleted" ? null : await branchChanges(actor, source.id).catch(() => null);
  const open = OPEN.includes(mr.state as never);
  const isAuthor = mr.authorId === viewer;
  const myReview = reviews.find((r) => r.reviewerId === viewer);
  const reviewState = reviews.some((r) => r.state === "changes_requested") ? "changes_requested" : reviews.some((r) => r.state === "approved") ? "approved" : null;
  return {
    mergeRequest: {
      id: mr.id, number: mr.number, title: mr.title, description: mr.description,
      state: mr.state, shownState: mr.state === "open" && reviewState ? reviewState : mr.state,
      source: { id: source.id, name: source.name, status: source.status, headSaveId: source.headSaveId },
      target: { id: main.id, name: "main" },
      author: mr.authorId ? people.get(mr.authorId) ?? null : null, madeWith: madeWith({ via: mr.via, agentName: mr.agentName, authorId: mr.authorId }),
      task: task ? { id: task.id, number: task.number ?? null, title: task.title, status: task.status } : null,
      reviewers: reviews.map((r) => ({
        person: people.get(r.reviewerId) ?? { id: r.reviewerId, name: null, username: null }, state: r.state,
        // A save after the approval keeps it, marked (H4); whether it still counts is protection's call (H5).
        earlierSave: r.state === "approved" && Boolean(r.saveId) && r.saveId !== source.headSaveId,
      })),
      checks: checks.map((c) => ({ name: c.name, state: c.state, url: c.url, updatedAt: c.updatedAt.toISOString() })),
      merged: mr.state === "merged" ? { method: mr.mergeMethod, saveId: mr.mergeSaveId, by: mr.mergedBy ? people.get(mr.mergedBy) ?? null : null, at: mr.mergedAt?.toISOString() ?? null } : null,
      behind: Math.max(0, mainHeadSeq - mergedFrom),
      bothChanged: open && source.status === "active" ? await overlap(source, main.id) : [],
      createdAt: mr.createdAt.toISOString(), updatedAt: mr.updatedAt.toISOString(), closedAt: mr.closedAt?.toISOString() ?? null,
    },
    saves: branchSaves.slice(0, MR_LIMITS.saves).map((s) => ({
      id: s.id, number: s.seq ?? 0, kind: s.kind, message: s.message ?? "", author: s.authorId ? people.get(s.authorId) ?? null : null,
      madeWith: madeWith({ via: s.via, agentName: s.agentName, authorId: s.authorId }), createdAt: s.createdAt.toISOString(),
      added: s.filesAdded, changed: s.filesChanged, deleted: s.filesDeleted, renamed: s.filesRenamed,
    })),
    moreSaves: branchSaves.length > MR_LIMITS.saves,
    files,
    comments: comments.map((c) => ({
      id: c.id, author: c.authorId ? people.get(c.authorId) ?? null : null, madeWith: madeWith({ via: c.via, agentName: c.agentName, authorId: c.authorId }),
      body: c.body, reviewState: c.reviewState, path: c.path, line: c.line, endLine: c.endLine, onEarlierSave: Boolean(c.saveId) && c.saveId !== source.headSaveId,
      suggestion: c.suggestion, original: c.original, appliedSaveId: c.appliedSaveId, resolved: Boolean(c.resolvedAt), createdAt: c.createdAt.toISOString(), mine: c.authorId === viewer,
    })),
    events: events.map((e) => ({ id: String(e.id), kind: e.kind, actor: e.actorId ? people.get(e.actorId) ?? null : null, madeWith: madeWith({ via: e.via, agentName: e.agentName, authorId: e.actorId }), data: e.data, createdAt: e.createdAt.toISOString() })),
    viewer: {
      isAuthor, canWrite, myReview: myReview?.state ?? null,
      canReview: canWrite && open && !isAuthor && !isAgent(actor),
      canMerge: canWrite && mr.state === "open" && source.status === "active",
    },
  };
}

// ── Changing (H4) ─────────────────────────────────────────────────────────────────────────────────────────────────

export async function updateMergeRequest(actor: Actor, workspaceId: string, ref: string | number, patch: {
  title?: string | null; description?: string | null; draft?: boolean | null; state?: "open" | "closed" | null; addReviewers?: string[] | null; removeReviewers?: string[] | null;
}) {
  const userId = userOf(actor);
  const { mr, source } = await loadMr(actor, workspaceId, ref, { write: true });
  if (mr.state === "merged") fail(`!${mr.number} was merged`, 409, "MERGE_REQUEST_CLOSED");
  const now = new Date();
  const set: Partial<typeof mergeRequests.$inferInsert> = {};
  if (patch.title != null) {
    const title = patch.title.trim();
    if (!title || title.length > 200) fail("A title is 1 to 200 characters", 400, "BAD_REQUEST");
    set.title = title;
  }
  if (patch.description != null) set.description = patch.description.slice(0, 20_000);
  if (patch.state === "closed" && mr.state !== "closed") Object.assign(set, { state: "closed", closedAt: now, pendingChangeSetId: null, pendingHeadSaveId: null });
  if (patch.state === "open" && mr.state === "closed") {
    if (source.status !== "active") fail(`${source.name} was ${source.status}; restore it first`, 409, "BRANCH_DELETED");
    Object.assign(set, { state: "open", closedAt: null });
  }
  if (patch.draft != null && (set.state ?? mr.state) !== "closed") set.state = patch.draft ? "draft" : "open";
  const add = patch.addReviewers?.length ? (await writersAmong(workspaceId, patch.addReviewers)).filter((id) => id !== mr.authorId) : [];
  const remove = patch.removeReviewers?.length ? await writersAmong(workspaceId, patch.removeReviewers) : [];
  try {
    await db.transaction(async (tx) => {
      if (Object.keys(set).length) await tx.update(mergeRequests).set({ ...set, updatedAt: now }).where(eq(mergeRequests.id, mr.id));
      if (add.length) await tx.insert(mergeRequestReviews).values(add.map((reviewerId) => ({ mergeRequestId: mr.id, reviewerId }))).onConflictDoUpdate({ target: [mergeRequestReviews.mergeRequestId, mergeRequestReviews.reviewerId], set: { state: "requested", updatedAt: now } });
      if (remove.length) await tx.delete(mergeRequestReviews).where(and(eq(mergeRequestReviews.mergeRequestId, mr.id), inArray(mergeRequestReviews.reviewerId, remove)));
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "23505" || (error as { cause?: { code?: string } })?.cause?.code === "23505") fail(`${source.name} already has another open merge request`, 409, "MERGE_REQUEST_EXISTS");
    throw error;
  }
  const after = { ...mr, ...set } as MergeRequest;
  const reviewers = (await db.select({ id: mergeRequestReviews.reviewerId }).from(mergeRequestReviews).where(eq(mergeRequestReviews.mergeRequestId, mr.id))).map((r) => r.id);
  if (set.title || set.description != null) await event(mr.id, userId, "edited", { title: Boolean(set.title), description: set.description != null });
  if (set.state && set.state !== mr.state) {
    const kind = set.state === "closed" ? "closed" : set.state === "draft" ? "draft" : mr.state === "closed" ? "reopened" : "ready";
    const id = await event(mr.id, userId, kind);
    if (kind === "closed") await notify(after, "closed", userId, [mr.authorId, ...reviewers], id);
    if (kind === "ready" || (kind === "reopened" && after.state === "open")) await notify(after, kind === "ready" ? "ready" : "review_requested", userId, reviewers, id);
  }
  if (add.length || remove.length) {
    const id = await event(mr.id, userId, "reviewers", { added: add, removed: remove });
    if (after.state === "open") await notify(after, "review_requested", userId, add, id);
  }
  return getMergeRequest(actor, workspaceId, mr.number);
}

/** Approve, request changes, or comment (H4): people who can write, never the author, never an agent (H15). */
export async function reviewMergeRequest(actor: Actor, workspaceId: string, ref: string | number, input: { state: "approve" | "request_changes" | "comment"; body?: string | null }) {
  const userId = userOf(actor);
  if (isAgent(actor)) fail("Agents can comment, but approving and requesting changes is for people", 403, "FORBIDDEN");
  const { mr, source } = await loadMr(actor, workspaceId, ref, { write: true });
  stillOpen(mr);
  const state = input.state === "approve" ? "approved" as const : input.state === "request_changes" ? "changes_requested" as const : "commented" as const;
  if (state !== "commented" && mr.authorId === userId) fail("You can't approve or request changes on your own merge request", 409, "SELF_REVIEW");
  const body = String(input.body ?? "").slice(0, 20_000);
  if (state === "changes_requested" && !body.trim()) fail("Say what to change", 400, "BAD_REQUEST");
  if (state === "commented" && !body.trim()) fail("Write a comment", 400, "BAD_REQUEST");
  const now = new Date();
  const via = await viaColumns();
  const [comment] = await db.transaction(async (tx) => {
    // A comment-only review doesn't replace an earlier approval or request for changes.
    const [had] = await tx.select().from(mergeRequestReviews).where(and(eq(mergeRequestReviews.mergeRequestId, mr.id), eq(mergeRequestReviews.reviewerId, userId))).limit(1);
    const keep = state === "commented" && had && had.state !== "requested";
    if (!keep) {
      await tx.insert(mergeRequestReviews).values({ mergeRequestId: mr.id, reviewerId: userId, state, saveId: source.headSaveId })
        .onConflictDoUpdate({ target: [mergeRequestReviews.mergeRequestId, mergeRequestReviews.reviewerId], set: { state, saveId: source.headSaveId, updatedAt: now } });
    }
    await tx.update(mergeRequests).set({ updatedAt: now }).where(eq(mergeRequests.id, mr.id));
    return tx.insert(mergeRequestComments).values({ mergeRequestId: mr.id, authorId: userId, via: via.via, agentName: via.agentName, body, reviewState: state, saveId: source.headSaveId }).returning({ id: mergeRequestComments.id });
  });
  await notify(mr, state === "approved" ? "approved" : state === "changes_requested" ? "changes_requested" : "comment", userId, [mr.authorId], comment!.id);
  return getMergeRequest(actor, workspaceId, mr.number);
}

/**
 * A comment (H4): general, on lines of a file, or a suggested edit. Anyone who can read the workspace may comment
 * (H15). A suggestion keeps the lines it replaces, so Apply knows when they've changed.
 */
export async function commentOnMergeRequest(actor: Actor, workspaceId: string, ref: string | number, input: {
  body?: string | null; path?: string | null; line?: number | null; endLine?: number | null; suggestion?: string | null;
}) {
  const userId = userOf(actor);
  const { mr, source } = await loadMr(actor, workspaceId, ref);
  if (mr.state === "merged" || mr.state === "closed") fail(`!${mr.number} is ${mr.state}`, 409, "MERGE_REQUEST_CLOSED");
  const body = String(input.body ?? "").slice(0, 20_000);
  const suggestion = input.suggestion == null ? null : String(input.suggestion);
  if (!body.trim() && suggestion == null) fail("Write a comment", 400, "BAD_REQUEST");
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(mergeRequestComments).where(eq(mergeRequestComments.mergeRequestId, mr.id));
  if (n >= MR_LIMITS.comments) fail(`A merge request holds at most ${MR_LIMITS.comments} comments`, 409, "MERGE_REQUEST_LIMIT");
  const path = input.path ? `/${String(input.path).split("/").filter(Boolean).join("/")}` : null;
  const line = input.line == null ? null : Number(input.line);
  const endLine = input.endLine == null ? line : Number(input.endLine);
  if (line != null && (!path || !Number.isInteger(line) || line < 1 || !Number.isInteger(endLine) || endLine! < line)) fail("A line comment needs a file and a line range", 400, "BAD_REQUEST");
  let original: string | null = null;
  if (suggestion != null) {
    if (line == null) fail("A suggested edit needs the lines it replaces", 400, "BAD_REQUEST");
    if (suggestion.length > 100_000) fail("A suggested edit is at most 100,000 characters", 413, "TOO_LARGE");
    const file = await branchFileText(actor, source.id, path!);
    if (file.text == null) fail("Suggested edits work on text files", 409, "NOT_AVAILABLE");
    const lines = file.text!.split("\n");
    if (endLine! > lines.length) fail(`${path} has ${lines.length} lines`, 400, "BAD_REQUEST");
    original = lines.slice(line! - 1, endLine!).join("\n");
  }
  const via = await viaColumns();
  const [row] = await db.insert(mergeRequestComments).values({
    mergeRequestId: mr.id, authorId: userId, via: via.via, agentName: via.agentName, body, path, line, endLine: line == null ? null : endLine, saveId: source.headSaveId, suggestion, original,
  }).returning({ id: mergeRequestComments.id });
  await db.update(mergeRequests).set({ updatedAt: new Date() }).where(eq(mergeRequests.id, mr.id));
  const reviewers = (await db.select({ id: mergeRequestReviews.reviewerId }).from(mergeRequestReviews).where(and(eq(mergeRequestReviews.mergeRequestId, mr.id), ne(mergeRequestReviews.state, "requested")))).map((r) => r.id);
  await notify(mr, "comment", userId, [mr.authorId, ...reviewers], row!.id);
  return { comment: { id: row!.id } };
}

/** Apply suggestion (H4): a save on the branch, only while the suggested lines are still as they were. */
export async function applySuggestion(actor: Actor, workspaceId: string, ref: string | number, commentId: string) {
  const userId = userOf(actor);
  const { mr, source } = await loadMr(actor, workspaceId, ref, { write: true });
  stillOpen(mr);
  if (!/^[0-9a-f-]{36}$/i.test(commentId)) fail("Comment not found", 404, "NOT_FOUND");
  const [c] = await db.select().from(mergeRequestComments).where(and(eq(mergeRequestComments.id, commentId), eq(mergeRequestComments.mergeRequestId, mr.id), isNull(mergeRequestComments.deletedAt))).limit(1);
  if (!c || c.suggestion == null || !c.path || c.line == null) fail("That comment has no suggested edit", 404, "NOT_FOUND");
  if (c!.appliedSaveId) fail("That suggestion was applied already", 409, "CONFLICT");
  const file = await branchFileText(actor, source.id, c!.path!);
  if (file.text == null) fail("Suggested edits work on text files", 409, "NOT_AVAILABLE");
  const lines = file.text!.split("\n");
  const end = c!.endLine ?? c!.line!;
  if (lines.slice(c!.line! - 1, end).join("\n") !== c!.original) {
    fail(`Those lines of ${c!.path} changed since the suggestion; edit the file instead`, 409, "CHANGE_SET_CONFLICT", { conflicts: [{ path: c!.path, kind: "edit" }] });
  }
  const text = [...lines.slice(0, c!.line! - 1), ...c!.suggestion!.split("\n"), ...lines.slice(end)].join("\n");
  const who = nameOf((await peopleById([c!.authorId])).get(c!.authorId ?? ""));
  const { save } = await saveTextOnBranch(actor, source.id, { path: c!.path!, text, expectedHash: file.contentHash, message: `Applied a suggestion from ${who}` });
  await db.update(mergeRequestComments).set({ appliedSaveId: save?.id ?? null, resolvedAt: new Date() }).where(eq(mergeRequestComments.id, c!.id));
  await db.update(mergeRequests).set({ updatedAt: new Date() }).where(eq(mergeRequests.id, mr.id));
  void userId;
  return { save };
}

/** A check from a build (H4): tied to the save it ran on (the branch head unless named). */
export async function postCheck(actor: Actor, workspaceId: string, ref: string | number, input: { name: string; state: "running" | "passed" | "failed"; url?: string | null; saveId?: string | null }) {
  const userId = userOf(actor);
  const { mr, source } = await loadMr(actor, workspaceId, ref, { write: true });
  stillOpen(mr);
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 100) fail("A check's name is 1 to 100 characters", 400, "BAD_REQUEST");
  if (!["running", "passed", "failed"].includes(input.state)) fail("A check is running, passed or failed", 400, "BAD_REQUEST");
  const url = input.url ? String(input.url) : null;
  if (url && (!/^https:\/\//.test(url) || url.length > 2000)) fail("A check's link is an https address", 400, "BAD_REQUEST");
  const saveId = input.saveId ?? source.headSaveId ?? fail("The branch has no saves yet", 409, "CONFLICT");
  const [owned] = await db.select({ id: saves.id }).from(saves).where(and(eq(saves.id, saveId!), eq(saves.branchId, source.id))).limit(1);
  if (!owned) fail("That save isn't on this merge request's branch", 404, "NOT_FOUND");
  const now = new Date();
  await db.insert(mergeRequestChecks).values({ mergeRequestId: mr.id, saveId: saveId!, name, state: input.state, url, updatedAt: now })
    .onConflictDoUpdate({ target: [mergeRequestChecks.mergeRequestId, mergeRequestChecks.saveId, mergeRequestChecks.name], set: { state: input.state, url, updatedAt: now } });
  if (input.state === "failed") await notify(mr, "checks_failed", userId, [mr.authorId], `${saveId}:${name}`);
  return { check: { name, state: input.state, url, saveId } };
}

// ── Merging (H4, H13) ─────────────────────────────────────────────────────────────────────────────────────────────

/** The branch's own files as change set items on main, based on main at the branch's merge base. */
async function mergeItems(source: Branch, mainId: string): Promise<ItemInput[]> {
  const own = await db.select().from(branchFiles).where(eq(branchFiles.branchId, source.id)).limit(SAVE_LIMITS.changes + 1);
  if (own.length > SAVE_LIMITS.changes) fail(`A merge over ${SAVE_LIMITS.changes} files can't go in one step`, 413, "CHANGE_SET_TOO_LARGE");
  const base = await mainAt(mainId, await seqOf(source.baseSaveId), own.map((f) => f.path));
  return own.flatMap((f): ItemInput[] => {
    const was = base.get(f.path);
    if (f.state === "deleted") return was ? [{ op: "delete", path: f.path, baseVersion: was.version, baseHash: was.contentHash }] : [];
    return [was
      ? { op: "change", path: f.path, contentHash: f.contentHash, baseVersion: was.version, baseHash: was.contentHash, size: f.size, mimeType: f.mimeType, executable: f.executable }
      : { op: "add", path: f.path, contentHash: f.contentHash, size: f.size, mimeType: f.mimeType, executable: f.executable }];
  });
}

/**
 * Merge or squash into main. Files main also changed merge as Part G merges them (G9); real conflicts come back and
 * the branch settles them with Update from main (decision 3). One undo covers the merge.
 */
export async function mergeMergeRequest(actor: Actor, request: Request, workspaceId: string, ref: string | number, input: {
  method?: "merge" | "squash" | null; confirmToken?: string | null; checkScope?: (scope: "file:final" | "doc:write") => Promise<Response | null>;
}) {
  const userId = userOf(actor);
  const method = input.method === "squash" ? "squash" : "merge";
  const { mr, source, main } = await loadMr(actor, workspaceId, ref, { write: true });
  stillOpen(mr);
  if (mr.state === "draft") fail(`!${mr.number} is a draft; mark it ready first`, 409, "DRAFT");
  if (source.status !== "active") fail(`${source.name} was ${source.status}; restore it first`, 409, "BRANCH_DELETED");

  // An agent's merge held for the person's yes reuses its change set (the yes names it) while the branch hasn't moved
  // and it's the same person merging; anyone else gets a fresh one.
  let setId: string | null = null;
  const mergedHead = source.headSaveId;
  if (mr.pendingChangeSetId && mr.pendingHeadSaveId === mergedHead) {
    const [held] = await db.select({ id: changeSets.id, status: changeSets.status, authorId: changeSets.authorId }).from(changeSets).where(eq(changeSets.id, mr.pendingChangeSetId)).limit(1);
    if (held?.status === "ready" && held.authorId === userId) setId = held.id;
  }
  if (!setId) {
    if (mr.pendingChangeSetId) await dropSet(mr.pendingChangeSetId);
    const items = await mergeItems(source, main.id);
    if (!items.length) fail("This branch has nothing that main doesn't already have", 409, "MERGE_REQUEST_EMPTY");
    const title = (method === "squash" ? mr.title : `Merge !${mr.number}: ${mr.title}`).slice(0, 120);
    const set = await startChangeSet(actor, { workspaceId, title, taskId: mr.taskId });
    for (let i = 0; i < items.length; i += 200) await upsertItems(actor, set.id, items.slice(i, i + 200));
    await finishChangeSet(actor, set.id, { confirmSecrets: !isAgent(actor) });
    const stepUp = await changeSetStepUp(actor, set.id);
    if (stepUp) {
      await dropSet(set.id);
      fail("This merge changes a doc: verify it's you, then merge", 403, "STEP_UP_REQUIRED", { stepUp });
    }
    setId = set.id;
    await db.update(mergeRequests).set({ pendingChangeSetId: set.id, pendingHeadSaveId: mergedHead }).where(eq(mergeRequests.id, mr.id));
  }
  let applied: Awaited<ReturnType<typeof applyChangeSet>>;
  try {
    applied = await applyChangeSet(actor, request, setId!, { confirmToken: input.confirmToken, checkScope: input.checkScope });
  } catch (error) {
    if (error instanceof ChangeSetError && error.code === "CHANGE_SET_CONFLICT") {
      await dropSet(setId!);
      await db.update(mergeRequests).set({ pendingChangeSetId: null, pendingHeadSaveId: null }).where(eq(mergeRequests.id, mr.id));
      return { outcome: "conflicts" as const, conflicts: (error.details?.conflicts ?? []) as Array<{ path: string; kind: string }> };
    }
    throw error; // a held agent merge keeps its set for the yes
  }
  const [made] = await db.select({ id: saves.id, seq: saves.seq }).from(saves).where(eq(saves.changeSetId, setId!)).orderBy(desc(saves.seq)).limit(1);
  const now = new Date();
  // Saves that reached the branch while this merged aren't in main: the branch then stays open for another request.
  const branchMoved = await db.transaction(async (tx) => {
    if (made) await tx.update(saves).set({ kind: method, secondParentSaveId: method === "merge" ? mergedHead : null }).where(eq(saves.id, made.id));
    await tx.update(mergeRequests).set({ state: "merged", mergeMethod: method, mergeSaveId: made?.id ?? null, mergedBy: userId, mergedAt: now, updatedAt: now, pendingChangeSetId: null, pendingHeadSaveId: null }).where(eq(mergeRequests.id, mr.id));
    const [now_] = await tx.select({ head: branches.headSaveId }).from(branches).where(eq(branches.id, source.id)).for("update");
    if (now_?.head !== mergedHead) return true;
    await tx.update(branches).set({ status: "merged", updatedAt: now }).where(eq(branches.id, source.id));
    return false;
  });
  const eventId = await event(mr.id, userId, "merged", { method, saveId: made?.id ?? null });
  // The linked task moves to Done, or to review when it needs one, through the normal task rules (H4).
  let task: { number: number | null; outcome: "done" | "review" | "unchanged"; reason?: string } | null = null;
  if (mr.taskId) {
    try {
      task = await db.transaction(async (tx) => {
        const locked = await lockTaskForWrite(tx, mr.taskId!, userId);
        if (locked.currentStatus === "done") return { number: locked.taskNumber, outcome: "unchanged" as const };
        const result = await transitionTaskTx(tx, locked, { taskId: mr.taskId!, userId, status: "done" });
        return { number: locked.taskNumber, outcome: result.reviewStatus === "pending" ? "review" as const : "done" as const };
      });
    } catch (error) {
      task = { number: null, outcome: "unchanged", reason: error instanceof Error ? error.message : String(error) };
    }
  }
  const reviewers = (await db.select({ id: mergeRequestReviews.reviewerId }).from(mergeRequestReviews).where(eq(mergeRequestReviews.mergeRequestId, mr.id))).map((r) => r.id);
  await notify(mr, "merged", userId, [mr.authorId, ...reviewers], eventId);
  return {
    outcome: "merged" as const, method, save: made ? { id: made.id, number: made.seq } : null, undoToken: (applied as { undoToken?: string | null }).undoToken ?? null,
    task, branch: { id: source.id, name: source.name }, branchMoved,
  };
}

/** A change set the merge made for itself and no longer needs (conflicted, superseded, or stopped for step-up). */
async function dropSet(id: string) {
  const at = new Date();
  await db.update(changeSets).set({ status: "discarded", discardedAt: at, updatedAt: at }).where(and(eq(changeSets.id, id), inArray(changeSets.status, ["open", "ready"])));
}

// ── Branch hooks (H24) ────────────────────────────────────────────────────────────────────────────────────────────

/** Deleting a branch closes its open merge requests ("Branch deleted"); restoring it reopens them. */
export async function closeForDeletedBranch(branchId: string, actorId: string, at: Date) {
  const closed = await db.update(mergeRequests).set({ state: "closed", closedAt: at, updatedAt: at, pendingChangeSetId: null, pendingHeadSaveId: null })
    .where(and(eq(mergeRequests.sourceBranchId, branchId), inArray(mergeRequests.state, [...OPEN]))).returning({ id: mergeRequests.id });
  for (const m of closed) await event(m.id, actorId, "closed", { reason: "branch_deleted" });
  return closed.length;
}

export async function reopenForRestoredBranch(branchId: string, actorId: string, deletedAt: Date | null) {
  if (!deletedAt) return 0;
  const reopened = await db.update(mergeRequests).set({ state: "open", closedAt: null, updatedAt: new Date() })
    .where(and(eq(mergeRequests.sourceBranchId, branchId), eq(mergeRequests.state, "closed"), eq(mergeRequests.closedAt, deletedAt))).returning({ id: mergeRequests.id });
  for (const m of reopened) await event(m.id, actorId, "reopened", { reason: "branch_restored" });
  return reopened.length;
}

/** The open merge request of each branch, for the branch list and page ("MR !3 open"). */
export async function openMergeRequestsOf(branchIds: string[]) {
  if (!branchIds.length) return new Map<string, { number: number; state: string }>();
  const rows = await db.select({ branchId: mergeRequests.sourceBranchId, number: mergeRequests.number, state: mergeRequests.state }).from(mergeRequests)
    .where(and(inArray(mergeRequests.sourceBranchId, branchIds), inArray(mergeRequests.state, [...OPEN])));
  return new Map(rows.map((r) => [r.branchId, { number: r.number, state: r.state }]));
}
