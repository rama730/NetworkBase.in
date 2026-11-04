import type { OrgType } from "@/lib/organizations/config";

// One type profile (report §21.2, decision 32): a type sets words and starting values, never power. Every check
// that used to ask "is it Education?" reads this instead. Client-safe and pure.

export type OrgTypeProfile = {
  roleNames: { owner: string; admin: string; member: string; viewer: string };
  /** C3: what finished work is called. */
  finishedWork: "Submissions" | "Final files";
  termDates: boolean;
  sprintPrefix: "CO" | "Sprint ";
  /** Board/review report §6, D1: the word for a main sprint ("CO" in Education, "Phase" elsewhere). */
  mainSprintWord: "CO" | "Phase";
  joinMode: "instant" | "approval";
  visibility: "public" | "private";
  /** Members can post discussions and create channels. */
  membersPost: boolean;
  generalNotify: "mentions" | "all";
  reviewRequired: boolean;
  lateRule: "until" | "always";
  storyPoints: "hidden" | "shown";
  /** The last one is Admins only. */
  starterFolders: [string, string, string, string];
  /** Paid roles make no sense in a class. */
  showCompensation: boolean;
  planLabel: "Plan your term" | "Plan your sprints";
};

const WORK: Omit<OrgTypeProfile, "roleNames" | "joinMode" | "visibility" | "starterFolders"> = {
  finishedWork: "Final files", termDates: false, sprintPrefix: "Sprint ", mainSprintWord: "Phase", membersPost: true, generalNotify: "all",
  reviewRequired: false, lateRule: "always", storyPoints: "shown", showCompensation: true, planLabel: "Plan your sprints",
};
const ADMINS: OrgTypeProfile["starterFolders"] = ["Shared", "Docs", "Templates", "Admins"];

export const ORG_TYPE_PROFILES: Record<OrgType, OrgTypeProfile> = {
  education: {
    roleNames: { owner: "Teacher", admin: "TA", member: "Student", viewer: "Viewer" },
    finishedWork: "Submissions", termDates: true, sprintPrefix: "CO", mainSprintWord: "CO", joinMode: "instant", visibility: "private", membersPost: false,
    generalNotify: "mentions", reviewRequired: true, lateRule: "until", storyPoints: "hidden",
    starterFolders: ["Course materials", "Docs", "Templates", "Staff"], showCompensation: false, planLabel: "Plan your term",
  },
  company: { ...WORK, roleNames: { owner: "Owner", admin: "Manager", member: "Member", viewer: "Viewer" }, joinMode: "approval", visibility: "private", starterFolders: ["Shared", "Docs", "Templates", "Managers"] },
  research: { ...WORK, roleNames: { owner: "PI", admin: "Researcher", member: "Member", viewer: "Viewer" }, joinMode: "approval", visibility: "private", starterFolders: ADMINS },
  community: { ...WORK, roleNames: { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer" }, joinMode: "instant", visibility: "public", starterFolders: ADMINS },
  club: { ...WORK, roleNames: { owner: "President", admin: "Coordinator", member: "Member", viewer: "Viewer" }, joinMode: "instant", visibility: "public", starterFolders: ADMINS },
  other: { ...WORK, roleNames: { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer" }, joinMode: "approval", visibility: "private", starterFolders: ADMINS },
};

/** The profile for a stored type; a missing or unknown type reads as Community. */
export function typeProfile(type: string | null | undefined): OrgTypeProfile {
  return ORG_TYPE_PROFILES[type as OrgType] ?? ORG_TYPE_PROFILES.community;
}

/**
 * Report §21.2: settings are saved when an organization is made, so they stop following its type. These are the
 * org_settings keys the type sets; migration 0048 fills the same keys for organizations made before.
 */
export function savedTypeSettings(type: string | null | undefined) {
  const p = typeProfile(type);
  return {
    assignmentReview: p.reviewRequired,
    assignmentLateRule: p.lateRule,
    storyPoints: p.storyPoints,
    membersCreateChannels: p.membersPost,
    generalNotify: p.generalNotify,
  };
}

/** Role names worth saving: only the ones that differ from the type's, so a later type change still renames the rest. */
export function customRoleNames(type: string | null | undefined, names: Partial<OrgTypeProfile["roleNames"]> | null | undefined) {
  const defaults = typeProfile(type).roleNames;
  return Object.fromEntries(Object.entries(names ?? {}).filter(([key, value]) => typeof value === "string" && value.trim() && value.trim() !== defaults[key as keyof typeof defaults]));
}
