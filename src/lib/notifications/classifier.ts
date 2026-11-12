import type { NotificationImportance, NotificationKind } from "./types";

/**
 * J1 = "You owe someone a response" (action-required, survives pause, important badge).
 * J2 = "Someone did a thing" (awareness, honors pause, more tab).
 * Source: /plan-ceo-review + /plan-eng-review consensus, plan §91 + §293.
 */
const J1_KIND_LIST: readonly NotificationKind[] = [
    "task_assigned",
    "task_comment_mention",
    "chat_invite",
    "chat_reminder",
    "task_reminder",
    "task_file_needs_review",
    "connection_request_received",
    "project_member_removed",
    "project_ownership_transferred",
    "project_file_permission_changed",
    "project_security_alert",
];

const J1_KINDS: ReadonlySet<NotificationKind> = new Set(J1_KIND_LIST);

export function importanceForKind(kind: NotificationKind): NotificationImportance {
    return J1_KINDS.has(kind) ? "important" : "more";
}
