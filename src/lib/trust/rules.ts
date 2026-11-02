import { REPORT_REASONS as REASON_TERMS } from "@/lib/copy/terms";

// Reporting and moderation rules (docs/trust-and-safety-concept.md), pure so the dialog, the console, the server and
// the tests agree. Severity sets the deadline; the rule numbers are the Acceptable Use sections (F3, §19.4).

export type ReportTargetKind =
  | "project" | "person" | "update" | "update_comment" | "doc" | "task" | "task_comment" | "file"
  | "chat_message" | "chat_channel" | "role" | "application" | "invitation" | "connection_request" | "contribution";
export type ReportReason = (typeof REASON_TERMS)[number]["id"];
export type Severity = "urgent" | "high" | "normal";
export type ModerationActionKind =
  | "hide" | "remove" | "reset_profile" | "hold_handle" | "remove_verified"
  | "hide_discover" | "restrict" | "suspend_workspace" | "remove_workspace"
  | "warning" | "limit" | "suspension" | "ban";

export const REPORT_REASONS = REASON_TERMS.map((r) => r.id) as ReportReason[];
export const REPORT_REASON_LABEL = Object.fromEntries(REASON_TERMS.map((r) => [r.id, r.label])) as Record<ReportReason, string>;

type ReasonRule = { severity: Severity; rule: number; hint: string; only?: ReportTargetKind[] };
const PEOPLE_AND_PLACES: ReportTargetKind[] = ["person", "project"];
export const REASON_RULES: Record<ReportReason, ReasonRule> = {
  threat: { severity: "urgent", rule: 1, hint: "Someone is threatening violence" },
  self_harm: { severity: "urgent", rule: 11, hint: "Someone may hurt themselves" },
  child_safety: { severity: "urgent", rule: 10, hint: "Removed at once and kept for the authorities" },
  intimate_images: { severity: "urgent", rule: 8, hint: "Private sexual images shared without the person’s consent" },
  private_info: { severity: "urgent", rule: 7, hint: "Phone numbers, addresses, ID documents, private photos" },
  harassment: { severity: "high", rule: 2, hint: "Targeting, insulting or bullying a person" },
  hate_speech: { severity: "high", rule: 3, hint: "Attacks on people for who they are" },
  impersonation: { severity: "high", rule: 5, hint: "Pretending to be another person or organization", only: PEOPLE_AND_PLACES },
  // A new account made to reach someone who blocked them (Blocking B28, K26): §15, a strike like any decision.
  evading_block: { severity: "high", rule: 15, hint: "A new account made to reach someone who blocked them", only: ["person"] },
  // Terms §2 (eligibility), not an Acceptable Use rule; decision 163. Only NetworkBase decides these.
  under_18: { severity: "high", rule: 15, hint: "NetworkBase is for people 18 and over", only: ["person"] },
  scam: { severity: "high", rule: 6, hint: "Fake jobs, payment requests, phishing links", only: ["person", "chat_message", "role", "project", "invitation", "connection_request"] },
  inappropriate: { severity: "normal", rule: 9, hint: "Sexual, violent or graphic content" },
  spam: { severity: "normal", rule: 4, hint: "Ads, repeated posts, mass messages" },
  other: { severity: "normal", rule: 15, hint: "Tell us what’s wrong in the details" },
};

/** Reasons only NetworkBase's team decides, never an organization's admins (report §29.2, decision 163). */
export const STAFF_ONLY_REASONS: ReportReason[] = ["under_18"];

/** The reasons offered for one kind of thing, most serious first. */
export function reasonsFor(kind: ReportTargetKind): ReportReason[] {
  return REPORT_REASONS.filter((r) => !REASON_RULES[r].only || REASON_RULES[r].only!.includes(kind));
}

export const SEVERITY_HOURS: Record<Severity, number> = { urgent: 1, high: 24, normal: 72 };
const SEVERITY_RANK: Record<Severity, number> = { urgent: 3, high: 2, normal: 1 };
export const higherSeverity = (a: Severity, b: Severity) => (SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b);

/** The decision deadline, and the org moderators' half of it (F5). Urgent never goes to org moderators. */
export function deadlinesFor(severity: Severity, openedAt: Date, routedToOrg: boolean) {
  const hours = SEVERITY_HOURS[severity];
  const deadlineAt = new Date(openedAt.getTime() + hours * 3_600_000);
  const orgDeadlineAt = routedToOrg && severity !== "urgent" ? new Date(openedAt.getTime() + (hours / 2) * 3_600_000) : null;
  return { deadlineAt, orgDeadlineAt };
}

/** Hidden on the first report (F10): leaving these up even an hour is too harmful. */
export const HIDE_ON_FIRST_REPORT: ReportReason[] = ["child_safety", "intimate_images"];
/** Hidden after two independent reports (T10): threats on messages and comments. */
export const HIDE_ON_TWO_REPORTS: ReportReason[] = ["threat"];
export const HIDEABLE_KINDS: ReportTargetKind[] = ["chat_message", "update_comment", "task_comment", "update", "file", "contribution"];
/** Support first, no penalty (F9). */
export const SUPPORT_FIRST: ReportReason[] = ["self_harm"];
/** "Also block" is ticked by default for these (T3). */
export const BLOCK_BY_DEFAULT: ReportReason[] = ["harassment", "threat", "private_info", "intimate_images"];

/** The numbered rules: Acceptable Use sections (F3, §19.4). */
export const RULES: Record<number, string> = {
  1: "Threats and violence", 2: "Harassment and bullying", 3: "Hate", 4: "Spam and manipulation", 5: "Impersonation",
  6: "Scams and fraud", 7: "Private information", 8: "Intimate images without consent", 9: "Sexual and graphic content",
  10: "Child safety", 11: "Self-harm", 12: "Intellectual property", 13: "Misusing reports and appeals",
  14: "Systems, automation and fair use", 15: "Reports and enforcement",
};
/** One line under each rule in the decision panel (S10), so a reviewer picks the right one at a glance. */
export const RULE_MEANINGS: Record<number, string> = {
  1: "Threatening or encouraging violence against anyone.", 2: "Targeting a person with abuse, insults or unwanted contact.",
  3: "Attacking people for who they are: caste, religion, race, gender, disability and the like.", 4: "Bulk, repetitive or misleading posts and fake engagement.",
  5: "Pretending to be another person or organization.", 6: "Tricking people out of money, data or access.",
  7: "Sharing someone’s private details without consent.", 8: "Sharing or threatening to share intimate images without consent.",
  9: "Sexual or graphic material in places it isn’t allowed.", 10: "Anything that sexualizes or endangers a child.",
  11: "Encouraging or showing self-harm; reach out with support first.", 12: "Using someone else’s work without the right to.",
  13: "Bad-faith reports or appeals meant to harass or overload.", 14: "Scraping, automation or load beyond fair use.",
  15: "Getting around a decision, such as a new account after a ban.",
};
export const ruleLabel = (rule: number) => `§${rule} ${RULES[rule] ?? "Community rules"}`;

/** What a decision can do to each kind of thing (C7: only the actions that fit). */
export function actionsFor(kind: ReportTargetKind): ModerationActionKind[] {
  if (kind === "project") return ["hide_discover", "restrict", "suspend_workspace", "remove_workspace", "remove_verified"];
  if (kind === "person") return ["reset_profile", "hold_handle"];
  return ["hide", "remove"];
}
/** Console words for each action (17.5, 17.7). */
export const ACTION_LABEL: Record<ModerationActionKind, string> = {
  hide: "Hide", remove: "Remove", reset_profile: "Reset profile", hold_handle: "Hold handle", remove_verified: "Remove Verified badge",
  hide_discover: "Hide from Discover", restrict: "Restrict", suspend_workspace: "Suspend", remove_workspace: "Remove", warning: "Warning",
  limit: "Limit", suspension: "Suspend account", ban: "Ban",
};
export const ACCOUNT_ACTIONS: ModerationActionKind[] = ["warning", "limit", "suspension", "ban"];
export const ADMIN_ONLY_ACTIONS: ModerationActionKind[] = ["ban", "remove_workspace"];

/** Strikes go to a person; workspace actions strike the owner only for Suspend and Remove (F4). */
export function addsStrike(action: ModerationActionKind) {
  return !["hide_discover", "restrict", "remove_verified"].includes(action);
}
export const STRIKE_DAYS = 180;

/** The ladder counts earlier active strikes only (F2). */
export function suggestedStep(activeStrikesBefore: number): { action: ModerationActionKind; days?: number } {
  if (activeStrikesBefore <= 0) return { action: "warning" };
  if (activeStrikesBefore === 1) return { action: "limit", days: 7 };
  if (activeStrikesBefore === 2) return { action: "limit", days: 30 };
  return { action: "suspension", days: 30 };
}

/** Limits are 7 or 30 days; suspensions 14, 30, or pending investigation for at most 14 days (F6). */
export const PENDING_INVESTIGATION_DAYS = 14;

/** The appeal window (T21): 30 days; bans 60; nothing for child safety. */
export function appealUntil(action: ModerationActionKind, reason: ReportReason, decidedAt: Date): Date | null {
  if (reason === "child_safety") return null;
  return new Date(decidedAt.getTime() + (action === "ban" ? 60 : 30) * 86_400_000);
}
export const APPEAL_DECIDE_HOURS = 72;
/** A restriction pauses when we're this late on its appeal (T22); never a ban. */

/** NB-4821. */
export const caseLabel = (number: number) => `NB-${number}`;
export function parseCaseLabel(value: string): number | null {
  const m = /^\s*(?:NB-?)?(\d{3,9})\s*$/i.exec(value);
  return m ? Number(m[1]) : null;
}

/** The nouns people read for each kind. */
export const KIND_NOUN: Record<ReportTargetKind, string> = {
  project: "workspace", person: "person", update: "post", update_comment: "comment", doc: "doc", task: "task", task_comment: "comment",
  file: "file", chat_message: "message", chat_channel: "channel", role: "role post", application: "application", invitation: "invitation",
  connection_request: "connection request", contribution: "contribution story",
};
