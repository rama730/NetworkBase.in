/** Organizations ship behind this flag until P16 removes it (server-only; read per request). */
export function organizationsEnabled() {
  return process.env.ORGANIZATIONS_ENABLED === "true";
}

/**
 * Every organization limit (docs/organization-concept-report.md §30.4), in one place.
 * ponytail: fixed v1 values; raise a value here when real orgs hit it (support asks first).
 */
export const ORG_LIMITS = {
  orgsOwnedPerUser: 5,
  orgsJoinedPerUser: 50,
  childProjectsPerOrg: 200,
  membersPerOrg: 2_000, // Max members can only lower this
  adminsPerOrg: 20,
  unitsPerChildProject: 20,
  membersPerUnit: 100,
  teamsPerAssignment: 500,
  copiesCreatedInline: 2_000, // above this, a background job creates the copies
  pinnedPosts: 3,
  emailAnnouncementsPerOrgPerDay: 5,
  docsPerOrg: 500,
  docGroupsPerOrg: 20,
  sprintsPerSeries: 52,
  orgStorageBytes: 5 * 1024 ** 3,
  orgStorageWarnRatio: 0.8,
  orgChatChannels: 200,
  joinCodeAttemptsPerMinutePerAccount: 5,
  joinCodeAttemptsPerMinutePerIp: 20,
  emailInvitesPerPaste: 200,
  emailInvitesPerOrgPerDay: 1_000,
  remindSamePersonHours: 12,
  downloadAllZipBytes: 2 * 1024 ** 3,
  handleRenameDays: 7,
  handleHoldDays: 90,
} as const;

export const ORG_TYPES = ["education", "company", "community", "research", "club"] as const;
export type OrgType = (typeof ORG_TYPES)[number];

/** Default role names by org type (report §5, §21.5): owner / admin / member / viewer (Guest). Editable in Settings. */
export function defaultOrgRoleNames(type: OrgType) {
  if (type === "education") return { owner: "Teacher", admin: "TA", member: "Student", viewer: "Guest" };
  if (type === "company") return { owner: "Owner", admin: "Manager", member: "Member", viewer: "Guest" };
  return { owner: "Owner", admin: "Admin", member: "Member", viewer: "Guest" };
}
