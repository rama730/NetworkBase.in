'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { workspaceNodes, workspaces, workspaceSprints, sprintMaterials } from '@/lib/db/schema';
import { getWorkspaceAccessById } from '@/lib/data/workspace-access';
import { assertFileNodeVisible, orgFileAccessSql, projectContentNodeSql } from '@/lib/files/internal-helpers';
import { readViewerOrgRole } from '@/lib/organizations/detail';
import { effectiveAccess, folderAccessBlock, readFolderAccess, type FolderAccess } from '@/lib/organizations/file-rules';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { ORG_LIMITS } from '@/lib/organizations/config';
import { UUID_RE } from '@/lib/validations/uuid';

// Org Files (report §23): folder access and Template marks for admins; the From <org> view and copies in
// child projects. Reads elsewhere go through orgFileAccessSql / assertFileNodeVisible.

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You don’t have permission to do this." };
type ReadableAccess = Awaited<ReturnType<typeof getWorkspaceAccessById>> & { project: NonNullable<Awaited<ReturnType<typeof getWorkspaceAccessById>>['project']> };

/** The viewer when they own or admin the org; writes refuse a suspended or archived org. */
async function orgAdmin(orgId: string, mode: 'read' | 'write' = 'write') {
    const { userId } = await getViewerAuthContext();
    if (!userId) return null;
    const access = await getWorkspaceAccessById(orgId, userId);
    if (mode === 'write' && access.writeBlocked) return null;
    return access.project?.kind === 'organization' && (access.isOwner || access.memberRole === 'admin') ? { userId, slug: access.project.slug ?? null } : null;
}

async function orgFolder(orgId: string, folderId: string) {
    const [folder] = await db.select({ id: workspaceNodes.id, path: workspaceNodes.path, metadata: workspaceNodes.metadata })
        .from(workspaceNodes)
        .where(and(eq(workspaceNodes.id, folderId), eq(workspaceNodes.projectId, orgId), eq(workspaceNodes.type, 'folder'), isNull(workspaceNodes.deletedAt), projectContentNodeSql))
        .limit(1);
    return folder ?? null;
}

const touch = (slug: string | null, id: string) => revalidatePath(`/org/${slug ?? id}`);
const plural = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;

/**
 * Admins only / Members / Public on a folder (null clears the mark). Without `confirm` it returns the
 * preview: who gains or loses access (report §23.9 #5). Access is only stricter going down.
 */
export async function setFolderAccessAction(orgId: string, folderId: string, access: FolderAccess | null, confirm: boolean): Promise<{ success: true; preview?: { files: number; message: string } } | Failure> {
    const admin = await orgAdmin(orgId);
    if (!admin) return DENIED;
    if (access !== null && !['admins', 'members', 'public'].includes(access)) return { success: false, error: 'Pick an access level.' };
    const folder = await orgFolder(orgId, folderId);
    if (!folder) return { success: false, error: 'That folder is no longer available.' };
    const ancestors = await db.select({ metadata: workspaceNodes.metadata }).from(workspaceNodes).where(and(
        eq(workspaceNodes.projectId, orgId), eq(workspaceNodes.type, 'folder'), isNull(workspaceNodes.deletedAt),
        sql`starts_with(${folder.path}, ${workspaceNodes.path} || '/')`,
    ));
    const block = folderAccessBlock(effectiveAccess(ancestors.map((a) => readFolderAccess(a.metadata))), access);
    if (block) return { success: false, error: block };
    if (!confirm) {
        const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(workspaceNodes).where(and(
            eq(workspaceNodes.projectId, orgId), eq(workspaceNodes.type, 'file'), isNull(workspaceNodes.deletedAt),
            sql`starts_with(${workspaceNodes.path}, ${folder.path} || '/')`,
        ));
        const message = access === 'admins' ? `Members will lose access to ${plural(n)}.`
            : access === 'public' ? `${plural(n)} will become visible to visitors.`
                : `${plural(n)} will follow the parent folder’s access.`;
        return { success: true, preview: { files: n, message } };
    }
    await db.update(workspaceNodes).set({
        metadata: access ? sql`coalesce(${workspaceNodes.metadata}, '{}'::jsonb) || ${JSON.stringify({ access })}::jsonb` : sql`coalesce(${workspaceNodes.metadata}, '{}'::jsonb) - 'access'`,
        updatedAt: new Date(),
    }).where(eq(workspaceNodes.id, folder.id));
    touch(admin.slug, orgId);
    return { success: true };
}

/** The Template mark on a folder (report §23.3). */
export async function setFolderTemplateAction(orgId: string, folderId: string, template: boolean): Promise<{ success: true } | Failure> {
    const admin = await orgAdmin(orgId);
    if (!admin) return DENIED;
    const folder = await orgFolder(orgId, folderId);
    if (!folder) return { success: false, error: 'That folder is no longer available.' };
    await db.update(workspaceNodes).set({
        metadata: template ? sql`coalesce(${workspaceNodes.metadata}, '{}'::jsonb) || '{"template": true}'::jsonb` : sql`coalesce(${workspaceNodes.metadata}, '{}'::jsonb) - 'template'`,
        updatedAt: new Date(),
    }).where(eq(workspaceNodes.id, folder.id));
    touch(admin.slug, orgId);
    return { success: true };
}

export type OrgFolderRow = { id: string; path: string; access: FolderAccess | null; template: boolean };

/** Every folder of the org tree with its marks, for the admin panel. */
export async function listOrgFoldersAction(orgId: string): Promise<{ success: true; folders: OrgFolderRow[] } | Failure> {
    if (!(await orgAdmin(orgId, 'read'))) return DENIED;
    // ponytail: 300 folders, sorted by path. Upgrade: per-folder controls in the Files tree when orgs outgrow it.
    const rows = await db.select({ id: workspaceNodes.id, path: workspaceNodes.path, metadata: workspaceNodes.metadata }).from(workspaceNodes)
        .where(and(eq(workspaceNodes.projectId, orgId), eq(workspaceNodes.type, 'folder'), isNull(workspaceNodes.deletedAt), projectContentNodeSql))
        .orderBy(asc(workspaceNodes.path)).limit(300);
    return { success: true, folders: rows.map((r) => ({ id: r.id, path: r.path, access: readFolderAccess(r.metadata), template: (r.metadata as { template?: unknown } | null)?.template === true })) };
}

/** The org's access for an org person inside one of its child projects; null for anyone else (§23.6). */
async function childOrgAccess(childProjectId: string): Promise<{ userId: string; orgAccess: ReadableAccess; org: { id: string; title: string; slug: string | null } } | null> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return null;
    const [child] = await db.select({ parentId: workspaces.parentId }).from(workspaces).where(and(eq(workspaces.id, childProjectId), isNull(workspaces.deletedAt))).limit(1);
    if (!child?.parentId || !(await readViewerOrgRole(child.parentId, userId))) return null; // outside people get no From org view
    const orgAccess = await getWorkspaceAccessById(child.parentId, userId);
    if (!orgAccess.project || !orgAccess.canRead) return null;
    const [org] = await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, child.parentId)).limit(1);
    return org ? { userId, orgAccess: orgAccess as ReadableAccess, org } : null;
}

export type OrgBrowseNode = { id: string; name: string; type: 'folder' | 'file'; path: string; currentVersion: number; size: number | null; access: FolderAccess | null };

/** From <org>: one level of the org tree, read-only, minus what the viewer can't open (report §23.6). */
export async function browseOrgFilesAction(childProjectId: string, folderId: string | null): Promise<{ success: true; org: { id: string; title: string; slug: string | null }; nodes: OrgBrowseNode[] } | Failure> {
    const ctx = await childOrgAccess(childProjectId);
    if (!ctx) return DENIED;
    if (folderId) {
        const folder = await orgFolder(ctx.org.id, folderId);
        if (!folder) return { success: false, error: 'That folder is no longer available.' };
        try { await assertFileNodeVisible(ctx.orgAccess, { path: folder.path, taskId: null, deletedAt: null }); } catch { return { success: false, error: 'That folder is no longer available.' }; }
    }
    const rows = await db.select({ id: workspaceNodes.id, name: workspaceNodes.name, type: workspaceNodes.type, path: workspaceNodes.path, currentVersion: workspaceNodes.currentVersion, size: workspaceNodes.size, metadata: workspaceNodes.metadata })
        .from(workspaceNodes)
        .where(and(
            eq(workspaceNodes.projectId, ctx.org.id),
            folderId ? eq(workspaceNodes.parentId, folderId) : isNull(workspaceNodes.parentId),
            isNull(workspaceNodes.deletedAt),
            projectContentNodeSql,
            orgFileAccessSql(ctx.orgAccess),
        ))
        .orderBy(sql`CASE WHEN ${workspaceNodes.type} = 'folder' THEN 0 ELSE 1 END`, asc(workspaceNodes.name))
        .limit(200);
    return { success: true, org: ctx.org, nodes: rows.map(({ metadata, ...r }) => ({ ...r, access: readFolderAccess(metadata) })) };
}

/**
 * Copy to this project: after the browser copies the bytes into a new file here, record where it came from
 * so the Files tab can show "Copied from <org> · v2" and "Newer version in <org>" (report §23.6).
 */
export async function recordOrgCopyAction(childProjectId: string, nodeId: string, orgNodeId: string): Promise<{ success: true } | Failure> {
    const ctx = await childOrgAccess(childProjectId);
    if (!ctx) return DENIED;
    const childAccess = await getWorkspaceAccessById(childProjectId, ctx.userId);
    if (!childAccess.canWrite) return DENIED;
    const [source] = await db.select({ id: workspaceNodes.id, path: workspaceNodes.path, taskId: workspaceNodes.taskId, deletedAt: workspaceNodes.deletedAt, currentVersion: workspaceNodes.currentVersion, type: workspaceNodes.type })
        .from(workspaceNodes).where(and(eq(workspaceNodes.id, orgNodeId), eq(workspaceNodes.projectId, ctx.org.id))).limit(1);
    if (!source || source.type !== 'file') return { success: false, error: 'That file is no longer available.' };
    try { await assertFileNodeVisible(ctx.orgAccess, source); } catch { return { success: false, error: 'That file is no longer available.' }; }
    const copied = await db.update(workspaceNodes).set({
        metadata: sql`coalesce(${workspaceNodes.metadata}, '{}'::jsonb) || ${JSON.stringify({ copiedFrom: { orgId: ctx.org.id, nodeId: source.id, version: source.currentVersion } })}::jsonb`,
    }).where(and(eq(workspaceNodes.id, nodeId), eq(workspaceNodes.projectId, childProjectId), eq(workspaceNodes.type, 'file'), isNull(workspaceNodes.deletedAt)))
        .returning({ id: workspaceNodes.id });
    return copied.length ? { success: true } : { success: false, error: 'That copy is no longer available.' };
}

export type OrgCopyRow = { nodeId: string; name: string; sourceNodeId: string; copiedVersion: number; sourceVersion: number | null };

/** This project's copies of org files, with the source's current version for the "Source updated" hint. */
export async function listOrgCopiesAction(childProjectId: string): Promise<{ success: true; orgTitle: string; copies: OrgCopyRow[] } | Failure> {
    const ctx = await childOrgAccess(childProjectId);
    if (!ctx) return DENIED;
    const rows = await db.execute<{ node_id: string; name: string; source_node_id: string; copied_version: number; source_version: number | null }>(sql`
        SELECT c.id AS node_id, c.name, (c.metadata->'copiedFrom'->>'nodeId') AS source_node_id,
            (c.metadata->'copiedFrom'->>'version')::int AS copied_version, s.current_version AS source_version
        FROM workspace_nodes c
        LEFT JOIN workspace_nodes s ON s.id = (c.metadata->'copiedFrom'->>'nodeId')::uuid AND s.workspace_id = ${ctx.org.id}::uuid AND s.deleted_at IS NULL
        WHERE c.workspace_id = ${childProjectId}::uuid AND c.deleted_at IS NULL AND c.metadata ? 'copiedFrom'
        ORDER BY c.name
        LIMIT 200
    `);
    return {
        success: true,
        orgTitle: ctx.org.title,
        copies: Array.from(rows).map((r) => ({ nodeId: r.node_id, name: r.name, sourceNodeId: r.source_node_id, copiedVersion: Number(r.copied_version), sourceVersion: r.source_version == null ? null : Number(r.source_version) })),
    };
}

/**
 * Before an org file or folder goes to Trash (report §23.9 #11): where it's in use as a sprint material, an
 * assignment or task reference, a template folder or a doc. Empty outside orgs and for anything unused.
 */
export async function readOrgFileUsageAction(orgId: string, nodeIds: string[]): Promise<string[]> {
    nodeIds = nodeIds.filter((id) => UUID_RE.test(id));
    if (nodeIds.length === 0 || !(await orgAdmin(orgId, 'read'))) return [];
    const rows = await db.execute<{ label: string }>(sql`
        WITH picked AS (SELECT path FROM workspace_nodes WHERE workspace_id = ${orgId} AND id IN ${nodeIds.slice(0, 200)} AND deleted_at IS NULL),
        affected AS (
            SELECT n.id, n.name, n.type, n.metadata FROM workspace_nodes n
            WHERE n.workspace_id = ${orgId} AND n.deleted_at IS NULL
              AND EXISTS (SELECT 1 FROM picked p WHERE n.path = p.path OR n.path LIKE p.path || '/%'))
        SELECT DISTINCT 'Material in ' || s.name AS label FROM sprint_materials m JOIN workspace_sprints s ON s.id = m.sprint_id WHERE m.node_id IN (SELECT id FROM affected)
        UNION SELECT DISTINCT 'Reference on ' || t.title FROM task_node_links l JOIN tasks t ON t.id = l.task_id AND t.deleted_at IS NULL WHERE l.node_id IN (SELECT id FROM affected)
        UNION SELECT DISTINCT 'Template folder ' || a.name FROM affected a WHERE a.type = 'folder' AND (a.metadata->>'template')::boolean IS TRUE
        UNION SELECT DISTINCT 'Doc ' || d.filename FROM workspace_documents d WHERE d.workspace_id = ${orgId} AND d.linked_node_id IN (SELECT id FROM affected)
        LIMIT 20`);
    return rows.map((r) => r.label);
}

/** Org storage for admins (report §23): used of 5 GB, with a warning from 80%. */
export async function readOrgStorageAction(orgId: string): Promise<{ usedBytes: number; limitBytes: number; warn: boolean } | null> {
    if (!(await orgAdmin(orgId, 'read'))) return null;
    const [row] = await db.execute<{ used: number | null }>(sql`
        SELECT (retained_bytes + reserved_bytes)::bigint AS used FROM storage_quota_scopes WHERE scope_type = 'project' AND scope_id = ${orgId}`);
    const usedBytes = Number(row?.used ?? 0);
    return { usedBytes, limitBytes: ORG_LIMITS.orgStorageBytes, warn: usedBytes >= ORG_LIMITS.orgStorageBytes * ORG_LIMITS.orgStorageWarnRatio };
}

export type SprintMaterialsGroup = { sprintId: string; sprint: string; status: string; files: Array<{ nodeId: string; name: string }> };

/**
 * Sprint materials (report §23.3): org files linked to each sprint, newest sprint first, filtered by folder access
 * for members and guests. Docs linked to sprints stay on the Docs tab.
 */
export async function readOrgSprintMaterialsAction(orgId: string): Promise<{ success: true; groups: SprintMaterialsGroup[] } | Failure> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return DENIED;
    const access = await getWorkspaceAccessById(orgId, userId);
    if (access.project?.kind !== 'organization' || !(access.isOwner || access.isMember)) return DENIED;
    const rows = await db.select({ sprintId: workspaceSprints.id, sprint: workspaceSprints.name, status: workspaceSprints.status, nodeId: workspaceNodes.id, name: workspaceNodes.name })
        .from(sprintMaterials)
        .innerJoin(workspaceSprints, eq(workspaceSprints.id, sprintMaterials.sprintId))
        .innerJoin(workspaceNodes, and(eq(workspaceNodes.id, sprintMaterials.nodeId), isNull(workspaceNodes.deletedAt)))
        .where(and(eq(workspaceSprints.projectId, orgId), orgFileAccessSql(access)))
        .orderBy(desc(workspaceSprints.startDate), asc(workspaceNodes.name))
        .limit(500);
    const groups = new Map<string, SprintMaterialsGroup>();
    for (const r of rows) {
        const group = groups.get(r.sprintId) ?? { sprintId: r.sprintId, sprint: r.sprint, status: r.status, files: [] };
        group.files.push({ nodeId: r.nodeId, name: r.name });
        groups.set(r.sprintId, group);
    }
    return { success: true, groups: [...groups.values()] };
}

export type GroupDeliverableRow = { nodeId: string; name: string; project: string; projectSlug: string | null; projectId: string; assignment: string; review: string };

/** The org's Deliverables also list child projects' group-copy files (report §23.6, §23.9 #14), for admins. */
export async function readGroupDeliverablesAction(orgId: string): Promise<{ success: true; rows: GroupDeliverableRow[] } | Failure> {
    if (!(await orgAdmin(orgId, 'read'))) return DENIED;
    const rows = await db.execute<{ node_id: string; name: string; project: string; project_slug: string | null; project_id: string; assignment: string; review: string }>(sql`
        SELECT n.id AS node_id, n.name, p.title AS project, p.slug AS project_slug, p.id AS project_id, m.title AS assignment,
               -- The copy's real state, in the shipped words (report §42.10 smaller bug 10).
               CASE WHEN c.review_status = 'pending' THEN 'submitted' WHEN c.review_status = 'rejected' THEN 'returned'
                    WHEN c.status = 'done' THEN 'completed' ELSE 'not_handed_in' END AS review
        FROM tasks m JOIN tasks c ON c.assignment_id = m.id AND c.deleted_at IS NULL AND c.workspace_id <> m.workspace_id
        JOIN workspaces p ON p.id = c.workspace_id AND p.parent_id = ${orgId} AND p.deleted_at IS NULL
        JOIN workspace_nodes n ON n.task_id = c.id AND n.type = 'file' AND n.deleted_at IS NULL
        WHERE m.workspace_id = ${orgId} AND m.deleted_at IS NULL
        ORDER BY m.title, p.title, n.name LIMIT 300`);
    return { success: true, rows: rows.map((r) => ({ nodeId: r.node_id, name: r.name, project: r.project, projectSlug: r.project_slug, projectId: r.project_id, assignment: r.assignment, review: r.review })) };
}

/** Template folders a member may start a child project from (report §23.3 Template mark, §23.6). */
export async function listOrgTemplateFoldersAction(orgId: string): Promise<Array<{ id: string; name: string }>> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return [];
    const access = await getWorkspaceAccessById(orgId, userId);
    if (access.project?.kind !== 'organization' || !(access.isOwner || access.isMember)) return [];
    return db.select({ id: workspaceNodes.id, name: workspaceNodes.name }).from(workspaceNodes)
        .where(and(eq(workspaceNodes.projectId, orgId), eq(workspaceNodes.type, 'folder'), isNull(workspaceNodes.deletedAt),
            sql`(${workspaceNodes.metadata}->>'template')::boolean IS TRUE`, orgFileAccessSql(access)))
        .orderBy(asc(workspaceNodes.name)).limit(50);
}
