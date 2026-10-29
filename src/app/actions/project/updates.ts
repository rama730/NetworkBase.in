"use server";

import { readViewerOrgRole } from "@/lib/organizations/detail";
import { orgFeedWhere, orgLivePinSql, readLastSeenUpdates, readOrgUpdateContext, readProjectTitles, readSharedPins, type OrgUpdateContext } from "@/lib/organizations/org-updates";
import { isPinnedNow, type UpdateAudience } from "@/lib/organizations/update-rules";
import { shareToOrgGeneral } from "@/lib/organizations/org-chat";
import { readProjectRoleTitles, roleTitleKey } from "@/lib/projects/update-roles";
import { randomUUID } from "node:crypto";
import { alias } from "drizzle-orm/pg-core";
import {
    and,
    asc,
    desc,
    eq,
    gt,
    ilike,
    inArray,
    isNull,
    lt,
    or,
    sql,
    type SQL,
} from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { db } from "@/lib/db";
import { scheduleAssetDeletionIfUnreferenced } from "@/lib/storage/asset-deletion";
import { orgFileAccessSql, projectContentNodeSql } from "@/lib/files/internal-helpers";
import { toIsoString } from "@/lib/utils/date";
import { parsePositiveInteger } from "@/lib/utils/number";
import { isLooseUuid } from "@/lib/validations/uuid";
import {
    profiles,
    profileProjectContributionStages,
    profileProjectContributions,
    projectMembers,
    projectNodes,
    projectSprints,
    projects,
    projectUpdateComments,
    projectUpdateDraftMediaAssets,
    projectUpdateDrafts,
    projectUpdateLikes,
    projectUpdateMediaAssets,
    projectUpdates,
    storageAssets,
    storageLegacyCleanupTargets,
    tasks,
} from "@/lib/db/schema";
import { computeProjectReadAccess } from "@/lib/data/project-access";
import { enqueueProjectNotificationEvent } from "@/lib/notifications/project-events";
import { notifyAnnouncement, notifyOrg } from "@/lib/organizations/notify";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { getViewerAuthContext, getViewerProfileContext } from "@/lib/server/viewer-context";
import { createAdminClient } from "@/lib/supabase/server";
import { createUploadIntent, finalizeUploadIntent } from "@/lib/upload/upload-intents";
import { normalizeAndValidateFileSize, normalizeAndValidateMimeType } from "@/lib/upload/security";
import {
    getProjectMemberRoleLabel,
    isProjectTabVisibleToViewer,
    normalizeProjectMemberRole,
} from "@/lib/projects/settings-policies";
import {
    normalizeProjectUpdateFilter,
    normalizeProjectUpdateMediaItems,
    normalizeProjectUpdateReferences,
    normalizeProjectUpdateType,
    PROJECT_UPDATE_ALLOWED_IMAGE_MIME_TYPES,
    PROJECT_UPDATE_COMMENT_PAGE_SIZE,
    PROJECT_UPDATE_MEDIA_BUCKET,
    PROJECT_UPDATE_MEDIA_MAX_BYTES,
    PROJECT_UPDATE_PAGE_SIZE,
    PROJECT_UPDATE_PERFORMANCE_BUDGETS,
    projectUpdateImageExtensionFromMimeType,
    projectUpdateMediaApplicationUrl,
    composeProjectUpdateRoleLabel,
    isGenericProjectUpdateRoleTitle,
    normalizeProjectUpdateAuthorRoleSnapshot,
    projectUpdateExcerpt,
    resolveProjectUpdateAuthorRoleDisplay,
    sanitizeProjectUpdateContent,
    sanitizeProjectUpdateRoleTitle,
    shouldNotifyProjectUpdateFollowers,
    type ProjectUpdateAuthorRoleSnapshot,
    type ProjectUpdateContextKind,
    type ProjectUpdateContextOption,
    type ProjectUpdateContextSummary,
    type ProjectUpdateEntityRefs,
    type ProjectUpdateFilter,
    type ProjectUpdateMediaItem,
    type ProjectUpdateReference,
    type ProjectUpdateReplyPolicy,
    type ProjectUpdateType,
    type ProjectUpdateVisibility,
} from "@/lib/projects/updates";
import { logger } from "@/lib/logger";

const UPDATES_PAGE_SIZE = PROJECT_UPDATE_PAGE_SIZE;
const COMMENTS_PAGE_SIZE = PROJECT_UPDATE_COMMENT_PAGE_SIZE;
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function updateMediaBinding(item: ProjectUpdateMediaItem) {
    return `${item.bucket ?? ""}\0${item.storageKey ?? ""}`;
}

async function queueRemovedLegacyUpdateMedia(params: {
    tx: DbTransaction;
    sourceType: "project_update_media" | "project_update_draft_media";
    sourceId: string;
    projectId: string;
    previous: ProjectUpdateMediaItem[] | null | undefined;
    next: ProjectUpdateMediaItem[];
}) {
    const retained = new Set(params.next.map(updateMediaBinding));
    const targets = normalizeMedia(params.previous).filter((item) => (
        !item.assetId
        && item.bucket === PROJECT_UPDATE_MEDIA_BUCKET
        && !!item.storageKey
        && item.storageKey.startsWith(`projects/${params.projectId}/update-media/`)
        && !retained.has(updateMediaBinding(item))
    ));
    if (targets.length === 0) return;
    await params.tx.insert(storageLegacyCleanupTargets)
        .values(targets.map((item) => ({
            sourceType: params.sourceType,
            sourceId: params.sourceId,
            sourceProjectId: params.projectId,
            bucket: PROJECT_UPDATE_MEDIA_BUCKET,
            storageKey: item.storageKey!,
            nextAttemptAt: new Date(),
        })))
        .onConflictDoNothing();
}

async function replaceUpdateMediaAssetRefs(params: {
    tx: DbTransaction;
    updateId: string;
    projectId: string;
    ownerUserId: string;
    media: ProjectUpdateMediaItem[];
    allowedLegacyBindings?: Set<string>;
}) {
    const previous = await params.tx
        .select({ assetId: projectUpdateMediaAssets.assetId })
        .from(projectUpdateMediaAssets)
        .where(eq(projectUpdateMediaAssets.updateId, params.updateId));
    await params.tx
        .delete(projectUpdateMediaAssets)
        .where(eq(projectUpdateMediaAssets.updateId, params.updateId));

    const attachedAssetIds = new Set<string>();
    for (const [ordinal, item] of params.media.entries()) {
        if (!item.assetId) {
            if (
                (item.bucket || item.storageKey) &&
                !params.allowedLegacyBindings?.has(updateMediaBinding(item))
            ) {
                throw new Error("Update media must use a verified asset identity");
            }
            continue;
        }
        if (
            !isLooseUuid(item.assetId) ||
            item.bucket !== PROJECT_UPDATE_MEDIA_BUCKET ||
            !item.storageKey ||
            attachedAssetIds.has(item.assetId)
        ) {
            throw new Error("Invalid update media asset binding");
        }
        const [publishable] = await params.tx.update(storageAssets)
            .set({
                backupState: sql`CASE WHEN ${storageAssets.backupState} = 'verified' THEN 'verified' ELSE 'pending' END`,
                updatedAt: new Date(),
            })
            .where(and(
                eq(storageAssets.id, item.assetId),
                eq(storageAssets.ownerUserId, params.ownerUserId),
                eq(storageAssets.projectId, params.projectId),
                eq(storageAssets.bucket, PROJECT_UPDATE_MEDIA_BUCKET),
                eq(storageAssets.storageKey, item.storageKey),
                eq(storageAssets.state, "verified"),
            ))
            .returning({ id: storageAssets.id });
        if (!publishable) throw new Error("Update media asset is no longer publishable");
        attachedAssetIds.add(item.assetId);
        await params.tx.insert(projectUpdateMediaAssets).values({
            updateId: params.updateId,
            assetId: item.assetId,
            ordinal,
        });
    }

    const removed = previous
        .map((row) => row.assetId)
        .filter((assetId) => !attachedAssetIds.has(assetId));
    // Shared media stays verified while another update or draft uses it (COR-045).
    await scheduleAssetDeletionIfUnreferenced(params.tx, removed);
}

async function replaceDraftMediaAssetRefs(params: {
    tx: DbTransaction;
    projectId: string;
    userId: string;
    media: ProjectUpdateMediaItem[];
    allowedLegacyBindings?: Set<string>;
}) {
    const previous = await params.tx
        .select({ assetId: projectUpdateDraftMediaAssets.assetId })
        .from(projectUpdateDraftMediaAssets)
        .where(and(
            eq(projectUpdateDraftMediaAssets.projectId, params.projectId),
            eq(projectUpdateDraftMediaAssets.userId, params.userId),
        ));
    await params.tx.delete(projectUpdateDraftMediaAssets).where(and(
        eq(projectUpdateDraftMediaAssets.projectId, params.projectId),
        eq(projectUpdateDraftMediaAssets.userId, params.userId),
    ));

    const attachedAssetIds = new Set<string>();
    for (const [ordinal, item] of params.media.entries()) {
        if (!item.assetId) {
            if (
                (item.bucket || item.storageKey) &&
                !params.allowedLegacyBindings?.has(updateMediaBinding(item))
            ) {
                throw new Error("Draft media must use a verified asset identity");
            }
            continue;
        }
        if (
            !isLooseUuid(item.assetId) ||
            item.bucket !== PROJECT_UPDATE_MEDIA_BUCKET ||
            !item.storageKey ||
            attachedAssetIds.has(item.assetId)
        ) {
            throw new Error("Invalid draft media asset binding");
        }
        const [publishable] = await params.tx.update(storageAssets)
            .set({
                backupState: sql`CASE WHEN ${storageAssets.backupState} = 'verified' THEN 'verified' ELSE 'pending' END`,
                updatedAt: new Date(),
            })
            .where(and(
                eq(storageAssets.id, item.assetId),
                eq(storageAssets.ownerUserId, params.userId),
                eq(storageAssets.projectId, params.projectId),
                eq(storageAssets.bucket, PROJECT_UPDATE_MEDIA_BUCKET),
                eq(storageAssets.storageKey, item.storageKey),
                eq(storageAssets.state, "verified"),
            ))
            .returning({ id: storageAssets.id });
        if (!publishable) throw new Error("Draft media asset is no longer available");
        attachedAssetIds.add(item.assetId);
        await params.tx.insert(projectUpdateDraftMediaAssets).values({
            projectId: params.projectId,
            userId: params.userId,
            assetId: item.assetId,
            ordinal,
        });
    }

    const removed = previous
        .map((row) => row.assetId)
        .filter((assetId) => !attachedAssetIds.has(assetId));
    // Shared media stays verified while another update or draft uses it (COR-045).
    await scheduleAssetDeletionIfUnreferenced(params.tx, removed);
}

type ProjectUpdateCursor = {
    pinned: boolean;
    createdAt: string;
    id: string;
};

type ProjectUpdateCommentCursor = {
    createdAt: string;
    id: string;
};

export type ProjectUpdateAuthorView = {
    id: string | null;
    fullName: string | null;
    username: string | null;
    avatarUrl: string | null;
    roleLabel: string | null;
    roleTitle: string | null;
    membershipRoleLabel: string | null;
    roleSource: "snapshot" | "project_role" | "membership" | null;
};

export type ProjectUpdateView = {
    id: string;
    projectId: string;
    authorId: string | null;
    author: ProjectUpdateAuthorView | null;
    content: string;
    updateType: ProjectUpdateType | null;
    visibility: ProjectUpdateVisibility;
    replyPolicy: ProjectUpdateReplyPolicy;
    entityRefs: ProjectUpdateEntityRefs;
    context: ProjectUpdateContextSummary;
    media: ProjectUpdateMediaItem[];
    metadata: Record<string, unknown>;
    isPinned: boolean;
    pinnedUntil: string | null;
    audience: UpdateAudience;
    /** Set on child posts shared up into the org feed ("From <project>"). */
    fromProject: { title: string; slug: string | null } | null;
    likeCount: number;
    commentCount: number;
    likedByViewer: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canPin: boolean;
    /** A child project's own post shared up to its org (report §17.6): "Shared to CSE-3A". */
    sharedToOrgTitle?: string | null;
    canComment: boolean;
    editedAt: string | null;
    deletedAt: string | null;
    createdAt: string;
    updatedAt: string;
};

export type ProjectUpdateCommentView = {
    id: string;
    updateId: string;
    projectId: string;
    parentId: string | null;
    userId: string | null;
    author: ProjectUpdateAuthorView | null;
    content: string;
    canDelete: boolean;
    deletedAt: string | null;
    createdAt: string;
    updatedAt: string;
    targetUserId: string | null;
    targetUsername: string | null;
};

export type ProjectUpdateMovementSummary = {
    totalUpdates: number;
    totalContributors: number;
    publicUpdates: number;
    notificationReadyUpdates: number;
    latestUpdateId: string | null;
    pinnedUpdateId: string | null;
    latestMovementAt: string | null;
    linkedWork: {
        task: number;
        sprint: number;
        file: number;
        media: number;
        general: number;
    };
    timeline: Array<{ label: "Today" | "This week" | "Earlier"; count: number }>;
};

type ProjectUpdateAccess = {
    project: {
        id: string;
        ownerId: string;
        title: string | null;
        slug: string | null;
        visibility: string | null;
        status: string | null;
        publicTabVisibility: unknown;
        memberUpdatesEnabled: boolean;
        kind: string;
        parentId: string | null;
    } | null;
    /** Org context when this is an org or a child project (report §17). */
    org: OrgUpdateContext | null;
    viewerId: string | null;
    isOwner: boolean;
    isMember: boolean;
    memberRole: "owner" | "admin" | "member" | "viewer" | null;
    canRead: boolean;
    canCreate: boolean;
    canManage: boolean;
};

function encodeUpdateCursor(row: { isPinned: boolean; createdAt: Date | string; id: string }) {
    const payload: ProjectUpdateCursor = {
        pinned: Boolean(row.isPinned),
        createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
        id: row.id,
    };
    return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeUpdateCursor(value: string | null | undefined): ProjectUpdateCursor | null {
    if (!value) return null;
    try {
        const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<ProjectUpdateCursor>;
        if (typeof parsed.id !== "string" || typeof parsed.createdAt !== "string" || typeof parsed.pinned !== "boolean") {
            return null;
        }
        return { id: parsed.id, createdAt: parsed.createdAt, pinned: parsed.pinned };
    } catch {
        return null;
    }
}

function encodeCommentCursor(row: { createdAt: Date | string; id: string }) {
    const payload: ProjectUpdateCommentCursor = {
        createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
        id: row.id,
    };
    return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeCommentCursor(value: string | null | undefined): ProjectUpdateCommentCursor | null {
    if (!value) return null;
    try {
        const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<ProjectUpdateCommentCursor>;
        if (typeof parsed.id !== "string" || typeof parsed.createdAt !== "string") return null;
        return { id: parsed.id, createdAt: parsed.createdAt };
    } catch {
        return null;
    }
}

function normalizeEntityRefs(value: unknown): ProjectUpdateEntityRefs {
    if (!value || typeof value !== "object") return {};
    const source = value as Record<string, unknown>;
    const pick = (key: keyof ProjectUpdateEntityRefs) => {
        const raw = source[key];
        return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
    };
    const legacyReferences: ProjectUpdateReference[] = [
        pick("taskId") ? { kind: "task", id: pick("taskId")! } : null,
        pick("sprintId") ? { kind: "sprint", id: pick("sprintId")! } : null,
        pick("fileId") ? { kind: "file", id: pick("fileId")! } : null,
    ].filter((item): item is ProjectUpdateReference => Boolean(item));
    const references = normalizeProjectUpdateReferences([
        ...normalizeProjectUpdateReferences(source.references),
        ...legacyReferences,
    ]);
    return {
        taskId: pick("taskId"),
        sprintId: pick("sprintId"),
        fileId: pick("fileId"),
        readmeVersionId: pick("readmeVersionId"),
        roleId: pick("roleId"),
        milestoneId: pick("milestoneId"),
        references,
    };
}

function normalizeMedia(value: unknown): ProjectUpdateMediaItem[] {
    return normalizeProjectUpdateMediaItems(value);
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

async function readProjectRoleTitleMap(projectId: string, userIds: Array<string | null | undefined>) {
    const titles = await readProjectRoleTitles(userIds.map((userId) => ({ projectId, userId })));
    const byUser = new Map<string, string>();
    for (const userId of userIds) {
        const title = userId ? titles.get(roleTitleKey(projectId, userId)) : null;
        if (userId && title) byUser.set(userId, title);
    }
    return byUser;
}

async function hydrateUpdateRowsWithRoleTitles<T extends { authorId: string | null }>(
    projectId: string,
    rows: T[],
): Promise<Array<T & { authorProjectRoleTitle: string | null }>> {
    const roleTitles = await readProjectRoleTitleMap(projectId, rows.map((row) => row.authorId));
    return rows.map((row) => ({
        ...row,
        authorProjectRoleTitle: row.authorId ? roleTitles.get(row.authorId) ?? null : null,
    }));
}

async function hydrateCommentRowsWithRoleTitles<T extends { userId: string | null }>(
    projectId: string,
    rows: T[],
): Promise<Array<T & { authorProjectRoleTitle: string | null }>> {
    const roleTitles = await readProjectRoleTitleMap(projectId, rows.map((row) => row.userId));
    return rows.map((row) => ({
        ...row,
        authorProjectRoleTitle: row.userId ? roleTitles.get(row.userId) ?? null : null,
    }));
}

function authorRoleSnapshotFromMetadata(metadata: unknown) {
    const normalized = normalizeMetadata(metadata);
    return normalizeProjectUpdateAuthorRoleSnapshot(normalized.authorRoleSnapshot);
}

async function readAuthorRoleSnapshot(params: {
    projectId: string;
    userId: string;
    projectOwnerId: string | null;
    memberRole: ProjectUpdateAccess["memberRole"];
}): Promise<ProjectUpdateAuthorRoleSnapshot> {
    const role = params.userId === params.projectOwnerId
        ? "owner"
        : normalizeProjectMemberRole(params.memberRole, "member");
    const membershipRoleLabel = getProjectMemberRoleLabel(role);
    const roleTitles = await readProjectRoleTitleMap(params.projectId, [params.userId]);
    const roleTitle = sanitizeProjectUpdateRoleTitle(roleTitles.get(params.userId));
    return {
        displayRoleLabel: composeProjectUpdateRoleLabel({ roleTitle, membershipRoleLabel }) ?? membershipRoleLabel,
        roleTitle,
        membershipRoleLabel,
        source: roleTitle ? "project_role" : "membership",
        capturedAt: new Date().toISOString(),
    };
}

function projectHref(project: { id: string; slug: string | null }, updateId?: string | null) {
    const slugOrId = project.slug || project.id;
    const base = `/projects/${encodeURIComponent(slugOrId)}?tab=updates`;
    return updateId ? `${base}&updateId=${encodeURIComponent(updateId)}` : base;
}

function projectBaseHref(project: { id: string; slug: string | null }) {
    return `/projects/${encodeURIComponent(project.slug || project.id)}`;
}

function projectTaskHref(project: { id: string; slug: string | null }, taskId: string) {
    return `${projectBaseHref(project)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(taskId)}`;
}

function projectSprintHref(project: { id: string; slug: string | null }, sprintId: string) {
    return `${projectBaseHref(project)}?tab=sprints&sprintId=${encodeURIComponent(sprintId)}`;
}

function encodeProjectNodePath(row: { path: string | null; name: string }) {
    const pathParts = row.path && row.path !== "/"
        ? row.path.split("/").filter(Boolean)
        : [row.name];
    return pathParts.map((part) => encodeURIComponent(part)).join("/");
}

function projectFileHref(project: { id: string; slug: string | null }, row: { id: string; path: string | null; name: string }) {
    const encodedPath = encodeProjectNodePath(row);
    const fileId = encodeURIComponent(row.id);
    return encodedPath
        ? `${projectBaseHref(project)}?tab=files&fileId=${fileId}&path=${encodedPath}`
        : `${projectBaseHref(project)}?tab=files&fileId=${fileId}`;
}

function normalizeProjectUpdateMentionKind(kind: unknown): ProjectUpdateContextKind | null {
    if (kind === "task" || kind === "tasks") return "task";
    if (kind === "sprint" || kind === "sprints") return "sprint";
    if (kind === "file" || kind === "files") return "file";
    return null;
}

function projectUpdateTargetUnavailableMessage(kind: ProjectUpdateContextKind) {
    if (kind === "task") return "This task is not available or you do not have access.";
    if (kind === "sprint") return "This sprint is not available or you do not have access.";
    return "This file is not available or you do not have access.";
}

function canReadProjectUpdateTargetTab(access: ProjectUpdateAccess, kind: ProjectUpdateContextKind) {
    if (!access.project) return false;
    return isProjectTabVisibleToViewer({
        tabId: kind === "task" ? "tasks" : kind === "sprint" ? "sprints" : "files",
        isOwnerOrMember: access.isOwner || access.isMember,
        canManageSettings: access.isOwner,
        publicTabVisibility: access.project.publicTabVisibility,
    });
}

export async function resolveProjectUpdateMentionTargetAction(projectId: string, input: {
    kind?: string | null;
    id?: string | null;
}) {
    try {
        const kind = normalizeProjectUpdateMentionKind(input.kind);
        const id = typeof input.id === "string" ? input.id.trim() : "";
        if (!kind || !id) {
            return { success: false as const, error: "This mention is not available." };
        }

        const viewer = await getViewerAuthContext();
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.project || !access.canRead || !canReadProjectUpdateTargetTab(access, kind)) {
            return { success: false as const, error: projectUpdateTargetUnavailableMessage(kind) };
        }

        if (kind === "task") {
            const isUuid = isLooseUuid(id);
            let taskQuery;
            if (isUuid) {
                taskQuery = db
                    .select({
                        id: tasks.id,
                        taskNumber: tasks.taskNumber,
                        projectKey: projects.key,
                    })
                    .from(tasks)
                    .innerJoin(projects, eq(tasks.projectId, projects.id))
                    .where(and(eq(tasks.projectId, projectId), eq(tasks.id, id), isNull(tasks.deletedAt)))
                    .limit(1);
            } else {
                const dashIndex = id.lastIndexOf("-");
                if (dashIndex !== -1) {
                    const projectKey = id.slice(0, dashIndex);
                    const taskNum = Number(id.slice(dashIndex + 1));
                    if (projectKey && Number.isInteger(taskNum)) {
                        taskQuery = db
                            .select({
                                id: tasks.id,
                                taskNumber: tasks.taskNumber,
                                projectKey: projects.key,
                            })
                            .from(tasks)
                            .innerJoin(projects, eq(tasks.projectId, projects.id))
                            .where(
                                and(
                                    eq(projects.key, projectKey),
                                    eq(tasks.taskNumber, taskNum),
                                    eq(tasks.projectId, projectId),
                                    isNull(tasks.deletedAt)
                                )
                            )
                            .limit(1);
                    }
                }
            }

            const [task] = taskQuery ? await taskQuery : [];
            if (!task) return { success: false as const, error: projectUpdateTargetUnavailableMessage(kind) };
            const taskCode = task.projectKey && task.taskNumber ? `${task.projectKey}-${task.taskNumber}` : task.id;
            return { success: true as const, href: projectTaskHref(access.project, taskCode), kind };
        }

        if (kind === "sprint") {
            const isUuid = isLooseUuid(id);
            if (!isUuid) return { success: false as const, error: projectUpdateTargetUnavailableMessage(kind) };

            const [sprint] = await db
                .select({ id: projectSprints.id })
                .from(projectSprints)
                .where(and(eq(projectSprints.projectId, projectId), eq(projectSprints.id, id)))
                .limit(1);
            if (!sprint) return { success: false as const, error: projectUpdateTargetUnavailableMessage(kind) };
            return { success: true as const, href: projectSprintHref(access.project, sprint.id), kind };
        }

        if (!isLooseUuid(id)) return { success: false as const, error: projectUpdateTargetUnavailableMessage(kind) };

        const [node] = await db
            .select({
                id: projectNodes.id,
                name: projectNodes.name,
                path: projectNodes.path,
            })
            .from(projectNodes)
            .where(and(
                eq(projectNodes.projectId, projectId),
                eq(projectNodes.id, id),
                isNull(projectNodes.deletedAt),
                canReadProjectUpdateTargetTab(access, "task") ? undefined : projectContentNodeSql,
                orgFileAccessSql(access),
            ))
            .limit(1);
        if (!node) return { success: false as const, error: projectUpdateTargetUnavailableMessage(kind) };
        return { success: true as const, href: projectFileHref(access.project, node), kind };
    } catch (error) {
        logger.warn("project_updates.mention_target_resolve_failed", {
            module: "projects",
            projectId,
            kind: input.kind,
            targetId: input.id,
            error: error instanceof Error ? error.message : String(error),
        });
        const kind = normalizeProjectUpdateMentionKind(input.kind);
        return { success: false as const, error: kind ? projectUpdateTargetUnavailableMessage(kind) : "This mention is not available." };
    }
}

function taskContextOption(row: {
    id: string;
    title: string;
    status: string;
    taskNumber: number | null;
}, project: { id: string; slug: string | null }): ProjectUpdateContextOption {
    return {
        kind: "task",
        id: row.id,
        label: row.taskNumber ? `#${row.taskNumber} ${row.title}` : row.title,
        description: row.status,
        href: projectTaskHref(project, row.id),
        status: row.status,
    };
}

function sprintContextOption(row: {
    id: string;
    name: string;
    status: string;
    goal: string | null;
}, project: { id: string; slug: string | null }): ProjectUpdateContextOption {
    return {
        kind: "sprint",
        id: row.id,
        label: row.name,
        description: row.goal || row.status,
        href: projectSprintHref(project, row.id),
        status: row.status,
    };
}

function fileContextOption(row: {
    id: string;
    name: string;
    path: string;
    mimeType: string | null;
}, project: { id: string; slug: string | null }): ProjectUpdateContextOption {
    return {
        kind: "file",
        id: row.id,
        label: row.name,
        description: row.path,
        href: projectFileHref(project, row),
        status: row.mimeType,
    };
}

function isModerator(access: Pick<ProjectUpdateAccess, "isOwner" | "memberRole">) {
    return access.isOwner || access.memberRole === "admin";
}

function canCreateForRole(access: Pick<ProjectUpdateAccess, "isOwner" | "memberRole"> & { memberUpdatesEnabled: boolean }) {
    if (access.isOwner || access.memberRole === "admin") return true;
    if (access.memberRole === "member") {
        return access.memberUpdatesEnabled;
    }
    return false;
}

async function resolveProjectUpdateAccess(projectId: string, viewerId: string | null): Promise<ProjectUpdateAccess> {
    const [project] = await db
        .select({
            id: projects.id,
            ownerId: projects.ownerId,
            title: projects.title,
            slug: projects.slug,
            visibility: projects.visibility,
            status: projects.status,
            publicTabVisibility: projects.publicTabVisibility,
            memberUpdatesEnabled: projects.memberUpdatesEnabled,
            kind: projects.kind,
            parentId: projects.parentId,
        })
        .from(projects)
        .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
        .limit(1);

    if (!project) {
        return {
            project: null,
            org: null,
            viewerId,
            isOwner: false,
            isMember: false,
            memberRole: null,
            canRead: false,
            canCreate: false,
            canManage: false,
        };
    }

    const isOwner = Boolean(viewerId && viewerId === project.ownerId);
    const [membership] = viewerId && !isOwner
        ? await db
            .select({ role: projectMembers.role })
            .from(projectMembers)
            .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, viewerId)))
            .limit(1)
        : [];
    const isMember = Boolean(membership);
    const memberRole = isOwner
        ? "owner"
        : membership
            ? normalizeProjectMemberRole(membership.role, "member")
            : null;
    // Org only child projects and inherited org admins (report §29.4).
    const parentOrgRole = project.parentId && !isOwner && !isMember ? await readViewerOrgRole(project.parentId, viewerId) : null;
    const isInheritedAdmin = parentOrgRole === "owner" || parentOrgRole === "admin";
    const isOwnerOrMember = isOwner || isMember;
    const canRead = computeProjectReadAccess(project.visibility, project.status, isOwner, isMember, parentOrgRole) && isProjectTabVisibleToViewer({
        tabId: "updates",
        isOwnerOrMember: isOwnerOrMember || isInheritedAdmin,
        canManageSettings: isOwner,
        publicTabVisibility: project.publicTabVisibility,
    });
    const org = project.kind === "organization" || project.parentId ? await readOrgUpdateContext(project, viewerId) : null;
    const effectiveAccess = {
        project,
        org,
        viewerId,
        isOwner,
        isMember,
        memberRole,
        canRead,
        canCreate: canRead && canCreateForRole({ isOwner, memberRole, memberUpdatesEnabled: project.memberUpdatesEnabled }),
        // Org admins moderate child project updates too (report §29.4).
        canManage: canRead && (isModerator({ isOwner, memberRole }) || isInheritedAdmin),
    };
    return effectiveAccess;
}

type UpdateRow = typeof projectUpdates.$inferSelect & {
    authorFullName: string | null;
    authorUsername: string | null;
    authorAvatarUrl: string | null;
    authorMembershipRole: string | null;
    authorProjectRoleTitle: string | null;
};

function normalizeAuthor(row: {
    authorId: string | null;
    authorFullName: string | null;
    authorUsername: string | null;
    authorAvatarUrl: string | null;
    authorMembershipRole?: string | null;
    authorProjectRoleTitle?: string | null;
}, projectOwnerId: string | null, snapshot?: ProjectUpdateAuthorRoleSnapshot | null): ProjectUpdateAuthorView | null {
    if (!row.authorId) return null;
    const role = row.authorId === projectOwnerId
        ? "owner"
        : normalizeProjectMemberRole(row.authorMembershipRole, "member");
    const membershipRoleLabel = getProjectMemberRoleLabel(role);
    const roleDisplay = resolveProjectUpdateAuthorRoleDisplay({
        snapshot,
        projectRoleTitle: row.authorProjectRoleTitle,
        membershipRoleLabel,
    });
    return {
        id: row.authorId,
        fullName: row.authorFullName,
        username: row.authorUsername,
        avatarUrl: row.authorAvatarUrl,
        roleLabel: roleDisplay.roleLabel,
        roleTitle: roleDisplay.roleTitle,
        membershipRoleLabel: roleDisplay.membershipRoleLabel,
        roleSource: roleDisplay.roleSource,
    };
}

function normalizeUpdate(row: UpdateRow, params: {
    access: ProjectUpdateAccess;
    likedIds: Set<string>;
    contextByUpdateId?: Map<string, ProjectUpdateContextSummary>;
    fromProjects?: Map<string, { title: string; slug: string | null }>;
}): ProjectUpdateView {
    const shared = row.projectId !== params.access.project?.id;
    const viewerId = params.access.viewerId;
    const canModerate = params.access.canManage;
    const isAuthor = Boolean(viewerId && row.authorId === viewerId);
    const deleted = Boolean(row.deletedAt);
    return {
        id: row.id,
        projectId: row.projectId,
        authorId: row.authorId,
        author: normalizeAuthor(row, params.access.project?.ownerId ?? null, authorRoleSnapshotFromMetadata(row.metadata)),
        content: deleted ? "" : row.content,
        updateType: normalizeProjectUpdateType(row.updateType),
        visibility: row.visibility === "members" ? "members" : "public",
        replyPolicy: row.replyPolicy === "members" || row.replyPolicy === "closed" ? row.replyPolicy : "logged_in",
        entityRefs: normalizeEntityRefs(row.entityRefs),
        context: params.contextByUpdateId?.get(row.id) ?? {},
        media: normalizeMedia(row.media),
        metadata: normalizeMetadata(row.metadata),
        // A shared post is pinned only by the org, in the org feed (report §17.6).
        isPinned: shared ? Boolean(params.access.org?.kind === "org" && params.access.org.sharedPinIds.includes(row.id)) : isPinnedNow(Boolean(row.isPinned), row.pinnedUntil ?? null),
        pinnedUntil: toIsoString(row.pinnedUntil),
        audience: (row.audience ?? {}) as UpdateAudience,
        fromProject: shared ? params.fromProjects?.get(row.projectId) ?? null : null,
        likeCount: Math.max(0, row.likeCount ?? 0),
        commentCount: Math.max(0, row.commentCount ?? 0),
        likedByViewer: params.likedIds.has(row.id),
        canEdit: !deleted && isAuthor,
        canDelete: !deleted && (isAuthor || canModerate),
        // Org admins pin shared posts in the org feed only (report §17.6).
        canPin: !deleted && canModerate && (!shared || Boolean(params.access.org?.kind === "org" && params.access.org.isOrgAdmin)),
        sharedToOrgTitle: !shared && row.sharedToOrgAt && params.access.org?.kind === "child" ? params.access.org.orgTitle : null,
        // ponytail: shared posts take comments in their own project; the card checks there on submit.
        canComment: !deleted && Boolean(viewerId) && params.access.canRead && row.replyPolicy !== "closed" && (
            row.replyPolicy !== "members" || params.access.isOwner || params.access.isMember || shared
        ),
        editedAt: toIsoString(row.editedAt),
        deletedAt: toIsoString(row.deletedAt),
        createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
        updatedAt: toIsoString(row.updatedAt) ?? new Date().toISOString(),
    };
}

function projectUpdateContextFallbackLabel(
    context: ProjectUpdateContextSummary | null | undefined,
    media: ProjectUpdateMediaItem[] | null | undefined,
) {
    const references = context?.references?.length
        ? context.references
        : [
            context?.task ?? null,
            context?.sprint ?? null,
            context?.file ?? null,
        ].filter((item): item is ProjectUpdateContextOption => Boolean(item));
    if (references.length > 0) {
        return references.slice(0, 3).map((item) => item.label).join(", ");
    }
    const mediaItems = normalizeMedia(media);
    if (mediaItems.length > 0) {
        const namedMedia = mediaItems
            .map((item) => item.label || item.altText || null)
            .filter((item): item is string => Boolean(item));
        return namedMedia.length > 0 ? namedMedia.slice(0, 3).join(", ") : "Attached project media";
    }
    return "Project update";
}

function projectUpdateNotificationBody(input: {
    content: string;
    context?: ProjectUpdateContextSummary | null;
    media?: ProjectUpdateMediaItem[] | null;
    maxLength?: number;
}) {
    const body = projectUpdateExcerpt(input.content, input.maxLength ?? 180);
    return body || projectUpdateContextFallbackLabel(input.context, input.media);
}

async function readUpdateRowsByIds(updateIds: string[], access: ProjectUpdateAccess) {
    if (!access.project || updateIds.length === 0) return [];
    const rows = await db
        .select({
            id: projectUpdates.id,
            projectId: projectUpdates.projectId,
            authorId: projectUpdates.authorId,
            content: projectUpdates.content,
            updateType: projectUpdates.updateType,
            visibility: projectUpdates.visibility,
            replyPolicy: projectUpdates.replyPolicy,
            entityRefs: projectUpdates.entityRefs,
            media: projectUpdates.media,
            metadata: projectUpdates.metadata,
            isPinned: projectUpdates.isPinned,
            audience: projectUpdates.audience,
            notifyLevel: projectUpdates.notifyLevel,
            pinnedUntil: projectUpdates.pinnedUntil,
            sharedToOrgAt: projectUpdates.sharedToOrgAt,
            likeCount: projectUpdates.likeCount,
            commentCount: projectUpdates.commentCount,
            deletedBy: projectUpdates.deletedBy,
            editedAt: projectUpdates.editedAt,
            deletedAt: projectUpdates.deletedAt,
            createdAt: projectUpdates.createdAt,
            updatedAt: projectUpdates.updatedAt,
            authorFullName: profiles.fullName,
            authorUsername: profiles.username,
            authorAvatarUrl: profiles.avatarUrl,
            authorMembershipRole: projectMembers.role,
        })
        .from(projectUpdates)
        .leftJoin(profiles, eq(profiles.id, projectUpdates.authorId))
        .leftJoin(projectMembers, and(
            eq(projectMembers.projectId, projectUpdates.projectId),
            eq(projectMembers.userId, projectUpdates.authorId),
        ))
        .where(and(
            inArray(projectUpdates.id, updateIds),
            // The org feed's own rule covers its posts and the posts shared up to it (report §17.6).
            access.org?.kind === "org" ? undefined : eq(projectUpdates.projectId, access.project.id),
            access.isOwner || access.isMember ? undefined : eq(projectUpdates.visibility, "public"),
            orgAudienceWhere(access),
        ));
    return hydrateUpdateRowsWithRoleTitles(access.project.id, rows);
}

async function likedUpdateIds(updateIds: string[], viewerId: string | null) {
    if (!viewerId || updateIds.length === 0) return new Set<string>();
    const rows = await db
        .select({ updateId: projectUpdateLikes.updateId })
        .from(projectUpdateLikes)
        .where(and(
            eq(projectUpdateLikes.userId, viewerId),
            inArray(projectUpdateLikes.updateId, updateIds),
        ));
    return new Set(rows.map((row) => row.updateId));
}

async function contextSummariesForRows(rows: Array<Pick<UpdateRow, "id" | "entityRefs">>, access: ProjectUpdateAccess) {
    const summaries = new Map<string, ProjectUpdateContextSummary>();
    if (!access.project || rows.length === 0) return summaries;

    const taskIds = new Set<string>();
    const sprintIds = new Set<string>();
    const fileIds = new Set<string>();
    const refsByUpdate = new Map<string, ProjectUpdateEntityRefs>();

    rows.forEach((row) => {
        const refs = normalizeEntityRefs(row.entityRefs);
        refsByUpdate.set(row.id, refs);
        if (refs.taskId) taskIds.add(refs.taskId);
        if (refs.sprintId) sprintIds.add(refs.sprintId);
        if (refs.fileId) fileIds.add(refs.fileId);
        for (const reference of refs.references ?? []) {
            if (reference.kind === "task") taskIds.add(reference.id);
            if (reference.kind === "sprint") sprintIds.add(reference.id);
            if (reference.kind === "file") fileIds.add(reference.id);
        }
    });

    // Each reference is hydrated only when its tab is visible to this viewer;
    // task-owned and /.system files need Tasks visibility (COR-038).
    const canReadTasks = canReadProjectUpdateTargetTab(access, "task");
    const canReadSprints = canReadProjectUpdateTargetTab(access, "sprint");
    const canReadFiles = canReadProjectUpdateTargetTab(access, "file");
    const [taskRows, sprintRows, fileRows] = await Promise.all([
        canReadTasks && taskIds.size > 0
            ? db
                .select({
                    id: tasks.id,
                    title: tasks.title,
                    status: tasks.status,
                    taskNumber: tasks.taskNumber,
                })
                .from(tasks)
                .where(and(eq(tasks.projectId, access.project.id), isNull(tasks.deletedAt), inArray(tasks.id, Array.from(taskIds))))
            : Promise.resolve([]),
        canReadSprints && sprintIds.size > 0
            ? db
                .select({
                    id: projectSprints.id,
                    name: projectSprints.name,
                    status: projectSprints.status,
                    goal: projectSprints.goal,
                })
                .from(projectSprints)
                .where(and(eq(projectSprints.projectId, access.project.id), inArray(projectSprints.id, Array.from(sprintIds))))
            : Promise.resolve([]),
        canReadFiles && fileIds.size > 0
            ? db
                .select({
                    id: projectNodes.id,
                    name: projectNodes.name,
                    path: projectNodes.path,
                    mimeType: projectNodes.mimeType,
                })
                .from(projectNodes)
                .where(and(
                    eq(projectNodes.projectId, access.project.id),
                    eq(projectNodes.type, "file"),
                    isNull(projectNodes.deletedAt),
                    inArray(projectNodes.id, Array.from(fileIds)),
                    canReadTasks ? undefined : projectContentNodeSql,
                    orgFileAccessSql(access),
                ))
            : Promise.resolve([]),
    ]);

    const taskOptions = new Map(taskRows.map((row) => [row.id, taskContextOption(row, access.project!)]));
    const sprintOptions = new Map(sprintRows.map((row) => [row.id, sprintContextOption(row, access.project!)]));
    const fileOptions = new Map(fileRows.map((row) => [row.id, fileContextOption(row, access.project!)]));

    refsByUpdate.forEach((refs, updateId) => {
        const orderedReferences = (refs.references ?? []).flatMap((reference) => {
            if (reference.kind === "task") return taskOptions.get(reference.id) ?? [];
            if (reference.kind === "sprint") return sprintOptions.get(reference.id) ?? [];
            return fileOptions.get(reference.id) ?? [];
        });
        summaries.set(updateId, {
            task: refs.taskId ? taskOptions.get(refs.taskId) ?? null : null,
            sprint: refs.sprintId ? sprintOptions.get(refs.sprintId) ?? null : null,
            file: refs.fileId ? fileOptions.get(refs.fileId) ?? null : null,
            references: orderedReferences.length > 0
                ? orderedReferences
                : [
                    refs.taskId ? taskOptions.get(refs.taskId) ?? null : null,
                    refs.sprintId ? sprintOptions.get(refs.sprintId) ?? null : null,
                    refs.fileId ? fileOptions.get(refs.fileId) ?? null : null,
                ].filter((option): option is ProjectUpdateContextOption => Boolean(option)),
        });
    });

    return summaries;
}

/** An org's own posts are read through its audience rule (report §17.3). */
function orgAudienceWhere(access: ProjectUpdateAccess) {
    return access.org?.kind === "org" ? orgFeedWhere(access.org, access.viewerId, "all") : undefined;
}

function updateCursorCondition(cursor: ProjectUpdateCursor | null, pinned: SQL<boolean> | typeof projectUpdates.isPinned = projectUpdates.isPinned) {
    if (!cursor) return undefined;
    const cursorDate = new Date(cursor.createdAt);
    if (Number.isNaN(cursorDate.getTime())) return undefined;
    const afterWithinBucket = or(
        lt(projectUpdates.createdAt, cursorDate),
        and(eq(projectUpdates.createdAt, cursorDate), lt(projectUpdates.id, cursor.id)),
    );
    if (cursor.pinned) {
        return or(and(sql`${pinned}`, afterWithinBucket), sql`NOT ${pinned}`);
    }
    // Row comparison lets the member-feed index seek to the cursor instead of filtering every newer row.
    return and(sql`NOT ${pinned}`, sql`(${projectUpdates.createdAt}, ${projectUpdates.id}) < (${cursorDate}, ${cursor.id}::uuid)`);
}

export async function readProjectUpdatesAction(projectId: string, params?: {
    cursor?: string | null;
    filter?: ProjectUpdateFilter | string | null;
}) {
    const startedAt = performance.now();
    try {
        const viewer = await getViewerAuthContext();
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.canRead || !access.project) {
            return { success: false as const, error: "Project updates are unavailable.", data: { updates: [], nextCursor: null, hasMore: false, movementSummary: null } };
        }

        const filter = normalizeProjectUpdateFilter(params?.filter ?? "all");
        const cursor = decodeUpdateCursor(params?.cursor);
        // The org feed (report §17.5): own posts by audience plus posts shared up from child projects.
        const orgFeed = access.org?.kind === "org" ? access.org : null;
        const pinned = orgFeed ? orgLivePinSql(orgFeed.orgId) : projectUpdates.isPinned;
        const scope = orgFeed
            ? orgFeedWhere(orgFeed, viewer.userId, filter === "all" || filter === "from_projects" || filter === "announcement" || filter === "discussion" ? filter : "all")
            : and(
                eq(projectUpdates.projectId, projectId),
                access.isOwner || access.isMember ? undefined : eq(projectUpdates.visibility, "public"),
            );
        const rawRows = await db
            .select({
                id: projectUpdates.id,
                projectId: projectUpdates.projectId,
                authorId: projectUpdates.authorId,
                content: projectUpdates.content,
                updateType: projectUpdates.updateType,
                visibility: projectUpdates.visibility,
                replyPolicy: projectUpdates.replyPolicy,
                entityRefs: projectUpdates.entityRefs,
                media: projectUpdates.media,
                metadata: projectUpdates.metadata,
                isPinned: projectUpdates.isPinned,
                audience: projectUpdates.audience,
                notifyLevel: projectUpdates.notifyLevel,
                pinnedUntil: projectUpdates.pinnedUntil,
                sharedToOrgAt: projectUpdates.sharedToOrgAt,
                likeCount: projectUpdates.likeCount,
                commentCount: projectUpdates.commentCount,
                deletedBy: projectUpdates.deletedBy,
                editedAt: projectUpdates.editedAt,
                deletedAt: projectUpdates.deletedAt,
                createdAt: projectUpdates.createdAt,
                updatedAt: projectUpdates.updatedAt,
                authorFullName: profiles.fullName,
                authorUsername: profiles.username,
                authorAvatarUrl: profiles.avatarUrl,
                authorMembershipRole: projectMembers.role,
            })
            .from(projectUpdates)
            .leftJoin(profiles, eq(profiles.id, projectUpdates.authorId))
            .leftJoin(projectMembers, and(
                eq(projectMembers.projectId, projectUpdates.projectId),
                eq(projectMembers.userId, projectUpdates.authorId),
            ))
            .where(and(
                scope,
                isNull(projectUpdates.deletedAt),
                filter === "all" || filter === "from_projects" ? undefined : eq(projectUpdates.updateType, filter),
                updateCursorCondition(cursor, pinned),
            ))
            .orderBy(desc(pinned), desc(projectUpdates.createdAt), desc(projectUpdates.id))
            .limit(UPDATES_PAGE_SIZE + 1);

        const rows = await hydrateUpdateRowsWithRoleTitles(projectId, rawRows);
        const pageRows = rows.slice(0, UPDATES_PAGE_SIZE);
        const updateIds = pageRows.map((row) => row.id);
        const [likedIds, contextByUpdateId, fromProjects, lastSeenAt] = await Promise.all([
            likedUpdateIds(updateIds, viewer.userId),
            contextSummariesForRows(pageRows, access),
            readProjectTitles([...new Set(pageRows.filter((row) => row.projectId !== projectId).map((row) => row.projectId))]),
            orgFeed ? readLastSeenUpdates(orgFeed.orgId, viewer.userId) : null,
        ]);
        const updates = pageRows.map((row) => normalizeUpdate(row, { access, likedIds, contextByUpdateId, fromProjects }));
        const last = updates[updates.length - 1] ?? null;
        const durationMs = Math.round(performance.now() - startedAt);
        logger.metric("project_updates.read", {
            module: "projects",
            action: "readProjectUpdates",
            projectId,
            durationMs,
            count: updates.length,
            hasMore: rows.length > UPDATES_PAGE_SIZE,
            cursor: params?.cursor ? "present" : "initial",
        });
        if (durationMs > PROJECT_UPDATE_PERFORMANCE_BUDGETS.readMs) {
            logger.warn("project_updates.read_budget_exceeded", {
                module: "projects",
                projectId,
                durationMs,
                count: updates.length,
            });
        }
        return {
            success: true as const,
            data: {
                updates,
                nextCursor: rows.length > UPDATES_PAGE_SIZE && last ? encodeUpdateCursor(last) : null,
                hasMore: rows.length > UPDATES_PAGE_SIZE,
                movementSummary: null,
                /** Org feed only: when the viewer last opened it, for New markers. */
                lastSeenAt,
                org: access.org ? {
                    kind: access.org.kind,
                    title: access.org.orgTitle,
                    isAdmin: access.org.isOrgAdmin,
                    shareBlockedReason: access.org.shareBlockedReason,
                    notifyDefault: access.org.notifyDefault,
                } : null,
                capabilities: {
                    canCreate: access.canCreate,
                    canManage: access.canManage,
                    canInteract: Boolean(viewer.userId),
                },
            },
        };
    } catch (error) {
        console.error("Failed to read project updates:", error);
        return { success: false as const, error: "Failed to load project updates", data: { updates: [], nextCursor: null, hasMore: false, movementSummary: null } };
    }
}

export async function readProjectUpdateAction(projectId: string, updateId: string) {
    try {
        const viewer = await getViewerAuthContext();
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.canRead || !access.project) return { success: false as const, error: "Project update unavailable.", data: null };
        const rows = await readUpdateRowsByIds([updateId], access);
        const [likedIds, contextByUpdateId] = await Promise.all([
            likedUpdateIds(rows.map((row) => row.id), viewer.userId),
            contextSummariesForRows(rows, access),
        ]);
        const update = rows[0] ? normalizeUpdate(rows[0], { access, likedIds, contextByUpdateId }) : null;
        return update
            ? { success: true as const, data: update }
            : { success: false as const, error: "Project update not found.", data: null };
    } catch (error) {
        console.error("Failed to read project update:", error);
        return { success: false as const, error: "Failed to load project update", data: null };
    }
}

async function readContextOptionsForKind(params: {
    projectId: string;
    project: { id: string; slug: string | null };
    kind: ProjectUpdateContextKind;
    query: string;
    limit: number;
}) {
    const like = `%${params.query.replace(/[%_]/g, "\\$&")}%`;
    if (params.kind === "task") {
        const conditions = [eq(tasks.projectId, params.projectId), isNull(tasks.deletedAt)];
        if (params.query) conditions.push(or(ilike(tasks.title, like), sql`${tasks.taskNumber}::text ILIKE ${like}`)!);
        const rows = await db
            .select({
                id: tasks.id,
                title: tasks.title,
                status: tasks.status,
                taskNumber: tasks.taskNumber,
            })
            .from(tasks)
            .where(and(...conditions))
            .orderBy(desc(tasks.updatedAt))
            .limit(params.limit);
        return rows.map((row) => taskContextOption(row, params.project));
    }

    if (params.kind === "sprint") {
        const conditions = [eq(projectSprints.projectId, params.projectId)];
        if (params.query) conditions.push(or(ilike(projectSprints.name, like), ilike(projectSprints.goal, like), ilike(projectSprints.description, like))!);
        const rows = await db
            .select({
                id: projectSprints.id,
                name: projectSprints.name,
                status: projectSprints.status,
                goal: projectSprints.goal,
            })
            .from(projectSprints)
            .where(and(...conditions))
            .orderBy(desc(projectSprints.updatedAt))
            .limit(params.limit);
        return rows.map((row) => sprintContextOption(row, params.project));
    }

    const conditions = [eq(projectNodes.projectId, params.projectId), eq(projectNodes.type, "file"), isNull(projectNodes.deletedAt)];
    if (params.query) conditions.push(or(ilike(projectNodes.name, like), ilike(projectNodes.path, like))!);
    const rows = await db
        .select({
            id: projectNodes.id,
            name: projectNodes.name,
            path: projectNodes.path,
            mimeType: projectNodes.mimeType,
        })
        .from(projectNodes)
        .where(and(...conditions))
        .orderBy(desc(projectNodes.updatedAt))
        .limit(params.limit);
    return rows.map((row) => fileContextOption(row, params.project));
}

export async function readProjectUpdateContextOptionsAction(projectId: string, input?: {
    kind?: ProjectUpdateContextKind | "all" | string | null;
    query?: string | null;
    limit?: number | null;
}) {
    try {
        const viewer = await getViewerAuthContext();
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.canCreate || !access.project) {
            return { success: false as const, error: "Project update context is unavailable.", data: { task: [], sprint: [], file: [] } };
        }

        const requestedKind = input?.kind === "task" || input?.kind === "sprint" || input?.kind === "file"
            ? input.kind
            : "all";
        const query = typeof input?.query === "string" ? input.query.trim().slice(0, 80) : "";
        const limit = Math.max(1, Math.min(12, Math.trunc(Number(input?.limit ?? 6))));
        const kinds: ProjectUpdateContextKind[] = requestedKind === "all" ? ["task", "sprint", "file"] : [requestedKind];
        const entries = await Promise.all(kinds.map(async (kind) => [
            kind,
            await readContextOptionsForKind({ projectId, project: access.project!, kind, query, limit }),
        ] as const));
        const data: Record<ProjectUpdateContextKind, ProjectUpdateContextOption[]> = { task: [], sprint: [], file: [] };
        entries.forEach(([kind, options]) => { data[kind] = options; });
        return { success: true as const, data };
    } catch (error) {
        logger.warn("project_updates.context_options_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to load project update context.", data: { task: [], sprint: [], file: [] } };
    }
}

export async function createProjectUpdateMediaUploadUrlAction(projectId: string, input: {
    mimeType?: string | null;
    sizeBytes?: number | null;
    altText?: string | null;
}) {
    try {
        const viewer = await getViewerAuthContext();
        if (!viewer.userId) return { success: false as const, error: "Please log in to upload media." };
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.canCreate || !access.project) return { success: false as const, error: "You do not have permission to upload update media." };
        const rate = await consumeRateLimit(`project-update-media:create:${viewer.userId}`, 20, 60 * 60);
        if (!rate.allowed) return { success: false as const, error: "Too many media uploads. Please wait and try again." };

        const mimeType = normalizeAndValidateMimeType(input.mimeType);
        if (!PROJECT_UPDATE_ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
            return { success: false as const, error: "Unsupported image type. Use JPG, PNG, WebP, or GIF." };
        }
        const sizeBytes = normalizeAndValidateFileSize(input.sizeBytes, PROJECT_UPDATE_MEDIA_MAX_BYTES, "Update image");
        const extension = projectUpdateImageExtensionFromMimeType(mimeType);
        const storageKey = `projects/${projectId}/update-media/${viewer.userId}/${Date.now()}-${randomUUID()}.${extension}`;
        const intent = await createUploadIntent({
            userId: viewer.userId,
            projectId,
            bucket: PROJECT_UPDATE_MEDIA_BUCKET,
            storageKey,
            scope: "project_update_media",
            kind: "file",
            expectedMimeType: mimeType,
            expectedSize: sizeBytes,
            metadata: {
                kind: "project_update_media",
                projectId,
                altText: typeof input.altText === "string" ? input.altText.trim().slice(0, 240) : null,
            },
        });
        const admin = await createAdminClient();
        const { data, error } = await admin.storage
            .from(PROJECT_UPDATE_MEDIA_BUCKET)
            .createSignedUploadUrl(storageKey, { upsert: false });
        if (error || !data?.signedUrl || !data?.token) {
            return { success: false as const, error: "Failed to prepare update image upload." };
        }
        return {
            success: true as const,
            uploadUrl: data.signedUrl,
            uploadToken: data.token,
            uploadIntentId: intent.id,
            operationId: intent.id,
            storagePath: storageKey,
            bucket: PROJECT_UPDATE_MEDIA_BUCKET,
            contentType: mimeType,
        };
    } catch (error) {
        logger.error("project_updates.media_upload_url_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to prepare update image upload." };
    }
}

export async function finalizeProjectUpdateMediaUploadAction(projectId: string, input: {
    uploadIntentId?: string | null;
    altText?: string | null;
    label?: string | null;
    width?: number | null;
    height?: number | null;
}) {
    try {
        const viewer = await getViewerAuthContext();
        if (!viewer.userId) return { success: false as const, error: "Please log in to finalize media." };
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.canCreate || !access.project) return { success: false as const, error: "You do not have permission to upload update media." };
        if (!input.uploadIntentId) return { success: false as const, error: "Missing upload intent." };
        const intent = await finalizeUploadIntent({
            intentId: input.uploadIntentId,
            bucket: PROJECT_UPDATE_MEDIA_BUCKET,
            userId: viewer.userId,
            projectId,
            expectedScope: "project_update_media",
            expectedKind: "file",
        });
        const media: ProjectUpdateMediaItem = {
            type: "image",
            assetId: intent.assetId,
            url: projectUpdateMediaApplicationUrl(intent.bucket, intent.storageKey),
            label: typeof input.label === "string" && input.label.trim() ? input.label.trim().slice(0, 160) : null,
            altText: typeof input.altText === "string" && input.altText.trim() ? input.altText.trim().slice(0, 240) : null,
            mimeType: intent.finalizedMimeType || intent.expectedMimeType || "image/jpeg",
            size: intent.finalizedSize ?? intent.expectedSize ?? null,
            width: parsePositiveInteger(input.width),
            height: parsePositiveInteger(input.height),
            bucket: intent.bucket,
            storageKey: intent.storageKey,
        };
        return { success: true as const, media };
    } catch (error) {
        logger.error("project_updates.media_finalize_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to finalize update image." };
    }
}

const PIN_LIMIT_MESSAGE = "Up to 3 posts can be pinned. Unpin one first.";

/** The 0245 trigger refuses a pin over the project's limit. */
function isPinLimitError(error: unknown) {
    const text = `${error instanceof Error ? error.message : ""} ${error instanceof Error && error.cause instanceof Error ? error.cause.message : ""}`;
    return text.includes("project_update_pin_limit");
}

function futureDate(value: string | null | undefined) {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) && date.getTime() > Date.now() ? date : null;
}

/** Org post rules (report §17.2–17.6): announcement and discussion types, audience, notify, pin, comments off, share up. */
async function resolveOrgPostOptions(access: ProjectUpdateAccess, updateType: ProjectUpdateType | null, input: {
    audience?: UpdateAudience | null;
    notifyLevel?: string | null;
    pin?: boolean;
    pinnedUntil?: string | null;
    commentsOff?: boolean;
    shareToOrg?: boolean;
}) {
    const inOrg = access.org?.kind === "org";
    const orgAdmin = inOrg && access.canManage;
    if (updateType === "announcement" && !orgAdmin) return { error: "Only organization admins post announcements." };
    if (updateType === "discussion" && !inOrg) return { error: "Discussions are for organizations." };
    if (input.shareToOrg) {
        if (access.org?.kind !== "child") return { error: "Only workspaces in an organization can share to it." };
        if (access.org.shareBlockedReason) return { error: access.org.shareBlockedReason };
    }
    let audience: UpdateAudience = {};
    if (orgAdmin && input.audience) {
        const roles = (input.audience.roles ?? []).filter((role) => role === "admin" || role === "member" || role === "viewer");
        const wanted = (input.audience.projectIds ?? []).filter((id) => isLooseUuid(id));
        const projectIds = wanted.length === 0 ? [] : (await db.select({ id: projects.id }).from(projects)
            .where(and(eq(projects.parentId, access.project!.id), inArray(projects.id, wanted), isNull(projects.deletedAt)))).map((row) => row.id);
        audience = { ...(roles.length ? { roles } : {}), ...(projectIds.length ? { projectIds } : {}) };
    }
    return {
        audience,
        // ponytail: stored only; email sending lands with notifications (P14).
        notifyLevel: orgAdmin && (input.notifyLevel ?? access.org?.notifyDefault) === "email" ? "email" as const : "in_app" as const,
        pin: Boolean(orgAdmin && input.pin),
        pinnedUntil: orgAdmin && input.pin ? futureDate(input.pinnedUntil) : null,
        commentsOff: Boolean(orgAdmin && input.commentsOff),
        shareToOrg: Boolean(input.shareToOrg),
    };
}

export async function createProjectUpdateAction(projectId: string, input: {
    content: string;
    updateType?: ProjectUpdateType | string | null;
    visibility?: ProjectUpdateVisibility | string | null;
    replyPolicy?: ProjectUpdateReplyPolicy | string | null;
    entityRefs?: ProjectUpdateEntityRefs | null;
    media?: ProjectUpdateMediaItem[] | null;
    /** Org options (report §17): admins only, except shareToOrg in child projects. */
    audience?: UpdateAudience | null;
    notifyLevel?: "in_app" | "email" | null;
    pin?: boolean;
    pinnedUntil?: string | null;
    commentsOff?: boolean;
    shareToOrg?: boolean;
    /** Org announcements: also post a live card in #general (report §25.5). */
    shareToGeneral?: boolean;
}) {
    const startedAt = performance.now();
    try {
        const viewer = await getViewerProfileContext();
        if (!viewer.userId) return { success: false as const, error: "Please log in to post updates." };
        const rate = await consumeRateLimit(`project-update:create:${viewer.userId}`, 30, 60);
        if (!rate.allowed) return { success: false as const, error: "Too many updates. Please wait and try again." };

        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.canCreate || !access.project) return { success: false as const, error: "You do not have permission to post project updates." };

        const updateType = normalizeProjectUpdateType(input.updateType);
        const visibility: ProjectUpdateVisibility = input.visibility === "members" ? "members" : "public";
        const orgOptions = await resolveOrgPostOptions(access, updateType, input);
        if ("error" in orgOptions) return { success: false as const, error: orgOptions.error };
        const replyPolicy: ProjectUpdateReplyPolicy = orgOptions.commentsOff ? "closed" : input.replyPolicy === "members" ? "members"
            : input.replyPolicy === "logged_in" ? "logged_in" : access.org?.kind === "org" ? access.org.replyDefault : "logged_in";
        const entityRefs = normalizeEntityRefs(input.entityRefs);
        const media = normalizeMedia(input.media);
        const content = sanitizeProjectUpdateContent(input.content);
        const hasReferences = normalizeProjectUpdateReferences(entityRefs.references).length > 0
            || Boolean(entityRefs.taskId || entityRefs.sprintId || entityRefs.fileId);
        const hasMedia = media.length > 0;
        if (!content && !hasReferences && !hasMedia) return { success: false as const, error: "Update cannot be empty." };
        const createdAt = new Date();
        const authorRoleSnapshot = await readAuthorRoleSnapshot({
            projectId,
            userId: viewer.userId,
            projectOwnerId: access.project.ownerId,
            memberRole: access.memberRole,
        });
        const inserted = await db.transaction(async (tx) => {
            const [row] = await tx
                .insert(projectUpdates)
                .values({
                    projectId,
                    authorId: viewer.userId,
                    content,
                    updateType,
                    visibility,
                    replyPolicy,
                    entityRefs,
                    media,
                    metadata: { authorRoleSnapshot },
                    audience: orgOptions.audience,
                    notifyLevel: orgOptions.notifyLevel,
                    isPinned: orgOptions.pin,
                    pinnedUntil: orgOptions.pinnedUntil,
                    sharedToOrgAt: orgOptions.shareToOrg ? createdAt : null,
                    createdAt,
                    updatedAt: createdAt,
                })
                .returning({ id: projectUpdates.id });
            if (!row) throw new Error("Failed to create project update");
            await replaceUpdateMediaAssetRefs({
                tx,
                updateId: row.id,
                projectId,
                ownerUserId: viewer.userId!,
                media,
            });
            return row;
        });

        if (!inserted?.id) return { success: false as const, error: "Failed to post update." };

        const rows = await readUpdateRowsByIds([inserted.id], access);
        const contextByUpdateId = await contextSummariesForRows(rows, access);
        const update = rows[0] ? normalizeUpdate(rows[0], { access, likedIds: new Set(), contextByUpdateId }) : null;

        const shouldNotifyFollowers = visibility === "public"
            && access.project.visibility === "public"
            && shouldNotifyProjectUpdateFollowers({ content, entityRefs, media });
        if (shouldNotifyFollowers) {
            try {
                const actorName = viewer.profile?.fullName ?? viewer.profile?.username ?? null;
                const notificationBody = projectUpdateNotificationBody({
                    content,
                    context: update?.context ?? null,
                    media,
                });
                await enqueueProjectNotificationEvent({
                    projectId,
                    actorUserId: viewer.userId,
                    actorName,
                    actorAvatarUrl: viewer.profile?.avatarUrl ?? null,
                    eventKey: "updates.published",
                    title: `${actorName || "Someone"} posted an update in ${access.project.title || "Project"}`,
                    body: notificationBody,
                    href: projectHref(access.project, inserted.id),
                    entityRefs: {
                        projectId,
                        projectSlug: access.project.slug ?? null,
                        updateId: inserted.id,
                        createdAt: createdAt.toISOString(),
                    },
                    preview: {
                        actorName,
                        actorAvatarUrl: viewer.profile?.avatarUrl ?? null,
                        contextLabel: access.project.title ?? "Project update",
                        contextKind: "project",
                        secondaryText: null,
                    },
                    sourceEventId: inserted.id,
                    maxRecipients: PROJECT_UPDATE_PERFORMANCE_BUDGETS.fanoutSyncRecipients,
                });
            } catch (notifyError) {
                logger.warn("project_updates.notification_failed", {
                    module: "notifications",
                    projectId,
                    updateId: inserted.id,
                    error: notifyError instanceof Error ? notifyError.message : String(notifyError),
                });
            }
        } else {
            logger.info("project_updates.notification_skipped_low_signal", {
                module: "projects",
                projectId,
                count: content.length,
            });
        }

        if (input.shareToGeneral && updateType === "announcement" && access.org?.kind === "org" && access.canManage) {
            await shareToOrgGeneral(projectId, viewer.userId, { kind: "announcement", ref_id: inserted.id });
        }
        // Org announcements: tray and push for the audience, E9 when the post asked for email (report §26.3 E).
        if (updateType === "announcement" && access.org?.kind === "org" && access.canManage) {
            await notifyAnnouncement({ orgId: projectId, updateId: inserted.id, actorId: viewer.userId, content, audience: orgOptions.audience ?? null, email: orgOptions.notifyLevel === "email" });
        }
        revalidatePath(projectBaseHref(access.project)); // paths never carry a query string
        const durationMs = Math.round(performance.now() - startedAt);
        logger.metric("project_updates.create", {
            module: "projects",
            action: "createProjectUpdate",
            projectId,
            durationMs,
            count: content.length,
            status: shouldNotifyFollowers ? "notified" : "feed-only",
        });
        if (durationMs > PROJECT_UPDATE_PERFORMANCE_BUDGETS.createMs) {
            logger.warn("project_updates.create_budget_exceeded", {
                module: "projects",
                projectId,
                durationMs,
                count: content.length,
            });
        }
        return { success: true as const, data: update };
    } catch (error) {
        if (isPinLimitError(error)) return { success: false as const, error: PIN_LIMIT_MESSAGE };
        console.error("Failed to create project update:", error);
        return { success: false as const, error: "Failed to post update." };
    }
}

export async function editProjectUpdateAction(projectId: string, updateId: string, input: {
    content: string;
    updateType?: ProjectUpdateType | string | null;
    entityRefs?: ProjectUpdateEntityRefs | null;
    media?: ProjectUpdateMediaItem[] | null;
    /** Org announcements (report §17.4): an edit tells the audience again only when asked. */
    notifyAgain?: boolean;
}) {
    try {
        const viewer = await getViewerAuthContext();
        if (!viewer.userId) return { success: false as const, error: "Please log in to edit updates." };
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.canRead || !access.project) return { success: false as const, error: "Project update unavailable." };
        const content = sanitizeProjectUpdateContent(input.content);
        const entityRefs = normalizeEntityRefs(input.entityRefs);
        const media = normalizeMedia(input.media);
        const hasReferences = normalizeProjectUpdateReferences(entityRefs.references).length > 0
            || Boolean(entityRefs.taskId || entityRefs.sprintId || entityRefs.fileId);
        const hasMedia = media.length > 0;
        if (!content && !hasReferences && !hasMedia) return { success: false as const, error: "Update cannot be empty." };
        const now = new Date();
        await db.transaction(async (tx) => {
            const [existing] = await tx
                .select({
                    authorId: projectUpdates.authorId,
                    deletedAt: projectUpdates.deletedAt,
                    media: projectUpdates.media,
                })
                .from(projectUpdates)
                .where(and(eq(projectUpdates.id, updateId), eq(projectUpdates.projectId, projectId)))
                .limit(1)
                .for("update");
            if (!existing || existing.deletedAt) throw new Error("Project update not found.");
            if (existing.authorId !== viewer.userId) throw new Error("You can only edit your own update.");
            const allowedLegacyBindings = new Set(
                normalizeMedia(existing.media)
                    .filter((item) => !item.assetId && item.bucket && item.storageKey)
                    .map(updateMediaBinding),
            );
            await queueRemovedLegacyUpdateMedia({
                tx,
                sourceType: "project_update_media",
                sourceId: updateId,
                projectId,
                previous: existing.media,
                next: media,
            });
            await replaceUpdateMediaAssetRefs({
                tx,
                updateId,
                projectId,
                ownerUserId: viewer.userId!,
                media,
                allowedLegacyBindings,
            });
            await tx
                .update(projectUpdates)
                .set({
                    content,
                    // An edit that leaves the type out keeps it, so an announcement stays one.
                    ...(input.updateType === undefined ? {} : { updateType: normalizeProjectUpdateType(input.updateType) }),
                    entityRefs,
                    media,
                    editedAt: now,
                    updatedAt: now,
                })
                .where(eq(projectUpdates.id, updateId));
        });
        const rows = await readUpdateRowsByIds([updateId], access);
        const [likedIds, contextByUpdateId] = await Promise.all([
            likedUpdateIds([updateId], viewer.userId),
            contextSummariesForRows(rows, access),
        ]);
        if (input.notifyAgain && access.org?.kind === "org" && access.org.isOrgAdmin && rows[0]?.updateType === "announcement") {
            await notifyAnnouncement({ orgId: access.org.orgId, updateId, actorId: viewer.userId, content, audience: (rows[0].audience ?? {}) as UpdateAudience, email: false, again: true });
        }
        return { success: true as const, data: rows[0] ? normalizeUpdate(rows[0], { access, likedIds, contextByUpdateId }) : null };
    } catch (error) {
        console.error("Failed to edit project update:", error);
        return { success: false as const, error: "Failed to edit update." };
    }
}

export async function deleteProjectUpdateAction(projectId: string, updateId: string, reason?: string | null) {
    try {
        const viewer = await getViewerAuthContext();
        if (!viewer.userId) return { success: false as const, error: "Please log in to delete updates." };
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.canRead || !access.project) return { success: false as const, error: "Project update unavailable." };
        const now = new Date();
        let removedAuthorId: string | null = null;
        await db.transaction(async (tx) => {
            const [existing] = await tx
                .select({
                    id: projectUpdates.id,
                    authorId: projectUpdates.authorId,
                    deletedAt: projectUpdates.deletedAt,
                    media: projectUpdates.media,
                })
                .from(projectUpdates)
                .where(and(eq(projectUpdates.id, updateId), eq(projectUpdates.projectId, projectId)))
                .limit(1)
                .for("update");
            if (!existing || existing.deletedAt) throw new Error("Project update not found.");
            if (existing.authorId !== viewer.userId && !access.canManage) {
                throw new Error("You do not have permission to delete this update.");
            }
            // In an org or child project, removing someone else's post needs a reason, which the author hears (report §17.4).
            if (existing.authorId && existing.authorId !== viewer.userId && access.org) {
                if (!reason?.trim()) throw new ModerationReasonError();
                removedAuthorId = existing.authorId;
            }
            await queueRemovedLegacyUpdateMedia({
                tx,
                sourceType: "project_update_media",
                sourceId: updateId,
                projectId,
                previous: existing.media,
                next: [],
            });
            await replaceUpdateMediaAssetRefs({
                tx,
                updateId,
                projectId,
                ownerUserId: viewer.userId!,
                media: [],
            });
            await tx
                .update(projectUpdates)
                .set({
                    content: "",
                    entityRefs: {},
                    media: [],
                    metadata: {},
                    deletedAt: now,
                    deletedBy: viewer.userId,
                    isPinned: false,
                    updatedAt: now,
                })
                .where(eq(projectUpdates.id, updateId));
        });

        // Asynchronously clean up storage assets and comments via Inngest background job
        try {
            const { inngest } = await import("@/inngest/client");
            await inngest.send({
                name: "project/updates.cleanup",
                data: {
                    projectId,
                    updateId,
                },
            });
        } catch (inngestErr) {
            console.error("Failed to send project/updates.cleanup event:", inngestErr);
        }

        const rows = await readUpdateRowsByIds([updateId], access);
        const [likedIds, contextByUpdateId] = await Promise.all([
            likedUpdateIds([updateId], viewer.userId),
            contextSummariesForRows(rows, access),
        ]);
        revalidatePath(projectBaseHref(access.project));
        if (removedAuthorId && access.org) {
            await notifyOrg({ orgId: access.org.orgId, eventKey: "org.lifecycle", actorId: viewer.userId, to: [removedAuthorId], title: `Your post was removed: ${reason!.trim().slice(0, 300)}`,
                href: `${projectBaseHref(access.project)}?tab=updates`, sourceEventId: `post-removed:${updateId}` });
        }
        return { success: true as const, data: rows[0] ? normalizeUpdate(rows[0], { access, likedIds, contextByUpdateId }) : null };
    } catch (error) {
        if (error instanceof ModerationReasonError) return { success: false as const, error: error.message };
        console.error("Failed to delete project update:", error);
        return { success: false as const, error: "Failed to delete update." };
    }
}

class ModerationReasonError extends Error {
    constructor() { super("Say why you're removing this post. The author will see it."); }
}

/** An org admin pins a child's shared post in the org feed only (report §17.6); the 3-pin limit counts these too. */
async function countOrgOwnPins(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], orgId: string, exceptId?: string) {
    const [own] = await tx.select({ n: sql<number>`count(*)::int` }).from(projectUpdates)
        .where(and(eq(projectUpdates.projectId, orgId), eq(projectUpdates.isPinned, true), isNull(projectUpdates.deletedAt),
            sql`(${projectUpdates.pinnedUntil} IS NULL OR ${projectUpdates.pinnedUntil} > now())`, exceptId ? sql`${projectUpdates.id} <> ${exceptId}` : undefined));
    return own?.n ?? 0;
}

async function pinSharedInOrgFeed(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], orgId: string, updateId: string, pinned: boolean) {
    const [shared] = await tx.select({ id: projectUpdates.id }).from(projectUpdates)
        .where(and(eq(projectUpdates.id, updateId), isNull(projectUpdates.deletedAt), sql`${projectUpdates.sharedToOrgAt} IS NOT NULL`,
            sql`${projectUpdates.projectId} IN (SELECT id FROM projects WHERE parent_id = ${orgId} AND deleted_at IS NULL)`)).limit(1);
    if (!shared) return false;
    const [org] = await tx.select({ settings: projects.orgSettings }).from(projects).where(eq(projects.id, orgId)).limit(1);
    const current = readSharedPins(org?.settings);
    const next = pinned ? [...new Set([...current, updateId])] : current.filter((id) => id !== updateId);
    if (pinned && !current.includes(updateId)) {
        if ((await countOrgOwnPins(tx, orgId)) + next.length > 3) throw new Error("ORG_PIN_LIMIT");
    }
    await tx.update(projects).set({ orgSettings: sql`coalesce(${projects.orgSettings}, '{}'::jsonb) || jsonb_build_object('sharedPins', ${JSON.stringify(next)}::jsonb)` }).where(eq(projects.id, orgId));
    return true;
}

export async function toggleProjectUpdatePinAction(projectId: string, updateId: string, pinned: boolean, pinnedUntil?: string | null) {
    try {
        const viewer = await getViewerAuthContext();
        if (!viewer.userId) return { success: false as const, error: "Please log in to pin updates." };
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.canManage || !access.project) return { success: false as const, error: "Only the owner and admins can pin updates." };
        const found = await db.transaction(async (tx) => {
            // COR-046: the project row lock serializes pin swaps, and the target is validated before
            // anything is unpinned, so a bad request never clears the current pin.
            await tx.execute(sql`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`);
            const [target] = await tx
                .select({ id: projectUpdates.id })
                .from(projectUpdates)
                .where(and(eq(projectUpdates.id, updateId), eq(projectUpdates.projectId, projectId), isNull(projectUpdates.deletedAt)))
                .limit(1);
            if (!target) return access.org?.kind === "org" ? pinSharedInOrgFeed(tx, access.org.orgId, updateId, pinned) : false;
            const now = new Date();
            // Orgs keep up to 3 pins (the 0245 trigger refuses a 4th); other projects swap their one pin.
            const isOrg = access.project?.kind === "organization";
            // Shared posts pinned in the org feed count toward the same 3.
            if (pinned && isOrg && access.org?.kind === "org"
                && (await countOrgOwnPins(tx, projectId, updateId)) + access.org.sharedPinIds.length >= 3) throw new Error("ORG_PIN_LIMIT");
            if (pinned && !isOrg) {
                await tx
                    .update(projectUpdates)
                    .set({ isPinned: false, updatedAt: now })
                    .where(and(eq(projectUpdates.projectId, projectId), eq(projectUpdates.isPinned, true)));
            }
            await tx
                .update(projectUpdates)
                .set({ isPinned: pinned, pinnedUntil: pinned && isOrg ? futureDate(pinnedUntil) : null, updatedAt: now })
                .where(eq(projectUpdates.id, updateId));
            return true;
        });
        if (!found) return { success: false as const, error: "That update is no longer available." };
        if (access.org?.kind === "org") {
            access.org.sharedPinIds = pinned ? [...new Set([...access.org.sharedPinIds, updateId])] : access.org.sharedPinIds.filter((id) => id !== updateId);
        }
        const rows = await readUpdateRowsByIds([updateId], access);
        const [likedIds, contextByUpdateId] = await Promise.all([
            likedUpdateIds([updateId], viewer.userId),
            contextSummariesForRows(rows, access),
        ]);
        return { success: true as const, data: rows[0] ? normalizeUpdate(rows[0], { access, likedIds, contextByUpdateId }) : null };
    } catch (error) {
        if (isPinLimitError(error) || (error instanceof Error && error.message === "ORG_PIN_LIMIT")) return { success: false as const, error: PIN_LIMIT_MESSAGE };
        console.error("Failed to pin project update:", error);
        return { success: false as const, error: "Failed to update pinned state." };
    }
}

export async function toggleProjectUpdateLikeAction(projectId: string, updateId: string) {
    try {
        const viewer = await getViewerAuthContext();
        if (!viewer.userId) return { success: false as const, error: "Please log in to like updates." };
        // Each toggle is several statements; a tap loop shouldn't be able to hammer them.
        const rate = await consumeRateLimit(`project-update:like:${viewer.userId}`, 120, 60);
        if (!rate.allowed) return { success: false as const, error: "Too many likes. Please wait a moment and try again." };
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.canRead || !access.project) return { success: false as const, error: "Project update unavailable." };
        const [update] = await db
            .select({ id: projectUpdates.id, visibility: projectUpdates.visibility })
            .from(projectUpdates)
            .where(and(
                eq(projectUpdates.id, updateId),
                eq(projectUpdates.projectId, projectId),
                isNull(projectUpdates.deletedAt),
                access.isOwner || access.isMember ? undefined : eq(projectUpdates.visibility, "public"),
            ))
            .limit(1);
        if (!update) return { success: false as const, error: "Project update not found." };

        const result = await db.transaction(async (tx) => {
            const deletedRows = await tx
                .delete(projectUpdateLikes)
                .where(and(eq(projectUpdateLikes.updateId, updateId), eq(projectUpdateLikes.userId, viewer.userId!)))
                .returning({ id: projectUpdateLikes.id });
            if (deletedRows.length > 0) {
                const [countRow] = await tx
                    .update(projectUpdates)
                    .set({ likeCount: sql`GREATEST(${projectUpdates.likeCount} - 1, 0)`, updatedAt: new Date() })
                    .where(eq(projectUpdates.id, updateId))
                    .returning({ likeCount: projectUpdates.likeCount });
                return { liked: false, likeCount: Math.max(0, countRow?.likeCount ?? 0) };
            }
            const insertedRows = await tx
                .insert(projectUpdateLikes)
                .values({ updateId, userId: viewer.userId!, createdAt: new Date() })
                .onConflictDoNothing({
                    target: [projectUpdateLikes.updateId, projectUpdateLikes.userId],
                })
                .returning({ id: projectUpdateLikes.id });
            if (insertedRows.length > 0) {
                const [countRow] = await tx
                    .update(projectUpdates)
                    .set({ likeCount: sql`${projectUpdates.likeCount} + 1`, updatedAt: new Date() })
                    .where(eq(projectUpdates.id, updateId))
                    .returning({ likeCount: projectUpdates.likeCount });
                return { liked: true, likeCount: Math.max(0, countRow?.likeCount ?? 0) };
            }

            const [countRow] = await tx
                .select({ likeCount: projectUpdates.likeCount })
                .from(projectUpdates)
                .where(eq(projectUpdates.id, updateId))
                .limit(1);
            return { liked: true, likeCount: Math.max(0, countRow?.likeCount ?? 0) };
        });
        return { success: true as const, liked: result.liked, likeCount: result.likeCount };
    } catch (error) {
        console.error("Failed to toggle project update like:", error);
        return { success: false as const, error: "Failed to update like." };
    }
}

type CommentRow = typeof projectUpdateComments.$inferSelect & {
    authorFullName: string | null;
    authorUsername: string | null;
    authorAvatarUrl: string | null;
    authorMembershipRole: string | null;
    authorProjectRoleTitle: string | null;
    targetUsername: string | null;
};

function normalizeComment(row: CommentRow, access: ProjectUpdateAccess): ProjectUpdateCommentView {
    const canModerate = access.canManage;
    const isAuthor = Boolean(access.viewerId && row.userId === access.viewerId);
    const deleted = Boolean(row.deletedAt);
    return {
        id: row.id,
        updateId: row.updateId,
        projectId: row.projectId,
        parentId: row.parentId,
        userId: row.userId,
        author: normalizeAuthor({
            authorId: row.userId,
            authorFullName: row.authorFullName,
            authorUsername: row.authorUsername,
            authorAvatarUrl: row.authorAvatarUrl,
            authorMembershipRole: row.authorMembershipRole,
            authorProjectRoleTitle: row.authorProjectRoleTitle,
        }, access.project?.ownerId ?? null),
        content: deleted ? "" : row.content,
        canDelete: !deleted && (isAuthor || canModerate),
        deletedAt: toIsoString(row.deletedAt),
        createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
        updatedAt: toIsoString(row.updatedAt) ?? new Date().toISOString(),
        targetUserId: row.targetUserId,
        targetUsername: row.targetUsername,
    };
}

function commentCursorCondition(cursor: ProjectUpdateCommentCursor | null) {
    if (!cursor) return undefined;
    const cursorDate = new Date(cursor.createdAt);
    if (Number.isNaN(cursorDate.getTime())) return undefined;
    return or(
        gt(projectUpdateComments.createdAt, cursorDate),
        and(eq(projectUpdateComments.createdAt, cursorDate), gt(projectUpdateComments.id, cursor.id)),
    );
}

async function assertReadableUpdate(projectId: string, updateId: string, access: ProjectUpdateAccess) {
    if (!access.canRead || !access.project) return null;
    const [update] = await db
        .select({
            id: projectUpdates.id,
            projectId: projectUpdates.projectId,
            authorId: projectUpdates.authorId,
            replyPolicy: projectUpdates.replyPolicy,
            visibility: projectUpdates.visibility,
            deletedAt: projectUpdates.deletedAt,
        })
        .from(projectUpdates)
        .where(and(
            eq(projectUpdates.id, updateId),
            eq(projectUpdates.projectId, projectId),
            isNull(projectUpdates.deletedAt),
            access.isOwner || access.isMember ? undefined : eq(projectUpdates.visibility, "public"),
            orgAudienceWhere(access),
        ))
        .limit(1);
    return update ?? null;
}

export async function readProjectUpdateCommentsAction(projectId: string, updateId: string, cursor?: string | null) {
    const startedAt = performance.now();
    try {
        const viewer = await getViewerAuthContext();
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        const update = await assertReadableUpdate(projectId, updateId, access);
        if (!update) return { success: false as const, error: "Project update unavailable.", data: { comments: [], nextCursor: null, hasMore: false } };
        const parsedCursor = decodeCommentCursor(cursor);
        const targetProfiles = alias(profiles, "target_profiles");
        const rawRows = await db
            .select({
                id: projectUpdateComments.id,
                updateId: projectUpdateComments.updateId,
                projectId: projectUpdateComments.projectId,
                parentId: projectUpdateComments.parentId,
                userId: projectUpdateComments.userId,
                targetUserId: projectUpdateComments.targetUserId,
                content: projectUpdateComments.content,
                deletedBy: projectUpdateComments.deletedBy,
                deletedAt: projectUpdateComments.deletedAt,
                createdAt: projectUpdateComments.createdAt,
                updatedAt: projectUpdateComments.updatedAt,
                authorFullName: profiles.fullName,
                authorUsername: profiles.username,
                authorAvatarUrl: profiles.avatarUrl,
                authorMembershipRole: projectMembers.role,
                targetUsername: targetProfiles.username,
            })
            .from(projectUpdateComments)
            .leftJoin(profiles, eq(profiles.id, projectUpdateComments.userId))
            .leftJoin(projectMembers, and(
                eq(projectMembers.projectId, projectUpdateComments.projectId),
                eq(projectMembers.userId, projectUpdateComments.userId),
            ))
            .leftJoin(targetProfiles, eq(targetProfiles.id, projectUpdateComments.targetUserId))
            .where(and(
                eq(projectUpdateComments.updateId, updateId),
                eq(projectUpdateComments.projectId, projectId),
                commentCursorCondition(parsedCursor),
            ))
            .orderBy(asc(projectUpdateComments.createdAt), asc(projectUpdateComments.id))
            .limit(COMMENTS_PAGE_SIZE + 1);
        const rows = await hydrateCommentRowsWithRoleTitles(projectId, rawRows);
        const pageRows = rows.slice(0, COMMENTS_PAGE_SIZE);
        const last = pageRows[pageRows.length - 1] ?? null;
        const durationMs = Math.round(performance.now() - startedAt);
        logger.metric("project_updates.comments.read", {
            module: "projects",
            action: "readProjectUpdateComments",
            projectId,
            updateId,
            durationMs,
            count: pageRows.length,
            hasMore: rows.length > COMMENTS_PAGE_SIZE,
            cursor: cursor ? "present" : "initial",
        });
        if (durationMs > PROJECT_UPDATE_PERFORMANCE_BUDGETS.commentMs) {
            logger.warn("project_updates.comments_read_budget_exceeded", {
                module: "projects",
                projectId,
                updateId,
                durationMs,
                count: pageRows.length,
            });
        }
        return {
            success: true as const,
            data: {
                comments: pageRows.map((row) => normalizeComment(row, access)),
                nextCursor: rows.length > COMMENTS_PAGE_SIZE && last ? encodeCommentCursor(last) : null,
                hasMore: rows.length > COMMENTS_PAGE_SIZE,
            },
        };
    } catch (error) {
        console.error("Failed to read project update comments:", error);
        return { success: false as const, error: "Failed to load comments.", data: { comments: [], nextCursor: null, hasMore: false } };
    }
}

export async function createProjectUpdateCommentAction(projectId: string, updateId: string, contentInput: string, parentId?: string | null) {
    const startedAt = performance.now();
    try {
        const viewer = await getViewerProfileContext();
        if (!viewer.userId) return { success: false as const, error: "Please log in to comment." };
        const rate = await consumeRateLimit(`project-update:comment:${viewer.userId}`, 60, 60);
        if (!rate.allowed) return { success: false as const, error: "Too many comments. Please wait and try again." };
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        const update = await assertReadableUpdate(projectId, updateId, access);
        if (!update || !access.project) return { success: false as const, error: "Project update unavailable." };
        const project = access.project;
        if (update.replyPolicy === "closed") return { success: false as const, error: "Comments are off for this post." };
        if (update.replyPolicy === "members" && !access.isOwner && !access.isMember) {
            return { success: false as const, error: "Only project members can comment on this update." };
        }
        const content = sanitizeProjectUpdateContent(contentInput, 1_000);
        if (!content) return { success: false as const, error: "Comment cannot be empty." };
        const createdAt = new Date();

        if (parentId && !isLooseUuid(parentId)) return { success: false as const, error: "Reply target unavailable." };
        const posted = await db.transaction(async (tx) => {
            // COR-039: the parent must be a live comment on this update in this project, read in the write transaction.
            let targetUserId: string | null = null;
            if (parentId) {
                const [parentComment] = await tx
                    .select({ userId: projectUpdateComments.userId })
                    .from(projectUpdateComments)
                    .where(and(
                        eq(projectUpdateComments.id, parentId),
                        eq(projectUpdateComments.updateId, updateId),
                        eq(projectUpdateComments.projectId, projectId),
                        isNull(projectUpdateComments.deletedAt),
                    ))
                    .for("share")
                    .limit(1);
                if (!parentComment) return null;
                targetUserId = parentComment.userId;
            }
            const insertedRows = await tx
                .insert(projectUpdateComments)
                .values({
                    projectId,
                    updateId,
                    parentId: parentId || null,
                    userId: viewer.userId,
                    targetUserId,
                    content,
                    createdAt,
                    updatedAt: createdAt,
                })
                .returning({ id: projectUpdateComments.id });
            await tx
                .update(projectUpdates)
                .set({ commentCount: sql`${projectUpdates.commentCount} + 1`, updatedAt: createdAt })
                .where(eq(projectUpdates.id, updateId));
            return { inserted: insertedRows[0], targetUserId };
        });
        if (!posted) return { success: false as const, error: "Reply target unavailable." };
        const { inserted, targetUserId } = posted;
        if (!inserted?.id) return { success: false as const, error: "Failed to post comment." };

        const actorName = viewer.profile?.fullName ?? viewer.profile?.username ?? null;
        const actorAvatarUrl = viewer.profile?.avatarUrl ?? null;

        after(async () => {
            // 1. Notify target comment author if it's a reply
            if (targetUserId && targetUserId !== viewer.userId) {
                try {
                    await enqueueProjectNotificationEvent({
                        projectId,
                        actorUserId: viewer.userId,
                        actorName,
                        actorAvatarUrl,
                        eventKey: "updates.comment",
                        affectedMemberId: targetUserId,
                        title: `${actorName || "Someone"} replied to your comment`,
                        body: projectUpdateExcerpt(content, 160),
                        href: `${projectHref(project, updateId)}&commentId=${encodeURIComponent(inserted.id)}`,
                        entityRefs: {
                            projectId,
                            projectSlug: project.slug ?? null,
                            updateId,
                            commentId: inserted.id,
                            createdAt: createdAt.toISOString(),
                        },
                        preview: {
                            actorName,
                            actorAvatarUrl,
                            contextLabel: project.title ?? "Project update",
                            contextKind: "project",
                            secondaryText: null,
                        },
                        sourceEventId: inserted.id,
                    });
                } catch (notifyError) {
                    logger.warn("project_updates.comment_reply_notification_failed", {
                        module: "notifications",
                        projectId,
                        updateId,
                        commentId: inserted.id,
                        error: notifyError instanceof Error ? notifyError.message : String(notifyError),
                    });
                }
            }

            // 2. Notify original update author
            if (update.authorId && update.authorId !== viewer.userId && update.authorId !== targetUserId) {
                try {
                    await enqueueProjectNotificationEvent({
                        projectId,
                        actorUserId: viewer.userId,
                        actorName,
                        actorAvatarUrl,
                        eventKey: "updates.comment",
                        affectedMemberId: update.authorId,
                        title: `${actorName || "Someone"} commented on your project update`,
                        body: projectUpdateExcerpt(content, 160),
                        href: `${projectHref(project, updateId)}&commentId=${encodeURIComponent(inserted.id)}`,
                        entityRefs: {
                            projectId,
                            projectSlug: project.slug ?? null,
                            updateId,
                            commentId: inserted.id,
                            createdAt: createdAt.toISOString(),
                        },
                        preview: {
                            actorName,
                            actorAvatarUrl,
                            contextLabel: project.title ?? "Project update",
                            contextKind: "project",
                            secondaryText: null,
                        },
                        sourceEventId: inserted.id,
                    });
                } catch (notifyError) {
                    logger.warn("project_updates.comment_notification_failed", {
                        module: "notifications",
                        projectId,
                        updateId,
                        commentId: inserted.id,
                        error: notifyError instanceof Error ? notifyError.message : String(notifyError),
                    });
                }
            }
        });

        const targetProfiles = alias(profiles, "target_profiles");
        const rawCommentRows = await db
            .select({
                id: projectUpdateComments.id,
                updateId: projectUpdateComments.updateId,
                projectId: projectUpdateComments.projectId,
                parentId: projectUpdateComments.parentId,
                userId: projectUpdateComments.userId,
                targetUserId: projectUpdateComments.targetUserId,
                content: projectUpdateComments.content,
                deletedBy: projectUpdateComments.deletedBy,
                deletedAt: projectUpdateComments.deletedAt,
                createdAt: projectUpdateComments.createdAt,
                updatedAt: projectUpdateComments.updatedAt,
                authorFullName: profiles.fullName,
                authorUsername: profiles.username,
                authorAvatarUrl: profiles.avatarUrl,
                authorMembershipRole: projectMembers.role,
                targetUsername: targetProfiles.username,
            })
            .from(projectUpdateComments)
            .leftJoin(profiles, eq(profiles.id, projectUpdateComments.userId))
            .leftJoin(projectMembers, and(
                eq(projectMembers.projectId, projectUpdateComments.projectId),
                eq(projectMembers.userId, projectUpdateComments.userId),
            ))
            .leftJoin(targetProfiles, eq(targetProfiles.id, projectUpdateComments.targetUserId))
            .where(eq(projectUpdateComments.id, inserted.id))
            .limit(1);
        const [row] = await hydrateCommentRowsWithRoleTitles(projectId, rawCommentRows);
        const durationMs = Math.round(performance.now() - startedAt);
        logger.metric("project_updates.comments.create", {
            module: "projects",
            action: "createProjectUpdateComment",
            projectId,
            updateId,
            commentId: inserted.id,
            durationMs,
        });
        if (durationMs > PROJECT_UPDATE_PERFORMANCE_BUDGETS.commentMs) {
            logger.warn("project_updates.comments_create_budget_exceeded", {
                module: "projects",
                projectId,
                updateId,
                commentId: inserted.id,
                durationMs,
            });
        }
        return { success: true as const, data: row ? normalizeComment(row, access) : null };
    } catch (error) {
        console.error("Failed to create project update comment:", error);
        return { success: false as const, error: "Failed to post comment." };
    }
}

export async function deleteProjectUpdateCommentAction(projectId: string, commentId: string) {
    try {
        const viewer = await getViewerAuthContext();
        if (!viewer.userId) return { success: false as const, error: "Please log in to delete comments." };
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.canRead || !access.project) return { success: false as const, error: "Project update unavailable." };
        const [comment] = await db
            .select({
                id: projectUpdateComments.id,
                updateId: projectUpdateComments.updateId,
                userId: projectUpdateComments.userId,
                deletedAt: projectUpdateComments.deletedAt,
            })
            .from(projectUpdateComments)
            .where(and(eq(projectUpdateComments.id, commentId), eq(projectUpdateComments.projectId, projectId)))
            .limit(1);
        if (!comment || comment.deletedAt) return { success: false as const, error: "Comment not found." };
        if (comment.userId !== viewer.userId && !access.canManage) {
            return { success: false as const, error: "You do not have permission to delete this comment." };
        }
        const now = new Date();
        await db.transaction(async (tx) => {
            // COR-040: only the request that actually tombstones the comment decrements the count.
            const deleted = await tx
                .update(projectUpdateComments)
                .set({ content: "", deletedAt: now, deletedBy: viewer.userId, updatedAt: now })
                .where(and(eq(projectUpdateComments.id, commentId), isNull(projectUpdateComments.deletedAt)))
                .returning({ id: projectUpdateComments.id });
            if (deleted.length === 0) return;
            await tx
                .update(projectUpdates)
                .set({ commentCount: sql`GREATEST(${projectUpdates.commentCount} - 1, 0)`, updatedAt: now })
                .where(eq(projectUpdates.id, comment.updateId));
        });
        return { success: true as const, updateId: comment.updateId };
    } catch (error) {
        console.error("Failed to delete project update comment:", error);
        return { success: false as const, error: "Failed to delete comment." };
    }
}

export async function readProjectUpdateDraftAction(projectId: string) {
    const auth = await getViewerAuthContext();
    if (!auth || !auth.userId) return { success: false, error: "Unauthorized" };
    const userId = auth.userId;

    const access = await resolveProjectUpdateAccess(projectId, userId);
    if (!access.canCreate) return { success: false, error: "Not found" };

    try {
        const [draft] = await db
            .select()
            .from(projectUpdateDrafts)
            .where(
                and(
                    eq(projectUpdateDrafts.projectId, projectId),
                    eq(projectUpdateDrafts.userId, userId)
                )
            )
            .limit(1);

        return { success: true, data: draft ?? null };
    } catch (error) {
        return { success: false, error: "Failed to read draft" };
    }
}

export async function saveProjectUpdateDraftAction(
    projectId: string,
    input: {
        content: string;
        visibility: string;
        entityRefs: ProjectUpdateEntityRefs;
        media: ProjectUpdateMediaItem[];
        updateType: string | null;
    }
) {
    const auth = await getViewerAuthContext();
    if (!auth || !auth.userId) return { success: false, error: "Unauthorized" };
    const userId = auth.userId;

    const access = await resolveProjectUpdateAccess(projectId, userId);
    if (!access.canCreate) return { success: false, error: "Not found" };

    try {
        const content = sanitizeProjectUpdateContent(input.content, 2_200);
        const visibility: ProjectUpdateVisibility = input.visibility === "members" ? "members" : "public";
        const updateType = normalizeProjectUpdateType(input.updateType);
        const entityRefs = normalizeEntityRefs(input.entityRefs);
        const media = normalizeMedia(input.media);
        const hasReferences = normalizeProjectUpdateReferences(entityRefs.references).length > 0
            || Boolean(entityRefs.taskId || entityRefs.sprintId || entityRefs.fileId || entityRefs.readmeVersionId || entityRefs.roleId || entityRefs.milestoneId);
        if (!content.trim() && !hasReferences && media.length === 0) {
            await db.transaction(async (tx) => {
                const [existingDraft] = await tx
                    .select({ media: projectUpdateDrafts.media })
                    .from(projectUpdateDrafts)
                    .where(and(
                        eq(projectUpdateDrafts.projectId, projectId),
                        eq(projectUpdateDrafts.userId, userId),
                    ))
                    .limit(1)
                    .for("update");
                if (existingDraft) {
                    await queueRemovedLegacyUpdateMedia({
                        tx,
                        sourceType: "project_update_draft_media",
                        sourceId: userId,
                        projectId,
                        previous: existingDraft.media,
                        next: [],
                    });
                    await replaceDraftMediaAssetRefs({
                        tx,
                        projectId,
                        userId,
                        media: [],
                    });
                }
                await tx.delete(projectUpdateDrafts).where(
                    and(
                        eq(projectUpdateDrafts.projectId, projectId),
                        eq(projectUpdateDrafts.userId, userId)
                    )
                );
            });
            return { success: true, data: null };
        }

        const draft = await db.transaction(async (tx) => {
            const [existingDraft] = await tx
                .select({ media: projectUpdateDrafts.media })
                .from(projectUpdateDrafts)
                .where(and(
                    eq(projectUpdateDrafts.projectId, projectId),
                    eq(projectUpdateDrafts.userId, userId),
                ))
                .limit(1)
                .for("update");
            const allowedLegacyBindings = new Set(
                normalizeMedia(existingDraft?.media)
                    .filter((item) => !item.assetId && item.bucket && item.storageKey)
                    .map(updateMediaBinding),
            );
            await queueRemovedLegacyUpdateMedia({
                tx,
                sourceType: "project_update_draft_media",
                sourceId: userId,
                projectId,
                previous: existingDraft?.media,
                next: media,
            });
            const [row] = await tx
                .insert(projectUpdateDrafts)
                .values({
                    projectId,
                    userId,
                    content,
                    visibility,
                    updateType,
                    entityRefs,
                    media,
                    updatedAt: sql`now()`,
                })
                .onConflictDoUpdate({
                    target: [projectUpdateDrafts.projectId, projectUpdateDrafts.userId],
                    set: {
                        content,
                        visibility,
                        updateType,
                        entityRefs,
                        media,
                        updatedAt: sql`now()`,
                    },
                })
                .returning();
            if (!row) throw new Error("Failed to save update draft");
            await replaceDraftMediaAssetRefs({
                tx,
                projectId,
                userId,
                media,
                allowedLegacyBindings,
            });
            return row;
        });

        return { success: true, data: draft };
    } catch (error) {
        return { success: false, error: "Failed to save draft" };
    }
}
