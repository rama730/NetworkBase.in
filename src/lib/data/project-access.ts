import { cache } from "react";
import { ForbiddenError } from "@/lib/errors/domain";
import { db } from "@/lib/db";
import { projects, projectMembers } from "@/lib/db/schema";
import {
    isProjectPubliclyReadableVisibility,
    type ProjectVisibilityInput,
} from "@/lib/projects/project-visibility";
import { isProjectTabVisibleToViewer, type ProjectPublicTabId } from "@/lib/projects/settings-policies";
import { and, eq, isNull, inArray, or, sql, type SQL } from "drizzle-orm";

// `projects.visibility` has a database default but is not declared NOT NULL,
// so DB-selected values must remain nullable-safe and fail closed downstream.
type Visibility = ProjectVisibilityInput | null | undefined;
type Status = "draft" | "active" | "completed" | "archived" | string | null | undefined;
type MemberRole = "owner" | "admin" | "member" | "viewer" | null;

export type ProjectAccess = {
    project: {
        id: string;
        ownerId: string;
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
    canRead: boolean;
    canWrite: boolean;
};

export function computeProjectReadAccess(
    visibility: Visibility,
    status: Status,
    isOwner: boolean,
    isMember: boolean,
): boolean {
    if (Boolean(isOwner) || Boolean(isMember)) return true;

    const normalizedStatus = typeof status === "string" && status.trim().length > 0 ? status : "draft";
    const isPublic = isProjectPubliclyReadableVisibility(visibility);
    const isDraft = normalizedStatus === "draft";

    if (isDraft) return false;
    return Boolean(isPublic);
}

/**
 * The one answer to "may this viewer read this project's <tab> data?":
 * project readable (not deleted, draft only for owner/members) AND the tab is
 * public or the viewer is an owner/member. Every loader of tab-scoped data
 * (tasks, sprints, files, readme/docs, updates, dashboard) gates on this.
 */
export function canReadProjectTab(access: ProjectAccess, tab: ProjectPublicTabId): boolean {
    if (!access.project || !access.canRead) return false;
    return isProjectTabVisibleToViewer({
        tabId: tab,
        isOwnerOrMember: access.isOwner || access.isMember,
        publicTabVisibility: access.project.publicTabVisibility,
    });
}

export class ProjectTabForbiddenError extends ForbiddenError {
    constructor(readonly tab: ProjectPublicTabId) {
        super(`This project's ${tab} are not available to this viewer.`);
        this.name = "ProjectTabForbiddenError";
    }
}

/** Loads access and throws unless the viewer may read `tab` (see canReadProjectTab). */
export async function assertProjectTabReadAccess(projectId: string, userId: string | null, tab: ProjectPublicTabId) {
    const access = await getProjectAccessById(projectId, userId);
    if (!canReadProjectTab(access, tab)) throw new ProjectTabForbiddenError(tab);
    return access as ProjectAccess & { project: NonNullable<ProjectAccess["project"]> };
}

export function computeProjectWriteAccess(isOwner: boolean, memberRole: MemberRole) {
    if (isOwner) return true;
    if (!memberRole) return false;
    return memberRole !== "viewer";
}

async function getProjectAccess(where: SQL<unknown>, userId: string | null): Promise<ProjectAccess> {
    const memberJoinCondition = userId
        ? and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId))
        : sql`FALSE`;

    const [row] = await db
        .select({
            id: projects.id,
            ownerId: projects.ownerId,
            visibility: projects.visibility,
            status: projects.status,
            slug: projects.slug,
            publicTabVisibility: projects.publicTabVisibility,
            importSource: projects.importSource,
            syncStatus: projects.syncStatus,
            githubLastCommitSha: projects.githubLastCommitSha,
            memberRole: projectMembers.role,
            fileUploadEnabled: projectMembers.fileUploadEnabled,
        })
        .from(projects)
        .leftJoin(projectMembers, memberJoinCondition)
        .where(and(where, isNull(projects.deletedAt)))
        .limit(1);

    if (!row) {
        return {
            project: null,
            isOwner: false,
            isMember: false,
            memberRole: null,
            member: null,
            canRead: false,
            canWrite: false,
        };
    }

    const isOwner = Boolean(userId && row.ownerId === userId);
    let isMember = false;
    let memberRole: MemberRole = null;
    let member: ProjectAccess["member"] = null;

    if (userId && !isOwner) {
        if (row.memberRole) {
            isMember = true;
            memberRole = (row.memberRole as MemberRole) || "member";
            member = {
                role: memberRole,
                fileUploadEnabled: row.fileUploadEnabled,
            };
        }
    }

    const canRead = computeProjectReadAccess(row.visibility, row.status, isOwner, isMember);
    const canWrite = computeProjectWriteAccess(isOwner, memberRole);

    return {
        project: {
            id: row.id,
            ownerId: row.ownerId,
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
        member,
        canRead,
        canWrite,
    };
}

export const getProjectAccessById = cache(
    async (projectId: string, userId: string | null): Promise<ProjectAccess> => {
        return getProjectAccess(eq(projects.id, projectId), userId);
    }
);

export const getProjectAccessByIdentifier = cache(
    (identifier: string, userId: string | null): Promise<ProjectAccess> => {
        const value = identifier.trim();
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
        return getProjectAccess(isUuid ? or(eq(projects.slug, value), eq(projects.id, value))! : eq(projects.slug, value), userId);
    }
);

export async function getProjectAccessByIds(projectIds: string[], userId: string | null): Promise<Record<string, ProjectAccess>> {
    if (projectIds.length === 0) return {};
    
    const memberJoinCondition = userId
        ? and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId))
        : sql`FALSE`;

    const rows = await db
        .select({
            id: projects.id,
            ownerId: projects.ownerId,
            visibility: projects.visibility,
            status: projects.status,
            slug: projects.slug,
            publicTabVisibility: projects.publicTabVisibility,
            importSource: projects.importSource,
            syncStatus: projects.syncStatus,
            githubLastCommitSha: projects.githubLastCommitSha,
            memberRole: projectMembers.role,
            fileUploadEnabled: projectMembers.fileUploadEnabled,
        })
        .from(projects)
        .leftJoin(projectMembers, memberJoinCondition)
        .where(and(inArray(projects.id, projectIds), isNull(projects.deletedAt)));

    const result: Record<string, ProjectAccess> = {};
    for (const row of rows) {
        const isOwner = Boolean(userId && row.ownerId === userId);
        const isMember = Boolean(userId && !isOwner && row.memberRole);
        const memberRole: MemberRole = isMember ? ((row.memberRole as MemberRole) || "member") : null;
        const memberFileUploadEnabled = isMember ? row.fileUploadEnabled : null;

        const project = {
            id: row.id,
            ownerId: row.ownerId,
            visibility: row.visibility,
            status: row.status,
            slug: row.slug,
            publicTabVisibility: row.publicTabVisibility,
            importSource: row.importSource,
            syncStatus: row.syncStatus,
            githubLastCommitSha: row.githubLastCommitSha,
        };

        result[row.id] = {
            project,
            isOwner,
            isMember,
            memberRole,
            member: isMember ? { role: memberRole, fileUploadEnabled: memberFileUploadEnabled } : null,
            canRead: computeProjectReadAccess(project.visibility, project.status, isOwner, isMember),
            canWrite: computeProjectWriteAccess(isOwner, memberRole),
        };
    }
    return result;
}
