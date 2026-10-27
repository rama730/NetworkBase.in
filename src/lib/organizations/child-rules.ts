// Child project rules (report §14.2, §14.3, §21.7), pure so the wizard and the server agree.

export type ChildVisibility = "public" | "org" | "private";
export type VisibilityCap = ChildVisibility;
type OrgMemberRoleOrNone = "owner" | "admin" | "member" | "viewer" | null;

const RANK: Record<ChildVisibility, number> = { private: 0, org: 1, public: 2 };

/** Why this person can't create a project in the org, or null when they can. */
export function childCreationBlock(role: OrgMemberRoleOrNone, childCreation: "members" | "admins", orgOpen: boolean): string | null {
  if (!role) return "You're not a member of this organization.";
  if (!orgOpen) return "This organization is archived.";
  if (role === "viewer") return "Guests can't create projects.";
  if (role === "member" && childCreation === "admins") return "Only admins create projects here.";
  return null;
}

/** The effective cap: the org's setting, and never Public under a private org. */
function effectiveCap(cap: VisibilityCap, orgPublic: boolean): ChildVisibility {
  return !orgPublic && cap === "public" ? "org" : cap;
}

/** The requested visibility, lowered to the cap when above it. */
export function capChildVisibility(requested: ChildVisibility, cap: VisibilityCap, orgPublic: boolean): ChildVisibility {
  const limit = effectiveCap(cap, orgPublic);
  return RANK[requested] > RANK[limit] ? limit : requested;
}

/** Choices to offer, highest first; the others show as locked "Set by <org>" rows. */
export function allowedChildVisibilities(cap: VisibilityCap, orgPublic: boolean): ChildVisibility[] {
  const limit = RANK[effectiveCap(cap, orgPublic)];
  return (["public", "org", "private"] as const).filter((v) => RANK[v] <= limit);
}

export function isAboveCap(visibility: string | null, cap: VisibilityCap, orgPublic: boolean) {
  const v = (visibility === "unlisted" ? "public" : visibility) as ChildVisibility;
  return v in RANK && RANK[v] > RANK[effectiveCap(cap, orgPublic)];
}
