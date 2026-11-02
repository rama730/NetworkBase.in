import { ORG_LIMITS } from "@/lib/organizations/config";

// Limits with a plain message (report §21.4, decision 34): checked before anything starts, so nothing is left half
// done. Admins are told to contact support; members to ask an admin. Pure, so screens and the server agree.

const LIMITS = {
  workspaces: { max: ORG_LIMITS.childProjectsPerOrg, noun: "workspaces" },
  admins: { max: ORG_LIMITS.adminsPerOrg, noun: "admins" },
  teams: { max: ORG_LIMITS.unitsPerChildProject, noun: "teams" },
  documents: { max: ORG_LIMITS.docsPerOrg, noun: "documents" },
} as const;

export type OrgLimit = keyof typeof LIMITS | "teamsPerAssignment";

/** Null while there's room; otherwise what to tell the person. `count` is what exists now (or what's asked for). */
export function orgLimitBlock(limit: OrgLimit, count: number, who: { org: string; isAdmin: boolean }): string | null {
  if (limit === "teamsPerAssignment") return count > ORG_LIMITS.teamsPerAssignment ? `An assignment can go to up to ${ORG_LIMITS.teamsPerAssignment} teams.` : null;
  const { max, noun } = LIMITS[limit];
  if (count < max) return null;
  return `${who.org} has reached ${max} ${noun}. ${who.isAdmin ? "Contact support to raise this." : "Ask an admin."}`;
}

/** "412 left today" (report §21.4): email invites an organization can still send today. */
export function invitesLeftToday(sentToday: number) {
  return Math.max(0, ORG_LIMITS.emailInvitesPerOrgPerDay - sentToday);
}

/**
 * The storage a project may hold (report §19.2, §42.16): an organization 5 GB, a workspace inside one 2 GB, anything
 * else its stored limit. Hand-ins never meet the organization's 5 GB; they have their own allowance per person.
 */
export function projectStorageLimit(project: { kind: string | null; parentId: string | null } | null | undefined, storedLimit: number, handIn = false) {
  if (project?.kind === "organization") return handIn ? storedLimit : Math.min(storedLimit, ORG_LIMITS.orgStorageBytes);
  if (project?.parentId) return Math.min(storedLimit, ORG_LIMITS.teamStorageBytes);
  return storedLimit;
}

/** What a full upload says (report §7.8, §19.2): who can make room, and where. */
export function storageFullMessage(project: { kind: string | null; parentId: string | null } | null | undefined, isAdmin: boolean) {
  if (project?.kind === "organization") return isAdmin ? "The organization’s storage is full. Free up space in Settings → Storage." : "Storage is full. Ask an admin.";
  if (project?.parentId) return "Team storage is full. Remove files to make room.";
  return null;
}
