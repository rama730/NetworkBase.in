import "server-only";

import { and, count, eq, gt, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { orgHandleHolds, profiles, projectMembers, projects, roleApplications } from "@/lib/db/schema";
import { defaultOrgRoleNames, type OrgType } from "@/lib/organizations/config";
import { childCreationBlock, type VisibilityCap } from "@/lib/organizations/child-rules";
import { readOrgRules } from "@/lib/organizations/settings";
import { isProjectPubliclyReadableVisibility } from "@/lib/projects/project-visibility";

type OrgSettingsRecord = {
  joinMode?: string;
  childCreation?: string;
  outsidePeople?: boolean;
  roleNames?: Partial<Record<"owner" | "admin" | "member" | "viewer", string>>;
  handleChangedAt?: string;
  changes?: Record<string, { by: string; byName: string | null; at: string }>;
};

/** What the org header, About and Settings need, on top of the project read model (report §18.9). */
export type OrgDetail = {
  type: OrgType | null;
  roleNames: Record<"owner" | "admin" | "member" | "viewer", string>;
  joinMode: "instant" | "approval";
  childCreation: "members" | "admins";
  outsidePeople: boolean;
  visibilityCap: VisibilityCap;
  termStart: string | null;
  termEnd: string | null;
  timeZone: string | null;
  welcomeNote: string | null;
  childProjectCount: number;
  memberCount: number;
  suspended: boolean;
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
      orgType: projects.orgType,
      orgSettings: projects.orgSettings,
      termStart: projects.termStart,
      termEnd: projects.termEnd,
      timeZone: projects.timeZone,
      welcomeNote: projects.welcomeNote,
      suspendedAt: projects.suspendedAt,
      joinCode: projects.joinCode,
      joinCodeEnabled: projects.joinCodeEnabled,
    }).from(projects).where(and(eq(projects.id, orgId), eq(projects.kind, "organization"))).limit(1),
    // ponytail: counts every live child project; P11's Projects tab filters by what the viewer may see.
    db.select({ n: count() }).from(projects).where(and(eq(projects.parentId, orgId), isNull(projects.deletedAt))),
    db.select({ n: count() }).from(projectMembers).where(eq(projectMembers.projectId, orgId)),
    viewer.userId && !viewer.isInOrg
      ? db.select({ id: roleApplications.id }).from(roleApplications)
        .where(and(eq(roleApplications.projectId, orgId), eq(roleApplications.applicantId, viewer.userId), eq(roleApplications.status, "pending"))).limit(1)
      : Promise.resolve([]),
    viewer.userId && viewer.isInOrg
      ? db.select({ title: projectMembers.title, showOnProfile: projectMembers.showOnProfile, joinedAt: projectMembers.joinedAt }).from(projectMembers)
        .where(and(eq(projectMembers.projectId, orgId), eq(projectMembers.userId, viewer.userId))).limit(1)
      : Promise.resolve([]),
  ]);
  if (!org) return null;
  const settings = (org.orgSettings ?? {}) as OrgSettingsRecord;
  const type = (org.orgType as OrgType | null) ?? null;
  const renameAt = settings.handleChangedAt ? new Date(new Date(settings.handleChangedAt).getTime() + 7 * 24 * 3600 * 1000) : null;
  return {
    type,
    roleNames: { ...defaultOrgRoleNames(type ?? "community"), ...settings.roleNames },
    joinMode: settings.joinMode === "approval" ? "approval" : "instant",
    childCreation: settings.childCreation === "admins" ? "admins" : "members",
    outsidePeople: settings.outsidePeople === true,
    visibilityCap: readOrgRules(settings).visibilityCap,
    termStart: org.termStart,
    termEnd: org.termEnd,
    timeZone: org.timeZone,
    welcomeNote: viewer.isInOrg ? org.welcomeNote : null,
    childProjectCount: children?.n ?? 0,
    memberCount: members?.n ?? 0,
    suspended: Boolean(org.suspendedAt),
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
export async function readViewerOrgRole(orgId: string | null | undefined, userId: string | null | undefined): Promise<OrgMemberRoleOrNone> {
  if (!orgId || !userId) return null;
  const [row] = await db
    .select({ ownerId: projects.ownerId, role: projectMembers.role })
    .from(projects)
    .leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)))
    .where(and(eq(projects.id, orgId), eq(projects.kind, "organization"), isNull(projects.deletedAt)))
    .limit(1);
  if (!row) return null;
  return row.ownerId === userId ? "owner" : (row.role as OrgMemberRoleOrNone) ?? null;
}

/** An old handle still within its 90-day hold resolves to the org's current handle (report §30.2). */
export async function resolveHeldOrgHandle(handle: string): Promise<string | null> {
  const [row] = await db
    .select({ slug: projects.slug })
    .from(orgHandleHolds)
    .innerJoin(projects, eq(projects.id, orgHandleHolds.orgId))
    .where(and(eq(orgHandleHolds.handle, handle.toLowerCase()), gt(orgHandleHolds.heldUntil, sql`now()`), isNull(projects.deletedAt)))
    .limit(1);
  return row?.slug ?? null;
}

/** For the minimal header: a private org's name and picture, shown to people outside it (report §18.2). */
export async function readOrgCard(slug: string) {
  const [row] = await db
    .select({ id: projects.id, title: projects.title, slug: projects.slug, coverImage: projects.coverImage, orgType: projects.orgType, visibility: projects.visibility })
    .from(projects)
    .where(and(eq(projects.slug, slug), eq(projects.kind, "organization"), isNull(projects.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** A child project's parent org, as its header and Organization settings section show it (report §18.4, §21.6). */
export type ParentOrgLink = {
  id: string;
  title: string;
  slug: string | null;
  coverImage: string | null;
  isPublic: boolean;
  archived: boolean;
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
    const targets = await db.select({ id: projects.id, title: projects.title }).from(projects)
      .innerJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, viewer.userId)))
      .where(and(eq(projects.kind, "organization"), isNull(projects.deletedAt), sql`${projectMembers.role} IN ('owner', 'admin', 'member')`));
    const moveIn = childSettings.moveInRequest;
    const pending = moveIn ? targets.find((t) => t.id === moveIn.orgId) : undefined;
    return { parentOrg: null, pendingMoveIn: pending ? { orgId: pending.id, orgTitle: pending.title } : null, moveTargets: targets };
  }

  const [[org], admins] = await Promise.all([
    db.select({ id: projects.id, title: projects.title, slug: projects.slug, coverImage: projects.coverImage, visibility: projects.visibility, status: projects.status, orgSettings: projects.orgSettings, orgType: projects.orgType, ownerId: projects.ownerId })
      .from(projects).where(and(eq(projects.id, project.parentId), isNull(projects.deletedAt))).limit(1),
    db.select({ userId: profiles.id, fullName: profiles.fullName, username: profiles.username, role: projectMembers.role })
      .from(projectMembers).innerJoin(profiles, eq(profiles.id, projectMembers.userId))
      .where(and(eq(projectMembers.projectId, project.parentId), sql`${projectMembers.role} IN ('owner', 'admin')`)),
  ]);
  if (!org) return { parentOrg: null, pendingMoveIn: null, moveTargets: [] };
  const rules = readOrgRules(org.orgSettings);
  const roleNames = { ...defaultOrgRoleNames((org.orgType as OrgType | null) ?? "community"), ...(org.orgSettings as OrgSettingsRecord)?.roleNames };
  const inherited = viewer.parentOrgRole === "owner" || viewer.parentOrgRole === "admin";
  return {
    pendingMoveIn: null,
    moveTargets: [],
    parentOrg: {
      id: org.id,
      title: org.title,
      slug: org.slug,
      coverImage: org.coverImage,
      isPublic: isProjectPubliclyReadableVisibility(org.visibility),
      archived: org.status === "archived",
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
    .select({ id: projects.id, title: projects.title, slug: projects.slug, ownerId: projects.ownerId, role: projectMembers.role, visibility: projects.visibility, status: projects.status, suspendedAt: projects.suspendedAt, orgSettings: projects.orgSettings })
    .from(projects)
    .innerJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)))
    .where(and(eq(projects.kind, "organization"), isNull(projects.deletedAt)))
    .orderBy(projects.title);
  return rows.map((row) => {
    const role = (row.ownerId === userId ? "owner" : row.role) as Exclude<OrgMemberRoleOrNone, null>;
    const rules = readOrgRules(row.orgSettings);
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      block: childCreationBlock(role, rules.childCreation, row.status !== "archived" && !row.suspendedAt),
      visibilityCap: rules.visibilityCap,
      orgPublic: isProjectPubliclyReadableVisibility(row.visibility),
      isAdmin: role === "owner" || role === "admin",
    };
  });
}
