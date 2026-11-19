'use server';

import { docTitle, isEmptyDoc, readOrgDocOptions } from "@/lib/organizations/doc-rules";
import { linkedFileEditor } from "@/lib/workspaces/doc-linked-editor";
import { orgLimitBlock } from "@/lib/organizations/limits";
import { orgTaskReadFilter } from "@/lib/organizations/assignments";
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";

import { readWorkspaceFileText } from "@/lib/files/content-reader";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { availableSections, decisionLabel, DOC_SECTIONS, sectionHasDate, type DocSection } from "@/lib/workspaces/doc-sections";
import { canAddRows, MAX_BLOCK_ROWS, visibleRows } from "@/lib/workspaces/doc-live-blocks";
import {
    profiles,
    workspaceMembers,
    workspaceNodes,
    workspaceOpenRoles,
    workspaceDocumentVersions,
    workspaceDocuments,
    workspaceSprints,
    workspaces,
    tasks,
} from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { toIsoString as toIso } from "@/lib/utils/date";
import { isUuid } from "@/lib/validations/uuid";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { headers } from "next/headers";
import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { orgFileAccessSql, projectContentNodeSql, recordNodeEvent } from "@/lib/files/internal-helpers";
import {
    getOrBuildWorkspaceDocPublishMetadata,
    DEFAULT_WORKSPACE_DOC_SETTINGS,
    buildWorkspaceDocQualityReport,
    normalizeWorkspaceDocContent,
    normalizeWorkspaceDocHeadings,
    normalizeWorkspaceDocSettings,
    normalizeWorkspaceDocSlug,
    resolveWorkspaceDocPermission,
    type WorkspaceDocPublishedPayload,
    type WorkspaceDocQualityReport,
    type WorkspaceDocSettings,
    type WorkspaceDocVersion,
    type WorkspaceDocListItem,
} from "@/lib/workspaces/doc";
import { normalizeWorkspacePublicTabVisibility } from "@/lib/workspaces/settings-policies";
import type {
    WorkspaceDocReferenceKind,
    WorkspaceDocReferenceOption,
    WorkspaceDocSmartBlock,
    WorkspaceDocSmartBlockPreview,
} from "@/lib/workspaces/doc-blocks";
import { parseWorkspaceDocSmartBlocks } from "@/lib/workspaces/doc-blocks";
import { nextFreeDocSlug } from "@/lib/workspaces/doc-slug";

const PUBLIC_WORKSPACE_DETAIL_SHELL_CACHE_TAG = "public-project-detail-shell";
const PUBLIC_WORKSPACE_DETAIL_METADATA_CACHE_TAG = "public-project-detail-metadata";
const profileDisplayNameSql = (userId: unknown) => sql<string | null>`(
    SELECT COALESCE(NULLIF(full_name, ''), NULLIF(username, ''))
    FROM profiles
    WHERE id = ${userId}
    LIMIT 1
)`;
const docSlugSchema = z.string().optional().default("readme").transform((value) => normalizeWorkspaceDocSlug(value));

const readmeSettingsSchema = z.object({
    docSlug: docSlugSchema,
    editPolicy: z.enum(["leaders", "members"]).optional(),
    publicVisibility: z.literal("inherit_workspace").optional(),
    externalImages: z.boolean().optional(),
    projectBlocks: z.boolean().optional(),
});

const applyCreationIntentSchema = z.object({
    mode: z.enum(["detected", "starter", "skip"]).default("starter"),
    sourcePath: z.string().max(500).nullable().optional(),
    starterContent: z.string().max(500 * 1024).optional(),
    publishOnCreate: z.boolean().optional(),
    includeRoles: z.boolean().optional(),
});

const smartBlockPreviewSchema = z.array(z.object({
    kind: z.enum(["roles", "contributors", "files", "tasks", "sprints", "projects", "unknown"]),
    ids: z.array(z.string().max(80)).max(25).optional(),
    index: z.number().int().min(0).optional(),
    raw: z.string().max(300).optional(),
})).max(20);

function normalizeStoredQualityReport(value: unknown, fallbackContent: string): WorkspaceDocQualityReport {
    if (value && typeof value === "object") {
        const report = value as Partial<WorkspaceDocQualityReport>;
        if (
            typeof report.score === "number"
            && Array.isArray(report.issues)
            && report.sectionPresence
            && typeof report.sectionPresence === "object"
            && typeof report.contentBytes === "number"
        ) {
            return {
                score: report.score,
                issues: report.issues as WorkspaceDocQualityReport["issues"],
                sectionPresence: report.sectionPresence as Record<string, boolean>,
                contentBytes: report.contentBytes,
            };
        }
    }
    return buildWorkspaceDocQualityReport(fallbackContent);
}

function toDocVersion(row: (typeof workspaceDocumentVersions.$inferSelect & { createdByName?: string | null }) | null | undefined, displayVersionNumber?: number, coAuthorsData?: { id: string; name: string; avatarUrl: string | null }[]): WorkspaceDocVersion | null {
    if (!row) return null;
    const content = normalizeWorkspaceDocContent(row.content);
    const cleanedMetadata = content === row.content ? null : getOrBuildWorkspaceDocPublishMetadata(content);
    return {
        id: row.id,
        projectId: row.projectId,
        versionNumber: row.versionNumber,
        displayVersionNumber: displayVersionNumber ?? row.versionNumber,
        content,
        excerpt: cleanedMetadata?.excerpt ?? row.excerpt,
        headings: cleanedMetadata?.headings ?? normalizeWorkspaceDocHeadings(row.headings),
        qualityReport: cleanedMetadata?.qualityReport ?? normalizeStoredQualityReport(row.qualityReport, content),
        contentHash: cleanedMetadata?.contentHash ?? row.contentHash,
        changeSummary: row.changeSummary,
        coAuthors: coAuthorsData ?? [],
        createdBy: row.createdBy,
        createdByName: row.createdByName ?? null,
        createdAt: toIso(row.createdAt) ?? new Date().toISOString(),
        deletedAt: toIso(row.deletedAt),
    };
}

async function getOptionalUserId() {
    // CLI and agent tokens read docs through /api/v1/workspaces/:id/docs (report §18.2 "change the README").
    // requireAuthenticatedUser applies the token route allow-list and scopes; a token on any other path is
    // refused there and reads as signed out here. Browser sessions keep the cached viewer context.
    if (/^bearer\s/i.test((await headers()).get("authorization") ?? "")) {
        return (await requireAuthenticatedUser()).user?.id ?? null;
    }
    return (await getViewerAuthContext()).userId;
}

async function requireUserId() {
    const userId = await getOptionalUserId();
    if (!userId) throw new Error("Sign in to continue");
    return userId;
}

async function loadDocProjectBase(projectId: string, actorUserId: string | null) {
    const row = await db.query.workspaces.findFirst({
        where: and(eq(workspaces.id, projectId), isNull(workspaces.deletedAt)),
        columns: {
            id: true,
            slug: true,
            title: true,
            ownerId: true,
            visibility: true,
            status: true,
            publicTabVisibility: true,
            deletedAt: true,
            importSource: true,
            githubRepoUrl: true,
            githubDefaultBranch: true,
            key: true,
            kind: true,
            parentId: true,
        },
        with: {
            docs: { with: { linkedNode: { columns: { deletedAt: true, size: true } } } },
            members: {
                where: actorUserId ? eq(workspaceMembers.userId, actorUserId) : sql`false`,
                columns: { role: true },
                limit: 1,
            },
        },
    });
    if (!row) throw new Error("Workspace not found");
    const { docs: rawDocs, members, ...project } = row;
    // Report §7.4, §17.6: in an organization and its workspaces, an empty published document never reaches visitors.
    const published = rawDocs.map((d) => d.publishedVersionId).filter((id): id is string => Boolean(id));
    // Empty means blank, or only its title as a heading, as a new document starts (live-fix 23).
    const titleOf = new Map(rawDocs.map((d) => [d.publishedVersionId, docTitle(d.filename)]));
    const emptyVersions = (project.kind === "organization" || project.parentId) && published.length
        ? new Set(Array.from(await db.execute<{ id: string; content: string }>(sql`SELECT id, content FROM workspace_document_versions WHERE id IN ${published} AND length(content) < 400`))
            .filter((r) => isEmptyDoc(r.content, titleOf.get(r.id) ?? "")).map((r) => r.id))
        : new Set<string>();
    const docs = rawDocs.map((d) => ({ ...d, empty: d.linkedNodeId ? (d.linkedNode?.size ?? 0) === 0 : Boolean(d.publishedVersionId && emptyVersions.has(d.publishedVersionId)) }));
    // Inherited org admins edit a child project's docs like its admins; their edits carry their name (report §19.7).
    if (!members[0] && actorUserId) {
        const [inherited] = await db.execute<{ ok: number }>(sql`
            SELECT 1 AS ok FROM workspaces c JOIN workspaces o ON o.id = c.parent_id AND o.deleted_at IS NULL
            WHERE c.id = ${projectId} AND (o.owner_id = ${actorUserId}
              OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = o.id AND m.user_id = ${actorUserId} AND m.role IN ('owner', 'admin')))
            LIMIT 1`);
        if (inherited) return { project, membership: { role: "admin" as const }, docs };
    }
    return { project, membership: members[0] ?? null, docs };
}

type DocProjectBase = Awaited<ReturnType<typeof loadDocProjectBase>>;

function docContext(base: DocProjectBase, actorUserId: string | null, docSlug: string) {
    const { project, membership } = base;
    const readme = base.docs.find((doc) => doc.slug === docSlug);
    const settings = normalizeWorkspaceDocSettings(readme?.settings);
    const hasPublishedReadme = Boolean(readme?.publishedVersionId) || Boolean(readme?.linkedNodeId);
    const permission = resolveWorkspaceDocPermission({
        actorUserId,
        projectVisibility: project.visibility,
        projectStatus: project.status,
        publicTabVisibility: project.publicTabVisibility,
        settings,
        membershipRole: membership?.role,
        isOwner: actorUserId === project.ownerId,
        isActiveMember: Boolean(membership),
        hasPublishedReadme,
    });
    return { ...base, readme, settings, permission };
}

function visibleDocs(base: DocProjectBase, actorUserId: string | null) {
    const { project, membership } = base;
    const isOwner = actorUserId === project.ownerId;
    const results: WorkspaceDocListItem[] = [];
    for (const doc of base.docs) {
        const linkedAlive = Boolean(doc.linkedNodeId && doc.linkedNode && !doc.linkedNode.deletedAt);
        const permission = resolveWorkspaceDocPermission({
            actorUserId,
            projectVisibility: project.visibility,
            projectStatus: project.status,
            publicTabVisibility: project.publicTabVisibility,
            settings: normalizeWorkspaceDocSettings(doc.settings),
            membershipRole: isOwner ? "owner" : membership?.role,
            isOwner,
            isActiveMember: isOwner || Boolean(membership),
            hasPublishedReadme: true,
        });
        // No file and nothing published: only a starter draft that never had a file, and only for its editors
        // (T16 live test: the side list said 0 while a new workspace's README showed).
        if (!linkedAlive && !doc.publishedVersionId && !(permission.canEdit && !doc.linkedNodeId && !doc.empty)) continue;
        // Report §37.4: an organization's draft is for those who can edit it; an empty one never reaches visitors (§7.4).
        if (!permission.canEdit && project.kind === "organization" && readOrgDocOptions(normalizeWorkspaceDocSettings(doc.settings).org).lifecycle === "draft") continue;
        if (!permission.canEdit && !membership && !isOwner && doc.empty && (project.kind === "organization" || project.parentId)) continue;
        if (permission.canReadPublished || permission.canEdit) {
            const { section, kind, date, decisionNumber, decisionStatus, fromDocId } = normalizeWorkspaceDocSettings(doc.settings);
            results.push({ id: doc.id, slug: doc.slug, filename: doc.filename, linkedNodeId: doc.linkedNodeId, ...(section ? { section } : {}), ...(kind ? { kind } : {}), ...(date ? { date } : {}),
                ...(decisionNumber ? { decisionNumber, decisionStatus: decisionStatus ?? "decided" } : {}), ...(fromDocId ? { fromDocId } : {}) });
        }
    }
    return results.sort((a, b) => {
        if (a.slug === "readme") return -1;
        if (b.slug === "readme") return 1;
        return a.filename.localeCompare(b.filename, undefined, { sensitivity: "base", numeric: true });
    });
}

async function getDocProjectContext(projectId: string, actorUserId: string | null, docSlug: string = "readme") {
    return docContext(await loadDocProjectBase(projectId, actorUserId), actorUserId, normalizeWorkspaceDocSlug(docSlug));
}

async function getOrCreateMarkdown(projectId: string, userId: string, docSlug: string = "readme", settings: WorkspaceDocSettings = DEFAULT_WORKSPACE_DOC_SETTINGS) {
    docSlug = normalizeWorkspaceDocSlug(docSlug);
    const existing = await db.query.workspaceDocuments.findFirst({
        where: and(eq(workspaceDocuments.projectId, projectId), eq(workspaceDocuments.slug, docSlug)),
    });
    if (existing) return existing;
    const filename = docSlug === "readme" ? "README.md" : `${docSlug.toUpperCase()}.md`;
    const [created] = await db
        .insert(workspaceDocuments)
        .values({
            projectId,
            slug: docSlug,
            filename,
            settings,
        })
        .returning();
    if (!created) throw new Error("Couldn’t create markdown document");
    return created;
}

async function readPublishedVersion(versionId: string | null | undefined) {
    if (!versionId) return null;
    return db.query.workspaceDocumentVersions.findFirst({
        where: and(eq(workspaceDocumentVersions.id, versionId), isNull(workspaceDocumentVersions.deletedAt)),
    });
}

function revalidateProjectDoc(project: { id: string; slug: string | null }) {
    const slugOrId = project.slug || project.id;
    revalidatePath(`/workspaces/${slugOrId}`);
    revalidateTag(PUBLIC_WORKSPACE_DETAIL_SHELL_CACHE_TAG, "max");
    revalidateTag(PUBLIC_WORKSPACE_DETAIL_METADATA_CACHE_TAG, "max");
}

function projectHref(project: { id: string; slug: string | null }, tab: string) {
    return `/workspaces/${encodeURIComponent(project.slug || project.id)}?tab=${tab}`;
}

function projectTaskHref(project: { id: string; slug: string | null }, taskId: string) {
    return `${projectHref(project, "tasks")}&drawerType=task&drawerId=${encodeURIComponent(taskId)}`;
}

function projectSprintHref(project: { id: string; slug: string | null }, sprintId: string) {
    return `/workspaces/${encodeURIComponent(project.slug || project.id)}?tab=sprints&sprintId=${encodeURIComponent(sprintId)}`;
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
        ? `${projectHref(project, "files")}&fileId=${fileId}&path=${encodedPath}`
        : `${projectHref(project, "files")}&fileId=${fileId}`;
}

function projectRoleApplyHref(project: { id: string; slug: string | null }, roleId: string) {
    return `${projectHref(project, "dashboard")}&applyRole=${encodeURIComponent(roleId)}`;
}

function profileHref(row: { userId: string; username: string | null }) {
    return `/u/${encodeURIComponent(row.username || row.userId)}`;
}

function normalizeReferenceCount(value: number | null | undefined) {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
}

function canReadReferenceKind(
    kind: WorkspaceDocReferenceKind,
    context: Awaited<ReturnType<typeof getDocProjectContext>>,
) {
    if (context.permission.canEdit || context.permission.accessLevel === "owner" || context.membership) return true;
    if (context.project.visibility !== "public" || !context.permission.canReadPublished) return false;
    const tabs = normalizeWorkspacePublicTabVisibility(context.project.publicTabVisibility);
    if (kind === "files") return tabs.files;
    if (kind === "tasks") return tabs.tasks;
    if (kind === "sprints") return tabs.sprints;
    if (kind === "contributors") return tabs.dashboard;
    return true;
}

function blockKey(block: Pick<WorkspaceDocSmartBlock, "kind" | "ids" | "index">) {
    return `${block.kind}:${block.ids.join(",")}:${block.index}`;
}

function unavailablePreview(block: Pick<WorkspaceDocSmartBlock, "kind" | "ids" | "index">, description = "This workspace reference is not available to this viewer."): WorkspaceDocSmartBlockPreview {
    return {
        key: blockKey({ kind: block.kind, ids: block.ids ?? [], index: block.index ?? 0 }),
        kind: block.kind,
        title: block.kind === "unknown" ? "Unknown document block" : "Reference unavailable",
        description,
        items: [],
        unavailableCount: block.ids?.length ?? 0,
        safeUnavailable: true,
    };
}

function formatLabel(value: string | null | undefined) {
    if (!value) return null;
    return value
        .split(/[_\s-]+/)
        .filter(Boolean)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
        .join(" ");
}

function formatMemberRole(role: string | null | undefined, isOwner = false) {
    if (isOwner || role === "owner") return "Owner";
    if (role === "admin") return "Admin";
    if (role === "viewer") return "Viewer";
    return "Member";
}

function truncateReferenceText(value: string | null | undefined, maxLength = 96) {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (!normalized) return null;
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trim()}…` : normalized;
}

function formatShortDate(value: Date | string | null | undefined) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function formatSprintDateRange(startDate: Date | string, endDate: Date | string) {
    const start = formatShortDate(startDate);
    const end = formatShortDate(endDate);
    return [start, end].filter(Boolean).join(" - ");
}

function formatFileType(row: Pick<typeof workspaceNodes.$inferSelect, "name" | "mimeType" | "type">) {
    const extension = row.name.includes(".") ? row.name.split(".").pop()?.trim() : null;
    if (extension) return extension.toUpperCase();
    if (row.mimeType?.includes("/")) return row.mimeType.split("/").pop()?.toUpperCase() || "File";
    return formatLabel(row.mimeType || row.type) || "File";
}

function formatTaskReferenceTitle(title: string | null | undefined) {
    const normalized = truncateReferenceText(title, 120)
        ?.replace(/^task\s*#?\s*\d+\s*[:.\-–—]\s*/i, "")
        .trim();
    return `Task: ${normalized || "Untitled task"}`;
}

const acceptedRoleTitleSql = (projectId: string, userId: unknown) => sql<string | null>`(
    SELECT COALESCE(NULLIF(ra.accepted_role_title, ''), NULLIF(por.title, ''), NULLIF(por.role, ''))
    FROM role_applications ra
    LEFT JOIN workspace_open_roles por ON por.id = ra.role_id
    WHERE ra.workspace_id = ${projectId}
      AND ra.applicant_id = ${userId}
      AND ra.status = 'accepted'
    ORDER BY ra.updated_at DESC
    LIMIT 1
)`;

type TaskReferenceRow = Pick<typeof tasks.$inferSelect,
    "id" | "title" | "description" | "status" | "reviewStatus" | "priority" | "taskNumber" | "assigneeId" | "creatorId"
> & {
    assigneeName?: string | null;
    creatorName?: string | null;
};

function optionFromTask(row: TaskReferenceRow, project: { id: string; slug: string | null; key?: string | null }): WorkspaceDocReferenceOption {
    const assignee = truncateReferenceText(row.assigneeName, 40);
    const creator = truncateReferenceText(row.creatorName, 40);
    const assignment = assignee ? `assigned to ${assignee}` : creator ? `created by ${creator}` : "unassigned";
    const priority = row.priority ? `${formatLabel(row.priority)} priority` : null;
    const taskCode = project.key && row.taskNumber ? `${project.key}-${row.taskNumber}` : row.id;
    return {
        id: row.id,
        kind: "tasks",
        kindLabel: "Task",
        title: formatTaskReferenceTitle(row.title),
        subtitle: truncateReferenceText(row.description),
        status: row.reviewStatus === "pending" ? "In review" : formatLabel(row.status),
        reviewStatus: row.reviewStatus,
        meta: assignment,
        context: [formatLabel(row.status), assignment, priority].filter(Boolean).join(" · "),
        badges: [priority].filter((badge): badge is string => Boolean(badge)),
        href: projectTaskHref(project, taskCode),
    };
}

function optionFromSprint(
    row: Pick<typeof workspaceSprints.$inferSelect, "id" | "name" | "goal" | "description" | "status" | "startDate" | "endDate">,
    project: { id: string; slug: string | null }
): WorkspaceDocReferenceOption {
    const dateRange = formatSprintDateRange(row.startDate, row.endDate);
    return {
        id: row.id,
        kind: "sprints",
        kindLabel: "Sprint",
        title: `Sprint: ${truncateReferenceText(row.name, 80) || "Untitled sprint"}`,
        subtitle: truncateReferenceText(row.goal || row.description),
        status: formatLabel(row.status),
        meta: dateRange,
        context: [formatLabel(row.status), dateRange].filter(Boolean).join(" · "),
        href: projectSprintHref(project, row.id),
    };
}

function optionFromFile(
    row: Pick<typeof workspaceNodes.$inferSelect, "id" | "name" | "path" | "currentVersion" | "mimeType">,
    project: { id: string; slug: string | null }
): WorkspaceDocReferenceOption {
    const versions = row.currentVersion > 1 ? `${row.currentVersion} versions` : "1 version";
    const fileType = formatFileType(row as typeof workspaceNodes.$inferSelect);
    return {
        id: row.id,
        kind: "files",
        kindLabel: "File",
        title: row.name,
        subtitle: row.path || "/",
        status: fileType,
        meta: versions,
        href: projectFileHref(project, row as typeof workspaceNodes.$inferSelect),
    };
}

function optionFromRole(
    row: {
        id: string;
        role: string;
        title: string | null;
        description?: string | null;
        count: number;
        filled: number;
    },
    project: { id: string; slug: string | null },
): WorkspaceDocReferenceOption {
    const count = normalizeReferenceCount(row.count);
    const filled = count > 0
        ? Math.min(normalizeReferenceCount(row.filled), count)
        : normalizeReferenceCount(row.filled);
    const available = count > 0 ? Math.max(0, count - filled) : 0;
    const isOpen = available > 0;
    const roleTitle = truncateReferenceText(row.title || row.role, 80) || "Open role";
    const capacity = count > 0 ? `${filled}/${count}` : `${filled}`;
    return {
        id: row.id,
        kind: "roles",
        kindLabel: "Role",
        title: count > 0 ? `${roleTitle} (${capacity})` : roleTitle,
        subtitle: truncateReferenceText(row.description),
        status: isOpen ? "Open" : "Filled",
        meta: count > 0 ? `${capacity} filled` : `${filled} filled`,
        context: [roleTitle, count > 0 ? `${capacity} filled` : `${filled} filled`, isOpen ? "Open for applications" : "Filled"].join(" · "),
        href: projectRoleApplyHref(project, row.id),
    };
}

function optionFromContributor(row: {
    userId: string;
    role: string;
    fullName: string | null;
    username: string | null;
    avatarUrl: string | null;
    projectRoleTitle?: string | null;
}, project: { id: string; slug: string | null; ownerId?: string | null }): WorkspaceDocReferenceOption {
    const roleLabel = formatMemberRole(row.role, row.userId === project.ownerId);
    const projectRoleTitle = truncateReferenceText(row.projectRoleTitle, 48);
    return {
        id: row.userId,
        kind: "contributors",
        kindLabel: "Contributor",
        title: row.fullName || row.username || "Workspace member",
        subtitle: row.username ? `@${row.username}` : null,
        status: roleLabel,
        meta: projectRoleTitle ? `(${projectRoleTitle})` : null,
        context: [roleLabel, projectRoleTitle ? `Role: ${projectRoleTitle}` : null].filter(Boolean).join(" · "),
        badges: [roleLabel, projectRoleTitle].filter((badge): badge is string => Boolean(badge)),
        avatarUrl: row.avatarUrl,
        href: profileHref(row),
    };
}

export async function readWorkspaceDocAction(projectId: string, requestedSlug: string | null = null): Promise<
    | { success: true; data: WorkspaceDocPublishedPayload }
    | { success: false; error: string; code?: "NOT_FOUND" | "FORBIDDEN" }
> {
    try {
        const actorUserId = await getOptionalUserId();
        const base = await loadDocProjectBase(projectId, actorUserId);
        const docs = visibleDocs(base, actorUserId);
        const requested = requestedSlug ? normalizeWorkspaceDocSlug(requestedSlug) : null;
        // A link to a doc that is gone (or never visible) says so instead of silently showing another doc.
        // "readme" is the tab's default, so its absence is the ordinary "no docs yet" state.
        if (requested && requested !== "readme" && !docs.some((doc) => doc.slug === requested)) {
            return { success: false, error: "This doc link is invalid, or the doc was removed.", code: "NOT_FOUND" };
        }
        const docSlug = docs.find((doc) => doc.slug === requested)?.slug ?? docs[0]?.slug ?? "readme";
        const context = docContext(base, actorUserId, docSlug);
        if (!context.permission.canReadPublished && !context.permission.canEdit) {
            return { success: false, error: context.permission.reason || "Document unavailable", code: "FORBIDDEN" };
        }
        let versionRow = null;
        let linkedNode = null;
        // Report §37.4: once an organization's document is published, members read that copy, not the live file.
        const readsPublished = !context.permission.canEdit && context.project.kind === "organization" && Boolean(context.readme?.publishedVersionId)
            && readOrgDocOptions(context.settings.org).lifecycle === "published";
        if (context.readme?.linkedNodeId && !readsPublished) {
            // Scoped to this project; a missing or trashed file makes the doc
            // unavailable but never deletes it (COR-035).
            const node = await db.query.workspaceNodes.findFirst({
                where: and(
                    eq(workspaceNodes.id, context.readme.linkedNodeId),
                    eq(workspaceNodes.projectId, projectId),
                    isNull(workspaceNodes.deletedAt)
                )
            });
            if (node) {
                linkedNode = {
                    id: node.id,
                    name: node.name,
                    path: node.path,
                };
                try {
                    // The doc permission above authorizes this exact linked file; the
                    // reader still hides task-owned files from viewers without Tasks.
                    const access = await getWorkspaceAccessById(projectId, actorUserId);
                    if (!access.project || !access.canRead) throw new Error("Workspace not readable");
                    const content = await readWorkspaceFileText({ ...access, project: access.project }, projectId, node.id);
                    const metadata = getOrBuildWorkspaceDocPublishMetadata(content);
                    // "Updated by" names whoever last saved the file (live-fix 22), not "System".
                    const editor = await linkedFileEditor(node.id);
                    versionRow = {
                        id: `linked-${node.id}`,
                        projectId,
                        docId: context.readme!.id,
                        versionNumber: 1,
                        content: metadata.content,
                        excerpt: metadata.excerpt,
                        headings: metadata.headings,
                        qualityReport: metadata.qualityReport,
                        contentHash: metadata.contentHash,
                        changeSummary: "Linked file content",
                        coAuthors: [],
                        createdBy: editor.id ?? node.createdBy,
                        createdByName: editor.name,
                        createdAt: node.updatedAt || new Date(),
                        deletedAt: null,
                    };
                } catch (err) {
                    logger.error("project_readme.read_linked_node_failed", { projectId, nodeId: node.id, error: err instanceof Error ? err.message : String(err) });
                }
            } else if (!context.readme.publishedVersionId && !context.permission.canEdit) {
                return { success: false, error: "The linked file is unavailable." };
            }
        }

        let normalizedVersion = null;
        if (versionRow) {
            normalizedVersion = toDocVersion(versionRow);
        } else {
            let version = await readPublishedVersion(context.readme?.publishedVersionId);
            if (!version && context.permission.canEdit && context.readme?.id) {
                version = (await db.query.workspaceDocumentVersions.findFirst({
                    where: and(eq(workspaceDocumentVersions.docId, context.readme.id), isNull(workspaceDocumentVersions.deletedAt)),
                    orderBy: [desc(workspaceDocumentVersions.versionNumber)],
                })) ?? null;
            }
            if (!version && !context.permission.canEdit) {
                return { success: false, error: "Document has not been published yet." };
            }
            normalizedVersion = toDocVersion(version);
        }
        return {
            success: true,
            data: {
                projectId,
                docSlug,
                docs,
                canEdit: context.permission.canEdit,
                permission: context.permission,
                settings: context.settings,
                version: normalizedVersion,
                smartBlocks: normalizedVersion ? parseWorkspaceDocSmartBlocks(normalizedVersion.content) : [],
                linkedNodeId: context.readme?.linkedNodeId ?? null,
                linkedNode,
            },
        };
    } catch (error) {
        logger.error("project_readme.read_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: "Couldn’t load document." };
    }
}

export async function readWorkspaceDocSmartBlockPreviewsAction(projectId: string, input: unknown, docSlug: string = "readme"): Promise<
    | { success: true; previews: WorkspaceDocSmartBlockPreview[] }
    | { success: false; error: string }
> {
    try {
        const actorUserId = await getOptionalUserId();
        const parsed = smartBlockPreviewSchema.parse(input);
        // The doc being read decides access; a project without a README still shows its other docs' blocks.
        const context = await getDocProjectContext(projectId, actorUserId, docSlug);
        if (!context.permission.canReadPublished && !context.permission.canEdit) {
            return { success: false, error: "Document references unavailable." };
        }

        const normalizedBlocks = parsed.map((block, index) => ({
            kind: block.kind,
            ids: (block.ids ?? []).filter((id) => isUuid(id)).slice(0, 12),
            index: block.index ?? index,
        }));
        const readableKinds = new Set<WorkspaceDocReferenceKind>();
        const idsByKind = new Map<WorkspaceDocReferenceKind, Set<string>>();
        const needsRecent = new Set<WorkspaceDocReferenceKind>();

        for (const block of normalizedBlocks) {
            if (block.kind === "unknown" || !canReadReferenceKind(block.kind, context)) continue;
            readableKinds.add(block.kind);
            if (block.ids.length) {
                const ids = idsByKind.get(block.kind) ?? new Set<string>();
                block.ids.forEach((id) => ids.add(id));
                idsByKind.set(block.kind, ids);
            } else {
                needsRecent.add(block.kind);
            }
        }

        const tasksById = new Map<string, WorkspaceDocReferenceOption>();
        let recentTasks: WorkspaceDocReferenceOption[] = [];
        if (readableKinds.has("tasks")) {
            const taskIds = [...(idsByKind.get("tasks") ?? [])];
            const [selectedRows, recentRows] = await Promise.all([
                taskIds.length ? db
                    .select({
                        id: tasks.id,
                        title: tasks.title,
                        description: tasks.description,
                        status: tasks.status,
                        reviewStatus: tasks.reviewStatus,
                        priority: tasks.priority,
                        taskNumber: tasks.taskNumber,
                        assigneeId: tasks.assigneeId,
                        creatorId: tasks.creatorId,
                        assigneeName: profileDisplayNameSql(tasks.assigneeId),
                        creatorName: profileDisplayNameSql(tasks.creatorId),
                    })
                    .from(tasks)
                    .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt), inArray(tasks.id, taskIds)))
                    .orderBy(desc(tasks.updatedAt))
                    .limit(taskIds.length) : Promise.resolve([]),
                needsRecent.has("tasks") ? db
                    .select({
                        id: tasks.id,
                        title: tasks.title,
                        description: tasks.description,
                        status: tasks.status,
                        reviewStatus: tasks.reviewStatus,
                        priority: tasks.priority,
                        taskNumber: tasks.taskNumber,
                        assigneeId: tasks.assigneeId,
                        creatorId: tasks.creatorId,
                        assigneeName: profileDisplayNameSql(tasks.assigneeId),
                        creatorName: profileDisplayNameSql(tasks.creatorId),
                    })
                    .from(tasks)
                    .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
                    .orderBy(desc(tasks.updatedAt))
                    .limit(4) : Promise.resolve([]),
            ]);
            selectedRows.forEach((row) => tasksById.set(row.id, optionFromTask(row, context.project)));
            recentTasks = recentRows.map((row) => optionFromTask(row, context.project));
        }

        const sprintsById = new Map<string, WorkspaceDocReferenceOption>();
        let recentSprints: WorkspaceDocReferenceOption[] = [];
        if (readableKinds.has("sprints")) {
            const sprintIds = [...(idsByKind.get("sprints") ?? [])];
            const [selectedRows, recentRows] = await Promise.all([
                sprintIds.length ? db.query.workspaceSprints.findMany({
                    where: and(eq(workspaceSprints.projectId, projectId), inArray(workspaceSprints.id, sprintIds)),
                    columns: { id: true, name: true, goal: true, description: true, status: true, startDate: true, endDate: true },
                    orderBy: [desc(workspaceSprints.updatedAt)],
                    limit: sprintIds.length,
                }) : Promise.resolve([]),
                needsRecent.has("sprints") ? db.query.workspaceSprints.findMany({
                    where: eq(workspaceSprints.projectId, projectId),
                    columns: { id: true, name: true, goal: true, description: true, status: true, startDate: true, endDate: true },
                    orderBy: [desc(workspaceSprints.updatedAt)],
                    limit: 4,
                }) : Promise.resolve([]),
            ]);
            selectedRows.forEach((row) => sprintsById.set(row.id, optionFromSprint(row, context.project)));
            recentSprints = recentRows.map((row) => optionFromSprint(row, context.project));
        }

        const filesById = new Map<string, WorkspaceDocReferenceOption>();
        let recentFiles: WorkspaceDocReferenceOption[] = [];
        if (readableKinds.has("files")) {
            const fileIds = [...(idsByKind.get("files") ?? [])];
            // Task-owned and /.system files need Tasks visibility (COR-034).
            // Org Files: no Admins-only files or other people's copies in a doc's file blocks (report §23.9).
            const fileScope = and(canReadReferenceKind("tasks", context) ? undefined : projectContentNodeSql, orgFileAccessSql(await getWorkspaceAccessById(projectId, actorUserId)));
            const [selectedRows, recentRows] = await Promise.all([
                fileIds.length ? db.query.workspaceNodes.findMany({
                    where: and(eq(workspaceNodes.projectId, projectId), eq(workspaceNodes.type, "file"), isNull(workspaceNodes.deletedAt), inArray(workspaceNodes.id, fileIds), fileScope),
                    columns: { id: true, name: true, path: true, currentVersion: true, mimeType: true },
                    orderBy: [desc(workspaceNodes.updatedAt)],
                    limit: fileIds.length,
                }) : Promise.resolve([]),
                needsRecent.has("files") ? db.query.workspaceNodes.findMany({
                    where: and(eq(workspaceNodes.projectId, projectId), eq(workspaceNodes.type, "file"), isNull(workspaceNodes.deletedAt), fileScope),
                    columns: { id: true, name: true, path: true, currentVersion: true, mimeType: true },
                    orderBy: [desc(workspaceNodes.updatedAt)],
                    limit: 4,
                }) : Promise.resolve([]),
            ]);
            selectedRows.forEach((row) => filesById.set(row.id, optionFromFile(row, context.project)));
            recentFiles = recentRows.map((row) => optionFromFile(row, context.project));
        }

        const rolesById = new Map<string, WorkspaceDocReferenceOption>();
        let recentRoles: WorkspaceDocReferenceOption[] = [];
        if (readableKinds.has("roles")) {
            const roleIds = [...(idsByKind.get("roles") ?? [])];
            const [selectedRows, recentRows] = await Promise.all([
                roleIds.length ? db.query.workspaceOpenRoles.findMany({
                    where: and(eq(workspaceOpenRoles.projectId, projectId), inArray(workspaceOpenRoles.id, roleIds)),
                    columns: { id: true, role: true, title: true, description: true, count: true, filled: true },
                    orderBy: [desc(workspaceOpenRoles.updatedAt)],
                    limit: roleIds.length,
                }) : Promise.resolve([]),
                needsRecent.has("roles") ? db.query.workspaceOpenRoles.findMany({
                    where: eq(workspaceOpenRoles.projectId, projectId),
                    columns: { id: true, role: true, title: true, description: true, count: true, filled: true },
                    orderBy: [desc(workspaceOpenRoles.updatedAt)],
                    limit: 4,
                }) : Promise.resolve([]),
            ]);
            selectedRows.forEach((row) => rolesById.set(row.id, optionFromRole(row, context.project)));
            recentRoles = recentRows.map((row) => optionFromRole(row, context.project));
        }

        const contributorsById = new Map<string, WorkspaceDocReferenceOption>();
        let recentContributors: WorkspaceDocReferenceOption[] = [];
        if (readableKinds.has("contributors")) {
            const contributorIds = [...(idsByKind.get("contributors") ?? [])];
            const selectedRows = contributorIds.length ? await db
                .select({
                    userId: workspaceMembers.userId,
                    role: workspaceMembers.role,
                    fullName: profiles.fullName,
                    username: profiles.username,
                    avatarUrl: profiles.avatarUrl,
                    projectRoleTitle: acceptedRoleTitleSql(projectId, workspaceMembers.userId),
                })
                .from(workspaceMembers)
                .innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
                .where(and(
                    eq(workspaceMembers.projectId, projectId),
                    isNull(profiles.deletedAt),
                    inArray(workspaceMembers.userId, contributorIds),
                ))
                .orderBy(desc(workspaceMembers.joinedAt))
                .limit(contributorIds.length) : [];
            const recentRows = needsRecent.has("contributors") ? await db
                .select({
                    userId: workspaceMembers.userId,
                    role: workspaceMembers.role,
                    fullName: profiles.fullName,
                    username: profiles.username,
                    avatarUrl: profiles.avatarUrl,
                    projectRoleTitle: acceptedRoleTitleSql(projectId, workspaceMembers.userId),
                })
                .from(workspaceMembers)
                .innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
                .where(and(eq(workspaceMembers.projectId, projectId), isNull(profiles.deletedAt)))
                .orderBy(desc(workspaceMembers.joinedAt))
                .limit(4) : [];
            selectedRows.forEach((row) => contributorsById.set(row.userId, optionFromContributor(row, context.project)));
            recentContributors = recentRows.map((row) => optionFromContributor(row, context.project));
        }

        // Projects block (report §19.5): the org's child projects; visitors see public ones only.
        const isInside = Boolean(context.permission.canEdit || context.permission.accessLevel === "owner" || context.membership);
        const childProjects: WorkspaceDocReferenceOption[] = readableKinds.has("projects")
            ? (await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, visibility: workspaces.visibility })
                .from(workspaces)
                .where(and(
                    eq(workspaces.parentId, projectId),
                    isNull(workspaces.deletedAt),
                    isInside ? sql`${workspaces.visibility} <> 'private'` : eq(workspaces.visibility, "public"),
                ))
                .orderBy(workspaces.title)
                .limit(24)).map((row) => ({
                    id: row.id,
                    kind: "projects" as const,
                    title: row.title,
                    subtitle: row.visibility === "public" ? "Public" : "Organization",
                    href: `/workspaces/${encodeURIComponent(row.slug || row.id)}`,
                }))
            : [];

        const previewFor = (block: (typeof normalizedBlocks)[number]): WorkspaceDocSmartBlockPreview => {
            if (block.kind === "unknown") return unavailablePreview(block, "This document block is not recognized.");
            if (!canReadReferenceKind(block.kind, context)) return unavailablePreview(block);
            if (block.kind === "projects") {
                return {
                    key: blockKey(block),
                    kind: block.kind,
                    title: "Workspaces",
                    description: "Workspaces inside this organization, live.",
                    href: projectHref(context.project, "projects"),
                    items: childProjects,
                    unavailableCount: 0,
                };
            }
            const href = projectHref(context.project, block.kind === "files"
                ? "files"
                : block.kind === "tasks"
                    ? "tasks"
                    : block.kind === "sprints"
                        ? "sprints"
                        : block.kind === "roles"
                            ? "settings"
                            : "dashboard");
            const byId = block.kind === "tasks"
                ? tasksById
                : block.kind === "sprints"
                    ? sprintsById
                    : block.kind === "files"
                        ? filesById
                        : block.kind === "roles"
                            ? rolesById
                            : contributorsById;
            const recent = block.kind === "tasks"
                ? recentTasks
                : block.kind === "sprints"
                    ? recentSprints
                    : block.kind === "files"
                        ? recentFiles
                        : block.kind === "roles"
                            ? recentRoles
                            : recentContributors;
            const items = block.ids.length ? block.ids.map((id) => byId.get(id)).filter((item): item is WorkspaceDocReferenceOption => Boolean(item)) : recent;

            return {
                key: blockKey(block),
                kind: block.kind,
                title: block.kind === "tasks"
                    ? "Referenced tasks"
                    : block.kind === "sprints"
                        ? "Sprint summary"
                        : block.kind === "files"
                            ? "Referenced files"
                            : block.kind === "roles"
                                ? "Open roles"
                                : "Contributors",
                description: block.ids.length
                    ? "Selected workspace context from this document."
                    : "Current workspace context rendered from live workspace data.",
                href,
                items,
                unavailableCount: Math.max(0, block.ids.length - items.length),
            };
        };

        const previews = normalizedBlocks.map(previewFor);

        return { success: true, previews };
    } catch (error) {
        logger.error("project_readme.smart_block_previews_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: "Couldn’t load document workspace references." };
    }
}

export async function readWorkspaceDocSettingsAction(projectId: string, docSlug: string = "readme") {
    try {
        docSlug = normalizeWorkspaceDocSlug(docSlug);
        const userId = await requireUserId();
        const context = await getDocProjectContext(projectId, userId);
        if (!context.permission.canManageSettings) return { success: false as const, error: "You cannot manage document settings." };
        return { success: true as const, settings: context.settings, permission: context.permission };
    } catch (error) {
        return { success: false as const, error: "Couldn’t load document settings" };
    }
}

export async function updateWorkspaceDocSettingsAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = readmeSettingsSchema.parse(input);
        const docSlug = parsed.docSlug;
        const context = await getDocProjectContext(projectId, userId, docSlug);
        if (!context.permission.canManageSettings) return { success: false as const, error: "You cannot manage settings." };
        const readme = await getOrCreateMarkdown(projectId, userId, docSlug, context.settings);
        const nextSettings = normalizeWorkspaceDocSettings({ ...context.settings, ...parsed });
        const [updated] = await db.update(workspaceDocuments)
            .set({ settings: nextSettings, updatedAt: new Date() })
            .where(eq(workspaceDocuments.id, readme.id))
            .returning();
        await recordNodeEvent(projectId, userId, null, "project_readme.settings_updated", { settings: nextSettings });
        revalidateProjectDoc(context.project);
        return { success: true as const, settings: normalizeWorkspaceDocSettings(updated?.settings) };
    } catch (error) {
        logger.error("project_readme.settings_update_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Couldn’t update document settings." };
    }
}

const moveToSectionSchema = z.object({
    docSlug: docSlugSchema,
    section: z.enum(DOC_SECTIONS.map((s) => s.id) as [DocSection, ...DocSection[]]),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    kind: z.string().regex(/^[a-z0-9_-]{1,40}$/).optional(),
});

/**
 * Report 38.3 W2, S2: Move to section. Only sections whose workflow is added (or Pages); Meetings and Launches carry a
 * date (the document's creation date unless given). Settings only, so no version is written (call 7).
 */
export async function moveDocToSectionAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = moveToSectionSchema.parse(input);
        const context = await getDocProjectContext(projectId, userId, parsed.docSlug);
        if (!context.permission.canEdit) return { success: false as const, error: "Only people who can edit this document can move it." };
        const { readWorkspaceWorkflows } = await import("@/lib/workflows/server");
        const added = (await readWorkspaceWorkflows(projectId, userId)).added.map((w) => w.workflow);
        if (!availableSections(added).includes(parsed.section)) return { success: false as const, error: "That section isn’t in this workspace." };
        const readme = await db.query.workspaceDocuments.findFirst({
            where: and(eq(workspaceDocuments.projectId, projectId), eq(workspaceDocuments.slug, normalizeWorkspaceDocSlug(parsed.docSlug))),
            columns: { id: true, createdAt: true },
        });
        if (!readme) return { success: false as const, error: "That document isn’t here any more." };
        const { section: _section, kind: _kind, date: _date, ...rest } = context.settings;
        const placed = parsed.section === "pages" ? {} : {
            section: parsed.section,
            ...(parsed.kind ? { kind: parsed.kind } : {}),
            ...(sectionHasDate(parsed.section) ? { date: parsed.date ?? readme.createdAt.toISOString().slice(0, 10) } : {}),
        };
        const nextSettings = normalizeWorkspaceDocSettings({ ...rest, ...placed });
        await db.update(workspaceDocuments).set({ settings: nextSettings, updatedAt: new Date() }).where(eq(workspaceDocuments.id, readme.id));
        // A document moved into Decisions becomes a decision with the next D-number; one moved out keeps its number.
        if (parsed.section === "decisions" && !nextSettings.decisionNumber) await assignDecisionNumber(projectId, readme.id, {});
        await recordNodeEvent(projectId, userId, null, "project_readme.section_moved", { docSlug: parsed.docSlug, section: parsed.section });
        revalidateProjectDoc(context.project);
        return { success: true as const, section: parsed.section, date: nextSettings.date ?? null };
    } catch (error) {
        logger.error("project_readme.section_move_failed", { module: "projects", projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t move the document." };
    }
}

/**
 * Report 38.3 S4, call 6: the workspace's next D-number, taken under a lock on the workspace row so two records at once
 * never share one (the unique index 0108 is the backstop). A document that already has a number keeps it.
 */
async function assignDecisionNumber(projectId: string, docId: string, extra: Record<string, string>) {
    return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM workspaces WHERE id = ${projectId} FOR UPDATE`);
        const [current] = await tx.select({ n: sql<number | null>`(${workspaceDocuments.settings}->>'decisionNumber')::int` })
            .from(workspaceDocuments).where(eq(workspaceDocuments.id, docId)).limit(1);
        if (current?.n) return current.n;
        const [top] = await tx.select({ n: sql<number>`coalesce(max((${workspaceDocuments.settings}->>'decisionNumber')::int), 0)::int` })
            .from(workspaceDocuments).where(and(eq(workspaceDocuments.projectId, projectId), sql`${workspaceDocuments.settings} ? 'decisionNumber'`));
        const number = (top?.n ?? 0) + 1;
        await tx.update(workspaceDocuments)
            .set({ settings: sql`${workspaceDocuments.settings} || ${JSON.stringify({ section: "decisions", decisionNumber: number, decisionStatus: "decided", ...extra })}::jsonb`, updatedAt: new Date() })
            .where(eq(workspaceDocuments.id, docId));
        return number;
    });
}

const recordDecisionSchema = z.object({ docSlug: docSlugSchema, fromDocSlug: z.string().min(1).max(200).transform((value) => normalizeWorkspaceDocSlug(value)).optional() });

/**
 * W6: Record a decision. The browser makes the document's file as any new document (createDocFile); this files it under
 * Decisions with the next D-number, Decided, today's date and the document it came from. Editors of both only.
 */
export async function recordDecisionAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = recordDecisionSchema.parse(input);
        const context = await getDocProjectContext(projectId, userId, parsed.docSlug);
        if (!context.readme || !context.permission.canEdit) return { success: false as const, error: "Only people who can edit documents record decisions." };
        let fromDocId: string | undefined;
        if (parsed.fromDocSlug) {
            const from = await getDocProjectContext(projectId, userId, parsed.fromDocSlug);
            if (!from.readme || !from.permission.canEdit) return { success: false as const, error: "Only people who can edit this document record its decisions." };
            fromDocId = from.readme.id;
        }
        const number = await assignDecisionNumber(projectId, context.readme.id, { date: new Date().toISOString().slice(0, 10), ...(fromDocId ? { fromDocId } : {}) });
        await recordNodeEvent(projectId, userId, null, "project_readme.decision_recorded", { docSlug: parsed.docSlug, number });
        revalidateProjectDoc(context.project);
        return { success: true as const, number, label: decisionLabel(number) };
    } catch (error) {
        logger.error("project_readme.decision_record_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t record the decision." };
    }
}

export async function linkWorkspaceDocAction(projectId: string, nodeId: string) {
    try {
        const userId = await requireUserId();
        const base = await loadDocProjectBase(projectId, userId);
        const context = docContext(base, userId, "readme");
        if (!context.permission.canEdit) {
            return { success: false as const, error: "Only workspace members can add a document." };
        }

        const node = await db.query.workspaceNodes.findFirst({
            where: and(
                eq(workspaceNodes.id, nodeId),
                eq(workspaceNodes.projectId, projectId),
                eq(workspaceNodes.type, "file"),
                isNull(workspaceNodes.deletedAt),
            ),
            columns: { id: true, name: true },
        });
        if (!node) {
            return { success: false as const, error: "Target file not found." };
        }

        const existing = base.docs.find((doc) => doc.linkedNodeId === nodeId);
        if (existing) return { success: true as const, slug: existing.slug, id: existing.id };
        // Report §21.4: an organization holds up to 500 documents, checked before the new one is made.
        if (base.project.kind === "organization") {
            const full = orgLimitBlock("documents", base.docs.length, { org: base.project.title || "This organization", isAdmin: base.project.ownerId === userId || base.membership?.role === "admin" });
            if (full) return { success: false as const, error: full };
        }

        // Rows with no file and no published content are dead weight; reuse their slug.
        const taken = new Set(base.docs.filter((doc) => doc.linkedNodeId || doc.publishedVersionId).map((doc) => doc.slug));
        const slug = nextFreeDocSlug(normalizeWorkspaceDocSlug(node.name, "doc"), taken);
        const [linked] = await db
            .insert(workspaceDocuments)
            // A new doc takes the project's defaults, never another doc's org options (Required, group…).
            // Report §37.4, decision 101: a new organization document starts as a draft only its editors see.
            .values({ projectId, slug, filename: node.name, linkedNodeId: nodeId, settings: { ...context.settings, org: base.project.kind === "organization" ? { lifecycle: "draft" } : undefined } })
            .onConflictDoUpdate({
                target: [workspaceDocuments.projectId, workspaceDocuments.slug],
                set: { filename: node.name, linkedNodeId: nodeId, updatedAt: new Date() },
            })
            .returning({ id: workspaceDocuments.id });

        revalidateProjectDoc(context.project);
        return { success: true as const, slug, id: linked!.id };
    } catch (error) {
        logger.error("project_readme.link_failed", { projectId, nodeId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Internal server error." };
    }
}

export async function unlinkWorkspaceDocAction(projectId: string, docSlug: string) {
    try {
        docSlug = normalizeWorkspaceDocSlug(docSlug);
        const userId = await requireUserId();
        const context = await getDocProjectContext(projectId, userId, docSlug);
        if (!context.permission.canEdit) {
            return { success: false as const, error: "Only workspace members can remove a document." };
        }

        await db.delete(workspaceDocuments).where(and(eq(workspaceDocuments.projectId, projectId), eq(workspaceDocuments.slug, docSlug)));

        revalidateProjectDoc(context.project);
        return { success: true as const };
    } catch (error) {
        logger.error("project_readme.unlink_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Internal server error." };
    }
}

export async function listWorkspaceDocsAction(projectId: string) {
    try {
        const actorUserId = await getOptionalUserId();
        const base = await loadDocProjectBase(projectId, actorUserId);
        return { success: true as const, docs: visibleDocs(base, actorUserId) };
    } catch (error) {
        logger.error("project_readme.list_markdowns_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t list documents." };
    }
}

// ponytail: single atomic doc draft init on project creation. ceiling: 500KB starter draft. upgrade: chunked version insert if drafts exceed 500KB.
/**
 * 0.8 #15: a doc with no file yet (a new workspace's starter README) gets its file on Edit, as the CLI's first save
 * does: the new file is attached to that same doc, never a second one. Only for someone who may edit the doc.
 */
export async function attachWorkspaceDocFileAction(projectId: string, docSlug: string, nodeId: string) {
    try {
        const userId = await requireUserId();
        const slug = normalizeWorkspaceDocSlug(docSlug);
        const base = await loadDocProjectBase(projectId, userId);
        const context = docContext(base, userId, slug);
        if (!context.permission.canEdit) return { success: false as const, error: "Only people who can edit this document can start its file." };
        const doc = base.docs.find((d) => d.slug === slug);
        if (!doc) return { success: false as const, error: "That document isn’t here any more." };
        if (doc.linkedNodeId) return { success: false as const, error: "This document already has a file; open it from Files." };
        const node = await db.query.workspaceNodes.findFirst({
            where: and(eq(workspaceNodes.id, nodeId), eq(workspaceNodes.projectId, projectId), eq(workspaceNodes.type, "file"), isNull(workspaceNodes.deletedAt)),
            columns: { id: true, name: true },
        });
        if (!node) return { success: false as const, error: "The new file wasn’t found." };
        const [attached] = await db.update(workspaceDocuments)
            .set({ linkedNodeId: node.id, filename: node.name, updatedAt: new Date() })
            .where(and(eq(workspaceDocuments.projectId, projectId), eq(workspaceDocuments.slug, slug), isNull(workspaceDocuments.linkedNodeId)))
            .returning({ id: workspaceDocuments.id });
        if (!attached) return { success: false as const, error: "Someone else started this document’s file just now; open it from Files." };
        revalidateProjectDoc(context.project);
        return { success: true as const, slug, id: attached.id };
    } catch (error) {
        logger.error("project_readme.attach_failed", { projectId, nodeId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Internal server error." };
    }
}

export async function applyCreationIntentAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = applyCreationIntentSchema.parse(input);
        if (parsed.mode === "skip") {
            return { success: true as const, skipped: true };
        }

        const context = await getDocProjectContext(projectId, userId, "readme");
        if (!context.permission.canEdit) {
            return { success: false as const, error: "You cannot initialize documents for this workspace." };
        }

        const starterText = parsed.starterContent || "";

        if (starterText.trim().length > 0) {
            await db.transaction(async (tx) => {
                let readme = await tx.query.workspaceDocuments.findFirst({
                    where: and(eq(workspaceDocuments.projectId, projectId), eq(workspaceDocuments.slug, "readme")),
                });
                if (!readme) {
                    const [created] = await tx
                        .insert(workspaceDocuments)
                        .values({
                            projectId,
                            slug: "readme",
                            filename: "README.md",
                            settings: context.settings,
                        })
                        .onConflictDoNothing()
                        .returning();
                    readme = created ?? (await tx.query.workspaceDocuments.findFirst({
                        where: and(eq(workspaceDocuments.projectId, projectId), eq(workspaceDocuments.slug, "readme")),
                    }));
                }
                if (!readme) throw new Error("Couldn’t initialize readme record");

                const metadata = getOrBuildWorkspaceDocPublishMetadata(starterText);
                let versionId: string | null = null;
                const existingVersion = await tx.query.workspaceDocumentVersions.findFirst({
                    where: and(eq(workspaceDocumentVersions.docId, readme.id), eq(workspaceDocumentVersions.versionNumber, 1)),
                });

                if (existingVersion) {
                    versionId = existingVersion.id;
                } else {
                    const [newVersion] = await tx
                        .insert(workspaceDocumentVersions)
                        .values({
                            projectId,
                            docId: readme.id,
                            versionNumber: 1,
                            content: metadata.content,
                            excerpt: metadata.excerpt,
                            headings: metadata.headings,
                            qualityReport: metadata.qualityReport,
                            contentHash: metadata.contentHash,
                            changeSummary: "Initial workspace document",
                            coAuthors: [],
                            createdBy: userId,
                        })
                        .returning({ id: workspaceDocumentVersions.id });
                    versionId = newVersion?.id ?? null;
                }

                if (parsed.publishOnCreate && versionId) {
                    await tx
                        .update(workspaceDocuments)
                        .set({ publishedVersionId: versionId })
                        .where(eq(workspaceDocuments.id, readme.id));
                }
            });
        }

        revalidateProjectDoc(context.project);
        return { success: true as const };
    } catch (error) {
        logger.error("project_readme.apply_creation_intent_failed", {
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t apply document creation intent." };
    }
}


// ---- Live task-rows blocks (report 38.3 F2 S3, W3–W12) ----
const blockKeySchema = z.string().regex(/^[a-z0-9]{4,12}$/);

export type DocRow = {
    id: string; number: number | null; title: string; status: string; reviewStatus: string; dueDate: string | null; completedAt: string | null;
    position: number | null; itemType: string; assignee: { id: string; name: string | null; avatarUrl: string | null } | null; canTick: boolean;
};

/** A block's rows in order; `visible` applies the organization's task read rule (others' copies) when one is given. */
async function blockRows(docId: string, blockKey: string, readFilter?: SQL) {
    return db.select({
        visible: readFilter ? sql<boolean>`coalesce((${readFilter}), false)` : sql<boolean>`true`,
        id: tasks.id, number: tasks.taskNumber, title: tasks.title, status: tasks.status, reviewStatus: tasks.reviewStatus,
        dueDate: tasks.dueDate, completedAt: tasks.completedAt, position: tasks.sourcePosition, itemType: tasks.itemType,
        assigneeId: tasks.assigneeId, assigneeName: profiles.fullName, assigneeAvatar: profiles.avatarUrl,
    }).from(tasks).leftJoin(profiles, eq(profiles.id, tasks.assigneeId))
        .where(and(eq(tasks.sourceDocId, docId), eq(tasks.sourceBlock, blockKey), isNull(tasks.deletedAt)))
        .orderBy(asc(tasks.sourcePosition)).limit(MAX_BLOCK_ROWS);
}

/** A block's rows for this reader (W12: people who can't see Tasks get the count only; the public never sees who). */
export async function readDocRowsAction(projectId: string, docSlug: string, blockKey: string) {
    try {
        const actor = await getOptionalUserId();
        const key = blockKeySchema.parse(blockKey);
        const context = await getDocProjectContext(projectId, actor, docSlug);
        if (!context.readme || !(context.permission.canReadPublished || context.permission.canEdit)) return { success: false as const, error: "Document not found." };
        const insider = actor === context.project.ownerId || Boolean(context.membership);
        const role = actor === context.project.ownerId ? "owner" : context.membership?.role ?? null;
        const leader = role === "owner" || role === "admin";
        const canSeeTasks = insider || normalizeWorkspacePublicTabVisibility(context.project.publicTabVisibility).tasks;
        const all = await blockRows(context.readme.id, key, orgTaskReadFilter(await getWorkspaceAccessById(projectId, actor), actor));
        const readable = all.filter((r) => r.visible);
        const { rows, hidden: tabHidden } = visibleRows(readable, { canSeeTasks });
        const hidden = tabHidden + all.length - readable.length;
        return {
            success: true as const, hidden, canAdd: canAddRows(context.permission), canSeeTasks, projectKey: context.project.key ?? null, member: insider,
            rows: rows.map((r): DocRow => ({
                id: r.id, number: r.number, title: r.title, status: r.status, reviewStatus: r.reviewStatus, itemType: r.itemType,
                dueDate: r.dueDate ? r.dueDate.toISOString() : null, completedAt: r.completedAt ? r.completedAt.toISOString() : null, position: r.position,
                assignee: r.assigneeId && insider ? { id: r.assigneeId, name: r.assigneeName, avatarUrl: r.assigneeAvatar } : null,
                // B9: the task's own rule (the transition re-checks): its assignee, an unassigned one, or a leader; never viewers.
                canTick: insider && role !== "viewer" && (leader || !r.assigneeId || r.assigneeId === actor),
            })),
        };
    } catch (error) {
        logger.error("doc_rows.read_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t load these items." };
    }
}

const addRowSchema = z.object({
    docSlug: docSlugSchema,
    blockKey: blockKeySchema,
    title: z.string().trim().min(1, "Add a title").max(200),
    assigneeId: z.string().uuid().nullish(),
    dueDate: z.string().datetime().nullish(),
});

/**
 * W3: + Add action item. People who can edit the document add rows (B9); each is a task made the usual way (To do, in
 * the Backlog, the usual assignment notice) and then tied to the document and block, at the end of the list.
 */
export async function addDocRowAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const data = addRowSchema.parse(input);
        const context = await getDocProjectContext(projectId, userId, data.docSlug);
        if (!context.readme) return { success: false as const, error: `No document “${data.docSlug}” in this workspace.` };
        if (!canAddRows(context.permission)) return { success: false as const, error: "Only people who can edit this document add items here." };
        const [count] = await db.select({ n: sql<number>`count(*)::int`, last: sql<number | null>`max(${tasks.sourcePosition})` }).from(tasks)
            .where(and(eq(tasks.sourceDocId, context.readme.id), eq(tasks.sourceBlock, data.blockKey), isNull(tasks.deletedAt)));
        if ((count?.n ?? 0) >= MAX_BLOCK_ROWS) return { success: false as const, error: `A list holds up to ${MAX_BLOCK_ROWS} items.` };
        const { createTaskAction } = await import("@/lib/workspaces/server/tasks");
        const created = await createTaskAction({ projectId, title: data.title, status: "todo", priority: "medium", assigneeId: data.assigneeId ?? null, dueDate: data.dueDate ?? null });
        if (!created.success || !("task" in created) || !created.task) return { success: false as const, error: ("error" in created && created.error) || "Couldn’t add the item." };
        await db.update(tasks).set({ sourceDocId: context.readme.id, sourceBlock: data.blockKey, sourcePosition: (count?.last ?? 0) + 1 }).where(eq(tasks.id, created.task.id));
        return { success: true as const, id: created.task.id, number: created.task.taskNumber ?? null };
    } catch (error) {
        if (error instanceof z.ZodError) return { success: false as const, error: error.issues[0]?.message ?? "Check the item." };
        logger.error("doc_rows.add_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t add the item." };
    }
}

const rowSchema = z.object({ docSlug: docSlugSchema, taskId: z.string().uuid() });

async function editableRow(projectId: string, userId: string, input: unknown) {
    const data = rowSchema.parse(input);
    const context = await getDocProjectContext(projectId, userId, data.docSlug);
    if (!context.readme) throw new Error(`No document “${data.docSlug}” in this workspace.`);
    if (!canAddRows(context.permission)) throw new Error("Only people who can edit this document change its lists.");
    const [row] = await db.select({ id: tasks.id, block: tasks.sourceBlock, position: tasks.sourcePosition }).from(tasks)
        .where(and(eq(tasks.id, data.taskId), eq(tasks.sourceDocId, context.readme.id), isNull(tasks.deletedAt),
            orgTaskReadFilter(await getWorkspaceAccessById(projectId, userId), userId))).limit(1);
    if (!row?.block) throw new Error("That item isn’t in this list.");
    return { docId: context.readme.id, row: row as { id: string; block: string; position: number | null } };
}

/** W8: Move up / Move down, the menu path for reordering (positions only, no document write). */
export async function moveDocRowAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const direction = z.object({ direction: z.enum(["up", "down"]) }).passthrough().parse(input).direction;
        const { docId, row } = await editableRow(projectId, userId, input);
        const rows = await blockRows(docId, row.block);
        const at = rows.findIndex((r) => r.id === row.id);
        const other = rows[direction === "up" ? at - 1 : at + 1];
        if (!other) return { success: true as const };
        await db.transaction(async (tx) => {
            await tx.update(tasks).set({ sourcePosition: other.position ?? at }).where(eq(tasks.id, row.id));
            await tx.update(tasks).set({ sourcePosition: row.position ?? at + 1 }).where(eq(tasks.id, other.id));
        });
        return { success: true as const };
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t move the item." };
    }
}

/** W8: Remove from this list keeps the task and drops its "From" line; deleting the task is done from the task. */
export async function detachDocRowAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const { row } = await editableRow(projectId, userId, input);
        await db.update(tasks).set({ sourceDocId: null, sourceBlock: null, sourcePosition: null }).where(eq(tasks.id, row.id));
        return { success: true as const };
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t remove the item from the list." };
    }
}

/** W10: how many rows each list key holds, for editors; lists whose line was deleted from the text show as a note. */
export async function readDocRowKeysAction(projectId: string, docSlug: string) {
    try {
        const actor = await getOptionalUserId();
        const context = await getDocProjectContext(projectId, actor, docSlug);
        if (!context.readme || !context.permission.canEdit) return { success: true as const, keys: [] as Array<{ key: string; count: number }> };
        const keys = await db.select({ key: tasks.sourceBlock, count: sql<number>`count(*)::int` }).from(tasks)
            .where(and(eq(tasks.sourceDocId, context.readme.id), isNull(tasks.deletedAt))).groupBy(tasks.sourceBlock);
        return { success: true as const, keys: keys.flatMap((k) => (k.key ? [{ key: k.key, count: k.count }] : [])) };
    } catch {
        return { success: false as const, error: "Couldn’t count the lists." };
    }
}
