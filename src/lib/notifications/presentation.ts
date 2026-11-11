import type {
    NotificationEntityRefs,
    NotificationItem,
    NotificationKind,
    NotificationMuteScope,
    NotificationReason,
    NotificationTimeGroup,
    NotificationTrayFilter,
} from "@/lib/notifications/types";
import { openUpdateThreads } from "@/lib/realtime/update-live-state";

const KIND_REASON: Record<NotificationKind, NotificationReason> = {
    chat_invite: "workflow",
    chat_reminder: "message",
    application_received: "application",
    application_decision: "application",
    connection_request_received: "connection",
    connection_request_accepted: "connection",
    task_assigned: "assigned",
    task_status_attention: "update",
    task_comment_mention: "mention",
    task_comment_reply: "mention",
    task_file_version: "file",
    task_file_replaced: "file",
    task_file_needs_review: "file",
    file_version_added: "file",
    project_role_changed: "update",
    project_member_removed: "update",
    project_ownership_transferred: "update",
    project_member_joined: "update",
    project_visibility_changed: "update",
    project_public_surface_changed: "update",
    project_file_permission_changed: "update",
    project_role_activity: "update",
    project_application_activity: "application",
    project_sprint_activity: "update",
    project_task_activity: "update",
    project_file_activity: "file",
    project_security_alert: "update",
    project_update_activity: "update",
    project_update_like: "update",
    project_update_team: "update",
    project_update_comment: "mention",
    project_update_reply: "mention",
    project_update_mention: "mention",
    org_membership: "update",
    org_assignment: "assigned",
    org_announcement: "update",
    org_credit: "update",
    trust_safety: "safety",
    agent_question: "workflow",
    agent_access_request: "workflow",
    agent_access_expiring: "workflow",
    agent_session_summary: "update",
    task_report_submitted: "done",
};

export const REASON_LABELS: Record<NotificationReason, string> = {
    mention: "Mention",
    assigned: "Assigned",
    message: "Message",
    application: "Application",
    connection: "Connection",
    blocked: "Blocked",
    done: "Completed",
    workflow: "In review",
    file: "File",
    update: "Update",
    safety: "Safety",
};

export function getNotificationReason(kind: NotificationKind, refs?: NotificationEntityRefs | null): NotificationReason {
    if (kind === "task_status_attention") {
        const status = typeof refs?.status === "string" ? refs.status : null;
        if (status === "blocked") return "blocked";
        if (refs?.reviewStatus === "pending") return "workflow";
        if (status === "done") return "done";
    }
    return KIND_REASON[kind] ?? "update";
}

export function getNotificationReasonLabel(reason: NotificationReason) {
    return REASON_LABELS[reason] ?? "Update";
}

const AGGREGATE_NOUNS: Record<NotificationKind, { singular: string; plural: string }> = {
    chat_invite: { singular: "invitation", plural: "invitations" },
    chat_reminder: { singular: "reminder", plural: "reminders" },
    application_received: { singular: "application", plural: "applications" },
    application_decision: { singular: "decision", plural: "decisions" },
    connection_request_received: { singular: "request", plural: "requests" },
    connection_request_accepted: { singular: "connection", plural: "connections" },
    task_assigned: { singular: "assignment", plural: "assignments" },
    task_status_attention: { singular: "update", plural: "updates" },
    task_comment_mention: { singular: "mention", plural: "mentions" },
    task_comment_reply: { singular: "reply", plural: "replies" },
    task_file_version: { singular: "version", plural: "versions" },
    task_file_replaced: { singular: "replacement", plural: "replacements" },
    task_file_needs_review: { singular: "review", plural: "reviews" },
    file_version_added: { singular: "version", plural: "versions" },
    project_role_changed: { singular: "role change", plural: "role changes" },
    project_member_removed: { singular: "membership update", plural: "membership updates" },
    project_ownership_transferred: { singular: "ownership transfer", plural: "ownership transfers" },
    project_member_joined: { singular: "member update", plural: "member updates" },
    project_visibility_changed: { singular: "visibility change", plural: "visibility changes" },
    project_public_surface_changed: { singular: "public surface change", plural: "public surface changes" },
    project_file_permission_changed: { singular: "file permission change", plural: "file permission changes" },
    project_role_activity: { singular: "role update", plural: "role updates" },
    project_application_activity: { singular: "application update", plural: "application updates" },
    project_sprint_activity: { singular: "sprint update", plural: "sprint updates" },
    project_task_activity: { singular: "task update", plural: "task updates" },
    project_file_activity: { singular: "file update", plural: "file updates" },
    project_security_alert: { singular: "security update", plural: "security updates" },
    project_update_activity: { singular: "workspace update", plural: "workspace updates" },
    project_update_like: { singular: "like", plural: "likes" },
    project_update_team: { singular: "update", plural: "updates" },
    project_update_comment: { singular: "comment", plural: "comments" },
    project_update_reply: { singular: "reply", plural: "replies" },
    project_update_mention: { singular: "mention", plural: "mentions" },
    org_membership: { singular: "membership update", plural: "membership updates" },
    org_assignment: { singular: "assignment update", plural: "assignment updates" },
    org_announcement: { singular: "announcement", plural: "announcements" },
    org_credit: { singular: "profile credit update", plural: "profile credit updates" },
    trust_safety: { singular: "safety notice", plural: "safety notices" },
    agent_question: { singular: "question", plural: "questions" },
    agent_access_request: { singular: "access request", plural: "access requests" },
    agent_access_expiring: { singular: "agent renewal", plural: "agent renewals" },
    agent_session_summary: { singular: "agent session", plural: "agent sessions" },
    task_report_submitted: { singular: "report", plural: "reports" },
};

export function getAggregateLabel(kind: NotificationKind, count: number): string | null {
    if (count <= 1) return null;
    // Their titles already carry the count: "Ravi and 4 others liked your update".
    if (kind === "project_update_like" || kind === "project_update_team") return null;
    const nouns = AGGREGATE_NOUNS[kind];
    const noun = nouns?.plural ?? "updates";
    return `${count} new ${noun}`;
}

// -----------------------------------------------------------------------------
// Client-side bundling
//
// The server already collapses bursts that share a dedupe_key into one row with
// aggregate_count > 1. Distinct dedupe_keys that touch the same entity in a
// tight window (e.g. three different people commenting on the same task within
// an hour) still arrive as separate rows — bundle them visually so the tray
// reads "Ana, Ben and 2 others commented on <task>" instead of a wall of
// near-identical lines.
// -----------------------------------------------------------------------------

export type NotificationBundle = {
    key: string;
    lead: NotificationItem;
    items: NotificationItem[];
};

const BUNDLE_WINDOW_MS = 60 * 60 * 1000;

function bundleKeyFor(item: NotificationItem): string {
    const refs = item.entityRefs ?? {};
    const entity =
        // A like on a comment is its own row, not one more like on the post.
        (item.kind === "project_update_like" && typeof refs.commentId === "string" && refs.commentId)
        || (typeof refs.updateId === "string" && refs.updateId)
        || (typeof refs.taskId === "string" && refs.taskId)
        || (typeof refs.channelId === "string" && refs.channelId)
        || (typeof refs.projectId === "string" && refs.projectId)
        || item.actorUserId
        || "none";
    return `${item.kind}:${entity}`;
}

/**
 * Roll adjacent notifications that share a bundle key and fall within a 1h
 * window into a single visual bundle. Input must be pre-sorted DESC by
 * activityAt (as it is from the feed query). Totals in aggregate_count are
 * preserved on each child item so per-row counts stay truthful.
 */
export function bundleNotifications(items: NotificationItem[]): NotificationBundle[] {
    const bundles: NotificationBundle[] = [];
    const byKey = new Map<string, NotificationBundle>();
    for (const item of items) {
        const key = bundleKeyFor(item);
        const existing = byKey.get(key);
        const itemTime = new Date(item.activityAt).getTime();
        if (
            existing
            && !Number.isNaN(itemTime)
            && new Date(existing.lead.activityAt).getTime() - itemTime <= BUNDLE_WINDOW_MS
        ) {
            existing.items.push(item);
            continue;
        }
        const bundle: NotificationBundle = { key, lead: item, items: [item] };
        bundles.push(bundle);
        byKey.set(key, bundle);
    }
    return bundles;
}

function uniqueActorNames(items: NotificationItem[], max = 3): { names: string[]; remaining: number } {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const item of items) {
        const name = (item.preview?.actorName ?? "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        if (names.length < max) names.push(name);
    }
    return { names, remaining: Math.max(0, seen.size - names.length) };
}

/**
 * "Ana commented", "Ana and Ben commented", "Ana, Ben and 3 others commented".
 * Falls back to a count-only summary when we cannot resolve actor names.
 */
export function getBundleSummary(bundle: NotificationBundle): string {
    const { items } = bundle;
    if (items.length <= 1) return "";
    const reasonNoun = AGGREGATE_NOUNS[bundle.lead.kind]?.plural ?? "updates";
    const { names, remaining } = uniqueActorNames(items);
    if (names.length === 0) return `${items.length} new ${reasonNoun}`;
    if (names.length === 1 && remaining === 0) return `${names[0]}`;
    if (names.length === 2 && remaining === 0) return `${names[0]} and ${names[1]}`;
    if (remaining === 0) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    const total = names.length + remaining;
    return `${names.join(", ")} and ${total - names.length} others`;
}

export function bundleUnreadCount(bundle: NotificationBundle): number {
    return bundle.items.reduce((acc, item) => (item.seenAt ? acc : acc + 1), 0);
}

export function formatAbsoluteTimestamp(value: string): string | null {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

export function formatRelativeTimestamp(value: string): string | null {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diffSec < 45) return "just now";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 2592000) return `${Math.floor(diffSec / 86400)}d ago`;
    if (diffSec < 31536000) return `${Math.floor(diffSec / 2592000)}mo ago`;
    return `${Math.floor(diffSec / 31536000)}y ago`;
}

export function filterNotifications(items: NotificationItem[], filter: NotificationTrayFilter) {
    if (filter === "unread") return items.filter((item) => !item.seenAt);
    return items;
}

function startOfToday(now: Date) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function groupFor(item: NotificationItem, now: Date): NotificationTimeGroup {
    if (!item.seenAt) return "new";
    const activityAt = new Date(item.activityAt);
    if (!Number.isNaN(activityAt.getTime()) && activityAt >= startOfToday(now)) return "today";
    return "earlier";
}

export function groupNotificationsByTime(items: NotificationItem[], now: Date = new Date()) {
    const groups: Record<NotificationTimeGroup, NotificationItem[]> = {
        new: [],
        today: [],
        earlier: [],
    };
    for (const item of items) {
        groups[groupFor(item, now)].push(item);
    }
    return groups;
}

export function buildNotificationMuteScopes(item: NotificationItem): NotificationMuteScope[] {
    const scopes: NotificationMuteScope[] = [{
        kind: "notification_type",
        value: item.kind,
        label: getNotificationReasonLabel(item.reason),
        mutedAt: null,
    }];
    const refs = item.entityRefs ?? {};
    if (refs.orgId) scopes.push({ kind: "organization", value: refs.orgId, label: "This organization", mutedAt: null });
    if (refs.projectId && refs.projectId !== refs.orgId) scopes.push({ kind: "project", value: refs.projectId, label: item.preview?.contextLabel ?? "This workspace", mutedAt: null });
    if (refs.taskId) scopes.push({ kind: "task", value: refs.taskId, label: item.body ?? item.title, mutedAt: null });
    if (refs.updateId) scopes.push({ kind: "update", value: refs.updateId, label: "This post", mutedAt: null });
    if (item.actorUserId) scopes.push({ kind: "person", value: item.actorUserId, label: item.preview?.actorName ?? "This person", mutedAt: null });
    return scopes;
}

export function getNarrowestNotificationMuteScope(item: NotificationItem): NotificationMuteScope {
    const scopes = buildNotificationMuteScopes(item);
    const specificityOrder: NotificationMuteScope["kind"][] = ["task", "update", "project", "organization", "person", "notification_type"];
    for (const kind of specificityOrder) {
        const scope = scopes.find((candidate) => candidate.kind === kind);
        if (scope) return scope;
    }
    return scopes[0]!;
}

export function buildNotificationHref(item: NotificationItem): string | null {
    const href = item.href?.trim();
    if (!href) return null;
    if (!href.startsWith("/")) return null;
    if (href.startsWith("//")) return null;
    return href;
}

export function notificationMatchesMuteScope(
    params: {
        kind: NotificationKind;
        actorUserId?: string | null;
        entityRefs?: NotificationEntityRefs | null;
    },
    scope: NotificationMuteScope,
) {
    const refs = params.entityRefs ?? {};
    if (scope.kind === "notification_type") return params.kind === scope.value;
    if (scope.kind === "project") return refs.projectId === scope.value || refs.projectSlug === scope.value;
    if (scope.kind === "task") return refs.taskId === scope.value;
    if (scope.kind === "update") return refs.updateId === scope.value;
    if (scope.kind === "person") return params.actorUserId === scope.value;
    // Muting an org covers its child projects too: their events carry the parent's orgId.
    if (scope.kind === "organization") return refs.orgId === scope.value;
    return false;
}

export function shouldSuppressNotificationToast(params: {
    item: NotificationItem;
    pathname: string | null;
    search: string;
    trayOpen: boolean;
    documentVisible?: boolean;
}) {
    const {
        item,
        pathname,
        search,
        trayOpen,
        documentVisible = true,
    } = params;
    if (trayOpen || documentVisible === false) return true;
    if (item.importance !== "important") return true;
    if (item.readAt || item.seenAt) return true;
    if (item.entityRefs?.updateId && openUpdateThreads.has(item.entityRefs.updateId)) return true;

    const normalizedSearch = search ? (search.startsWith("?") ? search : `?${search}`) : "";
    const activePath = `${pathname ?? ""}${normalizedSearch}`;
    if (item.href && activePath && item.href === activePath) return true;

    const searchParams = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    if (
        (item.kind === "task_comment_mention" || item.kind === "task_comment_reply")
        && pathname?.startsWith("/workspaces/")
    ) {
        const activeTaskId = searchParams.get("drawerId");
        const activePanelTab = searchParams.get("panelTab");
        if (activeTaskId && activeTaskId === item.entityRefs?.taskId && activePanelTab === "comments") {
            return true;
        }
    }
    return false;
}

