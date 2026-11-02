// Org Members rules (report §20), pure so the roster, the bulk actions and the server agree.

import type { CopyState } from "@/lib/organizations/assignment-rules";

export type OrgMemberRole = "owner" | "admin" | "member" | "viewer";

/** "8 of 10 done · 1 missing" from a person's assignment copies; excused ones don't count. */
export function workSummary(states: CopyState[]) {
  const counted = states.filter((s) => s !== "excused");
  return { done: counted.filter((s) => s === "done").length, total: counted.length, missing: counted.filter((s) => s === "missing").length };
}

const INACTIVE_DAYS = 14;
// ponytail: the day Last active here (0043) went live, so nobody already in an org looks inactive on day one
// (report §41.4). Set it to the real deploy date when 1a ships; it stops mattering 14 days after that.
export const LAST_ACTIVE_HERE_SINCE = new Date("2026-11-03T00:00:00Z");

/**
 * Behind = anything missing; Inactive = not active here for 14 days, counted from joining at the earliest
 * (report §20.2, §28.7, decision 60).
 */
export function memberStatus(input: { missing: number; lastActiveAt: Date | null; joinedAt?: Date | null; now?: Date }) {
  const now = input.now ?? new Date();
  const since = Math.max(input.lastActiveAt?.getTime() ?? 0, input.joinedAt?.getTime() ?? 0, LAST_ACTIVE_HERE_SINCE.getTime());
  return {
    behind: input.missing > 0,
    inactive: now.getTime() - since > INACTIVE_DAYS * 86_400_000,
  };
}

/**
 * Who may change whom (report §20.4): nobody touches the owner (Transfer ownership does that); only the owner
 * promotes to admin, demotes or removes an admin; admins manage members and guests. `next` is the new role,
 * or null for removal.
 */
export function memberChangeBlock(actor: OrgMemberRole, target: OrgMemberRole, next: Exclude<OrgMemberRole, "owner"> | null): string | null {
  if (target === "owner") return "The owner changes only through Transfer ownership.";
  if (actor === "owner") return null;
  if (actor !== "admin") return "Only owners and admins manage members.";
  if (target === "admin" || next === "admin") return "Only the owner manages admins.";
  return null;
}

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** Pasted emails, comma or newline separated: normalized and de-duplicated, invalid ones reported (§20.5). */
export function parseInviteEmails(text: string) {
  const parts = text.split(/[\s,;]+/).map((p) => p.trim().replace(/^<|>$/g, "").toLowerCase()).filter(Boolean);
  const valid = [...new Set(parts.filter((p) => EMAIL.test(p)))];
  const invalid = [...new Set(parts.filter((p) => !EMAIL.test(p)))];
  return { valid, invalid };
}

export type RosterRow = {
  userId: string;
  name: string;
  role: OrgMemberRole;
  title: string | null;
  projects: Array<{ id: string; title: string; unit: string | null }>;
  work: { done: number; total: number; missing: number };
  lastActiveAt: string | null;
  joinedAt: string | null;
  behind: boolean;
  inactive: boolean;
};

export type RosterFilter = {
  q?: string;
  role?: "all" | "admins" | "members" | "guests";
  project?: "all" | "none" | string;
  status?: "all" | "behind" | "inactive";
  sort?: "name" | "joined" | "active" | "behind";
};

/** Search, Role, Project (or Not in a project), Status and Sort over the roster (§20.2). */
export function filterRoster(rows: RosterRow[], f: RosterFilter): RosterRow[] {
  const q = f.q?.trim().toLowerCase() ?? "";
  const kept = rows.filter((r) =>
    (!q || r.name.toLowerCase().includes(q) || (r.title ?? "").toLowerCase().includes(q))
    && (!f.role || f.role === "all" || (f.role === "admins" ? r.role === "owner" || r.role === "admin" : f.role === "members" ? r.role === "member" : r.role === "viewer"))
    && (!f.project || f.project === "all" || (f.project === "none" ? r.projects.length === 0 : r.projects.some((p) => p.id === f.project)))
    && (!f.status || f.status === "all" || (f.status === "behind" ? r.behind : r.inactive)));
  const byName = (a: RosterRow, b: RosterRow) => a.name.localeCompare(b.name);
  const sort = f.sort ?? "name";
  return [...kept].sort((a, b) =>
    sort === "joined" ? (b.joinedAt ?? "").localeCompare(a.joinedAt ?? "") || byName(a, b)
      : sort === "active" ? (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? "") || byName(a, b)
        : sort === "behind" ? b.work.missing - a.work.missing || byName(a, b)
          : byName(a, b));
}
