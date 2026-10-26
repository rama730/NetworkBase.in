import "server-only";

import { and, count, eq, gt, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { orgHandleHolds, projectMembers, projects, roleApplications } from "@/lib/db/schema";
import { defaultOrgRoleNames, type OrgType } from "@/lib/organizations/config";

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
