'use server';

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";

import { readProjectFileText } from "@/lib/files/content-reader";
import { getProjectAccessById } from "@/lib/data/project-access";
import { db } from "@/lib/db";
import {
    profiles,
    projectMembers,
    projectNodes,
    projectOpenRoles,
    projectDocVersions,
    projectDocs,
    projectSprints,
    projects,
    tasks,
} from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { toIsoString as toIso } from "@/lib/utils/date";
import { isUuid } from "@/lib/validations/uuid";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { orgFileAccessSql, projectContentNodeSql, recordNodeEvent } from "@/lib/files/internal-helpers";
import {
    getOrBuildProjectDocPublishMetadata,
    DEFAULT_PROJECT_DOC_SETTINGS,
    buildProjectDocQualityReport,
    normalizeProjectDocContent,
    normalizeProjectDocHeadings,
    normalizeProjectDocSettings,
    normalizeProjectDocSlug,
    resolveProjectDocPermission,
    type ProjectDocPublishedPayload,
    type ProjectDocQualityReport,
    type ProjectDocSettings,
    type ProjectDocVersion,
    type ProjectDocListItem,
} from "@/lib/projects/doc";
import { normalizeProjectPublicTabVisibility } from "@/lib/projects/settings-policies";
import type {
    ProjectDocReferenceKind,
    ProjectDocReferenceOption,
    ProjectDocSmartBlock,
    ProjectDocSmartBlockPreview,
} from "@/lib/projects/doc-blocks";
import { parseProjectDocSmartBlocks } from "@/lib/projects/doc-blocks";
import { nextFreeDocSlug } from "@/lib/projects/doc-slug";

const PUBLIC_PROJECT_DETAIL_SHELL_CACHE_TAG = "public-project-detail-shell";
const PUBLIC_PROJECT_DETAIL_METADATA_CACHE_TAG = "public-project-detail-metadata";
const profileDisplayNameSql = (userId: unknown) => sql<string | null>`(
    SELECT COALESCE(NULLIF(full_name, ''), NULLIF(username, ''))
    FROM profiles
    WHERE id = ${userId}
    LIMIT 1
)`;
const docSlugSchema = z.string().optional().default("readme").transform((value) => normalizeProjectDocSlug(value));

const readmeSettingsSchema = z.object({
    docSlug: docSlugSchema,
    editPolicy: z.enum(["leaders", "members"]).optional(),
    publicVisibility: z.literal("inherit_project").optional(),
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

function normalizeStoredQualityReport(value: unknown, fallbackContent: string): ProjectDocQualityReport {
    if (value && typeof value === "object") {
        const report = value as Partial<ProjectDocQualityReport>;
        if (
            typeof report.score === "number"
            && Array.isArray(report.issues)
            && report.sectionPresence
            && typeof report.sectionPresence === "object"
            && typeof report.contentBytes === "number"
        ) {
            return {
                score: report.score,
                issues: report.issues as ProjectDocQualityReport["issues"],
                sectionPresence: report.sectionPresence as Record<string, boolean>,
                contentBytes: report.contentBytes,
            };
        }
    }
    return buildProjectDocQualityReport(fallbackContent);
}

function toDocVersion(row: (typeof projectDocVersions.$inferSelect & { createdByName?: string | null }) | null | undefined, displayVersionNumber?: number, coAuthorsData?: { id: string; name: string; avatarUrl: string | null }[]): ProjectDocVersion | null {
    if (!row) return null;
    const content = normalizeProjectDocContent(row.content);
    const cleanedMetadata = content === row.content ? null : getOrBuildProjectDocPublishMetadata(content);
    return {
        id: row.id,
        projectId: row.projectId,
        versionNumber: row.versionNumber,
        displayVersionNumber: displayVersionNumber ?? row.versionNumber,
        content,
        excerpt: cleanedMetadata?.excerpt ?? row.excerpt,
        headings: cleanedMetadata?.headings ?? normalizeProjectDocHeadings(row.headings),
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
    return (await getViewerAuthContext()).userId;
}

async function requireUserId() {
    const userId = await getOptionalUserId();
    if (!userId) throw new Error("Sign in to continue");
    return userId;
}

async function loadDocProjectBase(projectId: string, actorUserId: string | null) {
    const row = await db.query.projects.findFirst({
        where: and(eq(projects.id, projectId), isNull(projects.deletedAt)),
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
        },
        with: {
            docs: { with: { linkedNode: { columns: { deletedAt: true } } } },
            members: {
                where: actorUserId ? eq(projectMembers.userId, actorUserId) : sql`false`,
                columns: { role: true },
                limit: 1,
            },
        },
    });
    if (!row) throw new Error("Project not found");
    const { docs, members, ...project } = row;
    // Inherited org admins edit a child project's docs like its admins; their edits carry their name (report §19.7).
    if (!members[0] && actorUserId) {
        const [inherited] = await db.execute<{ ok: number }>(sql`
            SELECT 1 AS ok FROM projects c JOIN projects o ON o.id = c.parent_id AND o.deleted_at IS NULL
            WHERE c.id = ${projectId} AND (o.owner_id = ${actorUserId}
              OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = o.id AND m.user_id = ${actorUserId} AND m.role IN ('owner', 'admin')))
            LIMIT 1`);
        if (inherited) return { project, membership: { role: "admin" as const }, docs };
    }
    return { project, membership: members[0] ?? null, docs };
}

type DocProjectBase = Awaited<ReturnType<typeof loadDocProjectBase>>;

function docContext(base: DocProjectBase, actorUserId: string | null, docSlug: string) {
    const { project, membership } = base;
    const readme = base.docs.find((doc) => doc.slug === docSlug);
    const settings = normalizeProjectDocSettings(readme?.settings);
    const hasPublishedReadme = Boolean(readme?.publishedVersionId) || Boolean(readme?.linkedNodeId);
    const permission = resolveProjectDocPermission({
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
    const results: ProjectDocListItem[] = [];
    for (const doc of base.docs) {
        const linkedAlive = Boolean(doc.linkedNodeId && doc.linkedNode && !doc.linkedNode.deletedAt);
        if (!linkedAlive && !doc.publishedVersionId) continue;
        const permission = resolveProjectDocPermission({
            actorUserId,
            projectVisibility: project.visibility,
            projectStatus: project.status,
            publicTabVisibility: project.publicTabVisibility,
            settings: normalizeProjectDocSettings(doc.settings),
            membershipRole: isOwner ? "owner" : membership?.role,
            isOwner,
            isActiveMember: isOwner || Boolean(membership),
            hasPublishedReadme: true,
        });
        if (permission.canReadPublished || permission.canEdit) {
            results.push({ id: doc.id, slug: doc.slug, filename: doc.filename, linkedNodeId: doc.linkedNodeId });
        }
    }
    return results.sort((a, b) => {
        if (a.slug === "readme") return -1;
        if (b.slug === "readme") return 1;
        return a.filename.localeCompare(b.filename, undefined, { sensitivity: "base", numeric: true });
    });
}

async function getDocProjectContext(projectId: string, actorUserId: string | null, docSlug: string = "readme") {
    return docContext(await loadDocProjectBase(projectId, actorUserId), actorUserId, normalizeProjectDocSlug(docSlug));
}

async function getOrCreateMarkdown(projectId: string, userId: string, docSlug: string = "readme", settings: ProjectDocSettings = DEFAULT_PROJECT_DOC_SETTINGS) {
    docSlug = normalizeProjectDocSlug(docSlug);
    const existing = await db.query.projectDocs.findFirst({
        where: and(eq(projectDocs.projectId, projectId), eq(projectDocs.slug, docSlug)),
    });
    if (existing) return existing;
    const filename = docSlug === "readme" ? "README.md" : `${docSlug.toUpperCase()}.md`;
    const [created] = await db
        .insert(projectDocs)
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
    return db.query.projectDocVersions.findFirst({
        where: and(eq(projectDocVersions.id, versionId), isNull(projectDocVersions.deletedAt)),
    });
}

function revalidateProjectDoc(project: { id: string; slug: string | null }) {
    const slugOrId = project.slug || project.id;
    revalidatePath(`/projects/${slugOrId}`);
    revalidateTag(PUBLIC_PROJECT_DETAIL_SHELL_CACHE_TAG, "max");
    revalidateTag(PUBLIC_PROJECT_DETAIL_METADATA_CACHE_TAG, "max");
}

function projectHref(project: { id: string; slug: string | null }, tab: string) {
    return `/projects/${encodeURIComponent(project.slug || project.id)}?tab=${tab}`;
}

function projectTaskHref(project: { id: string; slug: string | null }, taskId: string) {
    return `${projectHref(project, "tasks")}&drawerType=task&drawerId=${encodeURIComponent(taskId)}`;
}

function projectSprintHref(project: { id: string; slug: string | null }, sprintId: string) {
    return `/projects/${encodeURIComponent(project.slug || project.id)}?tab=sprints&sprintId=${encodeURIComponent(sprintId)}`;
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
    kind: ProjectDocReferenceKind,
    context: Awaited<ReturnType<typeof getDocProjectContext>>,
) {
    if (context.permission.canEdit || context.permission.accessLevel === "owner" || context.membership) return true;
    if (context.project.visibility !== "public" || !context.permission.canReadPublished) return false;
    const tabs = normalizeProjectPublicTabVisibility(context.project.publicTabVisibility);
    if (kind === "files") return tabs.files;
    if (kind === "tasks") return tabs.tasks;
    if (kind === "sprints") return tabs.sprints;
    if (kind === "contributors") return tabs.dashboard;
    return true;
}

function blockKey(block: Pick<ProjectDocSmartBlock, "kind" | "ids" | "index">) {
    return `${block.kind}:${block.ids.join(",")}:${block.index}`;
}

function unavailablePreview(block: Pick<ProjectDocSmartBlock, "kind" | "ids" | "index">, description = "This project reference is not available to this viewer."): ProjectDocSmartBlockPreview {
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

function formatFileType(row: Pick<typeof projectNodes.$inferSelect, "name" | "mimeType" | "type">) {
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
    LEFT JOIN project_open_roles por ON por.id = ra.role_id
    WHERE ra.project_id = ${projectId}
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

function optionFromTask(row: TaskReferenceRow, project: { id: string; slug: string | null; key?: string | null }): ProjectDocReferenceOption {
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
    row: Pick<typeof projectSprints.$inferSelect, "id" | "name" | "goal" | "description" | "status" | "startDate" | "endDate">,
    project: { id: string; slug: string | null }
): ProjectDocReferenceOption {
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
    row: Pick<typeof projectNodes.$inferSelect, "id" | "name" | "path" | "currentVersion" | "mimeType">,
    project: { id: string; slug: string | null }
): ProjectDocReferenceOption {
    const versions = row.currentVersion > 1 ? `${row.currentVersion} versions` : "1 version";
    const fileType = formatFileType(row as typeof projectNodes.$inferSelect);
    return {
        id: row.id,
        kind: "files",
        kindLabel: "File",
        title: row.name,
        subtitle: row.path || "/",
        status: fileType,
        meta: versions,
        href: projectFileHref(project, row as typeof projectNodes.$inferSelect),
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
): ProjectDocReferenceOption {
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
}, project: { id: string; slug: string | null; ownerId?: string | null }): ProjectDocReferenceOption {
    const roleLabel = formatMemberRole(row.role, row.userId === project.ownerId);
    const projectRoleTitle = truncateReferenceText(row.projectRoleTitle, 48);
    return {
        id: row.userId,
        kind: "contributors",
        kindLabel: "Contributor",
        title: row.fullName || row.username || "Project member",
        subtitle: row.username ? `@${row.username}` : null,
        status: roleLabel,
        meta: projectRoleTitle ? `(${projectRoleTitle})` : null,
        context: [roleLabel, projectRoleTitle ? `Role: ${projectRoleTitle}` : null].filter(Boolean).join(" · "),
        badges: [roleLabel, projectRoleTitle].filter((badge): badge is string => Boolean(badge)),
        avatarUrl: row.avatarUrl,
        href: profileHref(row),
    };
}

export async function readProjectDocAction(projectId: string, requestedSlug: string | null = null): Promise<
    | { success: true; data: ProjectDocPublishedPayload }
    | { success: false; error: string; code?: "NOT_FOUND" | "FORBIDDEN" }
> {
    try {
        const actorUserId = await getOptionalUserId();
        const base = await loadDocProjectBase(projectId, actorUserId);
        const docs = visibleDocs(base, actorUserId);
        const requested = requestedSlug ? normalizeProjectDocSlug(requestedSlug) : null;
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
        if (context.readme?.linkedNodeId) {
            // Scoped to this project; a missing or trashed file makes the doc
            // unavailable but never deletes it (COR-035).
            const node = await db.query.projectNodes.findFirst({
                where: and(
                    eq(projectNodes.id, context.readme.linkedNodeId),
                    eq(projectNodes.projectId, projectId),
                    isNull(projectNodes.deletedAt)
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
                    const access = await getProjectAccessById(projectId, actorUserId);
                    if (!access.project || !access.canRead) throw new Error("Project not readable");
                    const content = await readProjectFileText({ ...access, project: access.project }, projectId, node.id);
                    const metadata = getOrBuildProjectDocPublishMetadata(content);
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
                        createdBy: node.createdBy,
                        createdByName: "System",
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
                version = (await db.query.projectDocVersions.findFirst({
                    where: and(eq(projectDocVersions.docId, context.readme.id), isNull(projectDocVersions.deletedAt)),
                    orderBy: [desc(projectDocVersions.versionNumber)],
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
                smartBlocks: normalizedVersion ? parseProjectDocSmartBlocks(normalizedVersion.content) : [],
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

export async function readProjectDocSmartBlockPreviewsAction(projectId: string, input: unknown, docSlug: string = "readme"): Promise<
    | { success: true; previews: ProjectDocSmartBlockPreview[] }
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
        const readableKinds = new Set<ProjectDocReferenceKind>();
        const idsByKind = new Map<ProjectDocReferenceKind, Set<string>>();
        const needsRecent = new Set<ProjectDocReferenceKind>();

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

        const tasksById = new Map<string, ProjectDocReferenceOption>();
        let recentTasks: ProjectDocReferenceOption[] = [];
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

        const sprintsById = new Map<string, ProjectDocReferenceOption>();
        let recentSprints: ProjectDocReferenceOption[] = [];
        if (readableKinds.has("sprints")) {
            const sprintIds = [...(idsByKind.get("sprints") ?? [])];
            const [selectedRows, recentRows] = await Promise.all([
                sprintIds.length ? db.query.projectSprints.findMany({
                    where: and(eq(projectSprints.projectId, projectId), inArray(projectSprints.id, sprintIds)),
                    columns: { id: true, name: true, goal: true, description: true, status: true, startDate: true, endDate: true },
                    orderBy: [desc(projectSprints.updatedAt)],
                    limit: sprintIds.length,
                }) : Promise.resolve([]),
                needsRecent.has("sprints") ? db.query.projectSprints.findMany({
                    where: eq(projectSprints.projectId, projectId),
                    columns: { id: true, name: true, goal: true, description: true, status: true, startDate: true, endDate: true },
                    orderBy: [desc(projectSprints.updatedAt)],
                    limit: 4,
                }) : Promise.resolve([]),
            ]);
            selectedRows.forEach((row) => sprintsById.set(row.id, optionFromSprint(row, context.project)));
            recentSprints = recentRows.map((row) => optionFromSprint(row, context.project));
        }

        const filesById = new Map<string, ProjectDocReferenceOption>();
        let recentFiles: ProjectDocReferenceOption[] = [];
        if (readableKinds.has("files")) {
            const fileIds = [...(idsByKind.get("files") ?? [])];
            // Task-owned and /.system files need Tasks visibility (COR-034).
            // Org Files: no Admins-only files or other people's copies in a doc's file blocks (report §23.9).
            const fileScope = and(canReadReferenceKind("tasks", context) ? undefined : projectContentNodeSql, orgFileAccessSql(await getProjectAccessById(projectId, actorUserId)));
            const [selectedRows, recentRows] = await Promise.all([
                fileIds.length ? db.query.projectNodes.findMany({
                    where: and(eq(projectNodes.projectId, projectId), eq(projectNodes.type, "file"), isNull(projectNodes.deletedAt), inArray(projectNodes.id, fileIds), fileScope),
                    columns: { id: true, name: true, path: true, currentVersion: true, mimeType: true },
                    orderBy: [desc(projectNodes.updatedAt)],
                    limit: fileIds.length,
                }) : Promise.resolve([]),
                needsRecent.has("files") ? db.query.projectNodes.findMany({
                    where: and(eq(projectNodes.projectId, projectId), eq(projectNodes.type, "file"), isNull(projectNodes.deletedAt), fileScope),
                    columns: { id: true, name: true, path: true, currentVersion: true, mimeType: true },
                    orderBy: [desc(projectNodes.updatedAt)],
                    limit: 4,
                }) : Promise.resolve([]),
            ]);
            selectedRows.forEach((row) => filesById.set(row.id, optionFromFile(row, context.project)));
            recentFiles = recentRows.map((row) => optionFromFile(row, context.project));
        }

        const rolesById = new Map<string, ProjectDocReferenceOption>();
        let recentRoles: ProjectDocReferenceOption[] = [];
        if (readableKinds.has("roles")) {
            const roleIds = [...(idsByKind.get("roles") ?? [])];
            const [selectedRows, recentRows] = await Promise.all([
                roleIds.length ? db.query.projectOpenRoles.findMany({
                    where: and(eq(projectOpenRoles.projectId, projectId), inArray(projectOpenRoles.id, roleIds)),
                    columns: { id: true, role: true, title: true, description: true, count: true, filled: true },
                    orderBy: [desc(projectOpenRoles.updatedAt)],
                    limit: roleIds.length,
                }) : Promise.resolve([]),
                needsRecent.has("roles") ? db.query.projectOpenRoles.findMany({
                    where: eq(projectOpenRoles.projectId, projectId),
                    columns: { id: true, role: true, title: true, description: true, count: true, filled: true },
                    orderBy: [desc(projectOpenRoles.updatedAt)],
                    limit: 4,
                }) : Promise.resolve([]),
            ]);
            selectedRows.forEach((row) => rolesById.set(row.id, optionFromRole(row, context.project)));
            recentRoles = recentRows.map((row) => optionFromRole(row, context.project));
        }

        const contributorsById = new Map<string, ProjectDocReferenceOption>();
        let recentContributors: ProjectDocReferenceOption[] = [];
        if (readableKinds.has("contributors")) {
            const contributorIds = [...(idsByKind.get("contributors") ?? [])];
            const selectedRows = contributorIds.length ? await db
                .select({
                    userId: projectMembers.userId,
                    role: projectMembers.role,
                    fullName: profiles.fullName,
                    username: profiles.username,
                    avatarUrl: profiles.avatarUrl,
                    projectRoleTitle: acceptedRoleTitleSql(projectId, projectMembers.userId),
                })
                .from(projectMembers)
                .innerJoin(profiles, eq(profiles.id, projectMembers.userId))
                .where(and(
                    eq(projectMembers.projectId, projectId),
                    isNull(profiles.deletedAt),
                    inArray(projectMembers.userId, contributorIds),
                ))
                .orderBy(desc(projectMembers.joinedAt))
                .limit(contributorIds.length) : [];
            const recentRows = needsRecent.has("contributors") ? await db
                .select({
                    userId: projectMembers.userId,
                    role: projectMembers.role,
                    fullName: profiles.fullName,
                    username: profiles.username,
                    avatarUrl: profiles.avatarUrl,
                    projectRoleTitle: acceptedRoleTitleSql(projectId, projectMembers.userId),
                })
                .from(projectMembers)
                .innerJoin(profiles, eq(profiles.id, projectMembers.userId))
                .where(and(eq(projectMembers.projectId, projectId), isNull(profiles.deletedAt)))
                .orderBy(desc(projectMembers.joinedAt))
                .limit(4) : [];
            selectedRows.forEach((row) => contributorsById.set(row.userId, optionFromContributor(row, context.project)));
            recentContributors = recentRows.map((row) => optionFromContributor(row, context.project));
        }

        // Projects block (report §19.5): the org's child projects; visitors see public ones only.
        const isInside = Boolean(context.permission.canEdit || context.permission.accessLevel === "owner" || context.membership);
        const childProjects: ProjectDocReferenceOption[] = readableKinds.has("projects")
            ? (await db.select({ id: projects.id, title: projects.title, slug: projects.slug, visibility: projects.visibility })
                .from(projects)
                .where(and(
                    eq(projects.parentId, projectId),
                    isNull(projects.deletedAt),
                    isInside ? sql`${projects.visibility} <> 'private'` : eq(projects.visibility, "public"),
                ))
                .orderBy(projects.title)
                .limit(24)).map((row) => ({
                    id: row.id,
                    kind: "projects" as const,
                    title: row.title,
                    subtitle: row.visibility === "public" ? "Public" : "Organization",
                    href: `/projects/${encodeURIComponent(row.slug || row.id)}`,
                }))
            : [];

        const previewFor = (block: (typeof normalizedBlocks)[number]): ProjectDocSmartBlockPreview => {
            if (block.kind === "unknown") return unavailablePreview(block, "This document block is not recognized.");
            if (!canReadReferenceKind(block.kind, context)) return unavailablePreview(block);
            if (block.kind === "projects") {
                return {
                    key: blockKey(block),
                    kind: block.kind,
                    title: "Projects",
                    description: "Projects inside this organization, live.",
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
            const items = block.ids.length ? block.ids.map((id) => byId.get(id)).filter((item): item is ProjectDocReferenceOption => Boolean(item)) : recent;

            return {
                key: blockKey(block),
                kind: block.kind,
                title: block.kind === "tasks"
                    ? "Referenced tasks"
                    : block.kind === "sprints"
                        ? "Sprint story"
                        : block.kind === "files"
                            ? "Referenced files"
                            : block.kind === "roles"
                                ? "Open roles"
                                : "Contributors",
                description: block.ids.length
                    ? "Selected project context from this document."
                    : "Current project context rendered from live project data.",
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
        return { success: false, error: "Couldn’t load document project references." };
    }
}

export async function readProjectDocSettingsAction(projectId: string, docSlug: string = "readme") {
    try {
        docSlug = normalizeProjectDocSlug(docSlug);
        const userId = await requireUserId();
        const context = await getDocProjectContext(projectId, userId);
        if (!context.permission.canManageSettings) return { success: false as const, error: "You cannot manage document settings." };
        return { success: true as const, settings: context.settings, permission: context.permission };
    } catch (error) {
        return { success: false as const, error: "Couldn’t load document settings" };
    }
}

export async function updateProjectDocSettingsAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = readmeSettingsSchema.parse(input);
        const docSlug = parsed.docSlug;
        const context = await getDocProjectContext(projectId, userId, docSlug);
        if (!context.permission.canManageSettings) return { success: false as const, error: "You cannot manage settings." };
        const readme = await getOrCreateMarkdown(projectId, userId, docSlug, context.settings);
        const nextSettings = normalizeProjectDocSettings({ ...context.settings, ...parsed });
        const [updated] = await db.update(projectDocs)
            .set({ settings: nextSettings, updatedAt: new Date() })
            .where(eq(projectDocs.id, readme.id))
            .returning();
        await recordNodeEvent(projectId, userId, null, "project_readme.settings_updated", { settings: nextSettings });
        revalidateProjectDoc(context.project);
        return { success: true as const, settings: normalizeProjectDocSettings(updated?.settings) };
    } catch (error) {
        logger.error("project_readme.settings_update_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Couldn’t update document settings." };
    }
}

export async function linkProjectDocAction(projectId: string, nodeId: string) {
    try {
        const userId = await requireUserId();
        const base = await loadDocProjectBase(projectId, userId);
        const context = docContext(base, userId, "readme");
        if (!context.permission.canEdit) {
            return { success: false as const, error: "Only project members can add a document." };
        }

        const node = await db.query.projectNodes.findFirst({
            where: and(
                eq(projectNodes.id, nodeId),
                eq(projectNodes.projectId, projectId),
                eq(projectNodes.type, "file"),
                isNull(projectNodes.deletedAt),
            ),
            columns: { id: true, name: true },
        });
        if (!node) {
            return { success: false as const, error: "Target file not found." };
        }

        const existing = base.docs.find((doc) => doc.linkedNodeId === nodeId);
        if (existing) return { success: true as const, slug: existing.slug, id: existing.id };

        // Rows with no file and no published content are dead weight; reuse their slug.
        const taken = new Set(base.docs.filter((doc) => doc.linkedNodeId || doc.publishedVersionId).map((doc) => doc.slug));
        const slug = nextFreeDocSlug(normalizeProjectDocSlug(node.name, "doc"), taken);
        const [linked] = await db
            .insert(projectDocs)
            // A new doc takes the project's defaults, never another doc's org options (Required, group…).
            .values({ projectId, slug, filename: node.name, linkedNodeId: nodeId, settings: { ...context.settings, org: undefined } })
            .onConflictDoUpdate({
                target: [projectDocs.projectId, projectDocs.slug],
                set: { filename: node.name, linkedNodeId: nodeId, updatedAt: new Date() },
            })
            .returning({ id: projectDocs.id });

        revalidateProjectDoc(context.project);
        return { success: true as const, slug, id: linked!.id };
    } catch (error) {
        logger.error("project_readme.link_failed", { projectId, nodeId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Internal server error." };
    }
}

export async function unlinkProjectDocAction(projectId: string, docSlug: string) {
    try {
        docSlug = normalizeProjectDocSlug(docSlug);
        const userId = await requireUserId();
        const context = await getDocProjectContext(projectId, userId, docSlug);
        if (!context.permission.canEdit) {
            return { success: false as const, error: "Only project members can remove a document." };
        }

        await db.delete(projectDocs).where(and(eq(projectDocs.projectId, projectId), eq(projectDocs.slug, docSlug)));

        revalidateProjectDoc(context.project);
        return { success: true as const };
    } catch (error) {
        logger.error("project_readme.unlink_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Internal server error." };
    }
}

export async function listProjectDocsAction(projectId: string) {
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
export async function applyCreationIntentAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = applyCreationIntentSchema.parse(input);
        if (parsed.mode === "skip") {
            return { success: true as const, skipped: true };
        }

        const context = await getDocProjectContext(projectId, userId, "readme");
        if (!context.permission.canEdit) {
            return { success: false as const, error: "You cannot initialize documents for this project." };
        }

        const starterText = parsed.starterContent || "";

        if (starterText.trim().length > 0) {
            await db.transaction(async (tx) => {
                let readme = await tx.query.projectDocs.findFirst({
                    where: and(eq(projectDocs.projectId, projectId), eq(projectDocs.slug, "readme")),
                });
                if (!readme) {
                    const [created] = await tx
                        .insert(projectDocs)
                        .values({
                            projectId,
                            slug: "readme",
                            filename: "README.md",
                            settings: context.settings,
                        })
                        .onConflictDoNothing()
                        .returning();
                    readme = created ?? (await tx.query.projectDocs.findFirst({
                        where: and(eq(projectDocs.projectId, projectId), eq(projectDocs.slug, "readme")),
                    }));
                }
                if (!readme) throw new Error("Couldn’t initialize readme record");

                const metadata = getOrBuildProjectDocPublishMetadata(starterText);
                let versionId: string | null = null;
                const existingVersion = await tx.query.projectDocVersions.findFirst({
                    where: and(eq(projectDocVersions.docId, readme.id), eq(projectDocVersions.versionNumber, 1)),
                });

                if (existingVersion) {
                    versionId = existingVersion.id;
                } else {
                    const [newVersion] = await tx
                        .insert(projectDocVersions)
                        .values({
                            projectId,
                            docId: readme.id,
                            versionNumber: 1,
                            content: metadata.content,
                            excerpt: metadata.excerpt,
                            headings: metadata.headings,
                            qualityReport: metadata.qualityReport,
                            contentHash: metadata.contentHash,
                            changeSummary: "Initial project document",
                            coAuthors: [],
                            createdBy: userId,
                        })
                        .returning({ id: projectDocVersions.id });
                    versionId = newVersion?.id ?? null;
                }

                if (parsed.publishOnCreate && versionId) {
                    await tx
                        .update(projectDocs)
                        .set({ publishedVersionId: versionId })
                        .where(eq(projectDocs.id, readme.id));
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

