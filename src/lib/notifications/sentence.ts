import type { NotificationItem, NotificationKind } from "@/lib/notifications/types";

/**
 * One sentence per row (notifications mix): who, what, which. Names and things are bold, the verb is regular, and the
 * context is the workspace or organization title on one mono line. Titles stay as producers wrote them; this only
 * finds the actor and the quoted thing inside them.
 */
export type NotificationGlyph =
  | "branch" | "merge" | "check" | "x" | "file" | "task" | "clock" | "at" | "chat" | "person" | "door" | "org"
  | "megaphone" | "agent" | "key" | "shield" | "sprint" | "search" | "heart" | "role" | "archive";
export type NotificationTone = "info" | "act" | "ok" | "warn" | "bad" | "plain";
export type NotificationSentence = { actor: string; verb: string; object: string; context: string | null; glyph: NotificationGlyph; tone: NotificationTone };

const LOOK: Partial<Record<NotificationKind, [NotificationGlyph, NotificationTone]>> = {
  chat_invite: ["chat", "plain"], chat_reminder: ["clock", "warn"],
  application_received: ["door", "plain"], application_decision: ["check", "ok"], project_application_activity: ["door", "plain"],
  connection_request_received: ["person", "plain"], connection_request_accepted: ["check", "ok"],
  task_assigned: ["task", "plain"], task_reminder: ["clock", "warn"], task_status_attention: ["task", "plain"],
  task_comment_mention: ["at", "plain"], task_comment_reply: ["chat", "plain"], task_report_submitted: ["task", "ok"],
  task_file_version: ["file", "plain"], task_file_replaced: ["file", "plain"], task_file_needs_review: ["file", "plain"],
  file_version_added: ["file", "plain"], project_file_activity: ["file", "plain"], project_file_permission_changed: ["key", "plain"],
  project_role_changed: ["role", "plain"], project_role_activity: ["role", "plain"], project_member_removed: ["person", "plain"],
  project_ownership_transferred: ["role", "plain"], project_member_joined: ["person", "plain"], project_member_journey: ["person", "plain"],
  project_visibility_changed: ["key", "plain"], project_public_surface_changed: ["key", "plain"],
  project_sprint_activity: ["sprint", "act"], project_task_activity: ["task", "plain"], project_security_alert: ["shield", "bad"],
  project_update_activity: ["chat", "plain"], project_update_like: ["heart", "plain"], project_update_team: ["heart", "plain"],
  project_update_comment: ["chat", "plain"], project_update_reply: ["chat", "plain"], project_update_mention: ["at", "plain"],
  org_membership: ["org", "act"], org_assignment: ["task", "act"], org_announcement: ["megaphone", "act"], org_credit: ["role", "act"],
  trust_safety: ["shield", "bad"],
  agent_question: ["agent", "info"], agent_access_request: ["key", "info"], agent_access_expiring: ["key", "warn"], agent_session_summary: ["agent", "info"],
  merge_request: ["branch", "info"], branch_saves: ["branch", "plain"], saved_search_matches: ["search", "plain"],
};

const QUOTED = /(“[^”]{1,120}”|"[^"]{1,120}")\s*$/;

export function notificationLook(item: Pick<NotificationItem, "kind" | "title" | "entityRefs">): [NotificationGlyph, NotificationTone] {
  const status = item.entityRefs?.status;
  if (item.kind === "task_status_attention" && status === "blocked") return ["x", "bad"];
  if (item.kind === "task_status_attention" && status === "done") return ["check", "ok"];
  if (item.kind === "merge_request" && /merged/i.test(item.title)) return ["merge", "ok"];
  if (item.kind === "merge_request" && /approved/i.test(item.title)) return ["check", "ok"];
  if (item.kind === "merge_request" && /fail/i.test(item.title)) return ["x", "warn"];
  return LOOK[item.kind] ?? ["archive", "plain"];
}

export function notificationSentence(item: NotificationItem): NotificationSentence {
  const [glyph, tone] = notificationLook(item);
  const title = item.title.trim();
  const name = item.preview?.actorName?.trim() || "";
  let actor = "";
  let rest = title;
  if (name && title.toLowerCase().startsWith(name.toLowerCase())) {
    actor = title.slice(0, name.length);
    rest = title.slice(name.length);
  }
  let object = "";
  const quoted = QUOTED.exec(rest);
  if (quoted) {
    object = quoted[1]!;
    rest = rest.slice(0, quoted.index);
  }
  return { actor, verb: rest, object, context: item.preview?.contextLabel?.trim() || null, glyph, tone };
}
