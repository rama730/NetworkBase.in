import { orgCan, type OrgRole } from "@/lib/organizations/permissions";

// Assignment rules (report §16.2–16.4, §16.11), pure so the roster, the board and the server agree.

export type SubmissionType = "none" | "file" | "link" | "text";
export type LateRule = "none" | "until" | "always";

export type AssignmentTarget =
  | { mode: "everyone" }
  | { mode: "role"; role: "member" | "admin" }
  | { mode: "people"; userIds: string[] }
  | { mode: "teams"; teams: Array<{ name: string; userIds: string[]; leadId?: string | null }>; individuals: string[] }
  | { mode: "each_child" }
  | { mode: "children"; projectIds: string[] };

/** Stored on the master. */
export type AssignmentSettings = {
  version: 1;
  submissionType: SubmissionType;
  reviewRequired: boolean;
  lateRule: LateRule;
  lateUntil?: string | null;
  target: AssignmentTarget;
  publishedAt?: string | null;
  closedAt?: string | null;
  /** Shown on a draft that Duplicate changed, until it's published (report §42.10 problem 15). */
  note?: string | null;
  /** Late after (report §45.3, decision 171): minutes past the due time before work counts as Late; 15 by default. */
  lateAfterMinutes?: number;
  /** Publish timing (report §42.5, decision 125): a draft waits as Scheduled for a date, or for its sprint to start. */
  publishAt?: string | null;
  publishOnSprintStart?: boolean;
  /** "Instructions updated 2 Nov" on each copy (report §23.3); no history. */
  instructionsUpdatedAt?: string | null;
  /** Reviewers (report §33.5): the admins who review it; none means everyone. The queue's Mine follows this. */
  reviewers?: string[];
  /** AI agents on this assignment (CLI report A8.2, D20); unset follows the organization's default. */
  aiPolicy?: AiPolicy;
  /** A line to students about AI use ("You may use AI for research, not for writing"). */
  aiNote?: string | null;
};

/**
 * What AI agents connected to NetworkBase may do on an assignment's copies (report A8.2). It applies to agents
 * connected to NetworkBase only; nothing here detects work written with other tools.
 */
export type AiPolicy = "allowed" | "labelled" | "not_allowed";
export const AI_POLICY_DEFAULT: AiPolicy = "labelled";
export const AI_POLICY_WORDS: Record<AiPolicy, string> = { allowed: "AI agents allowed", labelled: "AI agents allowed, labelled", not_allowed: "No AI agents" };

/** The assignment's own policy, else the organization's default, else Labelled. */
export function effectiveAiPolicy(settings: Pick<AssignmentSettings, "aiPolicy"> | null | undefined, orgDefault?: AiPolicy | null): AiPolicy {
  return settings?.aiPolicy ?? orgDefault ?? AI_POLICY_DEFAULT;
}

export const LATE_AFTER_DEFAULT_MINUTES = 15;
/** Late after in milliseconds; assignments saved before it existed get the default. */
export const lateAfterMs = (settings?: Pick<AssignmentSettings, "lateAfterMinutes"> | null) => (settings?.lateAfterMinutes ?? LATE_AFTER_DEFAULT_MINUTES) * 60_000;

/** Stored on a copy when it is handed in. */
export type AssignmentSubmission = {
  link?: string | null;
  text?: string | null;
  by: string;
  at: string;
  version: number;
  /** An optional note with any hand-in (decision 85). */
  note?: string | null;
  late?: boolean;
};

export type CopyState = "not_started" | "in_progress" | "submitted" | "returned" | "done" | "missing" | "excused";

type CopyInput = {
  status: string;
  reviewStatus: string;
  dueDate: Date | null;
  submittedAt: Date | null;
  completedAt: Date | null;
  excusedAt: Date | null;
};

/**
 * One copy's roster state plus the Late label; Missing is "not handed in and past due" (report §16.3). Both wait for
 * Late after past the due time (decision 171); callers without the assignment's settings get the default.
 */
// ponytail: screens that don't read the main assignment use the 15-minute default. Pass graceMs where settings are loaded.
export function copyState(copy: CopyInput, now: Date = new Date(), graceMs: number = LATE_AFTER_DEFAULT_MINUTES * 60_000): { state: CopyState; late: boolean } {
  if (copy.excusedAt) return { state: "excused", late: false };
  // Late is about when it was handed in, never when someone reviewed it (report §42.2 problem 2, §42.4).
  const handedInAt = copy.reviewStatus === "pending" || copy.status === "done" ? copy.submittedAt ?? copy.completedAt : null;
  const late = Boolean(handedInAt && copy.dueDate && handedInAt.getTime() > copy.dueDate.getTime() + graceMs);
  if (copy.reviewStatus === "pending") return { state: "submitted", late };
  if (copy.status === "done") return { state: "done", late };
  // Returned work stays Returned past its due date, so the person knows to resubmit (decision 86).
  if (copy.reviewStatus === "rejected") return { state: "returned", late: false };
  if (copy.dueDate && now.getTime() > copy.dueDate.getTime() + graceMs) return { state: "missing", late: false };
  return { state: copy.status === "todo" ? "not_started" : "in_progress", late: false };
}

/**
 * Whether a copy may still be handed in now (report §16.3: closed, or past due with late work not allowed). Its own
 * "submit until" (Fix by on Return, or reopened for one person) wins over both (decision 126, smaller bug 18).
 */
export function canStillSubmit(settings: AssignmentSettings, dueDate: Date | null, now: Date = new Date(), submitUntil?: Date | null) {
  if (submitUntil && now.getTime() <= submitUntil.getTime()) return true;
  if (settings.closedAt) return false;
  if (!dueDate || now.getTime() <= dueDate.getTime() + lateAfterMs(settings)) return true;
  if (settings.lateRule === "always") return true;
  if (settings.lateRule === "until") return Boolean(settings.lateUntil && now.getTime() <= new Date(settings.lateUntil).getTime());
  return false;
}

/**
 * Teams picker (2026-11-09): what's wrong with each team before Publish — empty, unnamed, or a name another team has.
 * The server refuses the same things; this says so on the card first.
 */
export function teamProblems(teams: Array<{ name: string; size: number }>): Array<string | null> {
  const names = teams.map((t) => t.name.trim().toLowerCase());
  return teams.map((team, i) => !team.size ? "Add someone or remove this team."
    : !names[i] ? "Give this team a name."
      : names.indexOf(names[i]!) !== i || names.lastIndexOf(names[i]!) !== i ? "Another team has this name." : null);
}

/** "3 teams · 8 people · 4 on their own" (or "· 4 not getting it"). */
export function teamsSummary(teams: number, placed: number, leftover: number, leftoverGetsOwn: boolean) {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [plural(teams, "team", "teams"), plural(placed, "person", "people"), leftover ? `${leftover} ${leftoverGetsOwn ? "on their own" : "not getting it"}` : null].filter(Boolean).join(" · ");
}

/**
 * "Auto-make teams": a random split into teams of about `size`, or into `{ teams }` teams (2026-11-09: "10 teams" as
 * well as "3 people each"), sizes within one of each other.
 */
export function splitIntoTeams<T>(people: T[], size: number | { teams: number }, random: () => number = Math.random, apart: (a: T, b: T) => boolean = () => false): T[][] {
  if (people.length === 0) return [];
  const shuffled = [...people]
    .map((person) => ({ person, key: random() }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.person);
  const count = typeof size === "number" ? Math.max(1, Math.floor(shuffled.length / Math.max(1, size))) : Math.max(1, Math.min(shuffled.length, Math.trunc(size.teams)));
  const cap = Math.ceil(shuffled.length / count);
  const teams: T[][] = Array.from({ length: count }, () => []);
  // Each person joins the smallest team, skipping one that holds someone they must stay apart from (decision 64:
  // blocked pairs, quietly). When every open team has such a person, the smallest one takes them anyway.
  for (const person of shuffled) {
    const open = teams.map((team, i) => ({ team, i })).filter(({ team }) => team.length < cap).sort((a, b) => a.team.length - b.team.length || a.i - b.i);
    const pick = open.find(({ team }) => !team.some((other) => apart(person, other))) ?? open[0]!;
    pick.team.push(person);
  }
  // Repair: swap someone caught with a blocked partner into another team when that leaves both teams clear.
  const clash = (team: T[], person: T, without?: T) => team.some((other) => other !== person && other !== without && apart(person, other));
  for (let pass = 0; pass < shuffled.length; pass += 1) {
    let swapped = false;
    for (const team of teams) {
      const stuck = team.find((person) => clash(team, person));
      if (!stuck) continue;
      for (const other of teams) {
        if (other === team) continue;
        const partner = other.find((candidate) => !clash(team, candidate, stuck) && !clash(other, stuck, candidate));
        if (partner === undefined) continue;
        team[team.indexOf(stuck)] = partner;
        other[other.indexOf(partner)] = stuck;
        swapped = true;
        break;
      }
    }
    if (!swapped) break;
  }
  return teams;
}

/**
 * Reassigning assignment work (report §42.14, decision 149): a main assignment's people are set by publishing and
 * an individual copy belongs to its person, so neither is reassigned (Give to makes new copies). A team copy moves
 * only within its team, by an organization admin or the team's lead. Null means allowed.
 */
export function reassignBlock(task: { isMaster: boolean; isCopy: boolean; hasTeam: boolean; actorIsAdmin: boolean; actorIsLead: boolean; targetOnTeam: boolean }): string | null {
  if (task.isMaster) return "An assignment’s people are set when it’s published. Use Give to for someone new.";
  if (!task.isCopy) return null;
  if (!task.hasTeam) return "Each person keeps their own copy, so it can’t be reassigned.";
  if (!task.actorIsAdmin && !task.actorIsLead) return "Only the team’s lead or an admin can reassign this.";
  if (!task.targetOnTeam) return "Pick someone on this team.";
  return null;
}

export type AssignmentWrite = "title" | "description" | "priority" | "storyPoints" | "dueDate" | "sprintId" | "status" | "done" | "delete";

/**
 * Who may change what on assignment work (report §19.3, §42.12, decisions 85, 140, 142, 147): one rule for field
 * updates, status moves, sprint moves and delete, from the board, the panel or the editor. Ordinary tasks are never
 * touched (42.18). "done" is a move to Completed, which only Submit may make. Null means allowed.
 */
export function assignmentWriteBlock(task: {
  isMaster: boolean; isCopy: boolean; handedIn: boolean; approved: boolean; groupCopy: boolean; orgTitle: string;
  /** The actor's role in the organization the work belongs to, and whether it is their own copy or team's. */
  actorRole: OrgRole; actorIsHolder: boolean;
}, write: AssignmentWrite): string | null {
  const actorIsOrgAdmin = orgCan(task.actorRole, "edit_group_task_details");
  if (task.isMaster) {
    if (!orgCan(task.actorRole, "edit_for_everyone")) return `Only ${task.orgTitle}’s admins change an assignment.`;
    if (write === "status" || write === "done") return "An assignment’s state comes from its copies.";
    // Review UX 1.8: these change only the main task through the field path; Edit for everyone changes every copy.
    if (write === "title" || write === "description" || write === "priority" || write === "dueDate" || write === "storyPoints") return "Use Edit for everyone, so every copy changes.";
    if (write === "delete" && task.handedIn) return "Someone has handed this in, so it can’t be deleted. Close it instead.";
    return null;
  }
  if (!task.isCopy) return null;
  // Decisions 33 and 109: someone else's copy is never theirs to change (update_own_copy is "own" for members).
  if (!actorIsOrgAdmin && !task.groupCopy && !orgCan(task.actorRole, "update_own_copy", task.actorIsHolder)) return "You can change only your own work.";
  switch (write) {
    case "title":
    case "description":
      return `Set by ${task.orgTitle}`;
    case "dueDate":
      return `Set by ${task.orgTitle}. Ask for an extension.`;
    case "done":
      return "Use Submit to hand this in.";
    case "status":
      return task.approved ? "This was approved, so it’s locked." : null;
    case "delete":
      if (!actorIsOrgAdmin) return `Only ${task.orgTitle}’s admins can remove this.`;
      return task.handedIn ? "This was handed in, so it stays." : null;
    case "sprintId":
      return task.groupCopy ? null : "This moves with its assignment.";
    default:
      return null;
  }
}

/**
 * Every assignment link (decision 133, report §42.10 problem 11): Tasks, with the copy's panel open in the workspace
 * the copy lives in, or the In review filter for the queue. `?tab=assignments` links redirect here.
 */
export function assignmentHref(workspacePath: string, copyId?: string | null, review = false) {
  if (copyId) return `${workspacePath}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(copyId)}`;
  return `${workspacePath}?tab=tasks${review ? "&taskScope=review" : ""}`;
}

/** Old "Allowed until a date" assignments saved with no date accept nothing late, so they say so (problem 13). */
export function lateWorkLabel(settings: { lateRule: LateRule; lateUntil?: string | null }): string | null {
  return settings.lateRule === "until" && !settings.lateUntil ? "Late work closed" : null;
}

/** "Allowed until a date" needs that date, after the due date (report §42.10 problem 13, §42.12 smaller bug 16). */
export function lateRuleBlock(settings: { lateRule: LateRule; lateUntil?: string | null }, dueDate: Date | null): string | null {
  if (settings.lateRule !== "until") return null;
  if (!settings.lateUntil) return "Pick the last day late work is accepted.";
  if (dueDate && new Date(settings.lateUntil).getTime() <= dueDate.getTime()) return "Late work must be accepted until after the due date.";
  return null;
}

/**
 * Duplicate for a new term (report §42.10 problem 15): last term's people, teams and chosen workspaces mean nothing
 * here, so those drafts go to everyone, or to each workspace, with a note to check before publishing.
 */
export function resetDuplicatedTarget(target: AssignmentTarget): { target: AssignmentTarget; note: string | null } {
  if (target.mode === "people" || target.mode === "teams") return { target: { mode: "everyone" }, note: "Copied from last term: it now goes to everyone. Check who gets it before publishing." };
  if (target.mode === "children") return { target: { mode: "each_child" }, note: "Copied from last term: it now goes to each workspace. Check who gets it before publishing." };
  return { target, note: null };
}

/** A handed-in link is only ever a web address; anything else (javascript:, data:) is never shown as a link. */
export function webLink(link: string | null | undefined): string | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export const REPEAT_WEEKS_MAX = 26;

/**
 * Repeat weekly until (report §33.5, "Later"): the later weeks' titles and due dates. A title ending in a number counts
 * on from it ("Lab 1" → "Lab 2"); otherwise the week is added ("Reading · week 2"). The first week is the one created.
 */
export function weeklyRepeats(title: string, firstDue: Date, until: Date): Array<{ title: string; dueDate: Date }> {
  const match = title.match(/^(.*?)(\d+)$/);
  const out: Array<{ title: string; dueDate: Date }> = [];
  for (let week = 1; week <= REPEAT_WEEKS_MAX; week += 1) {
    const dueDate = new Date(firstDue.getTime() + week * 7 * 86_400_000);
    if (dueDate.getTime() > until.getTime()) break;
    out.push({ title: (match ? `${match[1]}${Number(match[2]) + week}` : `${title} · week ${week + 1}`).slice(0, 200), dueDate });
  }
  return out;
}

/** Student check 18, 22: what Delete takes with it, and how many had started (started counts work in progress). */
export function deleteAssignmentWarning(counts: { total: number; in_progress: number; returned: number; missing: number }): string | null {
  if (counts.total === 0) return null;
  const copies = counts.total === 1 ? "1 copy goes with it, with its class questions and comments." : `${counts.total} copies go with it, with their class questions and comments.`;
  const started = counts.in_progress + counts.returned;
  return started ? `${copies} ${started} ${started === 1 ? "person has" : "people have"} started.` : copies;
}

/** Live loop 33: Return's default Fix by is the end of the day three days on, never the minute of the click. */
export function defaultFixBy(now: Date = new Date()) {
  const at = new Date(now);
  at.setDate(at.getDate() + 3);
  at.setHours(23, 59, 0, 0);
  return at;
}

/** Mockup task 1: the assignment panel's four tiles; Not in is everyone still to hand in, returned work included. */
export function rosterTiles(counts: Record<CopyState, number> & { total: number }) {
  return { done: counts.done, submitted: counts.submitted, notIn: counts.not_started + counts.in_progress + counts.returned + counts.missing, excused: counts.excused };
}

/** Mockup task 3: the Hand in section's chip, in the board's status tones. */
export function handInChip(state: CopyState, approved: boolean): { label: string; tone: "info" | "warn" | "ok" | "danger" | "muted" } {
  switch (state) {
    case "in_progress": return { label: "In progress", tone: "info" };
    case "submitted": return { label: "In review", tone: "warn" };
    case "done": return approved ? { label: "Approved", tone: "ok" } : { label: "Done", tone: "ok" };
    case "returned": return { label: "Returned", tone: "danger" };
    case "missing": return { label: "Missing", tone: "danger" };
    case "excused": return { label: "Excused", tone: "muted" };
    default: return { label: "Not started", tone: "muted" };
  }
}

/** Review UX 1.7: a main assignment's chip is its own life, never a task status derived from the copies. */
export function masterChip(s: { publishedAt: string | null; publishAt?: string | null; closedAt: string | null }): { label: string; tone: "info" | "warn" | "muted" } {
  if (s.closedAt) return { label: "Closed", tone: "muted" };
  if (s.publishedAt) return { label: "Open", tone: "info" };
  return s.publishAt ? { label: "Scheduled", tone: "info" } : { label: "Draft", tone: "warn" };
}

/** Review UX 1.9–1.11: what a main assignment's own tabs hold, said once at the top of each. */
export const MASTER_TAB_NOTES = {
  comments: "The brief and questions everyone with this assignment sees.",
  files: "Materials. Students open these read-only from their own copy.",
  subtasks: "Steps. A step added here goes to every copy.",
} as const;

/** The fields of a roster row the Assignment tab's grouping, search and sort read (review UX 1.2, 1.4, 1.14). */
type RosterLike = { label: string; state: CopyState; late: boolean; approved?: boolean; submittedAt: string | null; remindedAt: string | null; members: string[]; people?: Array<{ name: string }> };

const SECTIONS: Array<{ key: string; title: string; match: (r: RosterLike) => boolean }> = [
  { key: "submitted", title: "Waiting for review", match: (r) => r.state === "submitted" },
  { key: "returned", title: "Returned", match: (r) => r.state === "returned" },
  { key: "in_progress", title: "In progress", match: (r) => r.state === "in_progress" },
  { key: "not_started", title: "Not started", match: (r) => r.state === "not_started" },
  { key: "missing", title: "Missing", match: (r) => r.state === "missing" },
  { key: "approved", title: "Approved", match: (r) => r.state === "done" && Boolean(r.approved) },
  { key: "done", title: "Done", match: (r) => r.state === "done" && !r.approved },
  { key: "excused", title: "Excused", match: (r) => r.state === "excused" },
];

/** Review UX 1.2: everyone in one list, in sections by state, each sorted by name, or oldest hand-in first. */
export function rosterSections<T extends RosterLike>(rows: T[], sort: "name" | "handedIn") {
  const by = sort === "handedIn"
    ? (a: T, b: T) => (a.submittedAt ?? "9").localeCompare(b.submittedAt ?? "9") || a.label.localeCompare(b.label)
    : (a: T, b: T) => a.label.localeCompare(b.label);
  return SECTIONS.map((s) => ({ key: s.key, title: s.title, rows: rows.filter(s.match).sort(by) })).filter((s) => s.rows.length > 0);
}

/** Review UX 1.4: search by a person's or a team member's name, and Late only. */
export function filterRoster<T extends RosterLike>(rows: T[], f: { query: string; lateOnly: boolean }) {
  const q = f.query.trim().toLowerCase();
  return rows.filter((r) => (!f.lateOnly || r.late) && (!q || [r.label, ...r.members, ...(r.people ?? []).map((p) => p.name)].some((n) => n.toLowerCase().includes(q))));
}

/** Review UX 1.14: how many Remind will skip, reminded inside the 12-hour window (decision 60). */
export function remindSkips(rows: RosterLike[], now = Date.now(), windowMs = 12 * 3_600_000) {
  return rows.filter((r) => !["done", "excused", "submitted"].includes(r.state) && r.remindedAt && now - Date.parse(r.remindedAt) < windowMs).length;
}

type HandInLike = {
  submissionType: string; state: CopyState; approved: boolean; canSubmit: boolean; closed: boolean; late: boolean; excusedReason: string | null;
  returned: { by: string | null; reason: string | null } | null; from: string; lateLabel: string | null; latest: { version: number } | null;
};
const NEXT_STEP: Record<string, string> = { file: "Add your file below, then hand it in.", link: "Paste the link below, then hand it in.", text: "Write your answer below, then hand it in.", none: "Mark it as done when you’ve finished." };

/** Review UX 2.4, 2.13: the Hand in card's one state box — what happened, and what to do next. `message` puts Message in it. */
export function handInBox(h: HandInLike): { tone: "info" | "ok" | "danger" | "muted"; title: string; lines: string[]; next: string | null; message: boolean } {
  if (h.excusedReason || h.state === "excused") return { tone: "muted", title: "You’re excused", lines: h.excusedReason ? [h.excusedReason] : [], next: "Nothing to hand in.", message: true };
  if (h.returned) return { tone: "danger", title: `${h.returned.by ?? h.from} returned this`, lines: h.returned.reason ? [h.returned.reason] : [], next: "Make the changes, then hand it in again.", message: false };
  const version = h.latest ? `Version ${h.latest.version}` : null;
  if (h.approved) return { tone: "ok", title: "Approved", lines: [version].filter(Boolean) as string[], next: "It’s locked now.", message: false };
  if (h.state === "submitted") return { tone: "ok", title: "Handed in", lines: [[version ?? "Version 1", h.late ? "Late" : null, "Waiting for review"].filter(Boolean).join(" · ")],
    next: h.submissionType === "file" ? "It’s locked while it waits. Message them to change it." : "You can update it until it’s reviewed.", message: h.submissionType === "file" };
  if (h.state === "done") return { tone: "ok", title: "Done", lines: [[version, h.late ? "Late" : null].filter(Boolean).join(" · ")].filter(Boolean), next: null, message: false };
  if (h.closed && !h.canSubmit) return { tone: "muted", title: "This assignment is closed", lines: [], next: "Message them if you need more time.", message: true };
  if (h.state === "missing") return h.canSubmit
    ? { tone: "danger", title: "Overdue", lines: h.lateLabel ? [h.lateLabel] : [], next: "Hand it in now. It will be marked Late.", message: false }
    : { tone: "danger", title: "The due date has passed", lines: [], next: `Ask ${h.from} if you need more time.`, message: true };
  return { tone: "info", title: "Not handed in yet", lines: [], next: NEXT_STEP[h.submissionType] ?? null, message: false };
}

/** Review UX 2.6, 5.1: Hand in / Hand in again / Update hand-in (links and text) / Mark as done; no replacing a waiting file. */
export function handInButton(h: Pick<HandInLike, "submissionType" | "state" | "canSubmit">): { show: boolean; label: string } {
  if (h.submissionType === "none") return { show: h.canSubmit && h.state !== "done", label: "Mark as done" };
  const handedIn = h.state === "submitted" || h.state === "done";
  if (handedIn && h.submissionType !== "file") return { show: h.canSubmit, label: "Update hand-in" };
  if (handedIn || h.state === "returned") return { show: h.canSubmit && h.state !== "submitted", label: "Hand in again" };
  return { show: h.canSubmit, label: "Hand in" };
}

/** Review UX 2.5, 2.14: why Hand in is off, in words; null when it's ready. */
export function handInBlocked(f: { submissionType: string; files?: number; link?: string; text?: string }): string | null {
  if (f.submissionType === "file") return f.files ? null : "Add a file to hand it in.";
  if (f.submissionType === "link") return !f.link?.trim() ? "Add a link to hand it in." : webLink(f.link.trim()) ? null : "That isn’t a web link. Start it with https://";
  if (f.submissionType === "text") return f.text?.trim() ? null : "Write your answer to hand it in.";
  return null;
}

/** Review UX 3.7: Fix by is the later of the due date and three days on, so a return never shortens the time left. */
export function reviewFixBy(dueIso: string | null, now: Date = new Date()) {
  const three = defaultFixBy(now);
  const due = dueIso ? new Date(dueIso) : null;
  return due && due.getTime() > three.getTime() ? due : three;
}

/** Review UX 3.8: the queue searched by name (a team's hand-in person too) and sorted oldest, newest or late first. */
export function queueOrder<T extends { who: string; submittedBy: string | null; title: string; submittedAt: string; late: boolean }>(rows: T[], sort: "oldest" | "newest" | "late", query: string) {
  const q = query.trim().toLowerCase();
  const at = (r: T) => Date.parse(r.submittedAt);
  return rows.filter((r) => !q || [r.who, r.submittedBy ?? "", r.title].some((s) => s.toLowerCase().includes(q)))
    .sort((a, b) => (sort === "late" && a.late !== b.late ? (a.late ? -1 : 1) : sort === "newest" ? at(b) - at(a) : at(a) - at(b)));
}
