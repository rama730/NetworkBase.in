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
