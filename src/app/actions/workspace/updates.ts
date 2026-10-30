"use server";

import { readViewerOrgRole } from "@/lib/organizations/detail";
import { orgFeedWhere, orgLivePinSql, readLastSeenUpdates, readOrgUpdateContext, readWorkspaceTitles, readSharedPins, type OrgUpdateContext } from "@/lib/organizations/org-updates";
import { isPinnedNow, type UpdateAudience } from "@/lib/organizations/update-rules";
import { shareToOrgGeneral } from "@/lib/organizations/org-chat";
import { readWorkspaceRoleTitles, roleTitleKey } from "@/lib/workspaces/update-roles";
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
    profileContributionStages,
    profileContributions,
    workspaceMembers,
    workspaceNodes,
    workspaceSprints,
    workspaces,
    workspaceUpdateComments,
    workspaceUpdateDraftMediaAssets,
    workspaceUpdateDrafts,
    workspaceUpdateLikes,
    workspaceUpdateMediaAssets,
    workspaceUpdates,
    storageAssets,
    storageLegacyCleanupTargets,
    tasks,
} from "@/lib/db/schema";
import { computeWorkspaceReadAccess } from "@/lib/data/workspace-access";
import { enqueueWorkspaceNotificationEvent } from "@/lib/notifications/workspace-events";
import { notifyAnnouncement, notifyOrg } from "@/lib/organizations/notify";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { getViewerAuthContext, getViewerProfileContext } from "@/lib/server/viewer-context";
import { createAdminClient } from "@/lib/supabase/server";
import { createUploadIntent, finalizeUploadIntent } from "@/lib/upload/upload-intents";
import { normalizeAndValidateFileSize, normalizeAndValidateMimeType } from "@/lib/upload/security";
import {
    getWorkspaceMemberRoleLabel,
    isWorkspaceTabVisibleToViewer,
    normalizeWorkspaceMemberRole,
} from "@/lib/workspaces/settings-policies";
import {
    normalizeWorkspaceUpdateFilter,
    normalizeWorkspaceUpdateMediaItems,
    normalizeWorkspaceUpdateReferences,
    normalizeWorkspaceUpdateType,
    WORKSPACE_UPDATE_ALLOWED_IMAGE_MIME_TYPES,
    WORKSPACE_UPDATE_COMMENT_PAGE_SIZE,
    WORKSPACE_UPDATE_MEDIA_BUCKET,
    WORKSPACE_UPDATE_MEDIA_MAX_BYTES,
    WORKSPACE_UPDATE_PAGE_SIZE,
    WORKSPACE_UPDATE_PERFORMANCE_BUDGETS,
    projectUpdateImageExtensionFromMimeType,
    projectUpdateMediaApplicationUrl,
    composeWorkspaceUpdateRoleLabel,
    isGenericWorkspaceUpdateRoleTitle,
    normalizeWorkspaceUpdateAuthorRoleSnapshot,
    projectUpdateExcerpt,
    resolveWorkspaceUpdateAuthorRoleDisplay,
    sanitizeWorkspaceUpdateContent,
    sanitizeWorkspaceUpdateRoleTitle,
    shouldNotifyWorkspaceUpdateFollowers,
    type WorkspaceUpdateAuthorRoleSnapshot,
    type WorkspaceUpdateContextKind,
    type WorkspaceUpdateContextOption,
    type WorkspaceUpdateContextSummary,
    type WorkspaceUpdateEntityRefs,
    type WorkspaceUpdateFilter,
    type WorkspaceUpdateMediaItem,
    type WorkspaceUpdateReference,
    type WorkspaceUpdateReplyPolicy,
    type WorkspaceUpdateType,
    type WorkspaceUpdateVisibility,
} from "@/lib/workspaces/updates";
import { logger } from "@/lib/logger";
import { readableProfileIdentitySql } from "@/lib/privacy/resolver";

const UPDATES_PAGE_SIZE = WORKSPACE_UPDATE_PAGE_SIZE;
const COMMENTS_PAGE_SIZE = WORKSPACE_UPDATE_COMMENT_PAGE_SIZE;
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function updateMediaBinding(item: WorkspaceUpdateMediaItem) {
    return `${item.bucket ?? ""}\0${item.storageKey ?? ""}`;
}

async function queueRemovedLegacyUpdateMedia(params: {
    tx: DbTransaction;
    sourceType: "project_update_media" | "project_update_draft_media";
    sourceId: string;
    projectId: string;
    previous: WorkspaceUpdateMediaItem[] | null | undefined;
    next: WorkspaceUpdateMediaItem[];
}) {
    const retained = new Set(params.next.map(updateMediaBinding));
    const targets = normalizeMedia(params.previous).filter((item) => (
        !item.assetId
        && item.bucket === WORKSPACE_UPDATE_MEDIA_BUCKET
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
            bucket: WORKSPACE_UPDATE_MEDIA_BUCKET,
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
    media: WorkspaceUpdateMediaItem[];
    allowedLegacyBindings?: Set<string>;
}) {
    const previous = await params.tx
        .select({ assetId: workspaceUpdateMediaAssets.assetId })
        .from(workspaceUpdateMediaAssets)
        .where(eq(workspaceUpdateMediaAssets.updateId, params.updateId));
    await params.tx
        .delete(workspaceUpdateMediaAssets)
        .where(eq(workspaceUpdateMediaAssets.updateId, params.updateId));

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
            item.bucket !== WORKSPACE_UPDATE_MEDIA_BUCKET ||
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
                eq(storageAssets.bucket, WORKSPACE_UPDATE_MEDIA_BUCKET),
                eq(storageAssets.storageKey, item.storageKey),
                eq(storageAssets.state, "verified"),
            ))
            .returning({ id: storageAssets.id });
        if (!publishable) throw new Error("Update media asset is no longer publishable");
        attachedAssetIds.add(item.assetId);
        await params.tx.insert(workspaceUpdateMediaAssets).values({
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
    media: WorkspaceUpdateMediaItem[];
    allowedLegacyBindings?: Set<string>;
}) {
    const previous = await params.tx
        .select({ assetId: workspaceUpdateDraftMediaAssets.assetId })
        .from(workspaceUpdateDraftMediaAssets)
        .where(and(
            eq(workspaceUpdateDraftMediaAssets.projectId, params.projectId),
            eq(workspaceUpdateDraftMediaAssets.userId, params.userId),
        ));
    await params.tx.delete(workspaceUpdateDraftMediaAssets).where(and(
        eq(workspaceUpdateDraftMediaAssets.projectId, params.projectId),
        eq(workspaceUpdateDraftMediaAssets.userId, params.userId),
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
            item.bucket !== WORKSPACE_UPDATE_MEDIA_BUCKET ||
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
                eq(storageAssets.bucket, WORKSPACE_UPDATE_MEDIA_BUCKET),
                eq(storageAssets.storageKey, item.storageKey),
                eq(storageAssets.state, "verified"),
            ))
            .returning({ id: storageAssets.id });
        if (!publishable) throw new Error("Draft media asset is no longer available");
        attachedAssetIds.add(item.assetId);
        await params.tx.insert(workspaceUpdateDraftMediaAssets).values({
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

export type WorkspaceUpdateAuthorView = {
    id: string | null;
    fullName: string | null;
    username: string | null;
    avatarUrl: string | null;
    roleLabel: string | null;
    roleTitle: string | null;
    membershipRoleLabel: string | null;
    roleSource: "snapshot" | "project_role" | "membership" | null;
};

export type WorkspaceUpdateView = {
    id: string;
    projectId: string;
    authorId: string | null;
    author: WorkspaceUpdateAuthorView | null;
    content: string;
    updateType: WorkspaceUpdateType | null;
    visibility: WorkspaceUpdateVisibility;
    replyPolicy: WorkspaceUpdateReplyPolicy;
    entityRefs: WorkspaceUpdateEntityRefs;
    context: WorkspaceUpdateContextSummary;
    media: WorkspaceUpdateMediaItem[];
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

export type WorkspaceUpdateCommentView = {
    id: string;
    updateId: string;
    projectId: string;
    parentId: string | null;
    userId: string | null;
    author: WorkspaceUpdateAuthorView | null;
    content: string;
    canDelete: boolean;
    deletedAt: string | null;
    createdAt: string;
    updatedAt: string;
    targetUserId: string | null;
    targetUsername: string | null;
};

export type WorkspaceUpdateMovementSummary = {
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

function normalizeEntityRefs(value: unknown): WorkspaceUpdateEntityRefs {
    if (!value || typeof value !== "object") return {};
    const source = value as Record<string, unknown>;
    const pick = (key: keyof WorkspaceUpdateEntityRefs) => {
        const raw = source[key];
        return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
    };
    const legacyReferences: WorkspaceUpdateReference[] = [
        pick("taskId") ? { kind: "task", id: pick("taskId")! } : null,
        pick("sprintId") ? { kind: "sprint", id: pick("sprintId")! } : null,
        pick("fileId") ? { kind: "file", id: pick("fileId")! } : null,
    ].filter((item): item is WorkspaceUpdateReference => Boolean(item));
    const references = normalizeWorkspaceUpdateReferences([
        ...normalizeWorkspaceUpdateReferences(source.references),
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

function normalizeMedia(value: unknown): WorkspaceUpdateMediaItem[] {
    return normalizeWorkspaceUpdateMediaItems(value);
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

async function readProjectRoleTitleMap(projectId: string, userIds: Array<string | null | undefined>) {
    const titles = await readWorkspaceRoleTitles(userIds.map((userId) => ({ projectId, userId })));
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
    return normalizeWorkspaceUpdateAuthorRoleSnapshot(normalized.authorRoleSnapshot);
}

async function readAuthorRoleSnapshot(params: {
    projectId: string;
    userId: string;
    projectOwnerId: string | null;
    memberRole: ProjectUpdateAccess["memberRole"];
}): Promise<WorkspaceUpdateAuthorRoleSnapshot> {
    const role = params.userId === params.projectOwnerId
        ? "owner"
        : normalizeWorkspaceMemberRole(params.memberRole, "member");
    const membershipRoleLabel = getWorkspaceMemberRoleLabel(role);
    const roleTitles = await readProjectRoleTitleMap(params.projectId, [params.userId]);
    const roleTitle = sanitizeWorkspaceUpdateRoleTitle(roleTitles.get(params.userId));
    return {
        displayRoleLabel: composeWorkspaceUpdateRoleLabel({ roleTitle, membershipRoleLabel }) ?? membershipRoleLabel,
        roleTitle,
        membershipRoleLabel,
        source: roleTitle ? "project_role" : "membership",
        capturedAt: new Date().toISOString(),
    };
}

function projectHref(project: { id: string; slug: string | null }, updateId?: string | null) {
    const slugOrId = project.slug || project.id;
    const base = `/workspaces/${encodeURIComponent(slugOrId)}?tab=updates`;
    return updateId ? `${base}&updateId=${encodeURIComponent(updateId)}` : base;
}

function projectBaseHref(project: { id: string; slug: string | null }) {
    return `/workspaces/${encodeURIComponent(project.slug || project.id)}`;
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

function normalizeProjectUpdateMentionKind(kind: unknown): WorkspaceUpdateContextKind | null {
    if (kind === "task" || kind === "tasks") return "task";
    if (kind === "sprint" || kind === "sprints") return "sprint";
    if (kind === "file" || kind === "files") return "file";
    return null;
}

function projectUpdateTargetUnavailableMessage(kind: WorkspaceUpdateContextKind) {
    if (kind === "task") return "This task is not available or you do not have access.";
    if (kind === "sprint") return "This sprint is not available or you do not have access.";
    return "This file is not available or you do not have access.";
}

function canReadProjectUpdateTargetTab(access: ProjectUpdateAccess, kind: WorkspaceUpdateContextKind) {
    if (!access.project) return false;
    return isWorkspaceTabVisibleToViewer({
        tabId: kind === "task" ? "tasks" : kind === "sprint" ? "sprints" : "files",
        isOwnerOrMember: access.isOwner || access.isMember,
        canManageSettings: access.isOwner,
        publicTabVisibility: access.project.publicTabVisibility,
    });
}

export async function resolveWorkspaceUpdateMentionTargetAction(projectId: string, input: {
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
                        projectKey: workspaces.key,
                    })
                    .from(tasks)
                    .innerJoin(workspaces, eq(tasks.projectId, workspaces.id))
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
                                projectKey: workspaces.key,
                            })
                            .from(tasks)
                            .innerJoin(workspaces, eq(tasks.projectId, workspaces.id))
                            .where(
                                and(
                                    eq(workspaces.key, projectKey),
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
                .select({ id: workspaceSprints.id })
                .from(workspaceSprints)
                .where(and(eq(workspaceSprints.projectId, projectId), eq(workspaceSprints.id, id)))
                .limit(1);
            if (!sprint) return { success: false as const, error: projectUpdateTargetUnavailableMessage(kind) };
            return { success: true as const, href: projectSprintHref(access.project, sprint.id), kind };
        }

        if (!isLooseUuid(id)) return { success: false as const, error: projectUpdateTargetUnavailableMessage(kind) };

        const [node] = await db
            .select({
                id: workspaceNodes.id,
                name: workspaceNodes.name,
                path: workspaceNodes.path,
            })
            .from(workspaceNodes)
            .where(and(
                eq(workspaceNodes.projectId, projectId),
                eq(workspaceNodes.id, id),
                isNull(workspaceNodes.deletedAt),
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
}, project: { id: string; slug: string | null }): WorkspaceUpdateContextOption {
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
}, project: { id: string; slug: string | null }): WorkspaceUpdateContextOption {
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
}, project: { id: string; slug: string | null }): WorkspaceUpdateContextOption {
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
            id: workspaces.id,
            ownerId: workspaces.ownerId,
            title: workspaces.title,
            slug: workspaces.slug,
            visibility: workspaces.visibility,
            status: workspaces.status,
            publicTabVisibility: workspaces.publicTabVisibility,
            memberUpdatesEnabled: workspaces.memberUpdatesEnabled,
            kind: workspaces.kind,
            parentId: workspaces.parentId,
        })
        .from(workspaces)
        .where(and(eq(workspaces.id, projectId), isNull(workspaces.deletedAt)))
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
            .select({ role: workspaceMembers.role })
            .from(workspaceMembers)
            .where(and(eq(workspaceMembers.projectId, projectId), eq(workspaceMembers.userId, viewerId)))
            .limit(1)
        : [];
    const isMember = Boolean(membership);
    const memberRole = isOwner
        ? "owner"
        : membership
            ? normalizeWorkspaceMemberRole(membership.role, "member")
            : null;
    // Org only child projects and inherited org admins (report §29.4).
    const parentOrgRole = project.parentId && !isOwner && !isMember ? await readViewerOrgRole(project.parentId, viewerId) : null;
    const isInheritedAdmin = parentOrgRole === "owner" || parentOrgRole === "admin";
    const isOwnerOrMember = isOwner || isMember;
    const canRead = computeWorkspaceReadAccess(project.visibility, project.status, isOwner, isMember, parentOrgRole) && isWorkspaceTabVisibleToViewer({
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

type UpdateRow = typeof workspaceUpdates.$inferSelect & {
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
}, projectOwnerId: string | null, snapshot?: WorkspaceUpdateAuthorRoleSnapshot | null): WorkspaceUpdateAuthorView | null {
    if (!row.authorId) return null;
    const role = row.authorId === projectOwnerId
        ? "owner"
        : normalizeWorkspaceMemberRole(row.authorMembershipRole, "member");
    const membershipRoleLabel = getWorkspaceMemberRoleLabel(role);
    const roleDisplay = resolveWorkspaceUpdateAuthorRoleDisplay({
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
    contextByUpdateId?: Map<string, WorkspaceUpdateContextSummary>;
    fromProjects?: Map<string, { title: string; slug: string | null }>;
}): WorkspaceUpdateView {
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
        updateType: normalizeWorkspaceUpdateType(row.updateType),
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
    context: WorkspaceUpdateContextSummary | null | undefined,
    media: WorkspaceUpdateMediaItem[] | null | undefined,
) {
    const references = context?.references?.length
        ? context.references
        : [
            context?.task ?? null,
            context?.sprint ?? null,
            context?.file ?? null,
        ].filter((item): item is WorkspaceUpdateContextOption => Boolean(item));
    if (references.length > 0) {
        return references.slice(0, 3).map((item) => item.label).join(", ");
    }
    const mediaItems = normalizeMedia(media);
    if (mediaItems.length > 0) {
        const namedMedia = mediaItems
            .map((item) => item.label || item.altText || null)
            .filter((item): item is string => Boolean(item));
        return namedMedia.length > 0 ? namedMedia.slice(0, 3).join(", ") : "Attached media";
    }
    return "Workspace update";
}

function projectUpdateNotificationBody(input: {
    content: string;
    context?: WorkspaceUpdateContextSummary | null;
    media?: WorkspaceUpdateMediaItem[] | null;
    maxLength?: number;
}) {
    const body = projectUpdateExcerpt(input.content, input.maxLength ?? 180);
    return body || projectUpdateContextFallbackLabel(input.context, input.media);
}

async function readUpdateRowsByIds(updateIds: string[], access: ProjectUpdateAccess) {
    if (!access.project || updateIds.length === 0) return [];
    const rows = await db
        .select({
            id: workspaceUpdates.id,
            projectId: workspaceUpdates.projectId,
            authorId: workspaceUpdates.authorId,
            content: workspaceUpdates.content,
            updateType: workspaceUpdates.updateType,
            visibility: workspaceUpdates.visibility,
            replyPolicy: workspaceUpdates.replyPolicy,
            entityRefs: workspaceUpdates.entityRefs,
            media: workspaceUpdates.media,
            metadata: workspaceUpdates.metadata,
            isPinned: workspaceUpdates.isPinned,
            audience: workspaceUpdates.audience,
            notifyLevel: workspaceUpdates.notifyLevel,
            pinnedUntil: workspaceUpdates.pinnedUntil,
            sharedToOrgAt: workspaceUpdates.sharedToOrgAt,
            likeCount: workspaceUpdates.likeCount,
            commentCount: workspaceUpdates.commentCount,
            deletedBy: workspaceUpdates.deletedBy,
            editedAt: workspaceUpdates.editedAt,
            deletedAt: workspaceUpdates.deletedAt,
            createdAt: workspaceUpdates.createdAt,
            updatedAt: workspaceUpdates.updatedAt,
            authorFullName: profiles.fullName,
            authorUsername: profiles.username,
            authorAvatarUrl: profiles.avatarUrl,
            authorMembershipRole: workspaceMembers.role,
        })
        .from(workspaceUpdates)
        .leftJoin(profiles, eq(profiles.id, workspaceUpdates.authorId))
        .leftJoin(workspaceMembers, and(
            eq(workspaceMembers.projectId, workspaceUpdates.projectId),
            eq(workspaceMembers.userId, workspaceUpdates.authorId),
        ))
        .where(and(
            inArray(workspaceUpdates.id, updateIds),
            // The org feed's own rule covers its posts and the posts shared up to it (report §17.6).
            access.org?.kind === "org" ? undefined : eq(workspaceUpdates.projectId, access.project.id),
            access.isOwner || access.isMember ? undefined : eq(workspaceUpdates.visibility, "public"),
            orgAudienceWhere(access),
        ));
    return hydrateUpdateRowsWithRoleTitles(access.project.id, rows);
}

async function likedUpdateIds(updateIds: string[], viewerId: string | null) {
    if (!viewerId || updateIds.length === 0) return new Set<string>();
    const rows = await db
        .select({ updateId: workspaceUpdateLikes.updateId })
        .from(workspaceUpdateLikes)
        .where(and(
            eq(workspaceUpdateLikes.userId, viewerId),
            inArray(workspaceUpdateLikes.updateId, updateIds),
        ));
    return new Set(rows.map((row) => row.updateId));
}

async function contextSummariesForRows(rows: Array<Pick<UpdateRow, "id" | "entityRefs">>, access: ProjectUpdateAccess) {
    const summaries = new Map<string, WorkspaceUpdateContextSummary>();
    if (!access.project || rows.length === 0) return summaries;

    const taskIds = new Set<string>();
    const sprintIds = new Set<string>();
    const fileIds = new Set<string>();
    const refsByUpdate = new Map<string, WorkspaceUpdateEntityRefs>();

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
                    id: workspaceSprints.id,
                    name: workspaceSprints.name,
                    status: workspaceSprints.status,
                    goal: workspaceSprints.goal,
                })
                .from(workspaceSprints)
                .where(and(eq(workspaceSprints.projectId, access.project.id), inArray(workspaceSprints.id, Array.from(sprintIds))))
            : Promise.resolve([]),
        canReadFiles && fileIds.size > 0
            ? db
                .select({
                    id: workspaceNodes.id,
                    name: workspaceNodes.name,
                    path: workspaceNodes.path,
                    mimeType: workspaceNodes.mimeType,
                })
                .from(workspaceNodes)
                .where(and(
                    eq(workspaceNodes.projectId, access.project.id),
                    eq(workspaceNodes.type, "file"),
                    isNull(workspaceNodes.deletedAt),
                    inArray(workspaceNodes.id, Array.from(fileIds)),
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
                ].filter((option): option is WorkspaceUpdateContextOption => Boolean(option)),
        });
    });

    return summaries;
}

/** An org's own posts are read through its audience rule (report §17.3). */
function orgAudienceWhere(access: ProjectUpdateAccess) {
    return access.org?.kind === "org" ? orgFeedWhere(access.org, access.viewerId, "all") : undefined;
}

function updateCursorCondition(cursor: ProjectUpdateCursor | null, pinned: SQL<boolean> | typeof workspaceUpdates.isPinned = workspaceUpdates.isPinned) {
    if (!cursor) return undefined;
    const cursorDate = new Date(cursor.createdAt);
    if (Number.isNaN(cursorDate.getTime())) return undefined;
    const afterWithinBucket = or(
        lt(workspaceUpdates.createdAt, cursorDate),
        and(eq(workspaceUpdates.createdAt, cursorDate), lt(workspaceUpdates.id, cursor.id)),
    );
    if (cursor.pinned) {
        return or(and(sql`${pinned}`, afterWithinBucket), sql`NOT ${pinned}`);
    }
    // Row comparison lets the member-feed index seek to the cursor instead of filtering every newer row.
    return and(sql`NOT ${pinned}`, sql`(${workspaceUpdates.createdAt}, ${workspaceUpdates.id}) < (${cursorDate}, ${cursor.id}::uuid)`);
}

export async function readWorkspaceUpdatesAction(projectId: string, params?: {
    cursor?: string | null;
    filter?: WorkspaceUpdateFilter | string | null;
}) {
    const startedAt = performance.now();
    try {
        const viewer = await getViewerAuthContext();
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.canRead || !access.project) {
            return { success: false as const, error: "Updates aren’t available.", data: { updates: [], nextCursor: null, hasMore: false, movementSummary: null } };
        }

        const filter = normalizeWorkspaceUpdateFilter(params?.filter ?? "all");
        const cursor = decodeUpdateCursor(params?.cursor);
        // The org feed (report §17.5): own posts by audience plus posts shared up from child projects.
        const orgFeed = access.org?.kind === "org" ? access.org : null;
        const pinned = orgFeed ? orgLivePinSql(orgFeed.orgId) : workspaceUpdates.isPinned;
        const scope = orgFeed
            ? orgFeedWhere(orgFeed, viewer.userId, filter === "all" || filter === "from_projects" || filter === "announcement" || filter === "discussion" ? filter : "all")
            : and(
                eq(workspaceUpdates.projectId, projectId),
                access.isOwner || access.isMember ? undefined : eq(workspaceUpdates.visibility, "public"),
            );
        const rawRows = await db
            .select({
                id: workspaceUpdates.id,
                projectId: workspaceUpdates.projectId,
                authorId: workspaceUpdates.authorId,
                content: workspaceUpdates.content,
                updateType: workspaceUpdates.updateType,
                visibility: workspaceUpdates.visibility,
                replyPolicy: workspaceUpdates.replyPolicy,
                entityRefs: workspaceUpdates.entityRefs,
                media: workspaceUpdates.media,
                metadata: workspaceUpdates.metadata,
                isPinned: workspaceUpdates.isPinned,
                audience: workspaceUpdates.audience,
                notifyLevel: workspaceUpdates.notifyLevel,
                pinnedUntil: workspaceUpdates.pinnedUntil,
                sharedToOrgAt: workspaceUpdates.sharedToOrgAt,
                likeCount: workspaceUpdates.likeCount,
                commentCount: workspaceUpdates.commentCount,
                deletedBy: workspaceUpdates.deletedBy,
                editedAt: workspaceUpdates.editedAt,
                deletedAt: workspaceUpdates.deletedAt,
                createdAt: workspaceUpdates.createdAt,
                updatedAt: workspaceUpdates.updatedAt,
                authorFullName: profiles.fullName,
                authorUsername: profiles.username,
                authorAvatarUrl: profiles.avatarUrl,
                authorMembershipRole: workspaceMembers.role,
            })
            .from(workspaceUpdates)
            .leftJoin(profiles, eq(profiles.id, workspaceUpdates.authorId))
            .leftJoin(workspaceMembers, and(
                eq(workspaceMembers.projectId, workspaceUpdates.projectId),
                eq(workspaceMembers.userId, workspaceUpdates.authorId),
            ))
            .where(and(
                scope,
                isNull(workspaceUpdates.deletedAt),
                filter === "all" || filter === "from_projects" ? undefined : eq(workspaceUpdates.updateType, filter),
                updateCursorCondition(cursor, pinned),
            ))
            .orderBy(desc(pinned), desc(workspaceUpdates.createdAt), desc(workspaceUpdates.id))
            .limit(UPDATES_PAGE_SIZE + 1);

        const rows = await hydrateUpdateRowsWithRoleTitles(projectId, rawRows);
        const pageRows = rows.slice(0, UPDATES_PAGE_SIZE);
        const updateIds = pageRows.map((row) => row.id);
        const [likedIds, contextByUpdateId, fromProjects, lastSeenAt] = await Promise.all([
            likedUpdateIds(updateIds, viewer.userId),
            contextSummariesForRows(pageRows, access),
            readWorkspaceTitles([...new Set(pageRows.filter((row) => row.projectId !== projectId).map((row) => row.projectId))]),
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
        if (durationMs > WORKSPACE_UPDATE_PERFORMANCE_BUDGETS.readMs) {
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
        return { success: false as const, error: "Couldn’t load updates. Try again.", data: { updates: [], nextCursor: null, hasMore: false, movementSummary: null } };
    }
}

export async function readWorkspaceUpdateAction(projectId: string, updateId: string) {
    try {
        const viewer = await getViewerAuthContext();
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.canRead || !access.project) return { success: false as const, error: "This update isn’t available.", data: null };
        const rows = await readUpdateRowsByIds([updateId], access);
        const [likedIds, contextByUpdateId] = await Promise.all([
            likedUpdateIds(rows.map((row) => row.id), viewer.userId),
            contextSummariesForRows(rows, access),
        ]);
        const update = rows[0] ? normalizeUpdate(rows[0], { access, likedIds, contextByUpdateId }) : null;
        return update
            ? { success: true as const, data: update }
            : { success: false as const, error: "Update not found.", data: null };
    } catch (error) {
        console.error("Failed to read project update:", error);
        return { success: false as const, error: "Couldn’t load the update. Try again.", data: null };
    }
}

async function readContextOptionsForKind(params: {
    projectId: string;
    project: { id: string; slug: string | null };
    kind: WorkspaceUpdateContextKind;
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
        const conditions = [eq(workspaceSprints.projectId, params.projectId)];
        if (params.query) conditions.push(or(ilike(workspaceSprints.name, like), ilike(workspaceSprints.goal, like), ilike(workspaceSprints.description, like))!);
        const rows = await db
            .select({
                id: workspaceSprints.id,
                name: workspaceSprints.name,
                status: workspaceSprints.status,
                goal: workspaceSprints.goal,
            })
            .from(workspaceSprints)
            .where(and(...conditions))
            .orderBy(desc(workspaceSprints.updatedAt))
            .limit(params.limit);
        return rows.map((row) => sprintContextOption(row, params.project));
    }

    const conditions = [eq(workspaceNodes.projectId, params.projectId), eq(workspaceNodes.type, "file"), isNull(workspaceNodes.deletedAt)];
    if (params.query) conditions.push(or(ilike(workspaceNodes.name, like), ilike(workspaceNodes.path, like))!);
    const rows = await db
        .select({
            id: workspaceNodes.id,
            name: workspaceNodes.name,
            path: workspaceNodes.path,
            mimeType: workspaceNodes.mimeType,
        })
        .from(workspaceNodes)
        .where(and(...conditions))
        .orderBy(desc(workspaceNodes.updatedAt))
        .limit(params.limit);
    return rows.map((row) => fileContextOption(row, params.project));
}

export async function readWorkspaceUpdateContextOptionsAction(projectId: string, input?: {
    kind?: WorkspaceUpdateContextKind | "all" | string | null;
    query?: string | null;
    limit?: number | null;
}) {
    try {
        const viewer = await getViewerAuthContext();
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.canCreate || !access.project) {
            return { success: false as const, error: "This update isn’t available.", data: { task: [], sprint: [], file: [] } };
        }

        const requestedKind = input?.kind === "task" || input?.kind === "sprint" || input?.kind === "file"
            ? input.kind
            : "all";
        const query = typeof input?.query === "string" ? input.query.trim().slice(0, 80) : "";
        const limit = Math.max(1, Math.min(12, Math.trunc(Number(input?.limit ?? 6))));
        const kinds: WorkspaceUpdateContextKind[] = requestedKind === "all" ? ["task", "sprint", "file"] : [requestedKind];
        const entries = await Promise.all(kinds.map(async (kind) => [
            kind,
            await readContextOptionsForKind({ projectId, project: access.project!, kind, query, limit }),
        ] as const));
        const data: Record<WorkspaceUpdateContextKind, WorkspaceUpdateContextOption[]> = { task: [], sprint: [], file: [] };
        entries.forEach(([kind, options]) => { data[kind] = options; });
        return { success: true as const, data };
    } catch (error) {
        logger.warn("project_updates.context_options_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Couldn’t load the update. Try again.", data: { task: [], sprint: [], file: [] } };
    }
}

export async function createWorkspaceUpdateMediaUploadUrlAction(projectId: string, input: {
    mimeType?: string | null;
    sizeBytes?: number | null;
    altText?: string | null;
}) {
    try {
        const viewer = await getViewerAuthContext();
        if (!viewer.userId) return { success: false as const, error: "Sign in to upload media." };
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.canCreate || !access.project) return { success: false as const, error: "You do not have permission to upload update media." };
        const rate = await consumeRateLimit(`project-update-media:create:${viewer.userId}`, 20, 60 * 60);
        if (!rate.allowed) return { success: false as const, error: "Too many uploads. Try again in a minute." };

        const mimeType = normalizeAndValidateMimeType(input.mimeType);
        if (!WORKSPACE_UPDATE_ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
            return { success: false as const, error: "Unsupported image type. Use JPG, PNG, WebP, or GIF." };
        }
        const sizeBytes = normalizeAndValidateFileSize(input.sizeBytes, WORKSPACE_UPDATE_MEDIA_MAX_BYTES, "Update image");
        const extension = projectUpdateImageExtensionFromMimeType(mimeType);
        const storageKey = `projects/${projectId}/update-media/${viewer.userId}/${Date.now()}-${randomUUID()}.${extension}`;
        const intent = await createUploadIntent({
            userId: viewer.userId,
            projectId,
            bucket: WORKSPACE_UPDATE_MEDIA_BUCKET,
            storageKey,
            scope: "workspace_update_media",
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
            .from(WORKSPACE_UPDATE_MEDIA_BUCKET)
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
            bucket: WORKSPACE_UPDATE_MEDIA_BUCKET,
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

export async function finalizeWorkspaceUpdateMediaUploadAction(projectId: string, input: {
    uploadIntentId?: string | null;
    altText?: string | null;
    label?: string | null;
    width?: number | null;
    height?: number | null;
}) {
    try {
        const viewer = await getViewerAuthContext();
        if (!viewer.userId) return { success: false as const, error: "Sign in to finish the upload." };
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.canCreate || !access.project) return { success: false as const, error: "You do not have permission to upload update media." };
        if (!input.uploadIntentId) return { success: false as const, error: "Missing upload intent." };
        const intent = await finalizeUploadIntent({
            intentId: input.uploadIntentId,
            bucket: WORKSPACE_UPDATE_MEDIA_BUCKET,
            userId: viewer.userId,
            projectId,
            expectedScope: "workspace_update_media",
            expectedKind: "file",
        });
        const media: WorkspaceUpdateMediaItem = {
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
async function resolveOrgPostOptions(access: ProjectUpdateAccess, updateType: WorkspaceUpdateType | null, input: {
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
        const projectIds = wanted.length === 0 ? [] : (await db.select({ id: workspaces.id }).from(workspaces)
            .where(and(eq(workspaces.parentId, access.project!.id), inArray(workspaces.id, wanted), isNull(workspaces.deletedAt)))).map((row) => row.id);
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

export async function createWorkspaceUpdateAction(projectId: string, input: {
    content: string;
    updateType?: WorkspaceUpdateType | string | null;
    visibility?: WorkspaceUpdateVisibility | string | null;
    replyPolicy?: WorkspaceUpdateReplyPolicy | string | null;
    entityRefs?: WorkspaceUpdateEntityRefs | null;
    media?: WorkspaceUpdateMediaItem[] | null;
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
        if (!viewer.userId) return { success: false as const, error: "Sign in to post updates." };
        const rate = await consumeRateLimit(`project-update:create:${viewer.userId}`, 30, 60);
        if (!rate.allowed) return { success: false as const, error: "Too many updates. Try again in a minute." };

        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.canCreate || !access.project) return { success: false as const, error: "You don’t have access to post updates here." };

        const updateType = normalizeWorkspaceUpdateType(input.updateType);
        const visibility: WorkspaceUpdateVisibility = input.visibility === "members" ? "members" : "public";
        const orgOptions = await resolveOrgPostOptions(access, updateType, input);
        if ("error" in orgOptions) return { success: false as const, error: orgOptions.error };
        const replyPolicy: WorkspaceUpdateReplyPolicy = orgOptions.commentsOff ? "closed" : input.replyPolicy === "members" ? "members"
            : input.replyPolicy === "logged_in" ? "logged_in" : access.org?.kind === "org" ? access.org.replyDefault : "logged_in";
        const entityRefs = normalizeEntityRefs(input.entityRefs);
        const media = normalizeMedia(input.media);
        const content = sanitizeWorkspaceUpdateContent(input.content);
        const hasReferences = normalizeWorkspaceUpdateReferences(entityRefs.references).length > 0
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
                .insert(workspaceUpdates)
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
                .returning({ id: workspaceUpdates.id });
            if (!row) throw new Error("Couldn’t post the update. Try again.");
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
            && shouldNotifyWorkspaceUpdateFollowers({ content, entityRefs, media });
        if (shouldNotifyFollowers) {
            try {
                const actorName = viewer.profile?.fullName ?? viewer.profile?.username ?? null;
                const notificationBody = projectUpdateNotificationBody({
                    content,
                    context: update?.context ?? null,
                    media,
                });
                await enqueueWorkspaceNotificationEvent({
                    projectId,
                    actorUserId: viewer.userId,
                    actorName,
                    actorAvatarUrl: viewer.profile?.avatarUrl ?? null,
                    eventKey: "updates.published",
                    title: `${actorName || "Someone"} posted an update in ${access.project.title || "a workspace"}`,
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
                        contextLabel: access.project.title ?? "Workspace update",
                        contextKind: "project",
                        secondaryText: null,
                    },
                    sourceEventId: inserted.id,
                    maxRecipients: WORKSPACE_UPDATE_PERFORMANCE_BUDGETS.fanoutSyncRecipients,
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
        if (durationMs > WORKSPACE_UPDATE_PERFORMANCE_BUDGETS.createMs) {
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
        console.error("Couldn’t post the update. Try again.:", error);
        return { success: false as const, error: "Failed to post update." };
    }
}

export async function editWorkspaceUpdateAction(projectId: string, updateId: string, input: {
    content: string;
    updateType?: WorkspaceUpdateType | string | null;
    entityRefs?: WorkspaceUpdateEntityRefs | null;
    media?: WorkspaceUpdateMediaItem[] | null;
    /** Org announcements (report §17.4): an edit tells the audience again only when asked. */
    notifyAgain?: boolean;
}) {
    try {
        const viewer = await getViewerAuthContext();
        if (!viewer.userId) return { success: false as const, error: "Sign in to edit updates." };
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.canRead || !access.project) return { success: false as const, error: "This update isn’t available." };
        const content = sanitizeWorkspaceUpdateContent(input.content);
        const entityRefs = normalizeEntityRefs(input.entityRefs);
        const media = normalizeMedia(input.media);
        const hasReferences = normalizeWorkspaceUpdateReferences(entityRefs.references).length > 0
            || Boolean(entityRefs.taskId || entityRefs.sprintId || entityRefs.fileId);
        const hasMedia = media.length > 0;
        if (!content && !hasReferences && !hasMedia) return { success: false as const, error: "Update cannot be empty." };
        const now = new Date();
        await db.transaction(async (tx) => {
            const [existing] = await tx
                .select({
                    authorId: workspaceUpdates.authorId,
                    deletedAt: workspaceUpdates.deletedAt,
                    media: workspaceUpdates.media,
                })
                .from(workspaceUpdates)
                .where(and(eq(workspaceUpdates.id, updateId), eq(workspaceUpdates.projectId, projectId)))
                .limit(1)
                .for("update");
            if (!existing || existing.deletedAt) throw new Error("Update not found.");
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
                .update(workspaceUpdates)
                .set({
                    content,
                    // An edit that leaves the type out keeps it, so an announcement stays one.
                    ...(input.updateType === undefined ? {} : { updateType: normalizeWorkspaceUpdateType(input.updateType) }),
                    entityRefs,
                    media,
                    editedAt: now,
                    updatedAt: now,
                })
                .where(eq(workspaceUpdates.id, updateId));
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

export async function deleteWorkspaceUpdateAction(projectId: string, updateId: string, reason?: string | null) {
    try {
        const viewer = await getViewerAuthContext();
        if (!viewer.userId) return { success: false as const, error: "Sign in to delete updates." };
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.canRead || !access.project) return { success: false as const, error: "This update isn’t available." };
        const now = new Date();
        let removedAuthorId: string | null = null;
        await db.transaction(async (tx) => {
            const [existing] = await tx
                .select({
                    id: workspaceUpdates.id,
                    authorId: workspaceUpdates.authorId,
                    deletedAt: workspaceUpdates.deletedAt,
                    media: workspaceUpdates.media,
                })
                .from(workspaceUpdates)
                .where(and(eq(workspaceUpdates.id, updateId), eq(workspaceUpdates.projectId, projectId)))
                .limit(1)
                .for("update");
            if (!existing || existing.deletedAt) throw new Error("Update not found.");
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
                .update(workspaceUpdates)
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
                .where(eq(workspaceUpdates.id, updateId));
        });

        // Asynchronously clean up storage assets and comments via Inngest background job
        try {
            const { inngest } = await import("@/inngest/client");
            await inngest.send({
                name: "workspace/updates.cleanup",
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
    constructor() { super("Say why you’re removing this post. The author will see it."); }
}

/** An org admin pins a child's shared post in the org feed only (report §17.6); the 3-pin limit counts these too. */
async function countOrgOwnPins(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], orgId: string, exceptId?: string) {
    const [own] = await tx.select({ n: sql<number>`count(*)::int` }).from(workspaceUpdates)
        .where(and(eq(workspaceUpdates.projectId, orgId), eq(workspaceUpdates.isPinned, true), isNull(workspaceUpdates.deletedAt),
            sql`(${workspaceUpdates.pinnedUntil} IS NULL OR ${workspaceUpdates.pinnedUntil} > now())`, exceptId ? sql`${workspaceUpdates.id} <> ${exceptId}` : undefined));
    return own?.n ?? 0;
}

async function pinSharedInOrgFeed(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], orgId: string, updateId: string, pinned: boolean) {
    const [shared] = await tx.select({ id: workspaceUpdates.id }).from(workspaceUpdates)
        .where(and(eq(workspaceUpdates.id, updateId), isNull(workspaceUpdates.deletedAt), sql`${workspaceUpdates.sharedToOrgAt} IS NOT NULL`,
            sql`${workspaceUpdates.projectId} IN (SELECT id FROM workspaces WHERE parent_id = ${orgId} AND deleted_at IS NULL)`)).limit(1);
    if (!shared) return false;
    const [org] = await tx.select({ settings: workspaces.orgSettings }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
    const current = readSharedPins(org?.settings);
    const next = pinned ? [...new Set([...current, updateId])] : current.filter((id) => id !== updateId);
    if (pinned && !current.includes(updateId)) {
        if ((await countOrgOwnPins(tx, orgId)) + next.length > 3) throw new Error("ORG_PIN_LIMIT");
    }
    await tx.update(workspaces).set({ orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || jsonb_build_object('sharedPins', ${JSON.stringify(next)}::jsonb)` }).where(eq(workspaces.id, orgId));
    return true;
}

export async function toggleWorkspaceUpdatePinAction(projectId: string, updateId: string, pinned: boolean, pinnedUntil?: string | null) {
    try {
        const viewer = await getViewerAuthContext();
        if (!viewer.userId) return { success: false as const, error: "Sign in to pin updates." };
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.canManage || !access.project) return { success: false as const, error: "Only the owner and admins can pin updates." };
        const found = await db.transaction(async (tx) => {
            // COR-046: the project row lock serializes pin swaps, and the target is validated before
            // anything is unpinned, so a bad request never clears the current pin.
            await tx.execute(sql`SELECT id FROM workspaces WHERE id = ${projectId} FOR UPDATE`);
            const [target] = await tx
                .select({ id: workspaceUpdates.id })
                .from(workspaceUpdates)
                .where(and(eq(workspaceUpdates.id, updateId), eq(workspaceUpdates.projectId, projectId), isNull(workspaceUpdates.deletedAt)))
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
                    .update(workspaceUpdates)
                    .set({ isPinned: false, updatedAt: now })
                    .where(and(eq(workspaceUpdates.projectId, projectId), eq(workspaceUpdates.isPinned, true)));
            }
            await tx
                .update(workspaceUpdates)
                .set({ isPinned: pinned, pinnedUntil: pinned && isOrg ? futureDate(pinnedUntil) : null, updatedAt: now })
                .where(eq(workspaceUpdates.id, updateId));
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

export async function toggleWorkspaceUpdateLikeAction(projectId: string, updateId: string) {
    try {
        const viewer = await getViewerAuthContext();
        if (!viewer.userId) return { success: false as const, error: "Sign in to like updates." };
        // Each toggle is several statements; a tap loop shouldn't be able to hammer them.
        const rate = await consumeRateLimit(`project-update:like:${viewer.userId}`, 120, 60);
        if (!rate.allowed) return { success: false as const, error: "Too many likes. Try again in a minute." };
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.canRead || !access.project) return { success: false as const, error: "This update isn’t available." };
        const [update] = await db
            .select({ id: workspaceUpdates.id, visibility: workspaceUpdates.visibility })
            .from(workspaceUpdates)
            .where(and(
                eq(workspaceUpdates.id, updateId),
                eq(workspaceUpdates.projectId, projectId),
                isNull(workspaceUpdates.deletedAt),
                access.isOwner || access.isMember ? undefined : eq(workspaceUpdates.visibility, "public"),
            ))
            .limit(1);
        if (!update) return { success: false as const, error: "Update not found." };

        const result = await db.transaction(async (tx) => {
            const deletedRows = await tx
                .delete(workspaceUpdateLikes)
                .where(and(eq(workspaceUpdateLikes.updateId, updateId), eq(workspaceUpdateLikes.userId, viewer.userId!)))
                .returning({ id: workspaceUpdateLikes.id });
            if (deletedRows.length > 0) {
                const [countRow] = await tx
                    .update(workspaceUpdates)
                    .set({ likeCount: sql`GREATEST(${workspaceUpdates.likeCount} - 1, 0)`, updatedAt: new Date() })
                    .where(eq(workspaceUpdates.id, updateId))
                    .returning({ likeCount: workspaceUpdates.likeCount });
                return { liked: false, likeCount: Math.max(0, countRow?.likeCount ?? 0) };
            }
            const insertedRows = await tx
                .insert(workspaceUpdateLikes)
                .values({ updateId, userId: viewer.userId!, createdAt: new Date() })
                .onConflictDoNothing({
                    target: [workspaceUpdateLikes.updateId, workspaceUpdateLikes.userId],
                })
                .returning({ id: workspaceUpdateLikes.id });
            if (insertedRows.length > 0) {
                const [countRow] = await tx
                    .update(workspaceUpdates)
                    .set({ likeCount: sql`${workspaceUpdates.likeCount} + 1`, updatedAt: new Date() })
                    .where(eq(workspaceUpdates.id, updateId))
                    .returning({ likeCount: workspaceUpdates.likeCount });
                return { liked: true, likeCount: Math.max(0, countRow?.likeCount ?? 0) };
            }

            const [countRow] = await tx
                .select({ likeCount: workspaceUpdates.likeCount })
                .from(workspaceUpdates)
                .where(eq(workspaceUpdates.id, updateId))
                .limit(1);
            return { liked: true, likeCount: Math.max(0, countRow?.likeCount ?? 0) };
        });
        return { success: true as const, liked: result.liked, likeCount: result.likeCount };
    } catch (error) {
        console.error("Failed to toggle project update like:", error);
        return { success: false as const, error: "Failed to update like." };
    }
}

export interface ProjectUpdateLikerView {
    /** The like's own id: a private liker's account id never leaves the server. */
    key: string;
    /** Null for someone whose profile the viewer can't see: they read as "Private member", with no link. */
    userId: string | null;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    headline: string | null;
    likedAt: string;
    isViewer: boolean;
}

/** Keyset cursor over (liked at, like id), newest first. */
type ProjectUpdateLikerCursor = { createdAt: string; likeId: string };

function encodeLikerCursor(row: { likedAt: Date; likeId: string }): string {
    return Buffer.from(JSON.stringify({ createdAt: row.likedAt.toISOString(), likeId: row.likeId })).toString("base64url");
}

function decodeLikerCursor(value: string | null | undefined): ProjectUpdateLikerCursor | null {
    if (!value) return null;
    try {
        const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<ProjectUpdateLikerCursor>;
        if (typeof parsed.createdAt === "string" && !Number.isNaN(Date.parse(parsed.createdAt)) && typeof parsed.likeId === "string" && isLooseUuid(parsed.likeId)) {
            return { createdAt: parsed.createdAt, likeId: parsed.likeId };
        }
    } catch {
        // A cursor that isn't ours reads as the first page.
    }
    return null;
}

/**
 * Who liked an update, for anyone who can read it. The count on the card stays honest; the list leaves out deleted
 * accounts and anyone in a block with the viewer (Blocking B20), and shows people whose profile the viewer can't see
 * as "Private member", the same as the card does for authors.
 */
export async function readProjectUpdateLikersAction(
    projectId: string,
    updateId: string,
    params?: { cursor?: string | null; limit?: number }
) {
    try {
        if (!isLooseUuid(projectId) || !isLooseUuid(updateId)) return { success: false as const, error: "This update isn’t available." };
        const viewer = await getViewerAuthContext();
        const viewerId = viewer.userId ?? null;
        const access = await resolveProjectUpdateAccess(projectId, viewerId);
        const update = await assertReadableUpdate(projectId, updateId, access);
        if (!update) {
            return { success: false as const, error: "This update isn’t available." };
        }

        const limit = Math.min(Math.max(params?.limit ?? 20, 1), 50);
        const cursor = decodeLikerCursor(params?.cursor);
        const cursorDate = cursor ? new Date(cursor.createdAt) : null;

        const rows = await db
            .select({
                likeId: workspaceUpdateLikes.id,
                userId: workspaceUpdateLikes.userId,
                likedAt: workspaceUpdateLikes.createdAt,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
                headline: profiles.headline,
                readable: sql<boolean>`(${readableProfileIdentitySql(viewerId)})`,
            })
            .from(workspaceUpdateLikes)
            .innerJoin(profiles, eq(workspaceUpdateLikes.userId, profiles.id))
            .where(and(
                eq(workspaceUpdateLikes.updateId, updateId),
                isNull(profiles.deletedAt),
                viewerId ? sql`NOT app_private.blocked_between(${viewerId}::uuid, ${profiles.id})` : undefined,
                cursor && cursorDate ? or(
                    lt(workspaceUpdateLikes.createdAt, cursorDate),
                    and(eq(workspaceUpdateLikes.createdAt, cursorDate), lt(workspaceUpdateLikes.id, cursor.likeId)),
                ) : undefined,
            ))
            .orderBy(desc(workspaceUpdateLikes.createdAt), desc(workspaceUpdateLikes.id))
            .limit(limit + 1);

        const items = rows.slice(0, limit);
        const last = items.at(-1);
        const likers: ProjectUpdateLikerView[] = items.map((row) => {
            const isViewer = Boolean(viewerId && row.userId === viewerId);
            const visible = isViewer || row.readable;
            return {
                key: row.likeId,
                userId: visible ? row.userId : null,
                username: visible ? row.username : null,
                fullName: visible ? row.fullName : "Private member",
                avatarUrl: visible ? row.avatarUrl : null,
                headline: visible ? row.headline : null,
                likedAt: row.likedAt.toISOString(),
                isViewer,
            };
        });

        return {
            success: true as const,
            likers,
            nextCursor: rows.length > limit && last ? encodeLikerCursor(last) : null,
        };
    } catch (error) {
        logger.error("workspace_updates.likers.read_failed", { module: "workspace-updates", error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t load who liked this." };
    }
}

type CommentRow = typeof workspaceUpdateComments.$inferSelect & {
    authorFullName: string | null;
    authorUsername: string | null;
    authorAvatarUrl: string | null;
    authorMembershipRole: string | null;
    authorProjectRoleTitle: string | null;
    targetUsername: string | null;
};

function normalizeComment(row: CommentRow, access: ProjectUpdateAccess): WorkspaceUpdateCommentView {
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
        gt(workspaceUpdateComments.createdAt, cursorDate),
        and(eq(workspaceUpdateComments.createdAt, cursorDate), gt(workspaceUpdateComments.id, cursor.id)),
    );
}

async function assertReadableUpdate(projectId: string, updateId: string, access: ProjectUpdateAccess) {
    if (!access.canRead || !access.project) return null;
    const [update] = await db
        .select({
            id: workspaceUpdates.id,
            projectId: workspaceUpdates.projectId,
            authorId: workspaceUpdates.authorId,
            replyPolicy: workspaceUpdates.replyPolicy,
            visibility: workspaceUpdates.visibility,
            deletedAt: workspaceUpdates.deletedAt,
        })
        .from(workspaceUpdates)
        .where(and(
            eq(workspaceUpdates.id, updateId),
            eq(workspaceUpdates.projectId, projectId),
            isNull(workspaceUpdates.deletedAt),
            access.isOwner || access.isMember ? undefined : eq(workspaceUpdates.visibility, "public"),
            orgAudienceWhere(access),
        ))
        .limit(1);
    return update ?? null;
}

export async function readWorkspaceUpdateCommentsAction(projectId: string, updateId: string, cursor?: string | null) {
    const startedAt = performance.now();
    try {
        const viewer = await getViewerAuthContext();
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        const update = await assertReadableUpdate(projectId, updateId, access);
        if (!update) return { success: false as const, error: "This update isn’t available.", data: { comments: [], nextCursor: null, hasMore: false } };
        const parsedCursor = decodeCommentCursor(cursor);
        const targetProfiles = alias(profiles, "target_profiles");
        const rawRows = await db
            .select({
                id: workspaceUpdateComments.id,
                updateId: workspaceUpdateComments.updateId,
                projectId: workspaceUpdateComments.projectId,
                parentId: workspaceUpdateComments.parentId,
                userId: workspaceUpdateComments.userId,
                targetUserId: workspaceUpdateComments.targetUserId,
                content: workspaceUpdateComments.content,
                deletedBy: workspaceUpdateComments.deletedBy,
                deletedAt: workspaceUpdateComments.deletedAt,
                createdAt: workspaceUpdateComments.createdAt,
                updatedAt: workspaceUpdateComments.updatedAt,
                authorFullName: profiles.fullName,
                authorUsername: profiles.username,
                authorAvatarUrl: profiles.avatarUrl,
                authorMembershipRole: workspaceMembers.role,
                targetUsername: targetProfiles.username,
            })
            .from(workspaceUpdateComments)
            .leftJoin(profiles, eq(profiles.id, workspaceUpdateComments.userId))
            .leftJoin(workspaceMembers, and(
                eq(workspaceMembers.projectId, workspaceUpdateComments.projectId),
                eq(workspaceMembers.userId, workspaceUpdateComments.userId),
            ))
            .leftJoin(targetProfiles, eq(targetProfiles.id, workspaceUpdateComments.targetUserId))
            .where(and(
                eq(workspaceUpdateComments.updateId, updateId),
                eq(workspaceUpdateComments.projectId, projectId),
                commentCursorCondition(parsedCursor),
            ))
            .orderBy(asc(workspaceUpdateComments.createdAt), asc(workspaceUpdateComments.id))
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
        if (durationMs > WORKSPACE_UPDATE_PERFORMANCE_BUDGETS.commentMs) {
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

export async function createWorkspaceUpdateCommentAction(projectId: string, updateId: string, contentInput: string, parentId?: string | null) {
    const startedAt = performance.now();
    try {
        const viewer = await getViewerProfileContext();
        if (!viewer.userId) return { success: false as const, error: "Sign in to comment." };
        const rate = await consumeRateLimit(`project-update:comment:${viewer.userId}`, 60, 60);
        if (!rate.allowed) return { success: false as const, error: "Too many comments. Try again in a minute." };
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        const update = await assertReadableUpdate(projectId, updateId, access);
        if (!update || !access.project) return { success: false as const, error: "This update isn’t available." };
        const project = access.project;
        if (update.replyPolicy === "closed") return { success: false as const, error: "Comments are off for this post." };
        if (update.replyPolicy === "members" && !access.isOwner && !access.isMember) {
            return { success: false as const, error: "Only workspace members can comment on this update." };
        }
        const content = sanitizeWorkspaceUpdateContent(contentInput, 1_000);
        if (!content) return { success: false as const, error: "Comment cannot be empty." };
        const createdAt = new Date();

        if (parentId && !isLooseUuid(parentId)) return { success: false as const, error: "Reply target unavailable." };
        const posted = await db.transaction(async (tx) => {
            // COR-039: the parent must be a live comment on this update in this project, read in the write transaction.
            let targetUserId: string | null = null;
            if (parentId) {
                const [parentComment] = await tx
                    .select({ userId: workspaceUpdateComments.userId })
                    .from(workspaceUpdateComments)
                    .where(and(
                        eq(workspaceUpdateComments.id, parentId),
                        eq(workspaceUpdateComments.updateId, updateId),
                        eq(workspaceUpdateComments.projectId, projectId),
                        isNull(workspaceUpdateComments.deletedAt),
                    ))
                    .for("share")
                    .limit(1);
                if (!parentComment) return null;
                targetUserId = parentComment.userId;
            }
            const insertedRows = await tx
                .insert(workspaceUpdateComments)
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
                .returning({ id: workspaceUpdateComments.id });
            await tx
                .update(workspaceUpdates)
                .set({ commentCount: sql`${workspaceUpdates.commentCount} + 1`, updatedAt: createdAt })
                .where(eq(workspaceUpdates.id, updateId));
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
                    await enqueueWorkspaceNotificationEvent({
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
                            contextLabel: project.title ?? "Workspace update",
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
                    await enqueueWorkspaceNotificationEvent({
                        projectId,
                        actorUserId: viewer.userId,
                        actorName,
                        actorAvatarUrl,
                        eventKey: "updates.comment",
                        affectedMemberId: update.authorId,
                        title: `${actorName || "Someone"} commented on your update`,
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
                            contextLabel: project.title ?? "Workspace update",
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
                id: workspaceUpdateComments.id,
                updateId: workspaceUpdateComments.updateId,
                projectId: workspaceUpdateComments.projectId,
                parentId: workspaceUpdateComments.parentId,
                userId: workspaceUpdateComments.userId,
                targetUserId: workspaceUpdateComments.targetUserId,
                content: workspaceUpdateComments.content,
                deletedBy: workspaceUpdateComments.deletedBy,
                deletedAt: workspaceUpdateComments.deletedAt,
                createdAt: workspaceUpdateComments.createdAt,
                updatedAt: workspaceUpdateComments.updatedAt,
                authorFullName: profiles.fullName,
                authorUsername: profiles.username,
                authorAvatarUrl: profiles.avatarUrl,
                authorMembershipRole: workspaceMembers.role,
                targetUsername: targetProfiles.username,
            })
            .from(workspaceUpdateComments)
            .leftJoin(profiles, eq(profiles.id, workspaceUpdateComments.userId))
            .leftJoin(workspaceMembers, and(
                eq(workspaceMembers.projectId, workspaceUpdateComments.projectId),
                eq(workspaceMembers.userId, workspaceUpdateComments.userId),
            ))
            .leftJoin(targetProfiles, eq(targetProfiles.id, workspaceUpdateComments.targetUserId))
            .where(eq(workspaceUpdateComments.id, inserted.id))
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
        if (durationMs > WORKSPACE_UPDATE_PERFORMANCE_BUDGETS.commentMs) {
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
        console.error("Couldn’t post the update. Try again. comment:", error);
        return { success: false as const, error: "Failed to post comment." };
    }
}

export async function deleteWorkspaceUpdateCommentAction(projectId: string, commentId: string) {
    try {
        const viewer = await getViewerAuthContext();
        if (!viewer.userId) return { success: false as const, error: "Sign in to delete comments." };
        const access = await resolveProjectUpdateAccess(projectId, viewer.userId);
        if (!access.canRead || !access.project) return { success: false as const, error: "This update isn’t available." };
        const [comment] = await db
            .select({
                id: workspaceUpdateComments.id,
                updateId: workspaceUpdateComments.updateId,
                userId: workspaceUpdateComments.userId,
                deletedAt: workspaceUpdateComments.deletedAt,
            })
            .from(workspaceUpdateComments)
            .where(and(eq(workspaceUpdateComments.id, commentId), eq(workspaceUpdateComments.projectId, projectId)))
            .limit(1);
        if (!comment || comment.deletedAt) return { success: false as const, error: "Comment not found." };
        if (comment.userId !== viewer.userId && !access.canManage) {
            return { success: false as const, error: "You do not have permission to delete this comment." };
        }
        const now = new Date();
        await db.transaction(async (tx) => {
            // COR-040: only the request that actually tombstones the comment decrements the count.
            const deleted = await tx
                .update(workspaceUpdateComments)
                .set({ content: "", deletedAt: now, deletedBy: viewer.userId, updatedAt: now })
                .where(and(eq(workspaceUpdateComments.id, commentId), isNull(workspaceUpdateComments.deletedAt)))
                .returning({ id: workspaceUpdateComments.id });
            if (deleted.length === 0) return;
            await tx
                .update(workspaceUpdates)
                .set({ commentCount: sql`GREATEST(${workspaceUpdates.commentCount} - 1, 0)`, updatedAt: now })
                .where(eq(workspaceUpdates.id, comment.updateId));
        });
        return { success: true as const, updateId: comment.updateId };
    } catch (error) {
        console.error("Failed to delete project update comment:", error);
        return { success: false as const, error: "Failed to delete comment." };
    }
}

export async function readWorkspaceUpdateDraftAction(projectId: string) {
    const auth = await getViewerAuthContext();
    if (!auth || !auth.userId) return { success: false, error: "Unauthorized" };
    const userId = auth.userId;

    const access = await resolveProjectUpdateAccess(projectId, userId);
    if (!access.canCreate) return { success: false, error: "Not found" };

    try {
        const [draft] = await db
            .select()
            .from(workspaceUpdateDrafts)
            .where(
                and(
                    eq(workspaceUpdateDrafts.projectId, projectId),
                    eq(workspaceUpdateDrafts.userId, userId)
                )
            )
            .limit(1);

        return { success: true, data: draft ?? null };
    } catch (error) {
        return { success: false, error: "Failed to read draft" };
    }
}

export async function saveWorkspaceUpdateDraftAction(
    projectId: string,
    input: {
        content: string;
        visibility: string;
        entityRefs: WorkspaceUpdateEntityRefs;
        media: WorkspaceUpdateMediaItem[];
        updateType: string | null;
    }
) {
    const auth = await getViewerAuthContext();
    if (!auth || !auth.userId) return { success: false, error: "Unauthorized" };
    const userId = auth.userId;

    const access = await resolveProjectUpdateAccess(projectId, userId);
    if (!access.canCreate) return { success: false, error: "Not found" };

    try {
        const content = sanitizeWorkspaceUpdateContent(input.content, 2_200);
        const visibility: WorkspaceUpdateVisibility = input.visibility === "members" ? "members" : "public";
        const updateType = normalizeWorkspaceUpdateType(input.updateType);
        const entityRefs = normalizeEntityRefs(input.entityRefs);
        const media = normalizeMedia(input.media);
        const hasReferences = normalizeWorkspaceUpdateReferences(entityRefs.references).length > 0
            || Boolean(entityRefs.taskId || entityRefs.sprintId || entityRefs.fileId || entityRefs.readmeVersionId || entityRefs.roleId || entityRefs.milestoneId);
        if (!content.trim() && !hasReferences && media.length === 0) {
            await db.transaction(async (tx) => {
                const [existingDraft] = await tx
                    .select({ media: workspaceUpdateDrafts.media })
                    .from(workspaceUpdateDrafts)
                    .where(and(
                        eq(workspaceUpdateDrafts.projectId, projectId),
                        eq(workspaceUpdateDrafts.userId, userId),
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
                await tx.delete(workspaceUpdateDrafts).where(
                    and(
                        eq(workspaceUpdateDrafts.projectId, projectId),
                        eq(workspaceUpdateDrafts.userId, userId)
                    )
                );
            });
            return { success: true, data: null };
        }

        const draft = await db.transaction(async (tx) => {
            const [existingDraft] = await tx
                .select({ media: workspaceUpdateDrafts.media })
                .from(workspaceUpdateDrafts)
                .where(and(
                    eq(workspaceUpdateDrafts.projectId, projectId),
                    eq(workspaceUpdateDrafts.userId, userId),
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
                .insert(workspaceUpdateDrafts)
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
                    target: [workspaceUpdateDrafts.projectId, workspaceUpdateDrafts.userId],
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
