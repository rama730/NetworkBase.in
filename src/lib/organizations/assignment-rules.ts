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
};

/** Stored on a copy when it is handed in. */
export type AssignmentSubmission = {
  link?: string | null;
  text?: string | null;
  by: string;
  at: string;
  version: number;
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

/** One copy's roster state plus the Late label; Missing is "not handed in and past due" (report §16.3). */
export function copyState(copy: CopyInput, now: Date = new Date()): { state: CopyState; late: boolean } {
  if (copy.excusedAt) return { state: "excused", late: false };
  // Late is about when it was handed in, never when someone reviewed it (report §42.2 problem 2, §42.4).
  const handedInAt = copy.reviewStatus === "pending" || copy.status === "done" ? copy.submittedAt ?? copy.completedAt : null;
  const late = Boolean(handedInAt && copy.dueDate && handedInAt.getTime() > copy.dueDate.getTime());
  if (copy.reviewStatus === "pending") return { state: "submitted", late };
  if (copy.status === "done") return { state: "done", late };
  // Returned work stays Returned past its due date, so the person knows to resubmit (decision 86).
  if (copy.reviewStatus === "rejected") return { state: "returned", late: false };
  if (copy.dueDate && now.getTime() > copy.dueDate.getTime()) return { state: "missing", late: false };
  return { state: copy.status === "todo" ? "not_started" : "in_progress", late: false };
}

/** Whether a copy may still be handed in now (report §16.3: closed, or past due with late work not allowed). */
export function canStillSubmit(settings: AssignmentSettings, dueDate: Date | null, now: Date = new Date()) {
  if (settings.closedAt) return false;
  if (!dueDate || now.getTime() <= dueDate.getTime()) return true;
  if (settings.lateRule === "always") return true;
  if (settings.lateRule === "until") return Boolean(settings.lateUntil && now.getTime() <= new Date(settings.lateUntil).getTime());
  return false;
}

/** "Auto-make teams": a random split into teams of about `size`, sizes within one of each other. */
export function splitIntoTeams<T>(people: T[], size: number, random: () => number = Math.random): T[][] {
  if (people.length === 0) return [];
  const shuffled = [...people]
    .map((person) => ({ person, key: random() }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.person);
  const count = Math.max(1, Math.floor(shuffled.length / Math.max(1, size)));
  const teams: T[][] = Array.from({ length: count }, () => []);
  shuffled.forEach((person, index) => teams[index % count]!.push(person));
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
  isMaster: boolean; isCopy: boolean; handedIn: boolean; approved: boolean; groupCopy: boolean; orgTitle: string; actorIsOrgAdmin: boolean;
}, write: AssignmentWrite): string | null {
  if (task.isMaster) {
    if (!task.actorIsOrgAdmin) return `Only ${task.orgTitle}’s admins change an assignment.`;
    if (write === "status" || write === "done") return "An assignment’s state comes from its copies.";
    if (write === "delete" && task.handedIn) return "Someone has handed this in, so it can’t be deleted. Close it instead.";
    return null;
  }
  if (!task.isCopy) return null;
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
      if (!task.actorIsOrgAdmin) return `Only ${task.orgTitle}’s admins can remove this.`;
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

/** "Allowed until a date" needs that date, after the due date (report §42.10 problem 13, §42.12 smaller bug 16). */
export function lateRuleBlock(settings: { lateRule: LateRule; lateUntil?: string | null }, dueDate: Date | null): string | null {
  if (settings.lateRule !== "until") return null;
  if (!settings.lateUntil) return "Pick the last day late work is accepted.";
  if (dueDate && new Date(settings.lateUntil).getTime() <= dueDate.getTime()) return "Late work must be accepted until after the due date.";
  return null;
}
