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
  /** Hand-ins and their versions, per person, outside the organization's 5 GB (decision 157, report §42.16). */
  handInBytesPerPerson: 50 * 1024 ** 2,
  orgStorageWarnRatio: 0.8,
  orgChatChannels: 200,
  joinCodeAttemptsPerMinutePerAccount: 5,
  joinCodeAttemptsPerMinutePerIp: 20,
  emailInvitesPerPaste: 500,
  emailInvitesPerOrgPerDay: 1_000,
  remindSamePersonHours: 12,
  downloadAllZipBytes: 2 * 1024 ** 3,
  handleRenameDays: 7,
  handleHoldDays: 90,
} as const;

export const ORG_TYPES = ["education", "company", "community", "research", "club", "other"] as const;
export type OrgType = (typeof ORG_TYPES)[number];

/** Default role names by org type (report §5, §21.5, §34.2): owner / admin / member / viewer. Editable in Settings; shown beside the base level (terminology report §4.3). */
export function defaultOrgRoleNames(type: OrgType) {
  if (type === "education") return { owner: "Teacher", admin: "TA", member: "Student", viewer: "Viewer" };
  if (type === "company") return { owner: "Owner", admin: "Manager", member: "Member", viewer: "Viewer" };
  if (type === "research") return { owner: "PI", admin: "Researcher", member: "Member", viewer: "Viewer" };
  if (type === "club") return { owner: "President", admin: "Coordinator", member: "Member", viewer: "Viewer" };
  return { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer" };
}

/** The organization's role names: its type's defaults, overridden by its own (blank names fall back). */
export function orgRoleNames(type: string | null | undefined, orgSettings: unknown) {
  const custom = (orgSettings as { roleNames?: Partial<Record<"owner" | "admin" | "member" | "viewer", unknown>> } | null | undefined)?.roleNames ?? {};
  const names = defaultOrgRoleNames(ORG_TYPES.includes(type as OrgType) ? (type as OrgType) : "community");
  for (const key of Object.keys(names) as Array<keyof typeof names>) {
    const value = custom[key];
    if (typeof value === "string" && value.trim()) names[key] = value.trim();
  }
  return names;
}

const TYPE_NAMES: Record<OrgType, string> = { education: "Education", company: "Company", community: "Community", research: "Research", club: "Club", other: "Other" };

/** The type as people read it; "Other" shows the creator's own label ("Nonprofit"), report §34.2. */
export function orgTypeLabel(type: string | null | undefined, orgSettings?: unknown) {
  if (!type) return null;
  const custom = (orgSettings as { typeLabel?: unknown } | null | undefined)?.typeLabel;
  if (type === "other" && typeof custom === "string" && custom.trim()) return custom.trim();
  return TYPE_NAMES[type as OrgType] ?? null;
}
