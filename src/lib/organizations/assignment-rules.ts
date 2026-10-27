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
  const handedInAt = copy.reviewStatus === "pending" ? copy.submittedAt : copy.status === "done" ? copy.completedAt ?? copy.submittedAt : null;
  const late = Boolean(handedInAt && copy.dueDate && handedInAt.getTime() > copy.dueDate.getTime());
  if (copy.reviewStatus === "pending") return { state: "submitted", late };
  if (copy.status === "done") return { state: "done", late };
  if (copy.dueDate && now.getTime() > copy.dueDate.getTime()) return { state: "missing", late: false };
  if (copy.reviewStatus === "rejected") return { state: "returned", late: false };
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
