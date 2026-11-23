import "server-only";

import { and, desc, eq, inArray, isNotNull, isNull, ne, sql, type AnyColumn } from "drizzle-orm";

import { db } from "@/lib/db";
import { afterCommit, transactionThen } from "@/lib/db/after-commit";
import {
    branches, changeSets, extensionDeviceSessions, mergeRequestReviews, mergeRequests, nodeStars, profileContributionStages,
    profileContributions, profiles, sidebarPins, taskReminders, taskStars, taskWatchers, tasks, undoOperations,
    workspaceMemberPeriods, workspaceMembers, workspaceNodeEvents, workspaceNodes, workspaces,
} from "@/lib/db/schema";
import { WORKSPACE_NOTIFICATION_EVENT_REGISTRY } from "@/lib/notifications/workspace-policy";
import { endProfileWorkspaceContributionMembership, markProfileCollaborationSummaryStale } from "@/lib/profile/collaboration";
import { broadcast } from "@/lib/realtime/server-broadcast";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { readProfileSnapshot, removeWorkspaceMemberInternal } from "@/lib/workspaces/collaborator-lifecycle";
import { currentPeriodStart } from "@/lib/workspaces/member-periods";
import { recordTaskAssignment, taskAssignmentNotification } from "@/lib/workspaces/task-assignment";

/**
 * A person's part in a workspace (docs/superpowers/plans/2026-11-12-member-settings-concept.md): the wrap-up preview,
 * completing and reopening, leaving, the owner's decision, completing the whole workspace, your own settings and role
 * requests, and their undo. Server actions (app) and API routes (CLI) are thin layers over this module, so the rules
 * can't drift (§1.4). Every change is one transaction with a row lock on the membership (§1.5).
 */

export class MemberJourneyError extends Error {
    constructor(message: string, readonly code: "FORBIDDEN" | "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT" | "RATE_LIMITED" | "MEMBER_COMPLETED") { super(message); }
}
const fail = (message: string, code: MemberJourneyError["code"]): never => { throw new MemberJourneyError(message, code); };

export type TaskChoice = "keep" | "give" | "unassign";
export type MemberRole = "owner" | "admin" | "member" | "viewer";

/** Notifications here when your part completes: mentions only (§3). Mandatory events stay on regardless. */
const MENTION_KEYS = new Set(["tasks.mentions", "updates.mention", "tasks.replies", "updates.reply"]);
export function mentionsOnlyPreferences() {
    const rules: Record<string, boolean> = {};
    for (const entry of Object.values(WORKSPACE_NOTIFICATION_EVENT_REGISTRY)) {
        if (!entry.allowMemberOverride || entry.mandatory) continue;
        rules[entry.key] = MENTION_KEYS.has(entry.key);
    }
    return { version: 1 as const, mode: "custom" as const, rules };
}

/** What a role can do, in plain words (Part 1, Your part here). */
export function roleSentence(role: MemberRole | null, completed: boolean) {
    if (completed) return "Your part here is completed: you can read, comment and react. Reopen your part to change things again.";
    switch (role) {
        case "owner": return "You own this workspace: you can change everything, invite people and decide on roles.";
        case "admin": return "You can do everything a member can, invite people, manage roles and change workspace settings.";
        case "member": return "You can create and edit tasks, add files, post updates and comment. You can't invite people or change settings.";
        case "viewer": return "You can read this workspace and comment. You can't change tasks or files.";
        default: return "You aren't a member of this workspace.";
    }
}

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

async function readWorkspace(executor: Executor, projectId: string) {
    const [row] = await executor.select({ id: workspaces.id, ownerId: workspaces.ownerId, title: workspaces.title, slug: workspaces.slug, key: workspaces.key, kind: workspaces.kind, status: workspaces.status, membersChooseLabels: workspaces.membersChooseLabels })
        .from(workspaces).where(and(eq(workspaces.id, projectId), isNull(workspaces.deletedAt))).limit(1);
    return row ?? null;
}

async function lockMembership(executor: Executor, projectId: string, userId: string) {
    const rows = await executor.execute<{ id: string; role: MemberRole; joined_at: Date; completed_at: Date | null; completed_by: string | null; completion_note: string | null; notification_preferences: unknown }>(sql`
        SELECT id, role, joined_at, completed_at, completed_by, completion_note, notification_preferences
        FROM ${workspaceMembers} WHERE workspace_id = ${projectId} AND user_id = ${userId} FOR UPDATE`);
    return Array.from(rows)[0] ?? null;
}

const nameOf = (p: { fullName?: string | null; username?: string | null } | null) => p?.fullName || (p?.username ? `@${p.username}` : null) || "Someone";

/** Who may complete, reopen or leave, and why not (§3, §4). The owner and organizations have their own ways out. */
function refusal(ws: NonNullable<Awaited<ReturnType<typeof readWorkspace>>>, userId: string, membership: { role: MemberRole } | null, what: "complete" | "leave") {
    if (ws.kind === "organization") return what === "leave" ? "Leave an organization from its own page." : "Organizations end membership by term; there's nothing to complete here.";
    if (ws.ownerId === userId) return what === "leave" ? "You own this workspace. Transfer ownership first, then you can leave." : "You own this workspace. Transfer ownership first, or complete the whole workspace in its settings.";
    if (!membership) return "You aren't a member of this workspace.";
    return null;
}

// ── Reading ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Your part here (Part 1 · GET /me): role, dates, status, completion, who leads, what you can do, your settings. */
export async function getMyPart(projectId: string, userId: string) {
    const ws = await readWorkspace(db, projectId);
    if (!ws) fail("Workspace not found", "NOT_FOUND");
    const [m] = await db.select().from(workspaceMembers).where(and(eq(workspaceMembers.projectId, projectId), eq(workspaceMembers.userId, userId))).limit(1);
    const isOwner = ws!.ownerId === userId;
    if (!m && !isOwner) fail("You aren't a member of this workspace", "NOT_FOUND");
    const role: MemberRole = isOwner ? "owner" : (m!.role as MemberRole);
    const ids = [m?.completedBy, m?.completionConfirmedBy].filter((x): x is string => Boolean(x));
    const people = ids.length ? await db.select({ id: profiles.id, username: profiles.username, fullName: profiles.fullName }).from(profiles).where(inArray(profiles.id, ids)) : [];
    const person = (id: string | null | undefined) => { const p = people.find((x) => x.id === id); return p ? { id: p.id, username: p.username, name: nameOf(p) } : null; };
    const leaders = await db.select({ id: profiles.id, username: profiles.username, fullName: profiles.fullName, role: workspaceMembers.role })
        .from(workspaceMembers).innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
        .where(and(eq(workspaceMembers.projectId, projectId), inArray(workspaceMembers.role, ["owner", "admin"])));
    const [owner] = await db.select({ id: profiles.id, username: profiles.username, fullName: profiles.fullName }).from(profiles).where(eq(profiles.id, ws!.ownerId)).limit(1);
    const periods = await db.select({ startedAt: workspaceMemberPeriods.startedAt, endedAt: workspaceMemberPeriods.endedAt, endReason: workspaceMemberPeriods.endReason, note: workspaceMemberPeriods.note })
        .from(workspaceMemberPeriods).where(and(eq(workspaceMemberPeriods.projectId, projectId), eq(workspaceMemberPeriods.userId, userId))).orderBy(desc(workspaceMemberPeriods.endedAt)).limit(20);
    const { readWorkspaceMute } = await import("@/lib/notifications/service");
    const mute = await readWorkspaceMute(userId, projectId).catch(() => null);
    const completed = Boolean(m?.completedAt);
    return {
        workspace: { id: ws!.id, title: ws!.title, slug: ws!.slug, kind: ws!.kind, status: ws!.status },
        role,
        isOwner,
        joinedAt: m?.joinedAt?.toISOString() ?? null,
        status: completed ? ("completed" as const) : ("active" as const),
        completion: completed ? {
            at: m!.completedAt!.toISOString(), note: m!.completionNote ?? null, by: person(m!.completedBy), byOwner: Boolean(m!.completedBy && m!.completedBy !== userId),
            confirmedBy: person(m!.completionConfirmedBy), confirmedAt: m!.completionConfirmedAt?.toISOString() ?? null,
        } : null,
        canDo: roleSentence(role, completed),
        owner: owner ? { id: owner.id, username: owner.username, name: nameOf(owner) } : null,
        admins: leaders.filter((l) => l.role === "admin").map((l) => ({ id: l.id, username: l.username, name: nameOf(l) })),
        canComplete: !refusal(ws!, userId, m ? { role } : null, "complete") && !completed,
        canReopen: completed && !isOwner,
        canLeave: !refusal(ws!, userId, m ? { role } : null, "leave"),
        leaveRefusal: refusal(ws!, userId, m ? { role } : null, "leave"),
        periods: periods.map((p) => ({ startedAt: p.startedAt.toISOString(), endedAt: p.endedAt.toISOString(), endReason: p.endReason, note: p.note })),
        settings: {
            notifications: (m?.notificationPreferences ?? { version: 1, mode: "inherit", rules: {} }) as { version: 1; mode: "inherit" | "custom"; rules: Record<string, boolean> },
            muteUntil: mute?.until ?? (mute ? "forever" : null),
            hideAgentLabel: Boolean(m?.hideAgentLabel),
            membersChooseLabels: ws!.membersChooseLabels,
            agentsBlocked: Boolean(m?.agentsBlockedAt),
            viewPrefs: (m?.viewPrefs ?? {}) as { defaultTab?: string; density?: "compact" | "comfortable" },
            showOnProfile: m?.showOnProfile ?? true,
        },
    };
}

/** The wrap-up preview for complete and leave (GET /me/wrap-up): what's still open, with real numbers. Changes nothing. */
export async function previewWrapUp(projectId: string, userId: string) {
    const ws = await readWorkspace(db, projectId);
    if (!ws) fail("Workspace not found", "NOT_FOUND");
    const openTask = and(eq(tasks.projectId, projectId), eq(tasks.assigneeId, userId), isNull(tasks.deletedAt), sql`(${tasks.status} <> 'done' OR ${tasks.reviewStatus} = 'pending')`);
    const [taskRows, reviewRows, sets, ownBranches, mrs, docDrafts] = await Promise.all([
        db.select({ id: tasks.id, number: tasks.taskNumber, title: tasks.title }).from(tasks).where(openTask).orderBy(tasks.taskNumber).limit(50),
        db.select({ number: mergeRequests.number, title: mergeRequests.title }).from(mergeRequestReviews)
            .innerJoin(mergeRequests, eq(mergeRequests.id, mergeRequestReviews.mergeRequestId))
            .where(and(eq(mergeRequests.workspaceId, projectId), eq(mergeRequestReviews.reviewerId, userId), eq(mergeRequestReviews.state, "requested"), inArray(mergeRequests.state, ["open", "draft"]))).limit(50),
        db.select({ id: changeSets.id, title: changeSets.title }).from(changeSets).where(and(eq(changeSets.workspaceId, projectId), eq(changeSets.authorId, userId), inArray(changeSets.status, ["open", "ready"]))).limit(50),
        db.select({ id: branches.id, name: branches.name }).from(branches).where(and(eq(branches.workspaceId, projectId), eq(branches.createdBy, userId), eq(branches.status, "active"), eq(branches.isDefault, false))).limit(50),
        db.select({ number: mergeRequests.number, title: mergeRequests.title }).from(mergeRequests).where(and(eq(mergeRequests.workspaceId, projectId), eq(mergeRequests.authorId, userId), inArray(mergeRequests.state, ["open", "draft"]))).limit(50),
        db.execute<{ slug: string; filename: string }>(sql`
            SELECT d.slug, d.filename FROM workspace_documents d
            WHERE d.workspace_id = ${projectId} AND EXISTS (
              SELECT 1 FROM workspace_document_versions v
              WHERE v.doc_id = d.id AND v.created_by = ${userId} AND v.deleted_at IS NULL
                AND v.version_number > coalesce((SELECT p.version_number FROM workspace_document_versions p WHERE p.id = d.published_version_id), 0))
            LIMIT 50`),
    ]);
    const [taskCount] = await db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(openTask);
    return {
        workspace: { id: ws!.id, title: ws!.title, slug: ws!.slug },
        openTasks: { count: taskCount?.n ?? 0, items: taskRows },
        reviews: { count: reviewRows.length, items: reviewRows },
        openWork: {
            changeSets: sets,
            branches: ownBranches,
            mergeRequests: mrs,
            docDrafts: Array.from(docDrafts).map((d) => ({ slug: d.slug, filename: d.filename })),
        },
        stays: "Your files, versions, comments and updates stay, under your name.",
    };
}

// ── Shared steps ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Open tasks: keep them, give them to someone, or unassign them (§3 step 1). Returns what moved, for Undo. */
async function moveOpenTasks(tx: Executor, ws: NonNullable<Awaited<ReturnType<typeof readWorkspace>>>, actorId: string, userId: string, choice: TaskChoice, giveTo: string | null) {
    if (choice === "keep") return { moved: [] as string[], to: null as string | null, notifications: [] as ReturnType<typeof taskAssignmentNotification>[] };
    const open = and(eq(tasks.projectId, ws.id), eq(tasks.assigneeId, userId), isNull(tasks.deletedAt), sql`(${tasks.status} <> 'done' OR ${tasks.reviewStatus} = 'pending')`);
    if (choice === "unassign") {
        const moved = await tx.update(tasks).set({ assigneeId: null, updatedAt: new Date() }).where(open).returning({ id: tasks.id });
        return { moved: moved.map((t) => t.id), to: null, notifications: [] };
    }
    if (!giveTo || giveTo === userId) fail("Choose who gets your open tasks", "BAD_REQUEST");
    const [target] = await tx.select({ role: workspaceMembers.role, completedAt: workspaceMembers.completedAt }).from(workspaceMembers)
        .where(and(eq(workspaceMembers.projectId, ws.id), eq(workspaceMembers.userId, giveTo!))).limit(1);
    const targetIsOwner = ws.ownerId === giveTo;
    if (!targetIsOwner && (!target || target.role === "viewer")) fail("Give your tasks to a member who can work on them", "BAD_REQUEST");
    if (target?.completedAt) fail("That person has completed their part here", "BAD_REQUEST");
    const moved = await tx.update(tasks).set({ assigneeId: giveTo, updatedAt: new Date() }).where(open)
        .returning({ id: tasks.id, title: tasks.title, taskNumber: tasks.taskNumber, status: tasks.status, sprintId: tasks.sprintId });
    const actor = await readProfileSnapshot(tx, actorId);
    const from = await readProfileSnapshot(tx, userId);
    const to = await readProfileSnapshot(tx, giveTo!);
    const notifications: ReturnType<typeof taskAssignmentNotification>[] = [];
    for (const task of moved) {
        const eventId = await recordTaskAssignment(tx, {
            taskId: task.id, projectId: ws.id, sprintId: task.sprintId, title: task.title, taskNumber: task.taskNumber, status: task.status,
            actorId, actorName: actor?.fullName || actor?.username || null, actorAvatarUrl: actor?.avatarUrl ?? null,
            previousAssigneeId: userId, previousAssignee: from, assigneeId: giveTo!, assignee: to,
        });
        if (giveTo !== actorId) notifications.push(taskAssignmentNotification({
            taskId: task.id, projectId: ws.id, projectSlug: ws.slug, projectKey: ws.key, taskNumber: task.taskNumber, title: task.title,
            actorId, actorName: actor?.fullName || actor?.username || null, actorAvatarUrl: actor?.avatarUrl ?? null, assigneeId: giveTo!, eventId,
        }));
    }
    return { moved: moved.map((t) => t.id), to: giveTo!, notifications };
}

/** Reviews waiting on you go to the owner, or the reviewer you pick (§3 step 1). Returns what moved, for Undo. */
async function moveReviews(tx: Executor, ws: NonNullable<Awaited<ReturnType<typeof readWorkspace>>>, userId: string, reviewsTo: string | null) {
    const to = reviewsTo ?? ws.ownerId;
    if (to === userId) return [];
    if (to !== ws.ownerId) {
        // Same rule as giving tasks: a member here who can work, and whose part isn't completed.
        const [r] = await tx.select({ role: workspaceMembers.role, completedAt: workspaceMembers.completedAt }).from(workspaceMembers)
            .where(and(eq(workspaceMembers.projectId, ws.id), eq(workspaceMembers.userId, to))).limit(1);
        if (!r || r.role === "viewer" || r.completedAt) fail("Hand your reviews to the owner or a member who can review", "BAD_REQUEST");
    }
    const waiting = await tx.select({ id: mergeRequests.id, authorId: mergeRequests.authorId }).from(mergeRequestReviews)
        .innerJoin(mergeRequests, eq(mergeRequests.id, mergeRequestReviews.mergeRequestId))
        .where(and(eq(mergeRequests.workspaceId, ws.id), eq(mergeRequestReviews.reviewerId, userId), eq(mergeRequestReviews.state, "requested"), inArray(mergeRequests.state, ["open", "draft"])));
    const moved: string[] = [];
    for (const mr of waiting) {
        if (mr.authorId === to) continue; // nobody reviews their own merge request
        await tx.insert(mergeRequestReviews).values({ mergeRequestId: mr.id, reviewerId: to, state: "requested" }).onConflictDoNothing();
        await tx.delete(mergeRequestReviews).where(and(eq(mergeRequestReviews.mergeRequestId, mr.id), eq(mergeRequestReviews.reviewerId, userId)));
        moved.push(mr.id);
    }
    return moved.map((id) => ({ mergeRequestId: id, from: userId, to }));
}

async function recordEvent(tx: Executor, projectId: string, actorId: string, type: string, metadata: Record<string, unknown>) {
    const [row] = await tx.insert(workspaceNodeEvents).values({ projectId, actorId, nodeId: null, type, metadata, createdAt: new Date() }).returning({ id: workspaceNodeEvents.id });
    return row?.id ?? null;
}

async function writeUndo(tx: Executor, userId: string, projectId: string, operation: string, summary: string, inverse: MemberUndo) {
    const [row] = await tx.insert(undoOperations).values({
        userId, workspaceId: projectId, operation, summary: summary.slice(0, 300), inverse: inverse as unknown as Record<string, unknown>,
        via: null, agentName: null, expiresAt: new Date(Date.now() + MEMBER_UNDO_TTL_MS),
    }).returning({ id: undoOperations.id });
    return row?.id ?? null;
}

/** The toast offers Undo for 10 seconds; `nb undo` from the terminal has a few minutes (report §3, §4). */
export const MEMBER_UNDO_TTL_MS = 10 * 60_000;

export type MemberUndo =
    | { kind: "member.complete"; projectId: string; userId: string; actorId: string; periodId: string | null; previousNotifications: unknown; tasks: { ids: string[]; to: string | null }; reviews: Array<{ mergeRequestId: string; from: string; to: string }> }
    | { kind: "member.leave"; projectId: string; userId: string; snapshot: Record<string, unknown>; periodId: string | null; tasks: { ids: string[]; to: string | null } };

function announce(projectId: string, userId: string, change: string) {
    void broadcast([{ topic: `live:workspace:${projectId}`, event: "member.updated", payload: { userId, change } }]);
}

async function rateLimited(projectId: string, userId: string) {
    const r = await consumeRateLimit(`member-journey:${projectId}:${userId}`, 10, 86_400);
    if (!r.allowed) fail("You've completed and reopened your part here 10 times today. Try again tomorrow.", "RATE_LIMITED");
}

/** The owner, or an admin for members and viewers (§3 "The owner completes someone's part"); read again at undo time. */
async function mayActFor(tx: Executor, ws: { id: string; ownerId: string }, actorId: string, targetRole: string) {
    const actor = ws.ownerId === actorId ? "owner" : (await lockMembership(tx, ws.id, actorId))?.role;
    if (actor !== "owner" && actor !== "admin") fail("Only the owner or an admin can complete someone's part", "FORBIDDEN");
    if (actor === "admin" && targetRole === "admin") fail("Admins can't complete another admin's part; ask the owner", "FORBIDDEN");
}

// ── Complete my part ─────────────────────────────────────────────────────────────────────────────────────────────

export type CompleteInput = { note?: string | null; tasks?: TaskChoice; giveTo?: string | null; reviewsTo?: string | null };

/**
 * Completes a part (§3): yourself, or the owner/an admin for someone else. One transaction: tasks and reviews per the
 * choices, the membership marked completed (read-only from now on), a finished period, the profile entry ended with
 * "completed", notifications turned to mentions only, an activity event and an undo record. Idempotent.
 */
export async function completePart(actorId: string, projectId: string, targetUserId: string, input: CompleteInput = {}) {
    const self = actorId === targetUserId;
    if (self) await rateLimited(projectId, targetUserId);
    const note = input.note?.trim().slice(0, 280) || null;
    const result = await transactionThen(async (tx) => {
        const ws = await readWorkspace(tx, projectId);
        if (!ws) fail("Workspace not found", "NOT_FOUND");
        const m = await lockMembership(tx, projectId, targetUserId);
        const why = refusal(ws!, targetUserId, m, "complete");
        if (why) fail(self ? why : why.replace(/^You own/, "They own").replace(/^You aren't/, "They aren't"), "FORBIDDEN");
        if (!self) await mayActFor(tx, ws!, actorId, m!.role);
        if (m!.completed_at) return { already: true as const, ws: ws!, undoId: null, notifications: [] };
        const choice = input.tasks ?? "keep";
        const taskMove = await moveOpenTasks(tx, ws!, actorId, targetUserId, choice, input.giveTo ?? null);
        const reviews = await moveReviews(tx, ws!, targetUserId, input.reviewsTo ?? null);
        const now = new Date();
        await tx.update(workspaceMembers).set({
            completedAt: now, completedBy: actorId, completionNote: note, completionConfirmedBy: null, completionConfirmedAt: null,
            notificationPreferences: mentionsOnlyPreferences(),
        }).where(eq(workspaceMembers.id, m!.id));
        const [period] = await tx.insert(workspaceMemberPeriods).values({
            projectId, userId: targetUserId, role: m!.role, startedAt: await currentPeriodStart(tx, projectId, targetUserId, m!.joined_at),
            endedAt: now, endReason: "completed", note, endedBy: actorId,
        }).returning({ id: workspaceMemberPeriods.id });
        const eventId = await recordEvent(tx, projectId, actorId, "workspace_member.completed", { targetUserId, note, byOwner: !self, tasks: choice, movedTasks: taskMove.moved.length, movedReviews: reviews.length });
        await endProfileWorkspaceContributionMembership(tx, {
            profileId: targetUserId, projectId, verifiedBy: null, eventId, endedAt: now,
            ending: { reason: "completed", by: actorId, note },
        });
        const undoId = await writeUndo(tx, actorId, projectId, "member.complete", self ? "Completed your part" : "Completed a member's part", {
            kind: "member.complete", projectId, userId: targetUserId, actorId, periodId: period?.id ?? null,
            previousNotifications: m!.notification_preferences, tasks: { ids: taskMove.moved, to: taskMove.to }, reviews,
        });
        return { already: false as const, ws: ws!, undoId, notifications: taskMove.notifications, openTasksKept: choice === "keep" ? null : 0 };
    });
    if (!result.already) {
        const person = await readProfileSnapshot(db, targetUserId);
        const actor = self ? person : await readProfileSnapshot(db, actorId);
        const { enqueueWorkspaceNotificationEvents } = await import("@/lib/notifications/workspace-events");
        const events = [
            ...result.notifications,
            {
                projectId, actorUserId: actorId, actorName: nameOf(actor), eventKey: "members.completed" as const,
                title: `${nameOf(person)} completed their part`, body: note ? `“${note}”` : null,
                href: `/workspaces/${result.ws.slug ?? projectId}?tab=settings&section=collaborators`, groupKey: `member-completed:${projectId}`,
            },
            ...(self ? [] : [{
                projectId, actorUserId: actorId, actorName: nameOf(actor), eventKey: "members.marked_completed" as const, affectedMemberId: targetUserId,
                title: `${nameOf(actor)} marked your part in ${result.ws.title ?? "this workspace"} completed`, body: "You can reopen it from Your settings.",
                href: `/workspaces/${result.ws.slug ?? projectId}?tab=settings&section=you`,
            }]),
        ];
        await enqueueWorkspaceNotificationEvents(events).catch(() => undefined);
        await markProfileCollaborationSummaryStale(targetUserId);
        announce(projectId, targetUserId, "completed");
    }
    return { part: await getMyPart(projectId, targetUserId).catch(() => null), undoId: result.undoId, already: result.already };
}

// ── Reopen my part ───────────────────────────────────────────────────────────────────────────────────────────────

/** Reopens your part (§3): role and write access come back; the profile entry reopens with a new stage from today. */
export async function reopenPart(userId: string, projectId: string) {
    await rateLimited(projectId, userId);
    await transactionThen(async (tx) => {
        const ws = await readWorkspace(tx, projectId);
        if (!ws) fail("Workspace not found", "NOT_FOUND");
        const m = await lockMembership(tx, projectId, userId);
        if (!m) fail("You aren't a member of this workspace", "NOT_FOUND");
        if (!m!.completed_at) fail("Your part here isn't completed", "CONFLICT");
        await tx.update(workspaceMembers).set({ completedAt: null, completedBy: null, completionNote: null, completionConfirmedBy: null, completionConfirmedAt: null })
            .where(eq(workspaceMembers.id, m!.id));
        await reopenProfileEntry(tx, projectId, userId, m!.role, "reopen");
        await recordEvent(tx, projectId, userId, "workspace_member.reopened", { targetUserId: userId });
    });
    const person = await readProfileSnapshot(db, userId);
    const ws = await readWorkspace(db, projectId);
    const { enqueueWorkspaceNotificationEvents } = await import("@/lib/notifications/workspace-events");
    await enqueueWorkspaceNotificationEvents([{
        projectId, actorUserId: userId, actorName: nameOf(person), eventKey: "members.reopened",
        title: `${nameOf(person)} reopened their part`, href: `/workspaces/${ws?.slug ?? projectId}?tab=settings&section=collaborators`, groupKey: `member-reopened:${projectId}`,
    }]).catch(() => undefined);
    await markProfileCollaborationSummaryStale(userId);
    announce(projectId, userId, "reopened");
    return getMyPart(projectId, userId);
}

/** The profile entry reopens: no end, and a new open stage from now (history is kept in the closed stage and periods). */
async function reopenProfileEntry(tx: Executor, projectId: string, userId: string, role: MemberRole, source: "reopen" | "membership") {
    const [entry] = await tx.update(profileContributions)
        .set({ endedAt: null, endReason: null, endedBy: null, endNote: null, updatedAt: new Date() })
        .where(and(eq(profileContributions.profileId, userId), eq(profileContributions.projectId, projectId), isNull(profileContributions.deletedAt)))
        .returning({ id: profileContributions.id });
    if (!entry) return;
    const [open] = await tx.select({ id: profileContributionStages.id }).from(profileContributionStages)
        .where(and(eq(profileContributionStages.contributionId, entry.id), isNull(profileContributionStages.endedAt), isNull(profileContributionStages.deletedAt))).limit(1);
    if (!open) {
        await tx.insert(profileContributionStages).values({
            contributionId: entry.id, profileId: userId, projectId, source, roleKind: role === "owner" ? "owner" : role, startedAt: new Date(),
        });
    }
}

// ── Leave ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type LeaveInput = { tasks?: TaskChoice; giveTo?: string | null; reviewsTo?: string | null };

/**
 * Leaving (§4), through the existing removal (one transaction): reviews handed on, an undo snapshot of the membership,
 * one-workspace agent sign-ins revoked, your stars, watches, reminders, pins and mute here removed. A completed part
 * keeps its Completed dates (the removal checks it).
 */
export async function leaveWorkspace(userId: string, projectId: string, input: LeaveInput = {}) {
    const result = await transactionThen(async (tx) => {
        const ws = await readWorkspace(tx, projectId);
        if (!ws) fail("Workspace not found", "NOT_FOUND");
        const m = await lockMembership(tx, projectId, userId);
        const why = refusal(ws!, userId, m, "leave");
        if (why) fail(why, "FORBIDDEN");
        const [row] = await tx.select().from(workspaceMembers).where(eq(workspaceMembers.id, m!.id)).limit(1);
        const choice = input.tasks ?? "unassign";
        const reviews = await moveReviews(tx, ws!, userId, input.reviewsTo ?? null);
        // The removal moves open tasks; note which, so Undo moves back only the ones nobody touched since.
        const openIds = (await tx.select({ id: tasks.id }).from(tasks)
            .where(and(eq(tasks.projectId, projectId), eq(tasks.assigneeId, userId), isNull(tasks.deletedAt), sql`(${tasks.status} <> 'done' OR ${tasks.reviewStatus} = 'pending')`))).map((t) => t.id);
        const removal = await removeWorkspaceMemberInternal(tx, {
            projectId, actorId: userId, targetUserId: userId,
            mode: choice === "keep" ? "preserve_history" : choice === "give" ? "reassign_active_tasks" : "unassign_active_tasks",
            reassignToUserId: choice === "give" ? input.giveTo ?? null : null,
            allowSelf: true, ending: { reason: "left", by: userId },
        });
        const [period] = await tx.select({ id: workspaceMemberPeriods.id }).from(workspaceMemberPeriods)
            .where(and(eq(workspaceMemberPeriods.projectId, projectId), eq(workspaceMemberPeriods.userId, userId))).orderBy(desc(workspaceMemberPeriods.createdAt)).limit(1);
        // Agents limited to this workspace stop now; all-workspaces agents lose it because they're checked per request.
        await tx.update(extensionDeviceSessions).set({ revokedAt: new Date() })
            .where(and(eq(extensionDeviceSessions.userId, userId), eq(extensionDeviceSessions.workspaceId, projectId), eq(extensionDeviceSessions.tokenType, "agent"), isNull(extensionDeviceSessions.revokedAt)));
        await removePersonalLinks(tx, projectId, userId);
        const snapshot = row ? {
            role: row.role, title: row.title, unitId: row.unitId, fileUploadEnabled: row.fileUploadEnabled, notificationPreferences: row.notificationPreferences,
            showOnProfile: row.showOnProfile, profileOrder: row.profileOrder, joinedAt: row.joinedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null,
            completedBy: row.completedBy, completionNote: row.completionNote, completionConfirmedBy: row.completionConfirmedBy,
            completionConfirmedAt: row.completionConfirmedAt?.toISOString() ?? null, hideAgentLabel: row.hideAgentLabel, viewPrefs: row.viewPrefs, reviews,
        } : {};
        const undoId = await writeUndo(tx, userId, projectId, "member.leave", `Left ${ws!.title ?? "the workspace"}`, {
            kind: "member.leave", projectId, userId, snapshot, periodId: row?.completedAt ? null : period?.id ?? null,
            tasks: { ids: choice === "keep" ? [] : openIds, to: choice === "give" ? input.giveTo ?? null : null },
        });
        return { ws: ws!, undoId, removal, moved: choice === "keep" ? 0 : openIds.length, choice };
    });
    const person = await readProfileSnapshot(db, userId);
    const { enqueueWorkspaceNotificationEvents } = await import("@/lib/notifications/workspace-events");
    const taskWords = result.moved ? ` · ${result.moved} task${result.moved === 1 ? "" : "s"} ${result.choice === "give" ? "handed on" : "unassigned"}` : "";
    await enqueueWorkspaceNotificationEvents([
        ...result.removal.assignmentNotifications,
        {
            projectId, actorUserId: userId, actorName: nameOf(person), eventKey: "members.left",
            title: `${nameOf(person)} left ${result.ws.title ?? "the workspace"}${taskWords}`, href: `/workspaces/${result.ws.slug ?? projectId}?tab=settings&section=collaborators`,
            groupKey: `member-left:${projectId}`,
        },
    ]).catch(() => undefined);
    await markProfileCollaborationSummaryStale(userId);
    announce(projectId, userId, "left");
    return { left: true as const, undoId: result.undoId, tasksMoved: result.moved };
}

async function removePersonalLinks(tx: Executor, projectId: string, userId: string) {
    const inWorkspace = (taskCol: AnyColumn) => sql`${taskCol} IN (SELECT id FROM tasks WHERE workspace_id = ${projectId})`;
    await tx.delete(taskWatchers).where(and(eq(taskWatchers.userId, userId), inWorkspace(taskWatchers.taskId)));
    await tx.delete(taskStars).where(and(eq(taskStars.userId, userId), inWorkspace(taskStars.taskId)));
    await tx.delete(taskReminders).where(and(eq(taskReminders.userId, userId), inWorkspace(taskReminders.taskId)));
    await tx.delete(nodeStars).where(and(eq(nodeStars.userId, userId), sql`${nodeStars.nodeId} IN (SELECT id FROM ${workspaceNodes} WHERE workspace_id = ${projectId})`));
    await tx.delete(sidebarPins).where(and(eq(sidebarPins.userId, userId), eq(sidebarPins.workspaceId, projectId)));
    const { unmuteWorkspaceInTx } = await import("@/lib/notifications/service");
    await unmuteWorkspaceInTx(tx, userId, projectId);
}

// ── Undo ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Undo of a completion or a leave (§3, §4), from the toast or `nb undo`. Moves back only what nobody changed since. */
export async function undoMemberJourney(inverse: MemberUndo, callerId: string) {
    // Your own completion or leave is always yours to undo; someone else's only while you may still act for them.
    if (callerId !== inverse.userId && (inverse.kind === "member.leave" || inverse.actorId !== callerId)) fail("Only the person who made this change can undo it", "FORBIDDEN");
    if (inverse.kind === "member.complete") {
        await transactionThen(async (tx) => {
            const m = await lockMembership(tx, inverse.projectId, inverse.userId);
            if (!m?.completed_at) return;
            if (callerId !== inverse.userId) {
                const ws = await readWorkspace(tx, inverse.projectId);
                if (!ws) fail("Workspace not found", "NOT_FOUND");
                await mayActFor(tx, ws!, callerId, m.role);
            }
            await tx.update(workspaceMembers).set({ completedAt: null, completedBy: null, completionNote: null, completionConfirmedBy: null, completionConfirmedAt: null, notificationPreferences: inverse.previousNotifications as never })
                .where(eq(workspaceMembers.id, m.id));
            if (inverse.periodId) await tx.delete(workspaceMemberPeriods).where(eq(workspaceMemberPeriods.id, inverse.periodId));
            // No new period: the stage that completion closed opens again, as if it never ended.
            const [entry] = await tx.update(profileContributions).set({ endedAt: null, endReason: null, endedBy: null, endNote: null, updatedAt: new Date() })
                .where(and(eq(profileContributions.profileId, inverse.userId), eq(profileContributions.projectId, inverse.projectId), isNull(profileContributions.deletedAt)))
                .returning({ id: profileContributions.id });
            if (entry) {
                const [last] = await tx.select({ id: profileContributionStages.id }).from(profileContributionStages)
                    .where(and(eq(profileContributionStages.contributionId, entry.id), isNull(profileContributionStages.deletedAt), isNotNull(profileContributionStages.endedAt)))
                    .orderBy(desc(profileContributionStages.endedAt)).limit(1);
                if (last) await tx.update(profileContributionStages).set({ endedAt: null, updatedAt: new Date() }).where(eq(profileContributionStages.id, last.id));
            }
            if (inverse.tasks.ids.length) {
                await tx.update(tasks).set({ assigneeId: inverse.userId, updatedAt: new Date() })
                    .where(and(inArray(tasks.id, inverse.tasks.ids), inverse.tasks.to ? eq(tasks.assigneeId, inverse.tasks.to) : isNull(tasks.assigneeId)));
            }
            for (const r of inverse.reviews) {
                await tx.insert(mergeRequestReviews).values({ mergeRequestId: r.mergeRequestId, reviewerId: r.from, state: "requested" }).onConflictDoNothing();
                await tx.delete(mergeRequestReviews).where(and(eq(mergeRequestReviews.mergeRequestId, r.mergeRequestId), eq(mergeRequestReviews.reviewerId, r.to), eq(mergeRequestReviews.state, "requested")));
            }
            await recordEvent(tx, inverse.projectId, inverse.actorId, "workspace_member.completion_undone", { targetUserId: inverse.userId });
        });
    } else {
        await transactionThen(async (tx) => {
            const s = inverse.snapshot as Record<string, unknown>;
            const [exists] = await tx.select({ id: workspaceMembers.id }).from(workspaceMembers)
                .where(and(eq(workspaceMembers.projectId, inverse.projectId), eq(workspaceMembers.userId, inverse.userId))).limit(1);
            if (exists) return;
            const date = (v: unknown) => (typeof v === "string" ? new Date(v) : null);
            await tx.insert(workspaceMembers).values({
                projectId: inverse.projectId, userId: inverse.userId, role: (s.role as MemberRole) ?? "member", title: (s.title as string) ?? null,
                unitId: (s.unitId as string) ?? null, fileUploadEnabled: s.fileUploadEnabled !== false, notificationPreferences: (s.notificationPreferences ?? { version: 1, mode: "inherit", rules: {} }) as never,
                showOnProfile: s.showOnProfile !== false, profileOrder: (s.profileOrder as number) ?? null, joinedAt: date(s.joinedAt) ?? new Date(),
                completedAt: date(s.completedAt), completedBy: (s.completedBy as string) ?? null, completionNote: (s.completionNote as string) ?? null,
                completionConfirmedBy: (s.completionConfirmedBy as string) ?? null, completionConfirmedAt: date(s.completionConfirmedAt),
                hideAgentLabel: Boolean(s.hideAgentLabel), viewPrefs: (s.viewPrefs ?? {}) as never,
            });
            if (inverse.periodId) await tx.delete(workspaceMemberPeriods).where(eq(workspaceMemberPeriods.id, inverse.periodId));
            if (!s.completedAt) await reopenLeftEntry(tx, inverse.projectId, inverse.userId);
            if (inverse.tasks.ids.length) {
                await tx.update(tasks).set({ assigneeId: inverse.userId, updatedAt: new Date() })
                    .where(and(inArray(tasks.id, inverse.tasks.ids), inverse.tasks.to ? eq(tasks.assigneeId, inverse.tasks.to) : isNull(tasks.assigneeId)));
            }
            const { syncWorkspaceChat } = await import("@/lib/messaging/integrations");
            await syncWorkspaceChat(tx, inverse.projectId, inverse.userId, "add").catch(() => undefined);
            await recordEvent(tx, inverse.projectId, inverse.userId, "workspace_member.leave_undone", { targetUserId: inverse.userId });
        });
    }
    announce(inverse.projectId, inverse.userId, "undone");
    await markProfileCollaborationSummaryStale(inverse.userId);
}

/** Undoing a leave reopens the profile entry and the stage the leave closed, as if it never ended. */
async function reopenLeftEntry(tx: Executor, projectId: string, userId: string) {
    const [entry] = await tx.update(profileContributions).set({ endedAt: null, endReason: null, endedBy: null, endNote: null, updatedAt: new Date() })
        .where(and(eq(profileContributions.profileId, userId), eq(profileContributions.projectId, projectId), isNull(profileContributions.deletedAt)))
        .returning({ id: profileContributions.id });
    if (!entry) return;
    const [last] = await tx.select({ id: profileContributionStages.id }).from(profileContributionStages)
        .where(and(eq(profileContributionStages.contributionId, entry.id), isNull(profileContributionStages.deletedAt), isNotNull(profileContributionStages.endedAt)))
        .orderBy(desc(profileContributionStages.endedAt)).limit(1);
    if (last) await tx.update(profileContributionStages).set({ endedAt: null, updatedAt: new Date() }).where(eq(profileContributionStages.id, last.id));
}

// ── The owner's answer ───────────────────────────────────────────────────────────────────────────────────────────

/** Confirm or Not yet (§3), from the owner or an admin. Confirm shows "confirmed by" on the person's profile. */
export async function decideCompletion(actorId: string, projectId: string, targetUserId: string, decision: "confirm" | "not_yet", note?: string | null) {
    const text = note?.trim().slice(0, 500) || null;
    const ws = await transactionThen(async (tx) => {
        const w = await readWorkspace(tx, projectId);
        if (!w) fail("Workspace not found", "NOT_FOUND");
        const actorRole = w!.ownerId === actorId ? "owner" : (await lockMembership(tx, projectId, actorId))?.role;
        if (actorRole !== "owner" && actorRole !== "admin") fail("Only the owner or an admin can answer this", "FORBIDDEN");
        if (actorId === targetUserId) fail("You can't confirm your own part", "FORBIDDEN");
        const m = await lockMembership(tx, projectId, targetUserId);
        if (!m?.completed_at) fail("Their part isn't completed", "CONFLICT");
        if (decision === "confirm") {
            const now = new Date();
            await tx.update(workspaceMembers).set({ completionConfirmedBy: actorId, completionConfirmedAt: now }).where(eq(workspaceMembers.id, m!.id));
            const [latest] = await tx.select({ id: workspaceMemberPeriods.id }).from(workspaceMemberPeriods)
                .where(and(eq(workspaceMemberPeriods.projectId, projectId), eq(workspaceMemberPeriods.userId, targetUserId), inArray(workspaceMemberPeriods.endReason, ["completed", "workspace_completed"])))
                .orderBy(desc(workspaceMemberPeriods.endedAt)).limit(1);
            if (latest) await tx.update(workspaceMemberPeriods).set({ confirmedBy: actorId, confirmedAt: now }).where(eq(workspaceMemberPeriods.id, latest.id));
        }
        await recordEvent(tx, projectId, actorId, decision === "confirm" ? "workspace_member.completion_confirmed" : "workspace_member.completion_not_yet", { targetUserId, note: text });
        return w!;
    });
    const actor = await readProfileSnapshot(db, actorId);
    const { enqueueWorkspaceNotificationEvents } = await import("@/lib/notifications/workspace-events");
    await enqueueWorkspaceNotificationEvents([{
        projectId, actorUserId: actorId, actorName: nameOf(actor), eventKey: "members.completion_decided", affectedMemberId: targetUserId,
        title: decision === "confirm" ? `${nameOf(actor)} confirmed your part in ${ws.title ?? "the workspace"}` : `${nameOf(actor)} asked you to reopen your part in ${ws.title ?? "the workspace"}`,
        body: text, href: `/workspaces/${ws.slug ?? projectId}?tab=settings&section=you`,
    }]).catch(() => undefined);
    await markProfileCollaborationSummaryStale(targetUserId);
    announce(projectId, targetUserId, decision);
    return { decided: decision };
}

// ── Completing the whole workspace ───────────────────────────────────────────────────────────────────────────────

/**
 * The owner sets the workspace's status to completed (§3): every active part completes with that date and the note
 * "Workspace completed", the owner's own entry too. Runs inside the caller's transaction. Setting it back to active
 * reopens nobody.
 */
export async function completeAllParts(tx: Executor, projectId: string, actorId: string) {
    const ws = await readWorkspace(tx, projectId);
    if (!ws) return [] as string[];
    const now = new Date();
    const active = await tx.select({ id: workspaceMembers.id, userId: workspaceMembers.userId, role: workspaceMembers.role, joinedAt: workspaceMembers.joinedAt })
        .from(workspaceMembers).where(and(eq(workspaceMembers.projectId, projectId), isNull(workspaceMembers.completedAt), ne(workspaceMembers.userId, ws.ownerId)));
    for (const m of active) {
        await tx.update(workspaceMembers).set({ completedAt: now, completedBy: actorId, completionNote: "Workspace completed", notificationPreferences: mentionsOnlyPreferences() })
            .where(eq(workspaceMembers.id, m.id));
        await tx.insert(workspaceMemberPeriods).values({
            projectId, userId: m.userId, role: m.role, startedAt: await currentPeriodStart(tx, projectId, m.userId, m.joinedAt),
            endedAt: now, endReason: "workspace_completed", note: "Workspace completed", endedBy: actorId,
        });
        await endProfileWorkspaceContributionMembership(tx, { profileId: m.userId, projectId, verifiedBy: null, endedAt: now, ending: { reason: "workspace_completed", by: actorId, note: "Workspace completed" } });
    }
    // The owner's own entry ends with the workspace.
    await endProfileWorkspaceContributionMembership(tx, { profileId: ws.ownerId, projectId, verifiedBy: null, endedAt: now, ending: { reason: "workspace_completed", by: actorId, note: "Workspace completed" } });
    await recordEvent(tx, projectId, actorId, "workspace.completed", { parts: active.length });
    const ids = active.map((m) => m.userId);
    afterCommit(tx, async () => {
        const actor = await readProfileSnapshot(db, actorId);
        const { enqueueWorkspaceNotificationEvents } = await import("@/lib/notifications/workspace-events");
        if (ids.length) await enqueueWorkspaceNotificationEvents([{
            projectId, actorUserId: actorId, actorName: nameOf(actor), eventKey: "members.workspace_completed", directRecipientIds: ids,
            title: `${ws.title ?? "A workspace"} is completed`, body: "Your part there is completed with it. Your profile shows the dates.",
            href: `/workspaces/${ws.slug ?? projectId}`,
        }]).catch(() => undefined);
        for (const id of [...ids, ws.ownerId]) await markProfileCollaborationSummaryStale(id).catch(() => undefined);
        announce(projectId, ws.ownerId, "workspace_completed");
    });
    return ids;
}

// ── Your settings ────────────────────────────────────────────────────────────────────────────────────────────────

export type MySettingsPatch = {
    notifications?: { mode: "inherit" | "custom"; rules?: Record<string, boolean> };
    muteUntil?: string | null; // ISO date, "forever", or null to unmute
    hideAgentLabel?: boolean;
    agentsBlocked?: boolean;
    viewPrefs?: { defaultTab?: string | null; density?: "compact" | "comfortable" | null };
    showOnProfile?: boolean;
};

/** Your settings (Part 1 · PATCH /me). Only stricter than the workspace; mandatory notifications can't be turned off. */
export async function updateMySettings(userId: string, projectId: string, patch: MySettingsPatch) {
    const ws = await readWorkspace(db, projectId);
    if (!ws) fail("Workspace not found", "NOT_FOUND");
    const [m] = await db.select({ id: workspaceMembers.id, viewPrefs: workspaceMembers.viewPrefs }).from(workspaceMembers)
        .where(and(eq(workspaceMembers.projectId, projectId), eq(workspaceMembers.userId, userId))).limit(1);
    if (!m) fail("Your settings are for members of this workspace", "NOT_FOUND");
    const set: Partial<typeof workspaceMembers.$inferInsert> = {};
    if (patch.notifications) {
        const rules: Record<string, boolean> = {};
        for (const [key, on] of Object.entries(patch.notifications.rules ?? {})) {
            const entry = (WORKSPACE_NOTIFICATION_EVENT_REGISTRY as Record<string, { allowMemberOverride: boolean; mandatory: boolean }>)[key];
            if (!entry || !entry.allowMemberOverride || entry.mandatory) continue; // locked ones stay as the workspace says
            rules[key] = Boolean(on);
        }
        set.notificationPreferences = { version: 1, mode: patch.notifications.mode, rules } as never;
    }
    if (patch.hideAgentLabel !== undefined) {
        if (patch.hideAgentLabel && !ws!.membersChooseLabels) fail("The owner hasn't let members choose this here", "FORBIDDEN");
        set.hideAgentLabel = patch.hideAgentLabel;
    }
    if (patch.agentsBlocked !== undefined) set.agentsBlockedAt = patch.agentsBlocked ? new Date() : null;
    if (patch.showOnProfile !== undefined) set.showOnProfile = patch.showOnProfile;
    if (patch.viewPrefs) {
        const next = { ...(m!.viewPrefs ?? {}) } as Record<string, unknown>;
        const TABS = new Set(["overview", "docs", "updates", "sprints", "tasks", "files", "settings"]);
        if (patch.viewPrefs.defaultTab !== undefined) {
            if (patch.viewPrefs.defaultTab && !TABS.has(patch.viewPrefs.defaultTab)) fail("Unknown tab", "BAD_REQUEST");
            if (patch.viewPrefs.defaultTab) next.defaultTab = patch.viewPrefs.defaultTab; else delete next.defaultTab;
        }
        if (patch.viewPrefs.density !== undefined) {
            if (patch.viewPrefs.density) next.density = patch.viewPrefs.density; else delete next.density;
        }
        set.viewPrefs = next as never;
    }
    if (Object.keys(set).length) await db.update(workspaceMembers).set(set).where(eq(workspaceMembers.id, m!.id));
    if (patch.muteUntil !== undefined) {
        const { setWorkspaceMute } = await import("@/lib/notifications/service");
        await setWorkspaceMute(userId, projectId, ws!.title ?? null, patch.muteUntil);
    }
    if (patch.showOnProfile !== undefined) await markProfileCollaborationSummaryStale(userId);
    announce(projectId, userId, "settings");
    return getMyPart(projectId, userId);
}

/** Your view (Part 1): the tab this workspace opens on for you, and your task card density. Members only. */
export async function readViewPrefs(projectId: string, userId: string) {
    const [m] = await db.select({ viewPrefs: workspaceMembers.viewPrefs }).from(workspaceMembers)
        .where(and(eq(workspaceMembers.projectId, projectId), eq(workspaceMembers.userId, userId))).limit(1);
    return (m?.viewPrefs ?? {}) as { defaultTab?: string; density?: "compact" | "comfortable" };
}

/** Ask for a different role (Part 1): the owner and admins get the request with your note. */
export async function requestRole(userId: string, projectId: string, role: "admin" | "member" | "viewer", note?: string | null) {
    const part = await getMyPart(projectId, userId);
    if (part.isOwner) fail("You own this workspace", "BAD_REQUEST");
    if (part.role === role) fail(`You're already ${role === "admin" ? "an admin" : `a ${role}`} here`, "BAD_REQUEST");
    const r = await consumeRateLimit(`member-role-request:${projectId}:${userId}`, 3, 86_400);
    if (!r.allowed) fail("You've asked 3 times today. The owner has your requests.", "RATE_LIMITED");
    const person = await readProfileSnapshot(db, userId);
    const { enqueueWorkspaceNotificationEvents } = await import("@/lib/notifications/workspace-events");
    await enqueueWorkspaceNotificationEvents([{
        projectId, actorUserId: userId, actorName: nameOf(person), eventKey: "members.role_requested",
        title: `${nameOf(person)} asks to be ${role === "admin" ? "an admin" : `a ${role}`}`, body: note?.trim().slice(0, 500) || null,
        href: `/workspaces/${part.workspace.slug ?? projectId}?tab=settings&section=collaborators`,
    }]);
    const [event] = await db.insert(workspaceNodeEvents).values({ projectId, actorId: userId, nodeId: null, type: "workspace_member.role_requested", metadata: { role, note: note ?? null }, createdAt: new Date() }).returning({ id: workspaceNodeEvents.id });
    return { requested: role, eventId: event?.id ?? null };
}
