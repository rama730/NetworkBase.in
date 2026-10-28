'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { projectNodes, projects } from '@/lib/db/schema';
import { getProjectAccessById } from '@/lib/data/project-access';
import { assertFileNodeVisible, orgFileAccessSql, projectContentNodeSql } from '@/lib/files/internal-helpers';
import { organizationsEnabled } from '@/lib/organizations/config';
import { readViewerOrgRole } from '@/lib/organizations/detail';
import { effectiveAccess, folderAccessBlock, readFolderAccess, type FolderAccess } from '@/lib/organizations/file-rules';
import { getViewerAuthContext } from '@/lib/server/viewer-context';

// Org Files (report §23): folder access and Template marks for admins; the From <org> view and copies in
// child projects. Reads elsewhere go through orgFileAccessSql / assertFileNodeVisible.

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You don't have permission to do this." };
type ReadableAccess = Awaited<ReturnType<typeof getProjectAccessById>> & { project: NonNullable<Awaited<ReturnType<typeof getProjectAccessById>>['project']> };

/** The viewer when they own or admin the org; writes refuse a suspended or archived org. */
async function orgAdmin(orgId: string, mode: 'read' | 'write' = 'write') {
    if (!organizationsEnabled()) return null;
    const { userId } = await getViewerAuthContext();
    if (!userId) return null;
    const access = await getProjectAccessById(orgId, userId);
    if (mode === 'write' && access.writeBlocked) return null;
    return access.project?.kind === 'organization' && (access.isOwner || access.memberRole === 'admin') ? { userId, slug: access.project.slug ?? null } : null;
}

async function orgFolder(orgId: string, folderId: string) {
    const [folder] = await db.select({ id: projectNodes.id, path: projectNodes.path, metadata: projectNodes.metadata })
        .from(projectNodes)
        .where(and(eq(projectNodes.id, folderId), eq(projectNodes.projectId, orgId), eq(projectNodes.type, 'folder'), isNull(projectNodes.deletedAt), projectContentNodeSql))
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
    const ancestors = await db.select({ metadata: projectNodes.metadata }).from(projectNodes).where(and(
        eq(projectNodes.projectId, orgId), eq(projectNodes.type, 'folder'), isNull(projectNodes.deletedAt),
        sql`starts_with(${folder.path}, ${projectNodes.path} || '/')`,
    ));
    const block = folderAccessBlock(effectiveAccess(ancestors.map((a) => readFolderAccess(a.metadata))), access);
    if (block) return { success: false, error: block };
    if (!confirm) {
        const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(projectNodes).where(and(
            eq(projectNodes.projectId, orgId), eq(projectNodes.type, 'file'), isNull(projectNodes.deletedAt),
            sql`starts_with(${projectNodes.path}, ${folder.path} || '/')`,
        ));
        const message = access === 'admins' ? `Members will lose access to ${plural(n)}.`
            : access === 'public' ? `${plural(n)} will become visible to visitors.`
                : `${plural(n)} will follow the parent folder's access.`;
        return { success: true, preview: { files: n, message } };
    }
    await db.update(projectNodes).set({
        metadata: access ? sql`coalesce(${projectNodes.metadata}, '{}'::jsonb) || ${JSON.stringify({ access })}::jsonb` : sql`coalesce(${projectNodes.metadata}, '{}'::jsonb) - 'access'`,
        updatedAt: new Date(),
    }).where(eq(projectNodes.id, folder.id));
    touch(admin.slug, orgId);
    return { success: true };
}

/** The Template mark on a folder (report §23.3). */
export async function setFolderTemplateAction(orgId: string, folderId: string, template: boolean): Promise<{ success: true } | Failure> {
    const admin = await orgAdmin(orgId);
    if (!admin) return DENIED;
    const folder = await orgFolder(orgId, folderId);
    if (!folder) return { success: false, error: 'That folder is no longer available.' };
    await db.update(projectNodes).set({
        metadata: template ? sql`coalesce(${projectNodes.metadata}, '{}'::jsonb) || '{"template": true}'::jsonb` : sql`coalesce(${projectNodes.metadata}, '{}'::jsonb) - 'template'`,
        updatedAt: new Date(),
    }).where(eq(projectNodes.id, folder.id));
    touch(admin.slug, orgId);
    return { success: true };
}

export type OrgFolderRow = { id: string; path: string; access: FolderAccess | null; template: boolean };

/** Every folder of the org tree with its marks, for the admin panel. */
export async function listOrgFoldersAction(orgId: string): Promise<{ success: true; folders: OrgFolderRow[] } | Failure> {
    if (!(await orgAdmin(orgId, 'read'))) return DENIED;
    // ponytail: 300 folders, sorted by path. Upgrade: per-folder controls in the Files tree when orgs outgrow it.
    const rows = await db.select({ id: projectNodes.id, path: projectNodes.path, metadata: projectNodes.metadata }).from(projectNodes)
        .where(and(eq(projectNodes.projectId, orgId), eq(projectNodes.type, 'folder'), isNull(projectNodes.deletedAt), projectContentNodeSql))
        .orderBy(asc(projectNodes.path)).limit(300);
    return { success: true, folders: rows.map((r) => ({ id: r.id, path: r.path, access: readFolderAccess(r.metadata), template: (r.metadata as { template?: unknown } | null)?.template === true })) };
}

/** The org's access for an org person inside one of its child projects; null for anyone else (§23.6). */
async function childOrgAccess(childProjectId: string): Promise<{ userId: string; orgAccess: ReadableAccess; org: { id: string; title: string; slug: string | null } } | null> {
    if (!organizationsEnabled()) return null;
    const { userId } = await getViewerAuthContext();
    if (!userId) return null;
    const [child] = await db.select({ parentId: projects.parentId }).from(projects).where(and(eq(projects.id, childProjectId), isNull(projects.deletedAt))).limit(1);
    if (!child?.parentId || !(await readViewerOrgRole(child.parentId, userId))) return null; // outside people get no From org view
    const orgAccess = await getProjectAccessById(child.parentId, userId);
    if (!orgAccess.project || !orgAccess.canRead) return null;
    const [org] = await db.select({ id: projects.id, title: projects.title, slug: projects.slug }).from(projects).where(eq(projects.id, child.parentId)).limit(1);
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
    const rows = await db.select({ id: projectNodes.id, name: projectNodes.name, type: projectNodes.type, path: projectNodes.path, currentVersion: projectNodes.currentVersion, size: projectNodes.size, metadata: projectNodes.metadata })
        .from(projectNodes)
        .where(and(
            eq(projectNodes.projectId, ctx.org.id),
            folderId ? eq(projectNodes.parentId, folderId) : isNull(projectNodes.parentId),
            isNull(projectNodes.deletedAt),
            projectContentNodeSql,
            orgFileAccessSql(ctx.orgAccess),
        ))
        .orderBy(sql`CASE WHEN ${projectNodes.type} = 'folder' THEN 0 ELSE 1 END`, asc(projectNodes.name))
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
    const childAccess = await getProjectAccessById(childProjectId, ctx.userId);
    if (!childAccess.canWrite) return DENIED;
    const [source] = await db.select({ id: projectNodes.id, path: projectNodes.path, taskId: projectNodes.taskId, deletedAt: projectNodes.deletedAt, currentVersion: projectNodes.currentVersion, type: projectNodes.type })
        .from(projectNodes).where(and(eq(projectNodes.id, orgNodeId), eq(projectNodes.projectId, ctx.org.id))).limit(1);
    if (!source || source.type !== 'file') return { success: false, error: 'That file is no longer available.' };
    try { await assertFileNodeVisible(ctx.orgAccess, source); } catch { return { success: false, error: 'That file is no longer available.' }; }
    const copied = await db.update(projectNodes).set({
        metadata: sql`coalesce(${projectNodes.metadata}, '{}'::jsonb) || ${JSON.stringify({ copiedFrom: { orgId: ctx.org.id, nodeId: source.id, version: source.currentVersion } })}::jsonb`,
    }).where(and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, childProjectId), eq(projectNodes.type, 'file'), isNull(projectNodes.deletedAt)))
        .returning({ id: projectNodes.id });
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
        FROM project_nodes c
        LEFT JOIN project_nodes s ON s.id = (c.metadata->'copiedFrom'->>'nodeId')::uuid AND s.project_id = ${ctx.org.id}::uuid AND s.deleted_at IS NULL
        WHERE c.project_id = ${childProjectId}::uuid AND c.deleted_at IS NULL AND c.metadata ? 'copiedFrom'
        ORDER BY c.name
        LIMIT 200
    `);
    return {
        success: true,
        orgTitle: ctx.org.title,
        copies: Array.from(rows).map((r) => ({ nodeId: r.node_id, name: r.name, sourceNodeId: r.source_node_id, copiedVersion: Number(r.copied_version), sourceVersion: r.source_version == null ? null : Number(r.source_version) })),
    };
}
