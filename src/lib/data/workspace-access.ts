import { cache } from "react";
import { ForbiddenError } from "@/lib/errors/domain";
import { db } from "@/lib/db";
import { projects, projectMembers } from "@/lib/db/schema";
import {
    isWorkspacePubliclyReadableVisibility,
    type WorkspaceVisibilityInput,
} from "@/lib/workspaces/workspace-visibility";
import { isWorkspaceTabVisibleToViewer, type WorkspacePublicTabId } from "@/lib/workspaces/settings-policies";
import { and, eq, isNull, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

// `projects.visibility` has a database default but is not declared NOT NULL,
// so DB-selected values must remain nullable-safe and fail closed downstream.
type Visibility = WorkspaceVisibilityInput | null | undefined;
type Status = "draft" | "active" | "completed" | "archived" | string | null | undefined;
type MemberRole = "owner" | "admin" | "member" | "viewer" | null;
/** The viewer's role in a child project's parent org: the org owner is "owner", a guest is "viewer". */
type ParentOrgRole = MemberRole;

export type WorkspaceAccess = {
    project: {
        id: string;
        ownerId: string;
        kind: "project" | "organization";
        parentId: string | null;
        visibility: Visibility;
        status: Status;
        slug?: string | null;
        publicTabVisibility?: unknown;
        importSource?: { type?: string | null; repoUrl?: string | null; branch?: string | null; metadata?: any } | null;
        syncStatus?: string | null;
        githubLastCommitSha?: string | null;
    } | null;
    isOwner: boolean;
    isMember: boolean;
    memberRole: MemberRole;
    member: { role: MemberRole; fileUploadEnabled: boolean | null } | null;
    parentOrgRole: ParentOrgRole;
    /** Org owners and admins act as project admins in every child project (report §29.4). */
    isInheritedAdmin: boolean;
    canRead: boolean;
    canWrite: boolean;
    /** Who this access is for; org file rules need it (report §23). */
    viewerId?: string | null;
    /**
     * Why nobody may change anything here (report §30.3, §30.5): the org (or this project's org) is suspended,
     * or the org is archived (with its child projects). canWrite is false while this is set.
     */
    writeBlocked?: "suspended" | "archived" | "deleting" | null;
};

/** The plain sentence for a blocked write. */
export function writeBlockedMessage(reason: WorkspaceAccess["writeBlocked"]) {
    if (reason === "suspended") return "This organization is suspended. Everything is read-only.";
    if (reason === "archived") return "This organization has ended. Everything is read-only.";
    if (reason === "deleting") return "This organization is scheduled for deletion.";
    return "You don’t have permission to do this.";
}

/**
 * Mirrors app_private.nb_project_can_read (0241). `parentOrgRole` is the viewer's role in the parent org;
 * callers that don't load it fail closed for Org only projects and inherited admins.
 */
export function computeWorkspaceReadAccess(
    visibility: Visibility,
    status: Status,
    isOwner: boolean,
    isMember: boolean,
    parentOrgRole: ParentOrgRole = null,
): boolean {
    if (Boolean(isOwner) || Boolean(isMember) || isInheritedAdminRole(parentOrgRole)) return true;

    const normalizedStatus = typeof status === "string" && status.trim().length > 0 ? status : "draft";
    const isDraft = normalizedStatus === "draft";

    if (isDraft) return false;
    if (visibility === "org") return parentOrgRole !== null;
    return isWorkspacePubliclyReadableVisibility(visibility);
}

function isInheritedAdminRole(parentOrgRole: ParentOrgRole) {
    return parentOrgRole === "owner" || parentOrgRole === "admin";
}

/**
 * The one answer to "may this viewer read this project's <tab> data?":
 * project readable (not deleted, draft only for owner/members) AND the tab is
 * public or the viewer is an owner/member. Every loader of tab-scoped data
 * (tasks, sprints, files, readme/docs, updates, dashboard) gates on this.
 */
export function canReadWorkspaceTab(access: WorkspaceAccess, tab: WorkspacePublicTabId): boolean {
    if (!access.project || !access.canRead) return false;
    return isWorkspaceTabVisibleToViewer({
        tabId: tab,
        isOwnerOrMember: access.isOwner || access.isMember || access.isInheritedAdmin,
        publicTabVisibility: access.project.publicTabVisibility,
    });
}

export class WorkspaceTabForbiddenError extends ForbiddenError {
    constructor(readonly tab: WorkspacePublicTabId) {
        super(`This workspace’s ${tab} are not available to this viewer.`);
        this.name = "WorkspaceTabForbiddenError";
    }
}

/** Loads access and throws unless the viewer may read `tab` (see canReadWorkspaceTab). */
export async function assertWorkspaceTabReadAccess(projectId: string, userId: string | null, tab: WorkspacePublicTabId) {
    const access = await getWorkspaceAccessById(projectId, userId);
    if (!canReadWorkspaceTab(access, tab)) throw new WorkspaceTabForbiddenError(tab);
    return access as WorkspaceAccess & { project: NonNullable<WorkspaceAccess["project"]> };
}

export function computeWorkspaceWriteAccess(isOwner: boolean, memberRole: MemberRole) {
    if (isOwner) return true;
    if (!memberRole) return false;
    return memberRole !== "viewer";
}

const parentOrg = alias(projects, "parent_org");
const parentOrgMember = alias(projectMembers, "parent_org_member");

/** One query for the project, the viewer's membership, and the viewer's role in its parent org. */
function selectAccessRows(where: SQL<unknown>, userId: string | null) {
    const memberJoinCondition = userId
        ? and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId))
        : sql`FALSE`;
    const parentMemberJoinCondition = userId
        ? and(eq(parentOrgMember.projectId, parentOrg.id), eq(parentOrgMember.userId, userId))
        : sql`FALSE`;

    return db
        .select({
            id: projects.id,
            ownerId: projects.ownerId,
            kind: projects.kind,
            parentId: projects.parentId,
            visibility: projects.visibility,
            status: projects.status,
            slug: projects.slug,
            publicTabVisibility: projects.publicTabVisibility,
            importSource: projects.importSource,
            syncStatus: projects.syncStatus,
            githubLastCommitSha: projects.githubLastCommitSha,
            memberRole: projectMembers.role,
            fileUploadEnabled: projectMembers.fileUploadEnabled,
            suspendedAt: projects.suspendedAt,
            deletionScheduledAt: projects.deletionScheduledAt,
            parentOrgOwnerId: parentOrg.ownerId,
            parentOrgMemberRole: parentOrgMember.role,
            parentOrgStatus: parentOrg.status,
            parentOrgSuspendedAt: parentOrg.suspendedAt,
            parentOrgDeletionScheduledAt: parentOrg.deletionScheduledAt,
        })
        .from(projects)
        .leftJoin(projectMembers, memberJoinCondition)
        .leftJoin(parentOrg, and(eq(parentOrg.id, projects.parentId), eq(parentOrg.kind, "organization"), isNull(parentOrg.deletedAt)))
        .leftJoin(parentOrgMember, parentMemberJoinCondition)
        .where(and(where, isNull(projects.deletedAt)));
}

function toProjectAccess(row: Awaited<ReturnType<typeof selectAccessRows>>[number], userId: string | null): WorkspaceAccess {
    const isOwner = Boolean(userId && row.ownerId === userId);
    const isMember = Boolean(userId && !isOwner && row.memberRole);
    const memberRole: MemberRole = isMember ? ((row.memberRole as MemberRole) || "member") : null;
    // An org in its deletion grace grants nothing to its child projects' readers.
    const parentOrgRole: ParentOrgRole = row.parentOrgDeletionScheduledAt ? null
        : userId && row.parentOrgOwnerId === userId ? "owner" : (row.parentOrgMemberRole ?? null);
    const isInheritedAdmin = isInheritedAdminRole(parentOrgRole);
    const writeBlocked = row.deletionScheduledAt ? "deleting" as const
        : row.suspendedAt || row.parentOrgSuspendedAt ? "suspended" as const
        : (row.kind === "organization" && row.status === "archived") || (row.parentOrgStatus === "archived" && row.status === "archived") ? "archived" as const
        : null;
    // During the 30-day grace only the owner can open the org (to restore it), report §30.5.
    const canRead = row.deletionScheduledAt ? isOwner : computeWorkspaceReadAccess(row.visibility, row.status, isOwner, isMember, parentOrgRole);

    return {
        project: {
            id: row.id,
            ownerId: row.ownerId,
            kind: row.kind,
            parentId: row.parentId,
            visibility: row.visibility,
            status: row.status,
            slug: row.slug,
            publicTabVisibility: row.publicTabVisibility,
            importSource: row.importSource,
            syncStatus: row.syncStatus,
            githubLastCommitSha: row.githubLastCommitSha,
        },
        isOwner,
        isMember,
        memberRole,
        member: isMember ? { role: memberRole, fileUploadEnabled: row.fileUploadEnabled } : null,
        parentOrgRole,
        isInheritedAdmin,
        canRead,
        canWrite: !writeBlocked && (computeWorkspaceWriteAccess(isOwner, memberRole) || isInheritedAdmin),
        viewerId: userId,
        writeBlocked,
    };
}

async function getProjectAccess(where: SQL<unknown>, userId: string | null): Promise<WorkspaceAccess> {
    const [row] = await selectAccessRows(where, userId).limit(1);
    if (!row) {
        return {
            project: null,
            isOwner: false,
            isMember: false,
            memberRole: null,
            member: null,
            parentOrgRole: null,
            isInheritedAdmin: false,
            canRead: false,
            canWrite: false,
        };
    }
    return toProjectAccess(row, userId);
}

export const getWorkspaceAccessById = cache(
    async (projectId: string, userId: string | null): Promise<WorkspaceAccess> => {
        return getProjectAccess(eq(projects.id, projectId), userId);
    }
);

export const getWorkspaceAccessByIdentifier = cache(
    (identifier: string, userId: string | null): Promise<WorkspaceAccess> => {
        const value = identifier.trim();
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
        return getProjectAccess(isUuid ? or(eq(projects.slug, value), eq(projects.id, value))! : eq(projects.slug, value), userId);
    }
);

export async function getWorkspaceAccessByIds(projectIds: string[], userId: string | null): Promise<Record<string, WorkspaceAccess>> {
    if (projectIds.length === 0) return {};
    const rows = await selectAccessRows(inArray(projects.id, projectIds), userId);
    return Object.fromEntries(rows.map((row) => [row.id, toProjectAccess(row, userId)]));
}
