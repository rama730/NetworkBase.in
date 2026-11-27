import type { NotificationBundle } from "@/lib/notifications/presentation";
import type { NotificationItem, NotificationKind } from "@/lib/notifications/types";

/**
 * The tray's shape (notifications mix): Needs you is read from its own tables, so rows it stands for never show again
 * in New; likes and branch saves fold into one quiet Activity line; everything about one thing within a day is one
 * thread row.
 */
export const ACTIVITY_KINDS: NotificationKind[] = ["project_update_like", "project_update_team", "branch_saves"];
const DAY = 86_400_000;

export type ActivityDigest = { count: number; label: string; items: NotificationItem[] };
export type TrayShape = { fresh: NotificationBundle[]; earlier: NotificationBundle[]; activity: ActivityDigest | null };

function threadKey(item: NotificationItem): string {
    const refs = item.entityRefs ?? {};
    const entity = refs.updateId || refs.taskId || refs.channelId || null;
    return entity ? `thing:${entity}` : `row:${item.id}`;
}

function threads(items: NotificationItem[]): NotificationBundle[] {
    const out: NotificationBundle[] = [];
    const open = new Map<string, NotificationBundle>();
    for (const item of items) {
        const key = threadKey(item);
        const bundle = open.get(key);
        if (bundle && new Date(bundle.lead.activityAt).getTime() - new Date(item.activityAt).getTime() <= DAY) {
            bundle.items.push(item);
            continue;
        }
        const next = { key, lead: item, items: [item] };
        out.push(next);
        open.set(key, next);
    }
    return out;
}

function activityLabel(items: NotificationItem[], when: string): string {
    const likes = items.filter((i) => i.kind !== "branch_saves").reduce((n, i) => n + Math.max(1, i.aggregateCount), 0);
    const saves = items.filter((i) => i.kind === "branch_saves").reduce((n, i) => n + Math.max(1, i.aggregateCount), 0);
    const parts = [likes ? `${likes} ${likes === 1 ? "like" : "likes"}` : "", saves ? `${saves} ${saves === 1 ? "save" : "saves"} on branches you follow` : ""].filter(Boolean);
    return `${parts.join(" and ")} ${when}`;
}

export function splitTray(items: NotificationItem[], needs: Array<{ notificationId: string | null }>, filter: "unread" | "all", now: Date): TrayShape {
    const represented = new Set(needs.map((n) => n.notificationId).filter(Boolean));
    const visible = items.filter((i) => !represented.has(i.id) && (filter === "all" || !i.seenAt));
    const activityRows = visible.filter((i) => ACTIVITY_KINDS.includes(i.kind) && now.getTime() - new Date(i.activityAt).getTime() < DAY);
    const rest = visible.filter((i) => !activityRows.includes(i));
    const activity = activityRows.length ? { count: activityRows.reduce((n, i) => n + Math.max(1, i.aggregateCount), 0), label: activityLabel(activityRows, "today"), items: activityRows } : null;
    if (filter === "unread") return { fresh: threads(rest), earlier: [], activity };
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    return {
        fresh: threads(rest.filter((i) => new Date(i.activityAt) >= startOfDay)),
        earlier: threads(rest.filter((i) => new Date(i.activityAt) < startOfDay)),
        activity,
    };
}

/** "waiting 2d", in amber, once a request has waited a day. */
export function waitingLabel(since: string, now: Date): string | null {
    const days = Math.floor((now.getTime() - new Date(since).getTime()) / DAY);
    return days >= 1 ? `waiting ${days}d` : null;
}

const NOUNS: Array<[(k: NotificationKind) => boolean, string, string]> = [
    [(k) => k === "project_update_like" || k === "project_update_team", "like", "likes"],
    [(k) => k === "task_comment_mention" || k === "project_update_mention", "mention", "mentions"],
    [(k) => k === "task_comment_reply" || k === "project_update_comment" || k === "project_update_reply", "comment", "comments"],
    [(k) => k === "project_sprint_activity", "sprint", "sprints"],
    [(k) => k === "merge_request", "review", "reviews"],
];

/** "Since Tuesday: 3 need you · 14 new · 9 likes, 3 comments, 2 sprints" after a day or more away. */
export function awaySummary(input: { lastOpenedAt: string | null; needsCount: number; items: NotificationItem[]; now: Date }): string | null {
    if (!input.lastOpenedAt) return null;
    const last = new Date(input.lastOpenedAt);
    if (Number.isNaN(last.getTime()) || input.now.getTime() - last.getTime() < DAY) return null;
    const fresh = input.items.filter((i) => !i.seenAt && new Date(i.activityAt) > last);
    const since = input.now.getTime() - last.getTime() < 6 * DAY
        ? last.toLocaleDateString("en-GB", { weekday: "long" })
        : last.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const counts = NOUNS.map(([match, one, many]) => {
        const n = fresh.filter((i) => match(i.kind)).length;
        return { n, text: `${n} ${n === 1 ? one : many}` };
    }).filter((c) => c.n > 0).sort((a, b) => b.n - a.n).slice(0, 3).map((c) => c.text);
    return [`Since ${since}: ${input.needsCount} need you`, `${fresh.length} new`, ...(counts.length ? [counts.join(", ")] : [])].join(" · ");
}

/** The first line of a row's ⋯ menu: why this reached you. */
/** A task code like "WT-7" is a row's context, never a place someone is a member of. */
export const isTaskCode = (label: string | null | undefined) => Boolean(label && /^[A-Z][A-Z0-9]*-\d+$/.test(label.trim()));

export function whyYouGotIt(item: NotificationItem): string {
    const label = item.preview?.contextLabel;
    const where = label && !isTaskCode(label) ? ` in ${label}` : "";
    switch (item.kind) {
        case "task_comment_mention": case "project_update_mention": return "You were mentioned.";
        case "task_comment_reply": case "project_update_reply": case "project_update_comment": return "You’re in this thread.";
        case "task_assigned": case "task_reminder": return "It’s assigned to you.";
        case "merge_request": return "You’re a reviewer or the author.";
        case "branch_saves": return "You follow this branch.";
        case "connection_request_received": case "connection_request_accepted": return "It’s about your connections.";
        case "application_received": case "project_application_activity": return `You review applications${where}.`;
        case "application_decision": return "You applied.";
        case "trust_safety": return "It’s about your account. These are always sent.";
        case "saved_search_matches": return "You saved this search.";
        case "agent_question": case "agent_access_request": case "agent_access_expiring": case "agent_session_summary": return "Your agent sent it.";
        case "project_update_like": case "project_update_team": return "It’s your post.";
        default: return where ? `You’re a member${where}.` : item.entityRefs?.projectId ? "You’re a member of this workspace." : "You’re part of this.";
    }
}
