import "server-only";

import { memberPreviewOrgId } from "@/lib/organizations/member-preview";
import { and, isNotNull, count, eq, gt, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { orgHandleHolds, profiles, workspaceMembers, workspaces, roleApplications } from "@/lib/db/schema";
import { orgRoleNames, orgTypeLabel, type OrgType } from "@/lib/organizations/config";
import { orgLimitBlock } from "@/lib/organizations/limits";
import { childCreationBlock, type VisibilityCap } from "@/lib/organizations/child-rules";
import { readOrgRules, readOrgWork, type OrgWork } from "@/lib/organizations/settings";
import { isWorkspacePubliclyReadableVisibility } from "@/lib/workspaces/workspace-visibility";
import { linkUrls } from "@/lib/organizations/trust-rules";

type OrgSettingsRecord = {
  joinMode?: string;
  childCreation?: string;
  outsidePeople?: boolean;
  childShare?: boolean;
  defaultUnits?: string[];
  roleNames?: Partial<Record<"owner" | "admin" | "member" | "viewer", string>>;
  handleChangedAt?: string;
  changes?: Record<string, { by: string; byName: string | null; at: string }>;
};

/** Default unit names from org_settings, trimmed and capped. */
export function readDefaultUnits(settings: unknown): string[] {
  const units = (settings as { defaultUnits?: unknown } | null)?.defaultUnits;
  return Array.isArray(units) ? units.filter((u): u is string => typeof u === "string" && u.trim().length > 0).map((u) => u.trim()).slice(0, 20) : [];
}

/** What the org header, About and Settings need, on top of the project read model (report §18.9). */
export type OrgDetail = {
  type: OrgType | null;
  /** The type as people read it; Other shows its own label (report §34.2). */
  typeLabel: string | null;
  /** "RV College of Engineering" and "Bengaluru" (report §34.3). */
  partOf: string | null;
  location: string | null;
  roleNames: Record<"owner" | "admin" | "member" | "viewer", string>;
  joinMode: "instant" | "approval";
  childCreation: "members" | "admins";
  outsidePeople: boolean;
  /** Child projects may share posts up to the org feed (report §17.6). */
  childShare: boolean;
  /** Default units pre-filling a new child project's team (report §14.4 additions). */
  defaultUnits: string[];
  /** New child projects follow org sprints (report §21.2 #4, on by default). */
  followSprintsDefault: boolean;
  /** Settings → Work with the type defaults (report §21.2 #5, §21.5). */
  work: OrgWork;
  /** Chat rules as stored (report §25.4); read with orgChatSettings for type defaults. */
  chat: { membersCreateChannels?: boolean; generalAdminsOnly?: boolean; generalNotify?: string };
  adminDigest: "daily" | "instant";
  /** Org Settings → Updates (report §17.10). */
  announcementNotify: "in_app" | "email";
  replyRule: "members" | "logged_in";
  visibilityCap: VisibilityCap;
  termStart: string | null;
  termEnd: string | null;
  timeZone: string | null;
  welcomeNote: string | null;
  childProjectCount: number;
  memberCount: number;
  suspended: boolean;
  /** Lifecycle (report §30.3, §30.5): the reason shows to members; the owner sees the deletion date with Restore. */
  suspendReason: string | null;
  archived: boolean;
  deletionScheduledAt: string | null;
  verified: boolean;
  verificationRequested: boolean;
  /** Report §27.9: a decline or removal, with its reason; owners and admins only. */
  verificationOutcome: import("@/lib/organizations/trust-rules").VerificationOutcome | null;
  /** A website in Links, which the badge needs. */
  hasWebsite: boolean;
  /** Owners and admins only. */
  joinCode: string | null;
  joinCodeEnabled: boolean;
  /** When the owner may rename the handle again (once every 7 days); null when now. */
  handleRenameAvailableAt: string | null;
  /** Last change per settings section: "Last changed by Ms. Rao · Oct 26". */
  changes: Record<string, { byName: string | null; at: string }>;
  /** A logged-in visitor's pending join request. */
  viewerRequestPending: boolean;
  /** The viewer's own membership, for "My membership"; null outside the org. */
  you: { title: string | null; showOnProfile: boolean; joinedAt: string } | null;
};

export async function readOrgDetail(
  orgId: string,
  viewer: { userId: string | null; isAdmin: boolean; isInOrg: boolean },
): Promise<OrgDetail | null> {
  const [[org], [children], [members], [request], [you]] = await Promise.all([
    db.select({
      orgType: workspaces.orgType,
      orgSettings: workspaces.orgSettings,
      termStart: workspaces.termStart,
      termEnd: workspaces.termEnd,
      timeZone: workspaces.timeZone,
      welcomeNote: workspaces.welcomeNote,
      suspendedAt: workspaces.suspendedAt,
      suspendReason: workspaces.suspendReason,
      status: workspaces.status,
      deletionScheduledAt: workspaces.deletionScheduledAt,
      verifiedAt: workspaces.verifiedAt,
      verificationRequestedAt: workspaces.verificationRequestedAt,
      externalLinks: workspaces.externalLinks,
      joinCode: workspaces.joinCode,
      joinCodeEnabled: workspaces.joinCodeEnabled,
    }).from(workspaces).where(and(eq(workspaces.id, orgId), eq(workspaces.kind, "organization"))).limit(1),
    // ponytail: counts every live child project; P11's Projects tab filters by what the viewer may see.
    db.select({ n: count() }).from(workspaces).where(and(eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt))),
    db.select({ n: count() }).from(workspaceMembers).where(eq(workspaceMembers.projectId, orgId)),
    viewer.userId && !viewer.isInOrg
      ? db.select({ id: roleApplications.id }).from(roleApplications)
        .where(and(eq(roleApplications.projectId, orgId), eq(roleApplications.applicantId, viewer.userId), eq(roleApplications.status, "pending"))).limit(1)
      : Promise.resolve([]),
    viewer.userId && viewer.isInOrg
      ? db.select({ title: workspaceMembers.title, showOnProfile: workspaceMembers.showOnProfile, joinedAt: workspaceMembers.joinedAt }).from(workspaceMembers)
        .where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.userId, viewer.userId))).limit(1)
      : Promise.resolve([]),
  ]);
  if (!org) return null;
  const settings = (org.orgSettings ?? {}) as OrgSettingsRecord;
  const type = (org.orgType as OrgType | null) ?? null;
  const renameAt = settings.handleChangedAt ? new Date(new Date(settings.handleChangedAt).getTime() + 7 * 24 * 3600 * 1000) : null;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return {
    type,
    typeLabel: orgTypeLabel(type, settings),
    partOf: text((settings as { partOf?: unknown }).partOf),
    location: text((settings as { location?: unknown }).location),
    roleNames: orgRoleNames(type, settings),
    joinMode: settings.joinMode === "approval" ? "approval" : "instant",
    childCreation: settings.childCreation === "admins" ? "admins" : "members",
    outsidePeople: settings.outsidePeople === true,
    childShare: settings.childShare !== false,
    defaultUnits: readDefaultUnits(settings),
    followSprintsDefault: (settings as { followSprintsDefault?: boolean }).followSprintsDefault !== false,
    work: readOrgWork(settings, org.orgType),
    adminDigest: (settings as { adminDigest?: string }).adminDigest === "instant" ? "instant" : "daily",
    announcementNotify: (settings as { announcementNotify?: string }).announcementNotify === "email" ? "email" : "in_app",
    replyRule: (settings as { replyRule?: string }).replyRule === "logged_in" ? "logged_in" : "members",
    chat: { membersCreateChannels: (settings as { membersCreateChannels?: boolean }).membersCreateChannels, generalAdminsOnly: (settings as { generalAdminsOnly?: boolean }).generalAdminsOnly, generalNotify: (settings as { generalNotify?: string }).generalNotify },
    visibilityCap: readOrgRules(settings).visibilityCap,
    termStart: org.termStart,
    termEnd: org.termEnd,
    timeZone: org.timeZone,
    welcomeNote: viewer.isInOrg ? org.welcomeNote : null,
    childProjectCount: children?.n ?? 0,
    memberCount: members?.n ?? 0,
    suspended: Boolean(org.suspendedAt),
    // Decision 53: the reason goes to the owner and admins only; members see that it's suspended.
    suspendReason: viewer.isAdmin ? org.suspendReason : null,
    archived: org.status === "archived",
    deletionScheduledAt: org.deletionScheduledAt ? org.deletionScheduledAt.toISOString() : null,
    verified: Boolean(org.verifiedAt),
    verificationRequested: Boolean(org.verificationRequestedAt),
    verificationOutcome: viewer.isAdmin ? ((settings as { verification?: import("@/lib/organizations/trust-rules").VerificationOutcome }).verification ?? null) : null,
    hasWebsite: linkUrls(org.externalLinks).length > 0,
    joinCode: viewer.isAdmin ? org.joinCode : null,
    joinCodeEnabled: org.joinCodeEnabled,
    handleRenameAvailableAt: renameAt && renameAt.getTime() > Date.now() ? renameAt.toISOString() : null,
    changes: Object.fromEntries(Object.entries(settings.changes ?? {}).map(([section, c]) => [section, { byName: c.byName, at: c.at }])),
    viewerRequestPending: Boolean(request),
    you: you ? { title: you.title, showOnProfile: you.showOnProfile, joinedAt: you.joinedAt.toISOString() } : null,
  };
}

export type OrgMemberRoleOrNone = "owner" | "admin" | "member" | "viewer" | null;

/** The viewer's role in an org (the org owner is "owner"), or null outside it, without one, or when it isn't a live org. */
export async function readViewerOrgRole(orgId: string | null | undefined, userId: string | null | undefined, options: { ignorePreview?: boolean } = {}): Promise<OrgMemberRoleOrNone> {
  if (!orgId || !userId) return null;
  const [row] = await db
    .select({ ownerId: workspaces.ownerId, role: workspaceMembers.role })
    .from(workspaces)
    .leftJoin(workspaceMembers, and(eq(workspaceMembers.projectId, workspaces.id), eq(workspaceMembers.userId, userId)))
    .where(and(eq(workspaces.id, orgId), eq(workspaces.kind, "organization"), isNull(workspaces.deletedAt)))
    .limit(1);
  if (!row) return null;
  const role = row.ownerId === userId ? "owner" : (row.role as OrgMemberRoleOrNone) ?? null;
  // Preview as member (report §45.6): an owner or admin reads this organization as an ordinary member.
  if ((role === "owner" || role === "admin") && !options.ignorePreview && await memberPreviewOrgId() === orgId) return "member";
  return role;
}

/** An old handle still within its 90-day hold resolves to the org's current handle (report §30.2). */
export async function resolveHeldOrgHandle(handle: string): Promise<string | null> {
  const [row] = await db
    .select({ slug: workspaces.slug })
    .from(orgHandleHolds)
    .innerJoin(workspaces, eq(workspaces.id, orgHandleHolds.orgId))
    .where(and(eq(orgHandleHolds.handle, handle.toLowerCase()), gt(orgHandleHolds.heldUntil, sql`now()`), isNull(workspaces.deletedAt)))
    .limit(1);
  return row?.slug ?? null;
}

/** For the minimal header: a private org's name and picture, shown to people outside it (report §18.2). */
export async function readOrgCard(slug: string) {
  const [row] = await db
    .select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, coverImage: workspaces.coverImage, orgType: workspaces.orgType, visibility: workspaces.visibility })
    .from(workspaces)
    .where(and(eq(workspaces.slug, slug), eq(workspaces.kind, "organization"), isNull(workspaces.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** An organization-only workspace inside an organization, by its slug (report §31.2): outsiders get "not available". */
export async function isOrgOnlyWorkspace(slug: string) {
  const [row] = await db.select({ id: workspaces.id }).from(workspaces)
    .where(and(eq(workspaces.slug, slug), eq(workspaces.visibility, "org"), isNotNull(workspaces.parentId), isNull(workspaces.deletedAt))).limit(1);
  return Boolean(row);
}

/** A child project's parent org, as its header and Organization settings section show it (report §18.4, §21.6). */
export type ParentOrgLink = {
  id: string;
  title: string;
  slug: string | null;
  coverImage: string | null;
  isPublic: boolean;
  archived: boolean;
  /** Report §27.7: a suspended organization makes its workspaces read only, and they say so. */
  suspended: boolean;
  /** This workspace follows the organization's sprints (report §18.7). */
  followsSprints: boolean;
  viewerRole: OrgMemberRoleOrNone;
  viewerIsInheritedAdmin: boolean;
  visibilityCap: VisibilityCap;
  outsidePeople: boolean;
  inheritedAdmins: Array<{ name: string; roleName: string }>;
  detachRequested: boolean;
};

type ChildSettingsRecord = { detachRequest?: { by: string; at: string }; moveInRequest?: { orgId: string; by: string; at: string } };

export async function readChildOrgLink(
  project: { parentId: string | null; orgSettings: unknown },
  viewer: { userId: string | null; isLead: boolean; parentOrgRole: OrgMemberRoleOrNone },
): Promise<{ parentOrg: ParentOrgLink | null; pendingMoveIn: { orgId: string; orgTitle: string } | null; moveTargets: Array<{ id: string; title: string }> }> {
  const childSettings = (project.orgSettings ?? {}) as ChildSettingsRecord;
  if (!project.parentId) {
    // The lead of a personal project may move it into an org they belong to (report §14.7).
    if (!viewer.isLead || !viewer.userId) return { parentOrg: null, pendingMoveIn: null, moveTargets: [] };
    const targets = await db.select({ id: workspaces.id, title: workspaces.title }).from(workspaces)
      .innerJoin(workspaceMembers, and(eq(workspaceMembers.projectId, workspaces.id), eq(workspaceMembers.userId, viewer.userId)))
      .where(and(eq(workspaces.kind, "organization"), isNull(workspaces.deletedAt), sql`${workspaceMembers.role} IN ('owner', 'admin', 'member')`));
    const moveIn = childSettings.moveInRequest;
    const pending = moveIn ? targets.find((t) => t.id === moveIn.orgId) : undefined;
    return { parentOrg: null, pendingMoveIn: pending ? { orgId: pending.id, orgTitle: pending.title } : null, moveTargets: targets };
  }

  const [[org], admins] = await Promise.all([
    db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, coverImage: workspaces.coverImage, visibility: workspaces.visibility, status: workspaces.status, orgSettings: workspaces.orgSettings, orgType: workspaces.orgType, ownerId: workspaces.ownerId, suspendedAt: workspaces.suspendedAt })
      .from(workspaces).where(and(eq(workspaces.id, project.parentId), isNull(workspaces.deletedAt))).limit(1),
    db.select({ userId: profiles.id, fullName: profiles.fullName, username: profiles.username, role: workspaceMembers.role })
      .from(workspaceMembers).innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.projectId, project.parentId), sql`${workspaceMembers.role} IN ('owner', 'admin')`)),
  ]);
  if (!org) return { parentOrg: null, pendingMoveIn: null, moveTargets: [] };
  const rules = readOrgRules(org.orgSettings);
  const roleNames = orgRoleNames(org.orgType, org.orgSettings);
  const inherited = viewer.parentOrgRole === "owner" || viewer.parentOrgRole === "admin";
  return {
    pendingMoveIn: null,
    moveTargets: [],
    parentOrg: {
      id: org.id,
      title: org.title,
      slug: org.slug,
      coverImage: org.coverImage,
      isPublic: isWorkspacePubliclyReadableVisibility(org.visibility),
      archived: org.status === "archived",
      suspended: Boolean(org.suspendedAt),
      followsSprints: (childSettings as { followOrgSprints?: unknown }).followOrgSprints === true,
      viewerRole: viewer.parentOrgRole,
      viewerIsInheritedAdmin: inherited,
      visibilityCap: rules.visibilityCap,
      outsidePeople: rules.outsidePeople,
      inheritedAdmins: admins.map((a) => ({
        name: a.fullName || a.username || "Admin",
        roleName: a.userId === org.ownerId ? roleNames.owner : roleNames.admin,
      })),
      detachRequested: Boolean(childSettings.detachRequest),
    },
  };
}

/** Every org the person is in, for the create wizard's Where picker, with why they can't create there (report §14.1). */
export async function listCreateLocations(userId: string) {
  const rows = await db
    .select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, ownerId: workspaces.ownerId, role: workspaceMembers.role, visibility: workspaces.visibility, status: workspaces.status, suspendedAt: workspaces.suspendedAt, orgSettings: workspaces.orgSettings, orgType: workspaces.orgType, category: workspaces.category, tags: workspaces.tags, memberUpdatesEnabled: workspaces.memberUpdatesEnabled, memberFileUploadDefault: workspaces.memberFileUploadDefault,
      children: sql<number>`(SELECT count(*)::int FROM workspaces c WHERE c.parent_id = ${workspaces.id} AND c.deleted_at IS NULL)` })
    .from(workspaces)
    .innerJoin(workspaceMembers, and(eq(workspaceMembers.projectId, workspaces.id), eq(workspaceMembers.userId, userId)))
    .where(and(eq(workspaces.kind, "organization"), isNull(workspaces.deletedAt)))
    .orderBy(workspaces.title);
  return rows.map((row) => {
    const role = (row.ownerId === userId ? "owner" : row.role) as Exclude<OrgMemberRoleOrNone, null>;
    const rules = readOrgRules(row.orgSettings);
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      // Report §21.4: 200 workspaces, said on the create button rather than after the wizard.
      block: childCreationBlock(role, rules.childCreation, row.status !== "archived" && !row.suspendedAt)
        ?? orgLimitBlock("workspaces", row.children, { org: row.title || "This organization", isAdmin: role === "owner" || role === "admin" }),
      visibilityCap: rules.visibilityCap,
      orgPublic: isWorkspacePubliclyReadableVisibility(row.visibility),
      isAdmin: role === "owner" || role === "admin",
      orgType: row.orgType,
      category: row.category,
      defaultUnits: readDefaultUnits(row.orgSettings),
      followSprintsDefault: (row.orgSettings as { followSprintsDefault?: boolean } | null)?.followSprintsDefault !== false,
      outsidePeople: rules.outsidePeople,
      ownerId: row.ownerId,
      tags: (row.tags ?? []).slice(0, 8),
      memberUpdatesEnabled: row.memberUpdatesEnabled,
      memberFileUploadDefault: row.memberFileUploadDefault,
    };
  });
}
