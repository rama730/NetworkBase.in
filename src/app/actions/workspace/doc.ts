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
import { periodLabel as goalPeriodLabel } from "@/lib/workflows/goals";
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
    workspaceMeetingSeries,
    keyResultCheckIns,
    taskSubtasks,
    workspaceDocumentReminders,
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
            roleAbilities: true,
        },
        with: {
            docs: { with: { linkedNode: { columns: { deletedAt: true, size: true } } } },
            members: {
                where: actorUserId ? eq(workspaceMembers.userId, actorUserId) : sql`false`,
                columns: { role: true, completedAt: true },
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
    // Member settings §3: a completed part reads docs like a viewer until it's reopened.
    const own = members[0] ?? null;
    return { project, membership: own ? { role: own.completedAt ? ("viewer" as const) : own.role } : null, docs };
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
        roleAbilities: project.roleAbilities,
        orgRules: project.kind === "organization" || Boolean(project.parentId),
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
            roleAbilities: project.roleAbilities,
            orgRules: project.kind === "organization" || Boolean(project.parentId),
        });
        // No file and nothing published: only a starter draft that never had a file, and only for its editors
        // (T16 live test: the side list said 0 while a new workspace's README showed).
        if (!linkedAlive && !doc.publishedVersionId && !(permission.canEdit && !doc.linkedNodeId && !doc.empty)) continue;
        // Report §37.4: an organization's draft is for those who can edit it; an empty one never reaches visitors (§7.4).
        if (!permission.canEdit && project.kind === "organization" && readOrgDocOptions(normalizeWorkspaceDocSettings(doc.settings).org).lifecycle === "draft") continue;
        if (!permission.canEdit && !membership && !isOwner && doc.empty && (project.kind === "organization" || project.parentId)) continue;
        if (permission.canReadPublished || permission.canEdit) {
            const { section, kind, date, decisionNumber, decisionStatus, fromDocId, supersedes, supersededBy, reverseReason, meetingTitle, launchTitle, period } = normalizeWorkspaceDocSettings(doc.settings);
            // A5.1 live check: a goals document shows "Goals · Q4 2026", not its file name.
            const title = section === "meetings" ? meetingTitle : section === "launches" ? launchTitle : section === "goals" && period ? `Goals · ${goalPeriodLabel(period)}` : undefined;
            results.push({ id: doc.id, slug: doc.slug, filename: doc.filename, linkedNodeId: doc.linkedNodeId, ...(section ? { section } : {}), ...(kind ? { kind } : {}), ...(date ? { date } : {}), ...(title ? { title } : {}),
                ...(decisionNumber ? { decisionNumber, decisionStatus: decisionStatus ?? "decided" } : {}), ...(fromDocId ? { fromDocId } : {}),
                ...(supersedes ? { supersedes } : {}), ...(supersededBy ? { supersededBy } : {}), ...(reverseReason ? { reverseReason } : {}) });
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

const recordDecisionSchema = z.object({
    docSlug: docSlugSchema,
    fromDocSlug: z.string().min(1).max(200).transform((value) => normalizeWorkspaceDocSlug(value)).optional(),
    /** Report 38.11 W7 (A4.2): Supersede on an older decision records this one in its place. */
    supersedesSlug: z.string().min(1).max(200).transform((value) => normalizeWorkspaceDocSlug(value)).optional(),
    /** A4.9: the passed board motion this decision records. */
    motionId: z.string().uuid().optional(),
});
const STANDING = ["proposed", "decided"];

/**
 * W6: Record a decision. The browser makes the document's file as any new document (createDocFile); this files it under
 * Decisions with the next D-number, Decided, today's date and the document it came from. Editors of both only.
 * A4.2: when it supersedes an older decision that still stands, that one becomes Superseded with a link to this one (only
 * once: a second Supersede of the same decision is refused); a decision recorded from a meeting tells its attendees.
 */
export async function recordDecisionAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = recordDecisionSchema.parse(input);
        const context = await getDocProjectContext(projectId, userId, parsed.docSlug);
        if (!context.readme || !context.permission.canEdit) return { success: false as const, error: "Only people who can edit documents record decisions." };
        let from: Awaited<ReturnType<typeof getDocProjectContext>> | null = null;
        if (parsed.fromDocSlug) {
            from = await getDocProjectContext(projectId, userId, parsed.fromDocSlug);
            if (!from.readme || !from.permission.canEdit) return { success: false as const, error: "Only people who can edit this document record its decisions." };
        }
        if (parsed.motionId) {
            const motion = from?.settings.motions?.find((m) => m.id === parsed.motionId);
            if (!from || from.settings.kind !== "board" || from.settings.approvedAt || motion?.result !== "passed" || motion.decisionDocId) return { success: false as const, error: "Only a passed motion without a decision gets one." };
        }
        let old: Awaited<ReturnType<typeof getDocProjectContext>> | null = null;
        if (parsed.supersedesSlug) {
            old = await getDocProjectContext(projectId, userId, parsed.supersedesSlug);
            if (!old.readme || !old.permission.canEdit || !old.settings.decisionNumber) return { success: false as const, error: "Only people who can edit that decision supersede it." };
            if (!STANDING.includes(old.settings.decisionStatus ?? "decided")) return { success: false as const, error: "That decision was already superseded or reversed." };
        }
        const oldId = old?.readme?.id;
        const number = await assignDecisionNumber(projectId, context.readme.id, { date: new Date().toISOString().slice(0, 10), ...(from?.readme ? { fromDocId: from.readme.id } : {}), ...(oldId ? { supersedes: oldId } : {}) });
        if (oldId) {
            // Only a decision that still stands is superseded, so two people superseding it at once can't both win.
            const moved = await db.update(workspaceDocuments)
                .set({ settings: sql`${workspaceDocuments.settings} || ${JSON.stringify({ decisionStatus: "superseded", supersededBy: context.readme.id })}::jsonb`, updatedAt: new Date() })
                .where(and(eq(workspaceDocuments.id, oldId), eq(workspaceDocuments.projectId, projectId), sql`coalesce(${workspaceDocuments.settings}->>'decisionStatus', 'decided') IN ('proposed', 'decided')`))
                .returning({ id: workspaceDocuments.id });
            if (!moved.length) return { success: false as const, error: "That decision was already superseded or reversed." };
        }
        if (parsed.motionId && from?.readme) {
            const decisionId = context.readme.id;
            const linked = await updateMeetingSettings(from.readme.id, (s) => {
                const motion = s.motions?.find((m) => m.id === parsed.motionId);
                if (motion?.result !== "passed" || motion.decisionDocId) return { error: "That motion already has its decision." };
                return { patch: { motions: s.motions!.map((m) => (m.id === motion.id ? { ...m, decisionDocId: decisionId } : m)) }, result: null };
            });
            if ("error" in linked) return { success: false as const, error: linked.error };
        }
        await recordNodeEvent(projectId, userId, null, "project_readme.decision_recorded", { docSlug: parsed.docSlug, number, ...(parsed.supersedesSlug ? { supersedes: parsed.supersedesSlug } : {}) });
        // Report 38.11 notifications: a decision recorded from a meeting reaches the people who attended (Summary).
        // Security review (A4.2): only attendees who are still members and can read the new decision are told.
        const attendees = from?.settings.section === "meetings" ? await readersOf(projectId, parsed.docSlug, (from.settings.attendeeIds ?? []).filter((id) => id !== userId)) : [];
        if (attendees.length) {
            const { createNotification } = await import("@/lib/notifications/service");
            const meeting = from!.settings.meetingTitle ?? from!.readme!.filename.replace(/\.md$/i, "");
            for (const to of attendees) await createNotification({
                recipientUserId: to, actorUserId: userId, kind: "project_task_activity", category: "tasks", importance: "more",
                title: `${decisionLabel(number)} recorded in ${meeting}`,
                href: `/workspaces/${encodeURIComponent(context.project.slug || projectId)}?tab=docs&doc=${encodeURIComponent(parsed.docSlug)}`,
                entityRefs: { projectId, projectSlug: context.project.slug ?? null }, dedupeKey: `decision:${context.readme.id}:${to}`,
            }).catch(() => undefined);
        }
        revalidateProjectDoc(context.project);
        return { success: true as const, number, label: decisionLabel(number) };
    } catch (error) {
        logger.error("project_readme.decision_record_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t record the decision." };
    }
}

const decisionStatusSchema = z.object({ docSlug: docSlugSchema, status: z.enum(["proposed", "decided"]) });

/** Report 38.11 W4/S5 (A4.2): the header's status select moves a standing decision between Proposed and Decided. */
export async function setDecisionStatusAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = decisionStatusSchema.parse(input);
        const context = await getDocProjectContext(projectId, userId, parsed.docSlug);
        if (!context.readme || !context.permission.canEdit || !context.settings.decisionNumber) return { success: false as const, error: "Only people who can edit this decision change its status." };
        if (!STANDING.includes(context.settings.decisionStatus ?? "decided")) return { success: false as const, error: "A superseded or reversed decision keeps its status." };
        // Re-checked in the update, so a Supersede or Reverse at the same moment is never undone.
        const moved = await db.update(workspaceDocuments).set({ settings: sql`${workspaceDocuments.settings} || ${JSON.stringify({ decisionStatus: parsed.status })}::jsonb`, updatedAt: new Date() })
            .where(and(eq(workspaceDocuments.id, context.readme.id), sql`coalesce(${workspaceDocuments.settings}->>'decisionStatus', 'decided') IN ('proposed', 'decided')`))
            .returning({ id: workspaceDocuments.id });
        if (!moved.length) return { success: false as const, error: "A superseded or reversed decision keeps its status." };
        await recordNodeEvent(projectId, userId, null, "project_readme.decision_status", { docSlug: parsed.docSlug, status: parsed.status });
        revalidateProjectDoc(context.project);
        return { success: true as const };
    } catch (error) {
        logger.error("project_readme.decision_status_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t change the status." };
    }
}

const reverseDecisionSchema = z.object({ docSlug: docSlugSchema, reason: z.string().trim().min(1).max(500) });

/** Report 38.11 W7 (A4.2): Reverse asks a reason; the decision stays (its D-number never changes) and shows Reversed. */
export async function reverseDecisionAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = reverseDecisionSchema.safeParse(input);
        if (!parsed.success) return { success: false as const, error: "Say why it's reversed." };
        const context = await getDocProjectContext(projectId, userId, parsed.data.docSlug);
        if (!context.readme || !context.permission.canEdit || !context.settings.decisionNumber) return { success: false as const, error: "Only people who can edit this decision reverse it." };
        const moved = await db.update(workspaceDocuments)
            .set({ settings: sql`${workspaceDocuments.settings} || ${JSON.stringify({ decisionStatus: "reversed", reverseReason: parsed.data.reason })}::jsonb`, updatedAt: new Date() })
            .where(and(eq(workspaceDocuments.id, context.readme.id), sql`coalesce(${workspaceDocuments.settings}->>'decisionStatus', 'decided') IN ('proposed', 'decided')`))
            .returning({ id: workspaceDocuments.id });
        if (!moved.length) return { success: false as const, error: "That decision was already superseded or reversed." };
        await recordNodeEvent(projectId, userId, null, "project_readme.decision_reversed", { docSlug: parsed.data.docSlug });
        revalidateProjectDoc(context.project);
        return { success: true as const };
    } catch (error) {
        logger.error("project_readme.decision_reverse_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t reverse the decision." };
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
        // Security review (A4.9): approved minutes stay a document, so their lock can't be dropped by unlinking.
        if (context.settings.approvedAt) return { success: false as const, error: "Approved minutes stay in Documents." };

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
    /** Report 38.11 W5 (A4.1): an open action item carried over from the meeting before (the same task). */
    carried?: boolean;
};

/** A block's rows in order; `visible` applies the organization's task read rule (others' copies) when one is given. */
async function blockRows(docId: string, blockKey: string, readFilter?: SQL, carriedIds: string[] = []) {
    return db.select({
        visible: readFilter ? sql<boolean>`coalesce((${readFilter}), false)` : sql<boolean>`true`,
        id: tasks.id, projectId: tasks.projectId, number: tasks.taskNumber, title: tasks.title, status: tasks.status, reviewStatus: tasks.reviewStatus,
        dueDate: tasks.dueDate, completedAt: tasks.completedAt, position: tasks.sourcePosition, itemType: tasks.itemType,
        assigneeId: tasks.assigneeId, assigneeName: profiles.fullName, assigneeAvatar: profiles.avatarUrl,
    }).from(tasks).leftJoin(profiles, eq(profiles.id, tasks.assigneeId))
        .where(and(isNull(tasks.deletedAt), carriedIds.length
            ? sql`((${tasks.sourceDocId} = ${docId} AND ${tasks.sourceBlock} = ${blockKey}) OR ${tasks.id} IN (${sql.join(carriedIds.map((id) => sql`${id}::uuid`), sql`, `)}))`
            : and(eq(tasks.sourceDocId, docId), eq(tasks.sourceBlock, blockKey))))
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
        // A4.1: a meeting's Action items also list the open items carried into it (kept in this workspace only).
        const carried = key === "actions" ? (context.settings.carriedTaskIds ?? []) : [];
        const all = (await blockRows(context.readme.id, key, orgTaskReadFilter(await getWorkspaceAccessById(projectId, actor), actor), carried))
            .filter((r) => !carried.includes(r.id) || r.projectId === projectId);
        const readable = all.filter((r) => r.visible);
        const { rows, hidden: tabHidden } = visibleRows(readable, { canSeeTasks });
        const hidden = tabHidden + all.length - readable.length;
        return {
            success: true as const, hidden, canAdd: canAddRows(context.permission), canSeeTasks, projectKey: context.project.key ?? null, member: insider, canPlanSprints: leader,
            rows: rows.map((r): DocRow => ({
                id: r.id, number: r.number, title: r.title, status: r.status, reviewStatus: r.reviewStatus, itemType: r.itemType,
                dueDate: r.dueDate ? r.dueDate.toISOString() : null, completedAt: r.completedAt ? r.completedAt.toISOString() : null, position: r.position,
                assignee: r.assigneeId && insider ? { id: r.assigneeId, name: r.assigneeName, avatarUrl: r.assigneeAvatar } : null,
                // B9: the task's own rule (the transition re-checks): its assignee, an unassigned one, or a leader; never viewers.
                canTick: insider && role !== "viewer" && (leader || !r.assigneeId || r.assigneeId === actor),
                ...(carried.includes(r.id) ? { carried: true } : {}),
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
    dueDate: z.string().max(40).refine((v) => Number.isFinite(Date.parse(v)), "Pick a valid date").nullish(),
    // Report 38.4 W5 (plan A0.9): More details sends the full module's fields; createTaskAction checks them as usual.
    description: z.string().max(20000).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    status: z.enum(["todo", "in_progress", "blocked", "done"]).optional(),
    sprintId: z.string().uuid().nullish(),
    storyPoints: z.number().int().min(0).max(100).nullish(),
    subtasks: z.array(z.object({ title: z.string().trim().min(1).max(500) })).max(100).optional(),
    attachmentNodeIds: z.array(z.string().uuid()).max(100).optional(),
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
        const created = await createTaskAction({
            projectId, title: data.title, status: data.status ?? "todo", priority: data.priority ?? "medium", assigneeId: data.assigneeId ?? null, dueDate: data.dueDate ?? null,
            ...(data.description ? { description: data.description } : {}), ...(data.sprintId ? { sprintId: data.sprintId } : {}),
            ...(data.storyPoints != null ? { storyPoints: data.storyPoints } : {}), ...(data.attachmentNodeIds?.length ? { attachmentNodeIds: data.attachmentNodeIds } : {}),
            ...(data.subtasks?.length ? { subtasks: data.subtasks.map((st) => ({ title: st.title, completed: false })) } : {}),
        });
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

// ── Report 38.10 D2 (plan A3.1): launch checklists ──────────────────────────────────────────────────────────────────
const launchDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the launch date");
const createLaunchSchema = z.object({ docSlug: docSlugSchema, date: launchDateSchema, preset: z.string().regex(/^[a-z_]{1,40}$/), versionLabel: z.string().trim().max(40).optional(), title: z.string().trim().max(120).optional() });

async function launchDoc(projectId: string, userId: string, docSlug: string, needEdit = true) {
    const context = await getDocProjectContext(projectId, userId, docSlug);
    if (!context.readme) throw new Error("That launch isn’t here any more.");
    if (needEdit && !context.permission.canEdit) throw new Error("Only people who can edit this launch change it.");
    if (context.settings.section !== "launches") throw new Error("That document isn’t a launch.");
    return context;
}
async function writeLaunchSettings(docId: string, patch: Record<string, unknown>) {
    return db.transaction(async (tx) => {
        const [row] = Array.from(await tx.execute<{ settings: Record<string, unknown> | null }>(sql`SELECT settings FROM workspace_documents WHERE id = ${docId}::uuid FOR UPDATE`));
        // Security review (A4.9): approved minutes keep their settings (time, attendees, motions) as approved.
        if (row?.settings && typeof row.settings.approvedAt === "string") throw new Error("These minutes are approved and can't change.");
        const next = normalizeWorkspaceDocSettings({ ...(row?.settings ?? {}), ...patch });
        await tx.update(workspaceDocuments).set({ settings: next, updatedAt: new Date() }).where(eq(workspaceDocuments.id, docId));
        return next;
    });
}

/**
 * W1: the browser makes the document's file from the preset (launchMarkdown); this files it under Launches with its
 * date, preset and Planning, and adds the preset's steps as unassigned, undated tasks in their stage's block (call 3).
 */
export async function createLaunchAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const data = createLaunchSchema.parse(input);
        const { launchPreset, stageBlockKey } = await import("@/lib/workflows/launches");
        const preset = launchPreset(data.preset);
        if (!preset) return { success: false as const, error: "Pick a preset" };
        const context = await getDocProjectContext(projectId, userId, data.docSlug);
        if (!context.readme || !context.permission.canEdit) return { success: false as const, error: "Only people who can edit documents make launches." };
        const { readWorkspaceWorkflows } = await import("@/lib/workflows/server");
        if (!availableSections((await readWorkspaceWorkflows(projectId, userId)).added.map((w) => w.workflow)).includes("launches")) return { success: false as const, error: "Add Launch checklists first." };
        await writeLaunchSettings(context.readme.id, { section: "launches", kind: preset.id, date: data.date, launchStage: "planning", ...(data.versionLabel ? { versionLabel: data.versionLabel } : {}), ...(data.title ? { launchTitle: data.title } : {}) });
        const { createTaskAction } = await import("@/lib/workspaces/server/tasks");
        for (const [i, stage] of preset.stages.entries()) {
            for (const [p, title] of stage.steps.entries()) {
                const made = await createTaskAction({ projectId, title, status: "todo", priority: "medium", assigneeId: null, dueDate: null });
                if (made.success && "task" in made && made.task) await db.update(tasks).set({ sourceDocId: context.readme.id, sourceBlock: stageBlockKey(i), sourcePosition: p + 1 }).where(eq(tasks.id, made.task.id));
            }
        }
        await recordNodeEvent(projectId, userId, null, "project_readme.launch_created", { docSlug: data.docSlug, preset: preset.id });
        revalidateProjectDoc(context.project);
        return { success: true as const };
    } catch (error) {
        if (error instanceof z.ZodError) return { success: false as const, error: error.issues[0]?.message ?? "Check the launch." };
        logger.error("launches.create_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t make the launch." };
    }
}

/** S1–S4: the launch's header, progress, what ships and the What's new draft. Readers of the document only. */
export async function readLaunchAction(projectId: string, docSlug: string) {
    try {
        const actor = await getOptionalUserId();
        const context = await getDocProjectContext(projectId, actor, docSlug);
        if (!context.readme || !(context.permission.canReadPublished || context.permission.canEdit) || context.settings.section !== "launches") return { success: false as const, error: "Launch not found." };
        const insider = actor === context.project.ownerId || Boolean(context.membership);
        const { launchProgress, whatsNew } = await import("@/lib/workflows/launches");
        const steps = await db.select({ title: tasks.title, status: tasks.status, stage: tasks.stage, dueDate: tasks.dueDate }).from(tasks)
            .where(and(eq(tasks.sourceDocId, context.readme.id), isNull(tasks.deletedAt))).limit(MAX_BLOCK_ROWS * 10);
        const ships = insider ? Array.from(await db.execute<{ id: string; task_number: number | null; title: string; stage: string | null; item_type: string | null }>(sql`
            SELECT id, task_number, title, stage, type_fields->>'itemType' AS item_type FROM tasks
            WHERE workspace_id = ${projectId}::uuid AND item_type = 'roadmap_item' AND deleted_at IS NULL AND type_fields->>'launchDocId' = ${context.readme.id}
            ORDER BY task_number`)) : [];
        const version = context.settings.versionLabel ?? null;
        const bugs = insider && version ? Array.from(await db.execute<{ title: string; fixed_in: string | null }>(sql`
            SELECT title, type_fields->>'fixedIn' AS fixed_in FROM tasks WHERE workspace_id = ${projectId}::uuid AND item_type = 'bug' AND deleted_at IS NULL
              AND lower(trim(type_fields->>'fixedIn')) = lower(${version})`)) : [];
        const today = new Date().toISOString().slice(0, 10);
        return {
            success: true as const, docId: context.readme.id, canEdit: context.permission.canEdit, member: insider,
            date: context.settings.date ?? null, stage: context.settings.launchStage ?? "planning", preset: context.settings.kind ?? null, versionLabel: version,
            launchedAt: context.settings.launchedAt ?? null, progress: launchProgress(steps),
            openSteps: steps.filter((s) => s.status !== "done" && s.stage !== "cancelled").length,
            openTitles: insider ? steps.filter((s) => s.status !== "done" && s.stage !== "cancelled").slice(0, 5).map((s) => s.title) : [],
            overdue: steps.filter((s) => s.status !== "done" && s.dueDate && s.dueDate.toISOString().slice(0, 10) < today).length,
            ships: ships.map((s) => ({ id: s.id, number: s.task_number, title: s.title, stage: s.stage, itemType: s.item_type ?? "feature" })),
            whatsNew: whatsNew(ships.map((s) => ({ title: s.title, itemType: s.item_type })), bugs.map((b) => ({ title: b.title, fixedIn: b.fixed_in })), version),
        };
    } catch (error) {
        logger.error("launches.read_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t load the launch." };
    }
}

const shipsSchema = z.object({ docSlug: docSlugSchema, itemId: z.string().uuid(), on: z.boolean() });
/** W3: Add item / Remove: a roadmap item ships in this launch (T2's launchDocId; one launch per item). */
export async function setLaunchShipsAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const data = shipsSchema.parse(input);
        const context = await launchDoc(projectId, userId, data.docSlug);
        const { lockTaskForWrite } = await import("@/lib/workspaces/task-transition-service");
        await db.transaction(async (tx) => {
            const locked = await lockTaskForWrite(tx, data.itemId, userId);
            if (locked.projectId !== projectId || locked.itemType !== "roadmap_item") throw new Error("Pick a roadmap item from this workspace");
            await tx.update(tasks).set({ typeFields: data.on ? sql`coalesce(${tasks.typeFields}, '{}'::jsonb) || ${JSON.stringify({ launchDocId: context.readme!.id })}::jsonb` : sql`${tasks.typeFields} - 'launchDocId'`, updatedAt: new Date() }).where(eq(tasks.id, data.itemId));
        });
        return { success: true as const };
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t change what ships." };
    }
}

const launchSchema = z.object({ docSlug: docSlugSchema, markItems: z.boolean() });
/**
 * W5 and call 4: Launch now. Launched; the items that ship become Launched when asked (each move is the editor's own,
 * with its checks). Returns the release Update's text to prefill; it never posts.
 */
export async function launchAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const data = launchSchema.parse(input);
        const context = await launchDoc(projectId, userId, data.docSlug);
        if (context.settings.launchStage === "launched" || context.settings.launchStage === "closed") return { success: false as const, error: "It’s launched already." };
        if (context.settings.launchStage === "cancelled") return { success: false as const, error: "This launch was canceled." };
        await writeLaunchSettings(context.readme!.id, { launchStage: "launched", launchedAt: new Date().toISOString() });
        const read = await readLaunchAction(projectId, data.docSlug);
        let marked = 0;
        if (data.markItems && read.success) {
            const { setTaskStageAction } = await import("@/app/actions/task");
            for (const item of read.ships.filter((s) => s.stage !== "launched" && s.stage !== "wont_do")) if ((await setTaskStageAction({ projectId, taskId: item.id, stage: "launched" })).success) marked += 1;
        }
        // Part 8: people with steps hear it launched (Summary); roadmap assignees hear it from their item's move.
        const people = await db.selectDistinct({ id: tasks.assigneeId }).from(tasks).where(and(eq(tasks.sourceDocId, context.readme!.id), isNull(tasks.deletedAt), sql`${tasks.assigneeId} IS NOT NULL`, sql`${tasks.assigneeId} <> ${userId}::uuid`));
        if (people.length) {
            const { createNotification } = await import("@/lib/notifications/service");
            const name = context.settings.launchTitle ?? context.readme!.filename.replace(/\.md$/i, "");
            for (const p of people) await createNotification({
                recipientUserId: p.id!, actorUserId: userId, kind: "project_task_activity", category: "tasks", importance: "more", title: `Launched: ${name}`,
                href: `/workspaces/${encodeURIComponent(context.project.slug || projectId)}?tab=docs&doc=${encodeURIComponent(data.docSlug)}`,
                entityRefs: { projectId, projectSlug: context.project.slug ?? null }, dedupeKey: `launch-launched:${context.readme!.id}:${p.id}`,
            }).catch(() => undefined);
        }
        const w = read.success ? read.whatsNew : { added: [], improved: [], fixed: [] };
        const group = (label: string, list: string[]) => (list.length ? `**${label}**\n${list.map((t) => `- ${t}`).join("\n")}\n` : "");
        const update = [`${context.settings.launchTitle ?? context.readme!.filename.replace(/\.md$/i, "")} is out.`, group("Added", w.added), group("Improved", w.improved), group("Fixed", w.fixed)].filter(Boolean).join("\n");
        revalidateProjectDoc(context.project);
        return { success: true as const, marked, update };
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t launch." };
    }
}

const closeSchema = z.object({ docSlug: docSlugSchema, remaining: z.enum(["leave", "backlog"]) });
/**
 * W6 and call 6: Close launch, with what happens to open steps: leave them, or move them to the Backlog (out of their
 * sprints). Steps are plain tasks with no Canceled state, so "Cancel them" isn't offered (call 7).
 */
export async function closeLaunchAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const data = closeSchema.parse(input);
        const context = await launchDoc(projectId, userId, data.docSlug);
        if (context.settings.launchStage !== "launched") return { success: false as const, error: "Close a launch once it’s launched." };
        await settleOpenSteps(projectId, context.readme!.id, data.remaining);
        await writeLaunchSettings(context.readme!.id, { launchStage: "closed" });
        revalidateProjectDoc(context.project);
        return { success: true as const };
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t close the launch." };
    }
}
async function settleOpenSteps(projectId: string, docId: string, remaining: "leave" | "backlog") {
    if (remaining === "leave") return;
    const open = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.sourceDocId, docId), isNull(tasks.deletedAt), sql`${tasks.status} <> 'done'`, sql`${tasks.sprintId} IS NOT NULL`));
    const { updateTaskFieldAction } = await import("@/app/actions/task");
    for (const s of open) await updateTaskFieldAction(s.id, "sprintId", null, projectId);
}

const moveDateSchema = z.object({ docSlug: docSlugSchema, date: launchDateSchema, shiftSteps: z.boolean() });
/** W7: a new launch date; the steps' due dates move by the same days when asked (undated steps stay undated). */
export async function moveLaunchDateAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const data = moveDateSchema.parse(input);
        const context = await launchDoc(projectId, userId, data.docSlug);
        const before = context.settings.date;
        await writeLaunchSettings(context.readme!.id, { date: data.date });
        let moved = 0;
        if (data.shiftSteps && before) {
            const days = Math.round((Date.parse(`${data.date}T00:00:00Z`) - Date.parse(`${before}T00:00:00Z`)) / 86_400_000);
            const steps = await db.select({ id: tasks.id, dueDate: tasks.dueDate }).from(tasks).where(and(eq(tasks.sourceDocId, context.readme!.id), isNull(tasks.deletedAt), sql`${tasks.status} <> 'done'`));
            const { shiftDates } = await import("@/lib/workflows/launches");
            const { updateTaskFieldAction } = await import("@/app/actions/task");
            for (const s of shiftDates(steps.map((x) => ({ id: x.id, dueDate: x.dueDate ? x.dueDate.toISOString() : null })), days)) {
                if (s.dueDate && (await updateTaskFieldAction(s.id, "dueDate", `${s.dueDate}T00:00:00.000Z`, projectId)).success) moved += 1;
            }
        }
        revalidateProjectDoc(context.project);
        return { success: true as const, moved };
    } catch (error) {
        if (error instanceof z.ZodError) return { success: false as const, error: error.issues[0]?.message ?? "Check the date." };
        return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t move the launch." };
    }
}

const cancelSchema = z.object({ docSlug: docSlugSchema, backlogSteps: z.boolean() });
/** W8: Cancel launch: the items it shipped go back to Planned and stop pointing at it; open steps go to the Backlog when asked. */
export async function cancelLaunchAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const data = cancelSchema.parse(input);
        const context = await launchDoc(projectId, userId, data.docSlug);
        if (context.settings.launchStage === "launched" || context.settings.launchStage === "closed") return { success: false as const, error: "A launched launch is closed, not canceled." };
        const read = await readLaunchAction(projectId, data.docSlug);
        if (read.success) {
            const { setTaskStageAction } = await import("@/app/actions/task");
            for (const item of read.ships) {
                await setLaunchShipsAction(projectId, { docSlug: data.docSlug, itemId: item.id, on: false });
                if (item.stage === "testing" || item.stage === "in_progress") await setTaskStageAction({ projectId, taskId: item.id, stage: "planned" });
            }
        }
        if (data.backlogSteps) await settleOpenSteps(projectId, context.readme!.id, "backlog");
        await writeLaunchSettings(context.readme!.id, { launchStage: "cancelled" });
        revalidateProjectDoc(context.project);
        return { success: true as const };
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t cancel the launch." };
    }
}

// ── Report 38.11 D1 (plan A4.1): meetings ────────────────────────────────────────────────────────────────────────────
const meetingSchema = z.object({
    docSlug: docSlugSchema, type: z.string().regex(/^[a-z_]{1,40}$/), title: z.string().trim().min(1).max(120),
    startsAt: z.string().refine((v) => Number.isFinite(Date.parse(v)), "Pick the date and time"), lengthMinutes: z.number().int().min(5).max(600),
    attendeeIds: z.array(z.string().uuid()).max(100), repeat: z.enum(["none", "weekly", "biweekly", "weekdays", "monthly"]),
    /** A4.9: a board meeting's size, for its quorum. */
    boardSize: z.number().int().min(1).max(100).optional(),
});

async function meetingDoc(projectId: string, userId: string | null, docSlug: string, needEdit = true) {
    const context = await getDocProjectContext(projectId, userId, docSlug);
    if (!context.readme) throw new Error("That meeting isn’t here any more.");
    if (needEdit && !context.permission.canEdit) throw new Error("Only people who can edit this meeting change it.");
    if (context.settings.section !== "meetings") throw new Error("That document isn’t a meeting.");
    return context;
}
/** Attendees are members (or the owner) of the workspace; anyone else is dropped. */
/** The people among `ids` who are still members and may read the document (the page's own read rule). */
async function readersOf(projectId: string, docSlug: string, ids: string[]) {
    const out: string[] = [];
    for (const id of await memberIds(projectId, ids)) {
        const c = await getDocProjectContext(projectId, id, docSlug);
        if (c.readme && (c.permission.canReadPublished || c.permission.canEdit)) out.push(id);
    }
    return out;
}

async function memberIds(projectId: string, ids: string[]) {
    if (!ids.length) return [];
    const rows = Array.from(await db.execute<{ id: string }>(sql`
        SELECT id FROM profiles WHERE id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
          AND (id = (SELECT owner_id FROM workspaces WHERE id = ${projectId}::uuid) OR id IN (SELECT user_id FROM workspace_members WHERE workspace_id = ${projectId}::uuid))`));
    return ids.filter((i) => rows.some((r) => r.id === i));
}
/** W3: a reminder per attendee before the start (rewritten whenever the meeting moves). */
async function scheduleMeetingReminders(projectId: string, docId: string, startsAt: string, attendeeIds: string[]) {
    const { reminderAt } = await import("@/lib/workflows/meetings");
    const { readMeetingSettings } = await import("@/lib/workflows/meeting-settings-server");
    await db.delete(workspaceDocumentReminders).where(and(eq(workspaceDocumentReminders.docId, docId), isNull(workspaceDocumentReminders.sentAt)));
    // A4.16: Settings → Meetings' reminder (0 turns them off).
    const at = reminderAt(startsAt, (await readMeetingSettings(projectId)).reminderMinutes);
    if (!at || Date.parse(at) <= Date.now() || !attendeeIds.length) return;
    await db.insert(workspaceDocumentReminders).values(attendeeIds.map((userId) => ({ docId, userId, remindAt: new Date(at) })));
    const { wakeChatDueIfSoon } = await import("@/inngest/wake");
    await wakeChatDueIfSoon(new Date(at));
}
async function tellAttendees(projectId: string, actorId: string, attendeeIds: string[], title: string, docSlug: string, project: { slug: string | null }) {
    const { createNotification } = await import("@/lib/notifications/service");
    for (const to of attendeeIds.filter((id) => id !== actorId)) await createNotification({
        recipientUserId: to, actorUserId: actorId, kind: "project_task_activity", category: "tasks", importance: "important", title: `Invited: ${title}`,
        href: `/workspaces/${encodeURIComponent(project.slug || projectId)}?tab=docs&doc=${encodeURIComponent(docSlug)}`,
        entityRefs: { projectId, projectSlug: project.slug ?? null }, dedupeKey: `meeting-invite:${docSlug}:${to}`,
    }).catch(() => undefined);
}

/**
 * W1: the browser makes the document's file from the type (meetingMarkdown); this files it under Meetings with its
 * start, length and attendees, starts a series when it repeats, schedules the reminders and tells the attendees.
 */
export async function createMeetingAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const data = meetingSchema.parse(input);
        const { meetingType } = await import("@/lib/workflows/meetings");
        const type = meetingType(data.type);
        if (!type) return { success: false as const, error: "Pick a meeting type" };
        const { readMeetingSettings } = await import("@/lib/workflows/meeting-settings-server");
        if (!(await readMeetingSettings(projectId)).types.includes(type.id)) return { success: false as const, error: "That meeting type is switched off in Settings → Meetings." };
        const context = await getDocProjectContext(projectId, userId, data.docSlug);
        if (!context.readme || !context.permission.canEdit) return { success: false as const, error: "Only people who can edit documents make meetings." };
        if (context.settings.section === "meetings" || context.settings.approvedAt) return { success: false as const, error: "That document is already a meeting." };
        const { readWorkspaceWorkflows } = await import("@/lib/workflows/server");
        if (!availableSections((await readWorkspaceWorkflows(projectId, userId)).added.map((w) => w.workflow)).includes("meetings")) return { success: false as const, error: "Add Meetings and decisions first." };
        const attendeeIds = await memberIds(projectId, data.attendeeIds);
        const startsAt = new Date(data.startsAt).toISOString();
        const { readWorkingHours } = await import("@/lib/workflows/request-clock-server");
        const { zonedParts } = await import("@/lib/workflows/request-clock");
        const { tz } = await readWorkingHours(projectId);
        let seriesId: string | undefined;
        if (data.repeat !== "none") {
            const [series] = await db.insert(workspaceMeetingSeries).values({ projectId, meetingType: type.id, title: data.title, rule: data.repeat, startsTime: zonedParts(new Date(startsAt), tz).time,
                lengthMinutes: data.lengthMinutes, attendeeIds, ...(data.boardSize ? { boardSize: data.boardSize } : {}), createdBy: userId }).returning({ id: workspaceMeetingSeries.id });
            seriesId = series!.id;
        }
        await writeLaunchSettings(context.readme.id, { section: "meetings", kind: type.id, meetingTitle: data.title, date: zonedParts(new Date(startsAt), tz).day, startsAt, lengthMinutes: data.lengthMinutes, attendeeIds, ...(seriesId ? { seriesId } : {}), ...(data.boardSize ? { boardSize: data.boardSize } : {}) });
        await scheduleMeetingReminders(projectId, context.readme.id, startsAt, attendeeIds);
        await tellAttendees(projectId, userId, attendeeIds, data.title, data.docSlug, context.project);
        await recordNodeEvent(projectId, userId, null, "project_readme.meeting_created", { docSlug: data.docSlug, type: type.id });
        revalidateProjectDoc(context.project);
        return { success: true as const, seriesId: seriesId ?? null };
    } catch (error) {
        if (error instanceof z.ZodError) return { success: false as const, error: error.issues[0]?.message ?? "Check the meeting." };
        logger.error("meetings.create_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t make the meeting." };
    }
}

/** S2: the meeting header: when, type, attendees, series, finished, open action items. */
export async function readMeetingAction(projectId: string, docSlug: string) {
    try {
        const actor = await getOptionalUserId();
        const context = await getDocProjectContext(projectId, actor, docSlug);
        if (!context.readme || !(context.permission.canReadPublished || context.permission.canEdit) || context.settings.section !== "meetings") return { success: false as const, error: "Meeting not found." };
        const insider = actor === context.project.ownerId || Boolean(context.membership);
        const s = context.settings;
        const [series] = s.seriesId ? await db.select({ rule: workspaceMeetingSeries.rule, endedAt: workspaceMeetingSeries.endedAt, title: workspaceMeetingSeries.title }).from(workspaceMeetingSeries)
            .where(and(eq(workspaceMeetingSeries.id, s.seriesId), eq(workspaceMeetingSeries.projectId, projectId))).limit(1) : [];
        const attendees = insider && s.attendeeIds?.length ? await db.select({ id: profiles.id, name: profiles.fullName, avatarUrl: profiles.avatarUrl }).from(profiles).where(inArray(profiles.id, s.attendeeIds)) : [];
        const [open] = Array.from(await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM tasks WHERE deleted_at IS NULL AND status <> 'done'
            AND ((source_doc_id = ${context.readme.id}::uuid AND source_block = 'actions')${s.carriedTaskIds?.length ? sql` OR id IN (${sql.join(s.carriedTaskIds.map((i) => sql`${i}::uuid`), sql`, `)})` : sql``})`));
        const { readWorkingHours } = await import("@/lib/workflows/request-clock-server");
        return {
            success: true as const, canEdit: context.permission.canEdit, member: insider, type: s.kind ?? "blank", title: s.meetingTitle ?? context.readme.filename.replace(/\.md$/i, ""),
            startsAt: s.startsAt ?? null, lengthMinutes: s.lengthMinutes ?? 30, timeZone: (await readWorkingHours(projectId)).tz,
            attendees: attendees.map((a) => ({ id: a.id, name: a.name ?? "Someone", avatarUrl: a.avatarUrl })), seriesRule: series && !series.endedAt ? series.rule : null, seriesTitle: series?.title ?? null,
            seriesId: s.seriesId ?? null, finishedAt: s.finishedAt ?? null, openActionItems: open?.n ?? 0,
            ...(s.kind === "board" ? await boardView(projectId, context.readme.id, s, insider, context.permission.canEdit) : {}),
        };
    } catch (error) {
        logger.error("meetings.read_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t load the meeting." };
    }
}

/**
 * Report 38.11 W6 (A4.9): board meetings. Settings change under a row lock, so two people recording at once never lose
 * each other's motions. Only people who can edit the meeting record motions, votes and who is present.
 */
async function updateMeetingSettings<T>(docId: string, change: (s: ReturnType<typeof normalizeWorkspaceDocSettings>) => { patch: Record<string, unknown>; result: T } | { error: string }) {
    return db.transaction(async (tx) => {
        const [row] = Array.from(await tx.execute<{ settings: unknown }>(sql`SELECT settings FROM workspace_documents WHERE id = ${docId}::uuid FOR UPDATE`));
        const current = normalizeWorkspaceDocSettings(row?.settings);
        const out = change(current);
        if ("error" in out) return out;
        await tx.update(workspaceDocuments).set({ settings: normalizeWorkspaceDocSettings({ ...current, ...out.patch }), updatedAt: new Date() }).where(eq(workspaceDocuments.id, docId));
        return { result: out.result };
    });
}

async function boardContext(projectId: string, userId: string, docSlug: string) {
    const context = await getDocProjectContext(projectId, userId, docSlug);
    if (!context.readme || context.settings.section !== "meetings" || context.settings.kind !== "board") return { error: "Board meeting not found." } as const;
    if (!context.permission.canEdit) return { error: "Only people who can edit this meeting record motions and votes." } as const;
    if (context.settings.approvedAt) return { error: "These minutes are approved and can't change." } as const;
    return { context } as const;
}

const motionSchema = z.object({ docSlug: docSlugSchema, text: z.string().trim().min(1, "Write the motion").max(500), proposedBy: z.string().uuid().optional(), secondedBy: z.string().uuid().optional() });

/** + Motion: its text, and who proposed and seconded it (attendees only). */
export async function addMotionAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = motionSchema.safeParse(input);
        if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Check the motion." };
        const b = await boardContext(projectId, userId, parsed.data.docSlug);
        if ("error" in b) return { success: false as const, error: b.error! };
        const attendees = b.context.settings.attendeeIds ?? [];
        for (const who of [parsed.data.proposedBy, parsed.data.secondedBy]) if (who && !attendees.includes(who)) return { success: false as const, error: "Pick people who attend this meeting." };
        if (parsed.data.proposedBy && parsed.data.proposedBy === parsed.data.secondedBy) return { success: false as const, error: "Someone else seconds the motion." };
        const id = crypto.randomUUID();
        const r = await updateMeetingSettings(b.context.readme!.id, (s) => ({ patch: { motions: [...(s.motions ?? []), { id, text: parsed.data.text, ...(parsed.data.proposedBy ? { proposedBy: parsed.data.proposedBy } : {}), ...(parsed.data.secondedBy ? { secondedBy: parsed.data.secondedBy } : {}) }] }, result: id }));
        if ("error" in r) return { success: false as const, error: r.error };
        revalidateProjectDoc(b.context.project);
        return { success: true as const, motionId: id };
    } catch (error) {
        logger.error("meetings.motion_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t add the motion." };
    }
}

const presentSchema = z.object({ docSlug: docSlugSchema, present: z.array(z.string().uuid()).max(100) });

/** Who is present (attendees only), for the quorum line and the vote limit. */
export async function markPresentAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = presentSchema.parse(input);
        const b = await boardContext(projectId, userId, parsed.docSlug);
        if ("error" in b) return { success: false as const, error: b.error! };
        const attendees = new Set(b.context.settings.attendeeIds ?? []);
        const present = [...new Set(parsed.present)].filter((id) => attendees.has(id));
        await updateMeetingSettings(b.context.readme!.id, () => ({ patch: { present }, result: null }));
        revalidateProjectDoc(b.context.project);
        return { success: true as const, present };
    } catch (error) {
        logger.error("meetings.present_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t save who’s present." };
    }
}

const voteSchema = z.object({ docSlug: docSlugSchema, motionId: z.string().uuid(), for: z.number().int().min(0).max(1000), against: z.number().int().min(0).max(1000), abstain: z.number().int().min(0).max(1000) });

/**
 * Record vote: the counts can't add up to more than those present, and nothing passes without quorum. More For than
 * Against passes; the browser then records the decision (D-number) and links it to the motion. A motion votes once.
 */
export async function recordVoteAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = voteSchema.parse(input);
        const b = await boardContext(projectId, userId, parsed.docSlug);
        if ("error" in b) return { success: false as const, error: b.error! };
        const { quorum, motionResult, voteFits } = await import("@/lib/workflows/meetings");
        const r = await updateMeetingSettings(b.context.readme!.id, (s) => {
            const motions = s.motions ?? [];
            const motion = motions.find((m) => m.id === parsed.motionId);
            if (!motion) return { error: "Motion not found." };
            if (motion.result) return { error: "This motion was already voted on." };
            const present = s.present?.length ?? 0;
            const q = quorum(s.boardSize, present);
            if (!q.met) return { error: `Not quorate: ${present} present, ${q.needed} needed.` };
            const votes = { for: parsed.for, against: parsed.against, abstain: parsed.abstain };
            if (!voteFits(votes, present)) return { error: `The votes add up to more than the ${present} present.` };
            const result = motionResult(votes.for, votes.against);
            return { patch: { motions: motions.map((m) => (m.id === motion.id ? { ...m, votes, result } : m)) }, result };
        });
        if ("error" in r) return { success: false as const, error: r.error };
        await recordNodeEvent(projectId, userId, null, "project_readme.motion_voted", { docSlug: parsed.docSlug, result: r.result });
        revalidateProjectDoc(b.context.project);
        return { success: true as const, result: r.result };
    } catch (error) {
        logger.error("meetings.vote_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t record the vote." };
    }
}

/**
 * Approve last minutes: at a board meeting, approves the previous meeting of its series; from then on that meeting's
 * file refuses edits ("Approved Dec 10"), and its motions and present list stay as they were.
 */
export async function approveMinutesAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const { docSlug } = z.object({ docSlug: docSlugSchema }).parse(input);
        const context = await getDocProjectContext(projectId, userId, docSlug);
        if (!context.readme || context.settings.kind !== "board" || !context.permission.canEdit) return { success: false as const, error: "Only people who can edit this board meeting approve minutes." };
        const previous = await previousBoardMeeting(projectId, context.readme.id, context.settings);
        if (!previous) return { success: false as const, error: "There are no earlier minutes in this series to approve." };
        // Security review: approving is an edit of the earlier minutes, so it needs edit rights there too.
        const earlier = await getDocProjectContext(projectId, userId, previous.slug);
        if (!earlier.readme || !earlier.permission.canEdit || earlier.settings.section !== "meetings" || earlier.settings.kind !== "board") return { success: false as const, error: "Only people who can edit the earlier minutes approve them." };
        const approvedAt = new Date().toISOString();
        const [moved] = await db.update(workspaceDocuments)
            .set({ settings: sql`${workspaceDocuments.settings} || ${JSON.stringify({ approvedAt, approvedBy: userId })}::jsonb`, updatedAt: new Date() })
            .where(and(eq(workspaceDocuments.id, previous.id), sql`NOT (${workspaceDocuments.settings} ? 'approvedAt')`)).returning({ id: workspaceDocuments.id });
        if (!moved) return { success: false as const, error: "Those minutes are already approved." };
        await recordNodeEvent(projectId, userId, null, "project_readme.minutes_approved", { docSlug: previous.slug });
        // Report 38.11 notifications: minutes approved reach the attendees (Summary).
        const { createNotification } = await import("@/lib/notifications/service");
        for (const to of await readersOf(projectId, previous.slug, (previous.settings.attendeeIds ?? []).filter((id) => id !== userId))) await createNotification({
            recipientUserId: to, actorUserId: userId, kind: "project_task_activity", category: "tasks", importance: "more", title: `Minutes approved: ${previous.settings.meetingTitle ?? previous.slug}`,
            href: `/workspaces/${encodeURIComponent(context.project.slug || projectId)}?tab=docs&doc=${encodeURIComponent(previous.slug)}`,
            entityRefs: { projectId, projectSlug: context.project.slug ?? null }, dedupeKey: `minutes:${previous.id}:${to}`,
        }).catch(() => undefined);
        revalidateProjectDoc(context.project);
        return { success: true as const, approvedSlug: previous.slug, approvedAt };
    } catch (error) {
        logger.error("meetings.approve_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t approve the minutes." };
    }
}

/** A4.9: what the board panel shows: size, present, motions (names for members only), approval, and minutes to approve. */
async function boardView(projectId: string, docId: string, s: ReturnType<typeof normalizeWorkspaceDocSettings>, insider: boolean, canEdit: boolean) {
    const decisions = (s.motions ?? []).map((m) => m.decisionDocId).filter((id): id is string => Boolean(id));
    const numbers = decisions.length ? await db.select({ id: workspaceDocuments.id, slug: workspaceDocuments.slug, n: sql<number | null>`(${workspaceDocuments.settings}->>'decisionNumber')::int` })
        .from(workspaceDocuments).where(and(eq(workspaceDocuments.projectId, projectId), inArray(workspaceDocuments.id, decisions))) : [];
    const previous = canEdit ? await previousBoardMeeting(projectId, docId, s) : null;
    return {
        board: {
            size: s.boardSize ?? null, present: insider ? s.present ?? [] : [], presentCount: (s.present ?? []).length, approvedAt: s.approvedAt ?? null,
            motions: (s.motions ?? []).map((m) => {
                const d = numbers.find((x) => x.id === m.decisionDocId);
                return { id: m.id, text: m.text, proposedBy: insider ? m.proposedBy ?? null : null, secondedBy: insider ? m.secondedBy ?? null : null, votes: m.votes ?? null, result: m.result ?? null,
                    decision: d?.n ? { slug: d.slug, label: `D-${String(d.n).padStart(3, "0")}` } : null };
            }),
            toApprove: previous && !previous.settings.approvedAt ? { slug: previous.slug, title: previous.settings.meetingTitle ?? previous.slug } : null,
        },
    };
}

/** The board meeting just before this one in its series (by start), if any. */
async function previousBoardMeeting(projectId: string, docId: string, s: ReturnType<typeof normalizeWorkspaceDocSettings>) {
    if (!s.seriesId || !s.startsAt) return null;
    const [row] = await db.select({ id: workspaceDocuments.id, slug: workspaceDocuments.slug, settings: workspaceDocuments.settings }).from(workspaceDocuments)
        .where(and(eq(workspaceDocuments.projectId, projectId), sql`${workspaceDocuments.id} <> ${docId}::uuid`, sql`${workspaceDocuments.settings}->>'seriesId' = ${s.seriesId}`,
            sql`(${workspaceDocuments.settings}->>'startsAt')::timestamptz < ${s.startsAt}::timestamptz`))
        .orderBy(sql`(${workspaceDocuments.settings}->>'startsAt')::timestamptz DESC`).limit(1);
    return row ? { id: row.id, slug: row.slug, settings: normalizeWorkspaceDocSettings(row.settings) } : null;
}

// docSlugSchema falls back to the README; the next meeting's file must be named, never defaulted (A5.2 review).
const finishSchema = z.object({ docSlug: docSlugSchema, carryOver: z.boolean(), nextDocSlug: z.string().min(1).max(200).transform((v) => normalizeWorkspaceDocSlug(v)).optional(), nextTitle: z.string().trim().min(1).max(120).optional() });
/**
 * W5 and call 3: Finish meeting. Marks it finished; in a live series the browser has made the next meeting's file
 * (nextDocSlug) and this files it at the next date with the same attendees, carrying the open action items (the
 * same tasks, listed in both). Finishing twice changes nothing.
 */
export async function finishMeetingAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const data = finishSchema.parse(input);
        const context = await meetingDoc(projectId, userId, data.docSlug);
        if (context.settings.finishedAt) return { success: true as const, alreadyFinished: true, next: null };
        const s = context.settings;
        await writeLaunchSettings(context.readme!.id, { finishedAt: new Date().toISOString() });
        await db.delete(workspaceDocumentReminders).where(and(eq(workspaceDocumentReminders.docId, context.readme!.id), isNull(workspaceDocumentReminders.sentAt)));
        let next: { docSlug: string; startsAt: string; carried: number } | null = null;
        const [series] = s.seriesId ? await db.select().from(workspaceMeetingSeries).where(and(eq(workspaceMeetingSeries.id, s.seriesId), eq(workspaceMeetingSeries.projectId, projectId))).limit(1) : [];
        if (series && !series.endedAt && s.startsAt && data.nextDocSlug) {
            const nextCtx = await getDocProjectContext(projectId, userId, data.nextDocSlug);
            if (nextCtx.readme && nextCtx.permission.canEdit && !nextCtx.settings.section) {
                const { carryRows, nextOccurrence } = await import("@/lib/workflows/meetings");
                const { readWorkingHours } = await import("@/lib/workflows/request-clock-server");
                const { zonedParts } = await import("@/lib/workflows/request-clock");
                const { tz } = await readWorkingHours(projectId);
                const startsAt = nextOccurrence(series.rule, s.startsAt, tz);
                const rows = await db.select({ id: tasks.id, status: tasks.status, stage: tasks.stage }).from(tasks)
                    .where(and(isNull(tasks.deletedAt), eq(tasks.projectId, projectId), s.carriedTaskIds?.length
                        ? sql`((${tasks.sourceDocId} = ${context.readme!.id} AND ${tasks.sourceBlock} = 'actions') OR ${tasks.id} IN (${sql.join(s.carriedTaskIds.map((i) => sql`${i}::uuid`), sql`, `)}))`
                        : and(eq(tasks.sourceDocId, context.readme!.id), eq(tasks.sourceBlock, "actions"))));
                const carried = data.carryOver ? carryRows(rows).map((r) => r.id) : [];
                await writeLaunchSettings(nextCtx.readme.id, { section: "meetings", kind: s.kind ?? series.meetingType, meetingTitle: data.nextTitle ?? series.title, date: zonedParts(new Date(startsAt), tz).day, startsAt,
                    lengthMinutes: series.lengthMinutes, attendeeIds: series.attendeeIds, seriesId: series.id, ...(carried.length ? { carriedTaskIds: carried } : {}), ...(series.boardSize ? { boardSize: series.boardSize } : {}) });
                await scheduleMeetingReminders(projectId, nextCtx.readme.id, startsAt, series.attendeeIds);
                next = { docSlug: data.nextDocSlug, startsAt, carried: carried.length };
            }
        }
        revalidateProjectDoc(context.project);
        return { success: true as const, alreadyFinished: false, next };
    } catch (error) {
        if (error instanceof z.ZodError) return { success: false as const, error: error.issues[0]?.message ?? "Check the meeting." };
        return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t finish the meeting." };
    }
}

const seriesSchema = z.object({ docSlug: docSlugSchema });
/** W8: End the series: no more meetings are made; past and this one stay. */
export async function endSeriesAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const data = seriesSchema.parse(input);
        const context = await meetingDoc(projectId, userId, data.docSlug);
        if (!context.settings.seriesId) return { success: false as const, error: "This meeting doesn’t repeat." };
        await db.update(workspaceMeetingSeries).set({ endedAt: new Date() }).where(and(eq(workspaceMeetingSeries.id, context.settings.seriesId), eq(workspaceMeetingSeries.projectId, projectId)));
        revalidateProjectDoc(context.project);
        return { success: true as const };
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t end the series." };
    }
}

const moveMeetingSchema = z.object({ docSlug: docSlugSchema, startsAt: z.string().refine((v) => Number.isFinite(Date.parse(v)), "Pick the date and time"), lengthMinutes: z.number().int().min(5).max(600).optional() });
/** W8: Edit this meeting: a new time for this one only (the series keeps its rule); reminders follow. */
export async function moveMeetingAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const data = moveMeetingSchema.parse(input);
        const context = await meetingDoc(projectId, userId, data.docSlug);
        if (context.settings.finishedAt) return { success: false as const, error: "A finished meeting keeps its time." };
        const { readWorkingHours } = await import("@/lib/workflows/request-clock-server");
        const { zonedParts } = await import("@/lib/workflows/request-clock");
        const startsAt = new Date(data.startsAt).toISOString();
        await writeLaunchSettings(context.readme!.id, { startsAt, date: zonedParts(new Date(startsAt), (await readWorkingHours(projectId)).tz).day, ...(data.lengthMinutes ? { lengthMinutes: data.lengthMinutes } : {}) });
        await scheduleMeetingReminders(projectId, context.readme!.id, startsAt, context.settings.attendeeIds ?? []);
        revalidateProjectDoc(context.project);
        return { success: true as const };
    } catch (error) {
        if (error instanceof z.ZodError) return { success: false as const, error: error.issues[0]?.message ?? "Check the time." };
        return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t move the meeting." };
    }
}

/** S7 and W9: the workspace's meetings (calendar, Overview, My work) and every open action item across them. Members only. */
export async function readMeetingsAction(projectId: string) {
    try {
        const actor = await requireUserId();
        const access = await getWorkspaceAccessById(projectId, actor);
        if (!access.project || access.project.kind !== "workspace" || !(access.isOwner || access.isMember)) return { success: false as const, error: "Not found" };
        const all = Array.from(await db.execute<{ id: string; slug: string; filename: string; settings: Record<string, unknown> }>(sql`
            SELECT id, slug, filename, settings FROM workspace_documents WHERE workspace_id = ${projectId}::uuid AND settings->>'section' = 'meetings'
            ORDER BY settings->>'startsAt' DESC NULLS LAST LIMIT 500`));
        // Security review (A4.1): only meetings this person may read (a leaders-only meeting stays hidden), as one document would.
        const base = await loadDocProjectBase(projectId, actor);
        const docs = all.filter((d) => { const p = docContext(base, actor, d.slug).permission; return p.canReadPublished || p.canEdit; });
        const meetings = docs.map((d) => ({ docId: d.id, slug: d.slug, title: typeof d.settings.meetingTitle === "string" ? d.settings.meetingTitle : d.filename.replace(/\.md$/i, ""), type: String(d.settings.kind ?? "blank"),
            startsAt: typeof d.settings.startsAt === "string" ? d.settings.startsAt : null, lengthMinutes: typeof d.settings.lengthMinutes === "number" ? d.settings.lengthMinutes : 30,
            attendeeIds: Array.isArray(d.settings.attendeeIds) ? (d.settings.attendeeIds as string[]) : [], finished: Boolean(d.settings.finishedAt) }));
        const byDoc = new Map(meetings.map((m) => [m.docId, m]));
        // The task read rule too (as readDocRowsAction applies it).
        const open = docs.length ? await db.select({ id: tasks.id, number: tasks.taskNumber, title: tasks.title, status: tasks.status, dueDate: tasks.dueDate, assigneeId: tasks.assigneeId, assigneeName: profiles.fullName, sourceDocId: tasks.sourceDocId })
            .from(tasks).leftJoin(profiles, eq(profiles.id, tasks.assigneeId))
            .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt), sql`${tasks.status} <> 'done'`, eq(tasks.sourceBlock, "actions"),
                inArray(tasks.sourceDocId, docs.map((d) => d.id)), orgTaskReadFilter(access, actor)))
            .orderBy(sql`${tasks.dueDate} NULLS LAST`, asc(tasks.createdAt)).limit(500) : [];
        const [ws] = await db.select({ key: workspaces.key }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
        const { readWorkingHours } = await import("@/lib/workflows/request-clock-server");
        const people = Array.from(await db.execute<{ id: string; name: string }>(sql`
            SELECT p.id, coalesce(p.full_name, p.username, 'Someone') AS name FROM profiles p
            WHERE p.id IN (SELECT owner_id FROM workspaces WHERE id = ${projectId}::uuid UNION SELECT user_id FROM workspace_members WHERE workspace_id = ${projectId}::uuid)
            ORDER BY p.full_name`));
        return {
            success: true as const, projectKey: ws?.key ?? null, timeZone: (await readWorkingHours(projectId)).tz, viewerId: actor, meetings, people,
            settings: await (await import("@/lib/workflows/meeting-settings-server")).readMeetingSettings(projectId),
            openActionItems: open.map((r) => ({ id: r.id, number: r.number, title: r.title, status: r.status, dueDate: r.dueDate ? r.dueDate.toISOString().slice(0, 10) : null,
                assigneeId: r.assigneeId, assigneeName: r.assigneeName, meeting: r.sourceDocId && byDoc.get(r.sourceDocId) ? { slug: byDoc.get(r.sourceDocId)!.slug, title: byDoc.get(r.sourceDocId)!.title } : null })),
        };
    } catch (error) {
        logger.error("meetings.list_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t load meetings." };
    }
}

/* ------------------------------------------------------------------------------------------------------------------
 * Report 38.12 D3 (plan A5.1a): quarterly goals. One goals document per period (section Goals); its block lists the
 * period's objectives and key results (tasks that never go on the board). Goals are for members only, never public.
 * ---------------------------------------------------------------------------------------------------------------- */
const PERIOD_RE = /^\d{4}(-(Q[1-4]|H[12]|0[1-9]|1[0-2]))?$/;

async function goalsContext(projectId: string, userId: string | null, docSlug: string) {
    const context = await getDocProjectContext(projectId, userId, docSlug);
    const insider = Boolean(userId) && (userId === context.project.ownerId || Boolean(context.membership));
    if (!context.readme || !insider || context.settings.section !== "goals") return null;
    return context;
}

/** W1: the browser makes the file (goalsMarkdown); this files it under Goals for its period, members only. One per period. */
export async function createGoalsDocAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const data = z.object({ docSlug: docSlugSchema, period: z.string().regex(PERIOD_RE, "Pick a period") }).parse(input);
        const context = await getDocProjectContext(projectId, userId, data.docSlug);
        if (!context.readme || !context.permission.canEdit) return { success: false as const, error: "Only people who can edit documents set goals." };
        if (context.settings.section || context.settings.approvedAt) return { success: false as const, error: "That document is already filed in a section." };
        const { readWorkspaceWorkflows } = await import("@/lib/workflows/server");
        if (!availableSections((await readWorkspaceWorkflows(projectId, userId)).added.map((w) => w.workflow)).includes("goals")) return { success: false as const, error: "Add Quarterly goals first." };
        const [taken] = await db.select({ id: workspaceDocuments.id }).from(workspaceDocuments)
            .where(and(eq(workspaceDocuments.projectId, projectId), sql`${workspaceDocuments.id} <> ${context.readme.id}::uuid`, sql`${workspaceDocuments.settings}->>'section' = 'goals'`, sql`${workspaceDocuments.settings}->>'period' = ${data.period}`)).limit(1);
        const { periodLabel } = await import("@/lib/workflows/goals");
        if (taken) return { success: false as const, error: `${periodLabel(data.period)} already has a goals document.` };
        await writeLaunchSettings(context.readme.id, { section: "goals", period: data.period, visibilityOverride: "members_only" });
        await recordNodeEvent(projectId, userId, null, "project_readme.goals_created", { docSlug: data.docSlug, period: data.period });
        revalidateProjectDoc(context.project);
        return { success: true as const };
    } catch (error) {
        if (error instanceof z.ZodError) return { success: false as const, error: error.issues[0]?.message ?? "Check the period." };
        logger.error("goals.create_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t make the goals document." };
    }
}

/** S1: the block: period header, objectives with progress and status, their key results with check-ins. */
export async function readGoalsAction(projectId: string, docSlug: string) {
    try {
        const actor = await getOptionalUserId();
        const context = await goalsContext(projectId, actor, docSlug);
        if (!context) return { success: false as const, error: "Goals are for workspace members." };
        const g = await import("@/lib/workflows/goals");
        const period = context.settings.period!;
        const [ws] = await db.select({ settings: workspaces.workflowSettings }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
        const settings = g.goalSettings((ws?.settings as Record<string, unknown> | null)?.goals);
        const range = g.periodRange(period, settings);
        const pace = g.expectedPace(range.start, range.end, new Date());
        const { readWorkingHours } = await import("@/lib/workflows/request-clock-server");
        const { zonedParts } = await import("@/lib/workflows/request-clock");
        const tz = (await readWorkingHours(projectId)).tz;
        const today = zonedParts(new Date(), tz).day;
        const items = await db.select({ id: tasks.id, number: tasks.taskNumber, title: tasks.title, type: tasks.itemType, stage: tasks.stage, partOfId: tasks.partOfId, fields: tasks.typeFields,
            assigneeId: tasks.assigneeId, assigneeName: profiles.fullName }).from(tasks).leftJoin(profiles, eq(profiles.id, tasks.assigneeId))
            .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt), eq(tasks.sourceDocId, context.readme!.id), inArray(tasks.itemType, ["objective", "key_result"])))
            .orderBy(asc(tasks.createdAt));
        const krIds = items.filter((i) => i.type === "key_result").map((i) => i.id);
        const history = krIds.length ? Array.from(await db.execute<{ task_id: string; value: string; created_at: Date }>(sql`
            SELECT task_id, value, created_at FROM (SELECT task_id, value, created_at, row_number() OVER (PARTITION BY task_id ORDER BY created_at DESC) AS n
            FROM key_result_check_ins WHERE task_id IN (${sql.join(krIds.map((i) => sql`${i}::uuid`), sql`, `)})) h WHERE n <= 8 ORDER BY created_at`)) : [];
        const linked = await measuredValues(projectId, items.map((i) => ({ id: i.id, measuredBy: ((i.fields ?? {}) as Record<string, unknown>).measuredBy as { kind: string; ref?: string } | undefined })), range);
        const shapeKr = (i: (typeof items)[number]) => {
            const f = (i.fields ?? {}) as Record<string, unknown>;
            const live = linked.get(i.id);
            const kr = { start: Number(f.start ?? 0), target: Number(f.target ?? 0), current: live ? live.value : f.current == null ? null : Number(f.current), direction: (f.direction === "decrease" ? "decrease" : "increase") as "increase" | "decrease" };
            const progress = g.krProgress(kr);
            const override = f.statusOverride as { status: "on_track" | "at_risk" | "off_track"; reason: string } | null | undefined;
            return { id: i.id, number: i.number, title: i.title, assigneeId: i.assigneeId, assigneeName: i.assigneeName, ...kr, unit: String(f.unit ?? ""),
                measuredBy: live ? { kind: live.kind, from: live.from } : null,
                due: !context.settings.closedAt && i.stage === "active" && g.checkInDue((f.checkedInAt as string | null) ?? null, today, settings.checkInDay, tz),
                confidence: (f.confidence as number | null) ?? null, checkedInAt: (f.checkedInAt as string | null) ?? null, progress,
                status: override?.status ?? g.goalStatus(progress, pace, settings.bands), override: override ?? null, result: i.stage === "done" || i.stage === "missed" ? (i.stage as "done" | "missed") : null,
                history: history.filter((h) => h.task_id === i.id).map((h) => ({ value: Number(h.value), at: new Date(h.created_at).toISOString() })) };
        };
        const objectives = items.filter((i) => i.type === "objective").map((o) => {
            const krs = items.filter((k) => k.type === "key_result" && k.partOfId === o.id).map(shapeKr);
            const progress = g.objectiveProgress(krs.map((k) => k.progress));
            const override = ((o.fields ?? {}) as Record<string, unknown>).statusOverride as { status: "on_track" | "at_risk" | "off_track"; reason: string } | null | undefined;
            return { id: o.id, number: o.number, title: o.title, assigneeId: o.assigneeId, assigneeName: o.assigneeName, progress,
                status: override?.status ?? g.goalStatus(progress, pace, settings.bands), override: override ?? null, keyResults: krs };
        });
        const people = Array.from(await db.execute<{ id: string; name: string }>(sql`
            SELECT p.id, coalesce(p.full_name, p.username, 'Someone') AS name FROM profiles p
            WHERE p.id IN (SELECT owner_id FROM workspaces WHERE id = ${projectId}::uuid UNION SELECT user_id FROM workspace_members WHERE workspace_id = ${projectId}::uuid) ORDER BY p.full_name`));
        // W3: what a key result can be measured by (projects and roadmap items in this workspace).
        const sources = await db.select({ id: tasks.id, title: tasks.title, type: tasks.itemType }).from(tasks)
            .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt), inArray(tasks.itemType, ["project", "roadmap_item"]))).orderBy(asc(tasks.title)).limit(200);
        // W6 (A5.2): the period has ended (Close period shows), and the next period's document if it exists.
        const next = g.nextPeriod(period, settings);
        const [nextDoc] = await db.select({ slug: workspaceDocuments.slug }).from(workspaceDocuments)
            .where(and(eq(workspaceDocuments.projectId, projectId), sql`${workspaceDocuments.settings}->>'section' = 'goals'`, sql`${workspaceDocuments.settings}->>'period' = ${next}`)).limit(1);
        return { success: true as const, period, ended: today >= range.end, next: { period: next, label: g.periodLabel(next), slug: nextDoc?.slug ?? null }, label: g.periodLabel(period), sources: sources.map((x) => ({ id: x.id, title: x.title, kind: x.type === "project" ? "project" as const : "roadmap" as const })), week: g.weekOf(range.start, range.end, new Date()), pace, canEdit: context.permission.canEdit && !context.settings.closedAt,
            closedAt: context.settings.closedAt ?? null, viewerId: actor, objectives, people };
    } catch (error) {
        logger.error("goals.read_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t load the goals." };
    }
}

/**
 * W7 (A5.1b): a linked key result's current value, worked out on read: a project's or roadmap item's completion (its
 * work tasks done, canceled ones left out), tasks done with a label in the period, or open urgent bugs right now.
 */
async function measuredValues(projectId: string, krs: Array<{ id: string; measuredBy?: { kind: string; ref?: string } }>, range: { start: string; end: string }) {
    const out = new Map<string, { kind: string; value: number; from: string | null }>();
    for (const kr of krs) {
        const m = kr.measuredBy;
        if (!m || m.kind === "checkins") continue;
        if ((m.kind === "project" || m.kind === "roadmap") && m.ref && /^[0-9a-f-]{36}$/i.test(m.ref)) {
            const [row] = Array.from(await db.execute<{ title: string | null; done: number; total: number }>(sql`
                SELECT (SELECT title FROM tasks WHERE id = ${m.ref}::uuid AND workspace_id = ${projectId}::uuid AND deleted_at IS NULL) AS title,
                  count(*) FILTER (WHERE status = 'done')::int AS done, count(*)::int AS total
                FROM tasks WHERE part_of_id = ${m.ref}::uuid AND workspace_id = ${projectId}::uuid AND deleted_at IS NULL AND coalesce(stage, '') <> 'cancelled'`));
            // A deleted project or roadmap item: the value stays where it was (edge case in part 2).
            if (row?.title) out.set(kr.id, { kind: m.kind, value: row.total ? Math.round((100 * row.done) / row.total) : 0, from: row.title });
        } else if (m.kind === "label" && m.ref) {
            const [row] = Array.from(await db.execute<{ n: number }>(sql`
                SELECT count(*)::int AS n FROM tasks WHERE workspace_id = ${projectId}::uuid AND deleted_at IS NULL AND status = 'done' AND ${m.ref} = ANY(labels)
                  AND completed_at >= ${range.start}::date AND completed_at < ${range.end}::date`));
            out.set(kr.id, { kind: m.kind, value: row?.n ?? 0, from: m.ref });
        } else if (m.kind === "bugs") {
            const [row] = Array.from(await db.execute<{ n: number }>(sql`
                SELECT count(*)::int AS n FROM tasks WHERE workspace_id = ${projectId}::uuid AND deleted_at IS NULL AND item_type = 'bug'
                  AND stage IN ('new', 'confirmed', 'fixing') AND type_fields->>'severity' = 'urgent'`));
            out.set(kr.id, { kind: m.kind, value: row?.n ?? 0, from: null });
        }
    }
    return out;
}

async function addGoalItem(projectId: string, userId: string, docSlug: string, fields: { title: string; itemType: "objective" | "key_result"; typeFields: Record<string, unknown>; partOfId?: string; assigneeId?: string | null }) {
    const context = await goalsContext(projectId, userId, docSlug);
    if (!context || !context.permission.canEdit || context.settings.closedAt) return { success: false as const, error: "Only people who can edit these goals add to them." };
    if (fields.assigneeId && !(await memberIds(projectId, [fields.assigneeId])).length) return { success: false as const, error: "Assign someone in this workspace." };
    const { createTaskAction } = await import("@/lib/workspaces/server/tasks");
    const created = await createTaskAction({ projectId, title: fields.title, status: "in_progress", priority: "medium", assigneeId: fields.assigneeId ?? null, dueDate: null,
        itemType: fields.itemType, stage: "active", typeFields: { period: context.settings.period, ...fields.typeFields }, ...(fields.partOfId ? { partOfId: fields.partOfId } : {}) });
    if (!created.success || !("task" in created) || !created.task) return { success: false as const, error: ("error" in created && created.error) || "Couldn’t add it." };
    await db.update(tasks).set({ sourceDocId: context.readme!.id, sourceBlock: "goals" }).where(eq(tasks.id, created.task.id));
    revalidateProjectDoc(context.project);
    return { success: true as const, id: created.task.id };
}

/** W2: + Objective (a one-line add). */
export async function addObjectiveAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const data = z.object({ docSlug: docSlugSchema, title: z.string().trim().min(1, "Name the objective").max(200), assigneeId: z.string().uuid().nullish() }).parse(input);
        return await addGoalItem(projectId, userId, data.docSlug, { title: data.title, itemType: "objective", typeFields: {}, assigneeId: data.assigneeId });
    } catch (error) {
        if (error instanceof z.ZodError) return { success: false as const, error: error.issues[0]?.message ?? "Check the objective." };
        logger.error("goals.objective_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t add the objective." };
    }
}

/** W3: + Key result under an objective: direction, unit, start, target, assigned to (measured by check-ins in A5.1a). */
export async function addKeyResultAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const data = z.object({ docSlug: docSlugSchema, objectiveId: z.string().uuid(), title: z.string().trim().min(1, "Name the key result").max(200),
            direction: z.enum(["increase", "decrease"]), unit: z.string().trim().max(20), start: z.number().finite(), target: z.number().finite(), assigneeId: z.string().uuid().nullish(),
            measuredBy: z.object({ kind: z.enum(["checkins", "project", "roadmap", "label", "bugs"]), ref: z.string().trim().max(200).optional() }).optional() }).parse(input);
        // W7 (A5.1b): a linked key result names something in this workspace.
        const m = data.measuredBy;
        if (m && (m.kind === "project" || m.kind === "roadmap")) {
            const [linked] = m.ref && /^[0-9a-f-]{36}$/i.test(m.ref) ? await db.select({ id: tasks.id }).from(tasks)
                .where(and(eq(tasks.id, m.ref), eq(tasks.projectId, projectId), eq(tasks.itemType, m.kind === "project" ? "project" : "roadmap_item"), isNull(tasks.deletedAt))).limit(1) : [];
            if (!linked) return { success: false as const, error: m.kind === "project" ? "Pick a project in this workspace." : "Pick a roadmap item in this workspace." };
        }
        if (m?.kind === "label" && !m.ref) return { success: false as const, error: "Name the label." };
        const [objective] = await db.select({ id: tasks.id }).from(tasks)
            .where(and(eq(tasks.id, data.objectiveId), eq(tasks.projectId, projectId), eq(tasks.itemType, "objective"), isNull(tasks.deletedAt))).limit(1);
        if (!objective) return { success: false as const, error: "Objective not found." };
        if (data.direction === "increase" ? data.target < data.start : data.target > data.start) return { success: false as const, error: data.direction === "increase" ? "The target is below the start: pick Decrease." : "The target is above the start: pick Increase." };
        return await addGoalItem(projectId, userId, data.docSlug, { title: data.title, itemType: "key_result", partOfId: objective.id, assigneeId: data.assigneeId,
            typeFields: { direction: data.direction, unit: data.unit, start: data.start, target: data.target, current: data.start, ...(m && m.kind !== "checkins" ? { measuredBy: m } : {}) } });
    } catch (error) {
        if (error instanceof z.ZodError) return { success: false as const, error: error.issues[0]?.message ?? "Check the key result." };
        logger.error("goals.kr_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t add the key result." };
    }
}

/**
 * Report 38.12 W6 and S3 (A5.2): Close period. Every key result keeps its final value and becomes Done (at or past
 * its target) or Missed; an objective is Done when all its key results are. Ticked objectives are carried forward into
 * the next period's document (made by the browser when missing) as new items, each key result starting from its final
 * value. Then the document is read-only. Editors only; closing twice changes nothing.
 */
export async function closePeriodAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const data = z.object({ docSlug: docSlugSchema, carry: z.array(z.string().uuid()).max(50),
            nextDocSlug: z.string().min(1).max(200).transform((v) => normalizeWorkspaceDocSlug(v)).optional() }).parse(input);
        const context = await goalsContext(projectId, userId, data.docSlug);
        if (!context || !context.permission.canEdit) return { success: false as const, error: "Only people who can edit these goals close the period." };
        if (context.settings.closedAt) return { success: true as const, alreadyClosed: true, carried: 0, nextSlug: null };
        const read = await readGoalsAction(projectId, data.docSlug);
        if (!read.success) return { success: false as const, error: read.error };
        const g = await import("@/lib/workflows/goals");
        const carry = read.objectives.filter((o) => data.carry.includes(o.id));
        // The next period's document: the one that exists, else the file the browser just made.
        let nextSlug = read.next.slug;
        if (carry.length && !nextSlug) {
            if (!data.nextDocSlug) return { success: false as const, error: "Make the next period's document first." };
            const made = await createGoalsDocAction(projectId, { docSlug: data.nextDocSlug, period: read.next.period });
            if (!made.success) return { success: false as const, error: made.error };
            nextSlug = data.nextDocSlug;
        }
        const now = new Date().toISOString();
        for (const o of read.objectives) {
            for (const k of o.keyResults) {
                await db.update(tasks).set({ stage: g.closeResult(k.progress), status: "done", completedAt: new Date(),
                    typeFields: sql`coalesce(${tasks.typeFields}, '{}'::jsonb) || ${JSON.stringify({ final: k.current, result: g.closeResult(k.progress) })}::jsonb`, updatedAt: new Date() })
                    .where(and(eq(tasks.id, k.id), eq(tasks.projectId, projectId)));
            }
            const done = o.keyResults.length > 0 && o.keyResults.every((k) => g.closeResult(k.progress) === "done");
            await db.update(tasks).set({ stage: done ? "done" : "missed", status: "done", completedAt: new Date(), updatedAt: new Date() }).where(and(eq(tasks.id, o.id), eq(tasks.projectId, projectId)));
        }
        for (const o of carry) {
            const made = await addObjectiveAction(projectId, { docSlug: nextSlug!, title: o.title, assigneeId: o.assigneeId });
            if (!made.success || !made.id) continue;
            for (const k of o.keyResults) {
                await addKeyResultAction(projectId, { docSlug: nextSlug!, objectiveId: made.id, title: k.title, direction: k.direction, unit: k.unit, start: k.current ?? k.start, target: k.target,
                    assigneeId: k.assigneeId, ...(k.measuredBy ? { measuredBy: (await db.select({ f: tasks.typeFields }).from(tasks).where(eq(tasks.id, k.id)).limit(1))[0]?.f?.measuredBy as never } : {}) });
            }
        }
        await writeLaunchSettings(context.readme!.id, { closedAt: now });
        await recordNodeEvent(projectId, userId, null, "project_readme.goals_closed", { docSlug: data.docSlug, carried: carry.length });
        revalidateProjectDoc(context.project);
        return { success: true as const, alreadyClosed: false, carried: carry.length, nextSlug: carry.length ? nextSlug : null };
    } catch (error) {
        if (error instanceof z.ZodError) return { success: false as const, error: "Check what to carry forward." };
        logger.error("goals.close_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t close the period." };
    }
}

/** Report 38.12 S4 (A5.1b): the Overview card: this period's goals document in numbers. Null when there is none. */
export async function readGoalsSummaryAction(projectId: string) {
    try {
        const actor = await getOptionalUserId();
        const g = await import("@/lib/workflows/goals");
        const [ws] = await db.select({ settings: workspaces.workflowSettings }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
        const period = g.periodOf(new Date().toISOString().slice(0, 10), g.goalSettings((ws?.settings as Record<string, unknown> | null)?.goals));
        const [doc] = await db.select({ slug: workspaceDocuments.slug }).from(workspaceDocuments)
            .where(and(eq(workspaceDocuments.projectId, projectId), sql`${workspaceDocuments.settings}->>'section' = 'goals'`, sql`${workspaceDocuments.settings}->>'period' = ${period}`)).limit(1);
        if (!doc || !actor) return { success: true as const, summary: null };
        const r = await readGoalsAction(projectId, doc.slug);
        if (!r.success) return { success: true as const, summary: null };
        const count = (s: string) => r.objectives.filter((o) => o.status === s).length;
        return { success: true as const, summary: { slug: doc.slug, label: r.label.split(" ")[0]!, objectives: r.objectives.length, onTrack: count("on_track"), atRisk: count("at_risk"), offTrack: count("off_track"),
            due: r.objectives.reduce((n, o) => n + o.keyResults.filter((k) => k.due).length, 0) } };
    } catch (error) {
        logger.error("goals.summary_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t load the goals." };
    }
}

/** A goal item and whether this person may check in or set its status: its assignee, or someone who can edit the goals. */
async function goalItemFor(projectId: string, userId: string, taskId: string, type: "objective" | "key_result" | null) {
    const [item] = await db.select({ id: tasks.id, type: tasks.itemType, assigneeId: tasks.assigneeId, docId: tasks.sourceDocId, fields: tasks.typeFields }).from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt), inArray(tasks.itemType, type ? [type] : ["objective", "key_result"]))).limit(1);
    if (!item?.docId) return { error: "Not found." } as const;
    const [doc] = await db.select({ slug: workspaceDocuments.slug }).from(workspaceDocuments).where(eq(workspaceDocuments.id, item.docId)).limit(1);
    const context = doc ? await goalsContext(projectId, userId, doc.slug) : null;
    if (!context) return { error: "Not found." } as const;
    if (context.settings.closedAt) return { error: "This period is closed." } as const;
    if (item.assigneeId !== userId && !context.permission.canEdit) return { error: "Only its owner or people who can edit these goals do this." } as const;
    return { item, context } as const;
}

/** W4: Check in: the value, a confidence 1–10 and a note. The newest check-in is the current value; a status set by hand ends. */
export async function checkInAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const data = z.object({ taskId: z.string().uuid(), value: z.number().finite(), confidence: z.number().int().min(1).max(10), note: z.string().trim().max(1000).optional() }).parse(input);
        const found = await goalItemFor(projectId, userId, data.taskId, "key_result");
        if ("error" in found) return { success: false as const, error: found.error! };
        const at = new Date();
        // A5.2 notice: a key result that moves to At risk or Off track tells its owner (Normal), unless they checked in.
        const g = await import("@/lib/workflows/goals");
        const [wsRow] = await db.select({ settings: workspaces.workflowSettings }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
        const gs = g.goalSettings((wsRow?.settings as Record<string, unknown> | null)?.goals);
        const f = (found.item.fields ?? {}) as Record<string, unknown>;
        const range = g.periodRange(found.context.settings.period!, gs);
        const pace = g.expectedPace(range.start, range.end, at);
        const kr = { start: Number(f.start ?? 0), target: Number(f.target ?? 0), direction: (f.direction === "decrease" ? "decrease" : "increase") as "increase" | "decrease" };
        const before = g.goalStatus(g.krProgress({ ...kr, current: f.current == null ? null : Number(f.current) }), pace, gs.bands);
        const after = g.goalStatus(g.krProgress({ ...kr, current: data.value }), pace, gs.bands);
        await db.transaction(async (tx) => {
            await tx.insert(keyResultCheckIns).values({ taskId: data.taskId, value: String(data.value), confidence: data.confidence, note: data.note || null, createdBy: userId, createdAt: at });
            await tx.update(tasks).set({ typeFields: sql`coalesce(${tasks.typeFields}, '{}'::jsonb) || ${JSON.stringify({ current: data.value, confidence: data.confidence, checkedInAt: at.toISOString(), statusOverride: null })}::jsonb`, updatedAt: at })
                .where(eq(tasks.id, data.taskId));
        });
        if (after !== before && after !== "on_track" && found.item.assigneeId && found.item.assigneeId !== userId) {
            const { createNotification } = await import("@/lib/notifications/service");
            const [t] = await db.select({ title: tasks.title }).from(tasks).where(eq(tasks.id, data.taskId)).limit(1);
            await createNotification({ recipientUserId: found.item.assigneeId, actorUserId: userId, kind: "project_task_activity", category: "tasks", importance: "important",
                title: `${g.STATUS_WORD[after]}: ${t?.title ?? "a key result"}`, href: `/workspaces/${encodeURIComponent(found.context.project.slug || projectId)}?tab=docs&doc=${encodeURIComponent(found.context.readme!.slug)}`,
                entityRefs: { projectId, projectSlug: found.context.project.slug ?? null }, dedupeKey: `kr-status:${data.taskId}:${after}:${at.toISOString().slice(0, 10)}` }).catch(() => undefined);
        }
        revalidateProjectDoc(found.context.project);
        return { success: true as const };
    } catch (error) {
        if (error instanceof z.ZodError) return { success: false as const, error: error.issues[0]?.message ?? "Check the check-in." };
        logger.error("goals.checkin_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t check in." };
    }
}

/** W5: set the status by hand with a reason (until the next check-in); null goes back to the worked-out status. */
export async function setGoalStatusAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const data = z.object({ taskId: z.string().uuid(), status: z.enum(["on_track", "at_risk", "off_track"]).nullable(), reason: z.string().trim().max(200).optional() }).parse(input);
        if (data.status && !data.reason) return { success: false as const, error: "Say why." };
        const found = await goalItemFor(projectId, userId, data.taskId, null);
        if ("error" in found) return { success: false as const, error: found.error! };
        await db.update(tasks).set({ typeFields: sql`coalesce(${tasks.typeFields}, '{}'::jsonb) || ${JSON.stringify({ statusOverride: data.status ? { status: data.status, reason: data.reason } : null })}::jsonb`, updatedAt: new Date() })
            .where(eq(tasks.id, data.taskId));
        revalidateProjectDoc(found.context.project);
        return { success: true as const };
    } catch (error) {
        logger.error("goals.status_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t set the status." };
    }
}

/* ------------------------------------------------------------------------------------------------------------------
 * Report 38.13 D4 (plan A5.3): ideas. An Ideas document's ranked block lists its ideas (tasks of type `idea`, never on
 * the board, never public). Members add, score, validate, build and drop; viewers read.
 * ---------------------------------------------------------------------------------------------------------------- */
async function ideasContext(projectId: string, userId: string | null, docSlug: string) {
    const context = await getDocProjectContext(projectId, userId, docSlug);
    const insider = Boolean(userId) && (userId === context.project.ownerId || Boolean(context.membership));
    if (!context.readme || !insider || context.settings.section !== "ideas") return null;
    return { context, canAct: userId === context.project.ownerId || (context.membership?.role ?? "viewer") !== "viewer" };
}

/** W1: Ideas' + makes "Ideas": the browser makes the file (ideasMarkdown); this files it under Ideas, members only. */
export async function createIdeasDocAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const data = z.object({ docSlug: docSlugSchema }).parse(input);
        const context = await getDocProjectContext(projectId, userId, data.docSlug);
        if (!context.readme || !context.permission.canEdit) return { success: false as const, error: "Only people who can edit documents make an Ideas document." };
        if (context.settings.section || context.settings.approvedAt) return { success: false as const, error: "That document is already filed in a section." };
        const { readWorkspaceWorkflows } = await import("@/lib/workflows/server");
        if (!availableSections((await readWorkspaceWorkflows(projectId, userId)).added.map((w) => w.workflow)).includes("ideas")) return { success: false as const, error: "Add Ideas first." };
        await writeLaunchSettings(context.readme.id, { section: "ideas", visibilityOverride: "members_only" });
        revalidateProjectDoc(context.project);
        return { success: true as const };
    } catch (error) {
        logger.error("ideas.create_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t make the Ideas document." };
    }
}

/** S1: the ranked ideas (score, stage, validation n of m, built as), Dropped folded apart. */
export async function readIdeasAction(projectId: string, docSlug: string) {
    try {
        const actor = await getOptionalUserId();
        const found = await ideasContext(projectId, actor, docSlug);
        if (!found) return { success: false as const, error: "Ideas are for workspace members." };
        const items = await db.select({ id: tasks.id, number: tasks.taskNumber, title: tasks.title, stage: tasks.stage, fields: tasks.typeFields, createdAt: tasks.createdAt, creatorId: tasks.creatorId })
            .from(tasks).where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt), eq(tasks.sourceDocId, found.context.readme!.id), eq(tasks.itemType, "idea")))
            .orderBy(asc(tasks.createdAt)).limit(500);
        const ids = items.map((i) => i.id);
        const subs = ids.length ? Array.from(await db.execute<{ task_id: string; done: number; total: number }>(sql`
            SELECT task_id, count(*) FILTER (WHERE completed)::int AS done, count(*)::int AS total FROM task_subtasks WHERE task_id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) GROUP BY task_id`)) : [];
        const builtIds = items.map((i) => (i.fields as Record<string, unknown> | null)?.builtAs).filter((x): x is string => typeof x === "string");
        const built = builtIds.length ? await db.select({ id: tasks.id, number: tasks.taskNumber, title: tasks.title, type: tasks.itemType }).from(tasks)
            .where(and(inArray(tasks.id, builtIds), eq(tasks.projectId, projectId), isNull(tasks.deletedAt))) : [];
        const [ws] = await db.select({ key: workspaces.key }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
        const { rankIdeas } = await import("@/lib/workflows/ideas");
        const shaped = items.map((i) => {
            const f = (i.fields ?? {}) as Record<string, unknown>;
            const n = (k: string) => (typeof f[k] === "number" ? (f[k] as number) : null);
            const sub = subs.find((x) => x.task_id === i.id);
            const b = built.find((x) => x.id === f.builtAs);
            return { id: i.id, number: i.number, title: i.title, pitch: typeof f.pitch === "string" ? f.pitch : null, impact: n("impact"), ease: n("ease"), confidence: n("confidence"),
                stage: i.stage ?? "idea", createdAt: i.createdAt.toISOString(), validation: sub ? { done: sub.done, total: sub.total } : null,
                builtAs: b ? { id: b.id, number: b.number, title: b.title, type: b.type ?? "task" } : null, droppedReason: typeof f.droppedReason === "string" ? f.droppedReason : null };
        });
        return { success: true as const, projectKey: ws?.key ?? null, canAct: found.canAct, ranked: rankIdeas(shaped), dropped: shaped.filter((i) => i.stage === "dropped") };
    } catch (error) {
        logger.error("ideas.read_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t load the ideas." };
    }
}

const scoreSchema = z.number().int().min(1).max(5).nullable().optional();

/** W2: + Idea (one line, Enter), optionally scored and with a pitch. */
export async function addIdeaAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const data = z.object({ docSlug: docSlugSchema, title: z.string().trim().min(1, "Name the idea").max(200), pitch: z.string().trim().max(200).optional(),
            impact: scoreSchema, ease: scoreSchema, confidence: scoreSchema }).parse(input);
        const found = await ideasContext(projectId, userId, data.docSlug);
        if (!found?.canAct) return { success: false as const, error: "Only workspace members add ideas." };
        const { createTaskAction } = await import("@/lib/workspaces/server/tasks");
        const created = await createTaskAction({ projectId, title: data.title, status: "todo", priority: "medium", assigneeId: null, dueDate: null, itemType: "idea", stage: "idea",
            typeFields: { ...(data.pitch ? { pitch: data.pitch } : {}), ...(data.impact ? { impact: data.impact } : {}), ...(data.ease ? { ease: data.ease } : {}), ...(data.confidence ? { confidence: data.confidence } : {}) } });
        if (!created.success || !("task" in created) || !created.task) return { success: false as const, error: ("error" in created && created.error) || "Couldn’t add the idea." };
        await db.update(tasks).set({ sourceDocId: found.context.readme!.id, sourceBlock: "ideas" }).where(eq(tasks.id, created.task.id));
        revalidateProjectDoc(found.context.project);
        return { success: true as const, id: created.task.id, number: created.task.taskNumber ?? null };
    } catch (error) {
        if (error instanceof z.ZodError) return { success: false as const, error: error.issues[0]?.message ?? "Check the idea." };
        logger.error("ideas.add_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t add the idea." };
    }
}

/** An idea and whether this person may change it (members, not viewers), in a document they can read. */
async function ideaFor(projectId: string, userId: string, taskId: string) {
    const [item] = await db.select({ id: tasks.id, title: tasks.title, stage: tasks.stage, fields: tasks.typeFields, docId: tasks.sourceDocId, creatorId: tasks.creatorId }).from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), eq(tasks.itemType, "idea"), isNull(tasks.deletedAt))).limit(1);
    if (!item?.docId) return { error: "Idea not found." } as const;
    const [doc] = await db.select({ slug: workspaceDocuments.slug }).from(workspaceDocuments).where(eq(workspaceDocuments.id, item.docId)).limit(1);
    const found = doc ? await ideasContext(projectId, userId, doc.slug) : null;
    if (!found) return { error: "Idea not found." } as const;
    if (!found.canAct) return { error: "Only workspace members change ideas." } as const;
    return { item, found } as const;
}

const patchIdea = (taskId: string, patch: Record<string, unknown>, stage?: { stage: string; status: "todo" | "in_progress" | "done" }) =>
    db.update(tasks).set({ typeFields: sql`coalesce(${tasks.typeFields}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`, ...(stage ? { stage: stage.stage, status: stage.status, ...(stage.status === "done" ? { completedAt: new Date() } : {}) } : {}), updatedAt: new Date() })
        .where(eq(tasks.id, taskId));

/** W3: inline scores (1–5; null clears one) and the pitch. */
export async function scoreIdeaAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const data = z.object({ taskId: z.string().uuid(), impact: scoreSchema, ease: scoreSchema, confidence: scoreSchema, pitch: z.string().trim().max(200).optional() }).parse(input);
        const found = await ideaFor(projectId, userId, data.taskId);
        if ("error" in found) return { success: false as const, error: found.error! };
        const patch: Record<string, unknown> = {};
        for (const k of ["impact", "ease", "confidence", "pitch"] as const) if (data[k] !== undefined) patch[k] = data[k];
        await patchIdea(data.taskId, patch);
        revalidateProjectDoc(found.found.context.project);
        return { success: true as const };
    } catch (error) {
        if (error instanceof z.ZodError) return { success: false as const, error: "Scores run from 1 to 5." };
        logger.error("ideas.score_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t score the idea." };
    }
}

/** W4: Validating adds the workspace's validation steps as the idea's subtasks (once). */
export async function validateIdeaAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const { taskId } = z.object({ taskId: z.string().uuid() }).parse(input);
        const found = await ideaFor(projectId, userId, taskId);
        if ("error" in found) return { success: false as const, error: found.error! };
        if (found.item.stage !== "idea") return { success: false as const, error: "Only a new idea moves to Validating." };
        const [ws] = await db.select({ settings: workspaces.workflowSettings }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
        const { validationSteps } = await import("@/lib/workflows/ideas");
        const steps = validationSteps((ws?.settings as Record<string, unknown> | null)?.ideas);
        await db.transaction(async (tx) => {
            const [existing] = await tx.select({ n: sql<number>`count(*)::int` }).from(taskSubtasks).where(eq(taskSubtasks.taskId, taskId));
            if (!existing?.n) await tx.insert(taskSubtasks).values(steps.map((title, position) => ({ taskId, title, position, createdBy: userId })));
            await tx.update(tasks).set({ stage: "validating", status: "in_progress", updatedAt: new Date() }).where(eq(tasks.id, taskId));
        });
        revalidateProjectDoc(found.found.context.project);
        return { success: true as const, steps: steps.length };
    } catch (error) {
        logger.error("ideas.validate_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t start validating." };
    }
}

async function tellIdeaAuthor(projectId: string, actorId: string, item: { id: string; title: string; creatorId: string | null }, title: string, project: { slug: string | null }, docSlug: string) {
    if (!item.creatorId || item.creatorId === actorId || !(await memberIds(projectId, [item.creatorId])).length) return;
    const { createNotification } = await import("@/lib/notifications/service");
    await createNotification({ recipientUserId: item.creatorId, actorUserId: actorId, kind: "project_task_activity", category: "tasks", importance: "important", title,
        href: `/workspaces/${encodeURIComponent(project.slug || projectId)}?tab=docs&doc=${encodeURIComponent(docSlug)}`,
        entityRefs: { projectId, projectSlug: project.slug ?? null }, dedupeKey: `idea:${item.id}:${title.split(":")[0]}` }).catch(() => undefined);
}

/**
 * W5 and call 3: Start building makes a project (T1), a roadmap item (T2) or a task from the idea (its name and pitch);
 * the idea moves to Building with "Built as NB-320", and the new item knows it came from the idea. Once only.
 */
export async function startBuildingAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const data = z.object({ taskId: z.string().uuid(), as: z.enum(["project", "roadmap_item", "task"]) }).parse(input);
        const found = await ideaFor(projectId, userId, data.taskId);
        if ("error" in found) return { success: false as const, error: found.error! };
        const f = (found.item.fields ?? {}) as Record<string, unknown>;
        if (f.builtAs || found.item.stage === "building" || found.item.stage === "launched" || found.item.stage === "dropped") return { success: false as const, error: "This idea is already being built or closed." };
        const { createTaskAction } = await import("@/lib/workspaces/server/tasks");
        const pitch = typeof f.pitch === "string" ? f.pitch : "";
        const created = await createTaskAction({ projectId, title: found.item.title, status: "todo", priority: "medium", assigneeId: null, dueDate: null,
            ...(pitch ? { description: pitch } : {}), ...(data.as === "task" ? {} : { itemType: data.as, typeFields: data.as === "roadmap_item" && pitch ? { outcome: pitch } : {} }) });
        if (!created.success || !("task" in created) || !created.task) return { success: false as const, error: ("error" in created && created.error) || "Couldn’t make it." };
        await patchIdea(data.taskId, { builtAs: created.task.id }, { stage: "building", status: "in_progress" });
        await tellIdeaAuthor(projectId, userId, found.item, `Building: ${found.item.title}`, found.found.context.project, found.found.context.readme!.slug);
        revalidateProjectDoc(found.found.context.project);
        return { success: true as const, builtId: created.task.id, builtNumber: created.task.taskNumber ?? null };
    } catch (error) {
        logger.error("ideas.build_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t start building." };
    }
}

/** W7: Drop asks a reason; dropped ideas fold under "Dropped (n)". */
export async function dropIdeaAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = z.object({ taskId: z.string().uuid(), reason: z.string().trim().min(1).max(500) }).safeParse(input);
        if (!parsed.success) return { success: false as const, error: "Say why it's dropped." };
        const found = await ideaFor(projectId, userId, parsed.data.taskId);
        if ("error" in found) return { success: false as const, error: found.error! };
        if (found.item.stage === "launched" || found.item.stage === "dropped") return { success: false as const, error: "This idea is already closed." };
        await patchIdea(parsed.data.taskId, { droppedReason: parsed.data.reason }, { stage: "dropped", status: "done" });
        await tellIdeaAuthor(projectId, userId, found.item, `Dropped: ${found.item.title}`, found.found.context.project, found.found.context.readme!.slug);
        revalidateProjectDoc(found.found.context.project);
        return { success: true as const };
    } catch (error) {
        logger.error("ideas.drop_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t drop the idea." };
    }
}

/** D1 W2 (User interview's insights, A5.3): Save as idea adds it to the workspace's first Ideas document. */
export async function saveAsIdeaAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const data = z.object({ title: z.string().trim().min(1, "Name the idea").max(200), pitch: z.string().trim().max(200).optional() }).parse(input);
        const [doc] = await db.select({ slug: workspaceDocuments.slug }).from(workspaceDocuments)
            .where(and(eq(workspaceDocuments.projectId, projectId), sql`${workspaceDocuments.settings}->>'section' = 'ideas'`)).orderBy(asc(workspaceDocuments.createdAt)).limit(1);
        if (!doc) return { success: false as const, error: "Make an Ideas document first (Documents → Ideas)." };
        const r = await addIdeaAction(projectId, { docSlug: doc.slug, ...data });
        return r.success ? { ...r, docSlug: doc.slug } : r;
    } catch (error) {
        if (error instanceof z.ZodError) return { success: false as const, error: error.issues[0]?.message ?? "Check the idea." };
        return { success: false as const, error: "Couldn’t save the idea." };
    }
}
