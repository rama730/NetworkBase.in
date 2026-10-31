import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { userNotifications, workspaceUpdateComments, workspaceUpdates } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { emitNotificationWrites } from "@/lib/notifications/fanout";
import type { NotificationEntityRefs } from "@/lib/notifications/types";
import { buildProjectNotificationWrites, resolveWorkspaceNotificationRecipients } from "@/lib/notifications/workspace-events";
import { WORKSPACE_UPDATE_MAX_SYNC_NOTIFICATION_RECIPIENTS, projectUpdateExcerpt } from "@/lib/workspaces/updates";

// A first row counts only what just happened, not the post's whole history.
const FIRST_ROW_LOOKBACK_MS = 60_000;
const UNLIKED_MEMORY = 20;

type ActivityRefs = NotificationEntityRefs & { countSince?: string; unliked?: string[] };

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function likeRowTitle(name: string | null, likes: number) {
    const others = likes - 1;
    return `${name || "Someone"}${others > 0 ? ` and ${plural(others, "other")}` : ""} liked your update`;
}

export function commentLikeRowTitle(name: string | null, likes: number) {
    return likeRowTitle(name, likes).replace(/your update$/, "your comment");
}

export function teamRowTitle(workspaceTitle: string | null, likes: number, comments: number) {
    const parts = [likes > 0 ? plural(likes, "like") : null, comments > 0 ? plural(comments, "comment") : null].filter(Boolean);
    return `Your update in ${workspaceTitle || "your workspace"} got ${parts.join(" and ")}`;
}

/**
 * Whether a notification may name this person to its recipient: the same rule as "Liked by", where anyone else reads as
 * "Private member". Row titles are built from this, so a private person is simply one of the others.
 */
const nameableTo = (recipient: ReturnType<typeof sql>, person: ReturnType<typeof sql>) => sql`(p.visibility = 'public' OR EXISTS (
    SELECT 1 FROM connections conn WHERE conn.status = 'accepted'
      AND ((conn.requester_id = ${recipient} AND conn.addressee_id = ${person}) OR (conn.addressee_id = ${recipient} AND conn.requester_id = ${person}))))`;

/** A count that changed without news: an open row shows the new number, or goes if nothing is left. No bump, no push. */
async function quietlyUpdateRow(id: string, refs: ActivityRefs, open: boolean, title: string, total: number, actorId: string | null, actorName: string | null) {
    await db.execute(sql`
        UPDATE user_notifications SET
            entity_refs = ${JSON.stringify(refs)}::jsonb,
            title = CASE WHEN ${open && total > 0} THEN ${title} ELSE title END,
            aggregate_count = CASE WHEN ${open && total > 0} THEN ${Math.max(total, 1)}::int ELSE aggregate_count END,
            actor_user_id = CASE WHEN ${open && total > 0} THEN ${actorId}::uuid ELSE actor_user_id END,
            preview = CASE WHEN ${open && total > 0} THEN jsonb_set(coalesce(preview, '{}'::jsonb), '{actorName}', to_jsonb(${actorName}::text)) ELSE preview END,
            dismissed_at = CASE WHEN ${open && total === 0} THEN now() ELSE dismissed_at END,
            updated_at = now()
        WHERE id = ${id}::uuid`);
}

/**
 * The grouped rows on a post (Part 2, UP2–UP5): the author's "Ravi and 4 others liked your update", and one quiet
 * "got 5 likes and 2 comments" row for each person on the team. Counts are re-read from the likes and comments, so an
 * unlike or a deleted comment comes out and a block or mute is respected. Read rows start counting again from when they
 * were read. Whoever got a personal notice for this event passes through `exclude` (UP4).
 */
// ponytail: two events at once can write a count one behind; the next event corrects it. Upgrade: lock the post's rows if it shows.
export async function syncUpdateActivityNotifications(input: {
    projectId: string;
    updateId: string;
    actorId: string;
    activity: "like" | "comment" | "reply";
    change: "added" | "removed";
    href: string;
    exclude?: Array<string | null | undefined>;
}) {
    try {
        const { projectId, updateId, actorId, activity, change } = input;
        const [update] = await db
            .select({ authorId: workspaceUpdates.authorId, content: workspaceUpdates.content, audience: workspaceUpdates.audience })
            .from(workspaceUpdates)
            .where(eq(workspaceUpdates.id, updateId))
            .limit(1);
        if (!update) return;
        const authorId = update.authorId;
        if (activity === "like" && authorId === actorId) return;

        const { project, members } = await resolveWorkspaceNotificationRecipients({ projectId, eventKey: "updates.team_activity" });
        if (!project) return;
        // Only admins are sure to be able to open a post with a narrow audience; organizations can be very large.
        const adminsOnly = project.kind === "organization" || Object.keys((update.audience as object | null) ?? {}).length > 0;
        const team = new Set([project.ownerId, ...members.filter((m) => m.role === "admin" || (!adminsOnly && m.role !== "viewer")).map((m) => m.userId)]);
        const exclude = new Set([actorId, ...(input.exclude ?? [])]);
        const targets = new Map<string, "updates.liked" | "updates.team_activity">();
        for (const id of team) if (id !== authorId) targets.set(id, "updates.team_activity");
        if (authorId && activity === "like") targets.set(authorId, "updates.liked");
        // A reply isn't to the author unless it's to their comment, so for them it's team activity too.
        if (authorId && activity === "reply") targets.set(authorId, "updates.team_activity");
        for (const id of exclude) if (id) targets.delete(id);
        const recipients = [...targets].slice(0, WORKSPACE_UPDATE_MAX_SYNC_NOTIFICATION_RECIPIENTS);
        if (recipients.length === 0) return;

        const keyOf = (userId: string, eventKey: string) => `project:${projectId}:${eventKey}:post:${updateId}:${userId}`;
        const existing = await db
            .select({ id: userNotifications.id, userId: userNotifications.userId, dedupeKey: userNotifications.dedupeKey, readAt: userNotifications.readAt, dismissedAt: userNotifications.dismissedAt, entityRefs: userNotifications.entityRefs })
            .from(userNotifications)
            .where(and(
                inArray(userNotifications.userId, recipients.map(([id]) => id)),
                inArray(userNotifications.dedupeKey, recipients.map(([id, event]) => keyOf(id, event))),
            ));
        const rowFor = new Map(existing.map((row) => [row.dedupeKey, row]));
        const plan = recipients.map(([userId, eventKey]) => {
            const row = rowFor.get(keyOf(userId, eventKey));
            const refs = (row?.entityRefs ?? {}) as ActivityRefs;
            const closed = [row?.readAt, row?.dismissedAt].filter(Boolean).map((at) => new Date(at!).getTime());
            const since = closed.length ? new Date(Math.max(...closed)) : refs.countSince ? new Date(refs.countSince) : new Date(Date.now() - FIRST_ROW_LOOKBACK_MS);
            return { userId, eventKey, row, refs, since, open: Boolean(row && !row.readAt && !row.dismissedAt) };
        });

        const visible = (person: ReturnType<typeof sql>) => sql`(NOT app_private.blocked_between(r.user_id, ${person})
            AND NOT EXISTS (SELECT 1 FROM user_mutes m WHERE m.muter_id = r.user_id AND m.muted_id = ${person}))`;
        const counted = await db.execute(sql`
            SELECT r.user_id,
                (SELECT count(*)::int FROM workspace_update_likes l WHERE l.update_id = ${updateId}::uuid AND l.created_at > r.since
                    AND l.user_id <> r.user_id AND l.user_id IS DISTINCT FROM ${authorId}::uuid AND ${visible(sql`l.user_id`)}) AS likes,
                (SELECT count(*)::int FROM workspace_update_comments c WHERE c.update_id = ${updateId}::uuid AND c.deleted_at IS NULL AND c.created_at > r.since
                    AND c.user_id <> r.user_id AND c.target_user_id IS DISTINCT FROM r.user_id AND ${visible(sql`c.user_id`)}
                    AND (r.user_id IS DISTINCT FROM ${authorId}::uuid OR c.parent_id IS NOT NULL)) AS comments,
                liker.user_id AS liker_id, liker.name AS liker_name,
                NOT ${visible(sql`${actorId}::uuid`)} AS actor_hidden
            FROM jsonb_to_recordset(${JSON.stringify(plan.map((p) => ({ user_id: p.userId, since: p.since.toISOString() })))}::jsonb) AS r(user_id uuid, since timestamptz)
            LEFT JOIN LATERAL (
                SELECT l.user_id, coalesce(p.full_name, p.username) AS name FROM workspace_update_likes l JOIN profiles p ON p.id = l.user_id
                WHERE l.update_id = ${updateId}::uuid AND l.created_at > r.since AND l.user_id <> r.user_id AND ${visible(sql`l.user_id`)}
                  AND ${nameableTo(sql`r.user_id`, sql`l.user_id`)}
                ORDER BY l.created_at DESC LIMIT 1
            ) liker ON true`) as unknown as Array<{ user_id: string; likes: number; comments: number; liker_id: string | null; liker_name: string | null; actor_hidden: boolean }>;
        const countsFor = new Map(counted.map((row) => [row.user_id, row]));

        const body = projectUpdateExcerpt(update.content, 160);
        const writes = [];
        for (const { userId, eventKey, row, refs, since, open } of plan) {
            const counts = countsFor.get(userId);
            if (!counts) continue;
            const liked = eventKey === "updates.liked";
            // The author's likes have their own row, so their team row only counts replies.
            const teamLikes = userId === authorId ? 0 : counts.likes;
            const total = liked ? counts.likes : teamLikes + counts.comments;
            const title = liked ? likeRowTitle(counts.liker_name, counts.likes) : teamRowTitle(project.title, teamLikes, counts.comments);
            const unlikedBefore = refs.unliked ?? [];
            const removedLike = change === "removed" && activity === "like";
            const nextRefs: ActivityRefs = {
                ...refs, updateId, countSince: since.toISOString(),
                unliked: removedLike ? [actorId, ...unlikedBefore.filter((id) => id !== actorId)].slice(0, UNLIKED_MEMORY) : unlikedBefore,
            };
            // A like loop counts once: liking again changes a number already on show, and never brings a row back (RT6).
            const quiet = change === "removed" || (activity === "like" && unlikedBefore.includes(actorId));
            if (quiet) {
                if (!row) continue;
                await quietlyUpdateRow(row.id, nextRefs, open, title, total, liked ? counts.liker_id : null, liked ? counts.liker_name : null);
                continue;
            }
            if (counts.actor_hidden || total === 0) continue;
            writes.push(...buildProjectNotificationWrites({
                project, members, followerIds: [],
                input: {
                    projectId, eventKey, affectedMemberId: userId,
                    // Team rows carry counts rather than a name, so they have no actor.
                    actorUserId: liked ? counts.liker_id : null,
                    actorName: liked ? counts.liker_name : null,
                    title, body, href: input.href,
                    entityRefs: nextRefs,
                    preview: { actorName: liked ? counts.liker_name : null, contextLabel: project.title ?? "Workspace update", contextKind: "project", secondaryText: null },
                    groupKey: `post:${updateId}`,
                    aggregateCount: total,
                },
            }));
        }
        if (writes.length > 0) await emitNotificationWrites(writes);
    } catch (error) {
        logger.warn("workspace_updates.activity_notify_failed", { module: "workspace-updates", error: error instanceof Error ? error.message : String(error) });
    }
}

/** "Ravi and 2 others liked your comment": one row per comment, same rules as likes on a post (UP10). */
export async function syncCommentLikeNotification(input: { projectId: string; updateId: string; commentId: string; actorId: string; change: "added" | "removed"; href: string }) {
    try {
        const { projectId, updateId, commentId, actorId, change } = input;
        const [comment] = await db.select({ userId: workspaceUpdateComments.userId, content: workspaceUpdateComments.content }).from(workspaceUpdateComments).where(eq(workspaceUpdateComments.id, commentId)).limit(1);
        const authorId = comment?.userId;
        if (!authorId || authorId === actorId) return;
        const { project, members } = await resolveWorkspaceNotificationRecipients({ projectId, eventKey: "updates.comment_liked" });
        if (!project) return;
        const dedupeKey = `project:${projectId}:updates.comment_liked:comment:${commentId}:${authorId}`;
        const [row] = await db
            .select({ id: userNotifications.id, readAt: userNotifications.readAt, dismissedAt: userNotifications.dismissedAt, entityRefs: userNotifications.entityRefs })
            .from(userNotifications)
            .where(and(eq(userNotifications.userId, authorId), eq(userNotifications.dedupeKey, dedupeKey)));
        const refs = (row?.entityRefs ?? {}) as ActivityRefs;
        const closed = [row?.readAt, row?.dismissedAt].filter(Boolean).map((at) => new Date(at!).getTime());
        const since = closed.length ? new Date(Math.max(...closed)) : refs.countSince ? new Date(refs.countSince) : new Date(Date.now() - FIRST_ROW_LOOKBACK_MS);
        const [counts] = await db.execute(sql`
            SELECT count(*)::int AS likes,
                (array_agg(l.user_id ORDER BY l.created_at DESC) FILTER (WHERE ${nameableTo(sql`${authorId}::uuid`, sql`l.user_id`)}))[1] AS liker_id,
                (array_agg(coalesce(p.full_name, p.username) ORDER BY l.created_at DESC) FILTER (WHERE ${nameableTo(sql`${authorId}::uuid`, sql`l.user_id`)}))[1] AS liker_name,
                bool_or(l.user_id = ${actorId}::uuid) AS actor_counted
            FROM workspace_update_comment_likes l JOIN profiles p ON p.id = l.user_id
            WHERE l.comment_id = ${commentId}::uuid AND l.created_at > ${since.toISOString()}::timestamptz
              AND l.user_id <> ${authorId}::uuid
              AND NOT app_private.blocked_between(${authorId}::uuid, l.user_id)
              AND NOT EXISTS (SELECT 1 FROM user_mutes m WHERE m.muter_id = ${authorId}::uuid AND m.muted_id = l.user_id)`) as unknown as Array<{ likes: number; liker_id: string | null; liker_name: string | null; actor_counted: boolean | null }>;
        const likes = counts?.likes ?? 0;
        const title = commentLikeRowTitle(counts?.liker_name ?? null, likes);
        const unlikedBefore = refs.unliked ?? [];
        const nextRefs: ActivityRefs = {
            ...refs, updateId, commentId, countSince: since.toISOString(),
            unliked: change === "removed" ? [actorId, ...unlikedBefore.filter((id) => id !== actorId)].slice(0, UNLIKED_MEMORY) : unlikedBefore,
        };
        if (change === "removed" || unlikedBefore.includes(actorId)) {
            if (row) await quietlyUpdateRow(row.id, nextRefs, Boolean(!row.readAt && !row.dismissedAt), title, likes, counts?.liker_id ?? null, counts?.liker_name ?? null);
            return;
        }
        if (!counts?.actor_counted) return;
        await emitNotificationWrites(buildProjectNotificationWrites({
            project, members, followerIds: [],
            input: {
                projectId, eventKey: "updates.comment_liked", affectedMemberId: authorId,
                actorUserId: counts.liker_id, actorName: counts.liker_name, title,
                body: projectUpdateExcerpt(comment.content, 160), href: input.href, entityRefs: nextRefs,
                preview: { actorName: counts.liker_name, contextLabel: project.title ?? "Workspace update", contextKind: "project", secondaryText: null },
                groupKey: `comment:${commentId}`,
                aggregateCount: likes,
            },
        }));
    } catch (error) {
        logger.warn("workspace_updates.comment_like_notify_failed", { module: "workspace-updates", error: error instanceof Error ? error.message : String(error) });
    }
}
