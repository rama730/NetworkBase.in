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
import { copyState, lateAfterMs } from '@/lib/organizations/assignment-rules';
import { orgGrant, type OrgAction } from '@/lib/organizations/permissions';
import { ASSIGNMENT_STATE_LABELS } from '@/lib/copy/terms';
import { scheduleAssetDeletionIfUnreferenced } from '@/lib/storage/asset-deletion';
import { UUID_RE } from '@/lib/validations/uuid';

// Org Files (report §23): folder access and Template marks for admins; the From <org> view and copies in
// child projects. Reads elsewhere go through orgFileAccessSql / assertFileNodeVisible.

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You don’t have permission to do this." };
type ReadableAccess = Awaited<ReturnType<typeof getWorkspaceAccessById>> & { project: NonNullable<Awaited<ReturnType<typeof getWorkspaceAccessById>>['project']> };

/** The viewer when they own or admin the org; writes refuse a suspended or archived org. */
async function orgAdmin(orgId: string, mode: 'read' | 'write' = 'write', action?: OrgAction) {
    const { userId } = await getViewerAuthContext();
    if (!userId) return null;
    const access = await getWorkspaceAccessById(orgId, userId);
    if (mode === 'write' && access.writeBlocked) return null;
    const role = access.isOwner ? 'owner' as const : access.memberRole === 'admin' ? 'admin' as const : null;
    if (access.project?.kind !== 'organization' || !role || (action && orgGrant(role, action) !== 'yes')) return null;
    return { userId, slug: access.project.slug ?? null };
}

/** The strictest access on a folder and the folders above it. */
async function folderEffectiveAccess(orgId: string, path: string) {
    const rows = await db.select({ metadata: workspaceNodes.metadata }).from(workspaceNodes).where(and(
        eq(workspaceNodes.projectId, orgId), eq(workspaceNodes.type, 'folder'), isNull(workspaceNodes.deletedAt),
        sql`(${workspaceNodes.path} = ${path} OR starts_with(${path}, ${workspaceNodes.path} || '/'))`,
    ));
    return effectiveAccess(rows.map((r) => readFolderAccess(r.metadata)));
}

const isTemplate = (metadata: unknown) => (metadata as { template?: unknown } | null)?.template === true;
const NOT_A_TEMPLATE = 'Admins-only folders can’t be templates. Copying would show them to the team.';

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
    const admin = await orgAdmin(orgId, 'write', 'set_folder_access');
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
        // Decision 61: an Admins-only folder can't be a template, so the mark goes with this change.
        return { success: true, preview: { files: n, message: access === 'admins' && isTemplate(folder.metadata) ? `${message} It stops being a template.` : message } };
    }
    const base = access === 'admins' ? sql`(coalesce(${workspaceNodes.metadata}, '{}'::jsonb) - 'template')` : sql`coalesce(${workspaceNodes.metadata}, '{}'::jsonb)`;
    await db.update(workspaceNodes).set({
        metadata: access ? sql`${base} || ${JSON.stringify({ access })}::jsonb` : sql`${base} - 'access'`,
        updatedAt: new Date(),
    }).where(eq(workspaceNodes.id, folder.id));
    touch(admin.slug, orgId);
    return { success: true };
}

/** The Template mark on a folder (report §23.3). */
export async function setFolderTemplateAction(orgId: string, folderId: string, template: boolean): Promise<{ success: true } | Failure> {
    const admin = await orgAdmin(orgId, 'write', 'set_folder_access');
    if (!admin) return DENIED;
    const folder = await orgFolder(orgId, folderId);
    if (!folder) return { success: false, error: 'That folder is no longer available.' };
    if (template && (await folderEffectiveAccess(orgId, folder.path)) === 'admins') return { success: false, error: NOT_A_TEMPLATE };
    await db.update(workspaceNodes).set({
        metadata: template ? sql`coalesce(${workspaceNodes.metadata}, '{}'::jsonb) || '{"template": true}'::jsonb` : sql`coalesce(${workspaceNodes.metadata}, '{}'::jsonb) - 'template'`,
        updatedAt: new Date(),
    }).where(eq(workspaceNodes.id, folder.id));
    touch(admin.slug, orgId);
    return { success: true };
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
        SELECT DISTINCT s.name AS label FROM sprint_materials m JOIN workspace_sprints s ON s.id = m.sprint_id WHERE m.node_id IN (SELECT id FROM affected)
        UNION SELECT DISTINCT t.title FROM task_node_links l JOIN tasks t ON t.id = l.task_id AND t.deleted_at IS NULL WHERE l.node_id IN (SELECT id FROM affected)
        UNION SELECT DISTINCT 'the ' || a.name || ' template' FROM affected a WHERE a.type = 'folder' AND (a.metadata->>'template')::boolean IS TRUE
        UNION SELECT DISTINCT d.filename FROM workspace_documents d WHERE d.workspace_id = ${orgId} AND d.linked_node_id IN (SELECT id FROM affected)
        LIMIT 20`);
    return rows.map((r) => r.label);
}

/** Org storage for admins (report §23): used of 5 GB, with a warning from 80%. */
export async function readOrgStorageAction(orgId: string): Promise<{ usedBytes: number; limitBytes: number; warn: boolean } | null> {
    // Audit N90: the same permission as the storage breakdown.
    if (!(await orgAdmin(orgId, 'read', 'see_storage'))) return null;
    const [row] = await db.execute<{ used: number | null }>(sql`
        SELECT (retained_bytes + reserved_bytes)::bigint AS used FROM storage_quota_scopes WHERE scope_type = 'project' AND scope_id = ${orgId}`);
    const usedBytes = Number(row?.used ?? 0);
    return { usedBytes, limitBytes: ORG_LIMITS.orgStorageBytes, warn: usedBytes >= ORG_LIMITS.orgStorageBytes * ORG_LIMITS.orgStorageWarnRatio };
}

/** A file as the Files tab's lists show it: name, size, last updated and by whom (files report §1–§2). */
export type BrowserFile = { nodeId: string; name: string; size: number | null; updatedAt: string | null; by: string | null; byAvatarUrl: string | null };
export type SprintMaterialsGroup = { sprintId: string; sprint: string; status: string; startDate: string | null; endDate: string | null;
    /** The CO it sits inside (sprint levels), so the folder reads "CO1 · Week 1" and its CO's materials can be shown with it. */
    parentId: string | null; parentName: string | null; files: BrowserFile[] };

/**
 * Sprint materials (report §23.3): org files linked to each sprint, newest sprint first, filtered by folder access
 * for members and guests. Docs linked to sprints stay on the Docs tab.
 */
export async function readOrgSprintMaterialsAction(orgId: string): Promise<{ success: true; groups: SprintMaterialsGroup[] } | Failure> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return DENIED;
    const access = await getWorkspaceAccessById(orgId, userId);
    if (access.project?.kind !== 'organization' || !(access.isOwner || access.isMember)) return DENIED;
    const rows = await db.select({ sprintId: workspaceSprints.id, sprint: workspaceSprints.name, status: workspaceSprints.status, nodeId: workspaceNodes.id, name: workspaceNodes.name,
            startDate: workspaceSprints.startDate, endDate: workspaceSprints.endDate, parentId: workspaceSprints.parentSprintId,
            parentName: sql<string | null>`(SELECT p.name FROM workspace_sprints p WHERE p.id = ${workspaceSprints.parentSprintId} AND p.workspace_id = ${workspaceSprints.projectId})`,
            size: workspaceNodes.size, updatedAt: workspaceNodes.updatedAt,
            by: sql<string | null>`(SELECT coalesce(p.full_name, p.username) FROM profiles p WHERE p.id = ${workspaceNodes.createdBy})`,
            byAvatarUrl: sql<string | null>`(SELECT p.avatar_url FROM profiles p WHERE p.id = ${workspaceNodes.createdBy})` })
        .from(sprintMaterials)
        .innerJoin(workspaceSprints, eq(workspaceSprints.id, sprintMaterials.sprintId))
        .innerJoin(workspaceNodes, and(eq(workspaceNodes.id, sprintMaterials.nodeId), isNull(workspaceNodes.deletedAt)))
        .where(and(eq(workspaceSprints.projectId, orgId), orgFileAccessSql(access)))
        .orderBy(desc(workspaceSprints.startDate), asc(workspaceNodes.name))
        .limit(500);
    const groups = new Map<string, SprintMaterialsGroup>();
    for (const r of rows) {
        const group = groups.get(r.sprintId) ?? { sprintId: r.sprintId, sprint: r.sprint, status: r.status, startDate: r.startDate ? new Date(r.startDate).toISOString() : null,
            endDate: r.endDate ? new Date(r.endDate).toISOString() : null, parentId: r.parentName ? r.parentId : null, parentName: r.parentName, files: [] };
        group.files.push({ nodeId: r.nodeId, name: r.name, size: r.size == null ? null : Number(r.size), updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null, by: r.by, byAvatarUrl: r.byAvatarUrl });
        groups.set(r.sprintId, group);
    }
    return { success: true, groups: [...groups.values()] };
}

/** Template folders a member may start a child project from (report §23.3 Template mark, §23.6). */
export async function listOrgTemplateFoldersAction(orgId: string): Promise<Array<{ id: string; name: string }>> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return [];
    const access = await getWorkspaceAccessById(orgId, userId);
    if (access.project?.kind !== 'organization' || !(access.isOwner || access.isMember)) return [];
    return db.select({ id: workspaceNodes.id, name: workspaceNodes.name }).from(workspaceNodes)
        .where(and(eq(workspaceNodes.projectId, orgId), eq(workspaceNodes.type, 'folder'), isNull(workspaceNodes.deletedAt),
            sql`(${workspaceNodes.metadata}->>'template')::boolean IS TRUE`, orgFileAccessSql(access),
            // Report §28.5, decision 61: never an Admins-only folder (or one inside it), never an empty one.
            sql`NOT EXISTS (SELECT 1 FROM workspace_nodes a WHERE a.workspace_id = ${orgId} AND a.type = 'folder' AND a.deleted_at IS NULL
                AND a.metadata->>'access' = 'admins' AND (a.path = ${workspaceNodes.path} OR starts_with(${workspaceNodes.path}, a.path || '/')))`,
            sql`EXISTS (SELECT 1 FROM workspace_nodes f WHERE f.workspace_id = ${orgId} AND f.type = 'file' AND f.deleted_at IS NULL
                AND starts_with(f.path, ${workspaceNodes.path} || '/'))`))
        .orderBy(asc(workspaceNodes.name)).limit(50);
}

export type SubmissionRow = { copyId: string; who: string; files: number; version: number | null; submittedAt: string | null; late: boolean; status: string;
    /** Files report §1: who handed it in (a team's member), where the copy lives, and the person's photo. */
    by: string | null; projectId: string; avatarUrl: string | null; team: boolean };
export type SubmissionGroup = { id: string; title: string; dueDate: string | null; rows: SubmissionRow[]; reviewRequired: boolean; closed: boolean };

/**
 * The Submissions page (report §37.5; "Final files" for other types): per assignment, each person or group with
 * their files, version, when, Late and status. Admins only; members use My work → Submitted.
 */
export async function readOrgSubmissionsAction(orgId: string): Promise<{ success: true; assignments: SubmissionGroup[]; truncated: boolean } | Failure> {
    if (!(await orgAdmin(orgId, 'read', 'download_all'))) return DENIED;
    const rows = await db.execute<{ master_id: string; title: string; master_due: string | null; copy_id: string; who: string; files: number; version: number | null;
        status: string; review_status: string; due_date: string | null; submitted_at: string | null; completed_at: string | null; excused_at: string | null;
        by: string | null; project_id: string; avatar_url: string | null; team: boolean; review_required: boolean; closed: boolean; late_after: number | null }>(sql`
        SELECT m.id AS master_id, m.title, m.due_date::text AS master_due, c.id AS copy_id, c.workspace_id AS project_id,
               (m.assignment_settings->>'lateAfterMinutes')::int AS late_after,
               (SELECT coalesce(pr.full_name, pr.username) FROM profiles pr WHERE pr.id = (c.submission->>'by')::uuid) AS by,
               (SELECT pr.avatar_url FROM profiles pr WHERE pr.id = c.assignee_id AND c.team_name IS NULL) AS avatar_url,
               (c.team_name IS NOT NULL OR c.workspace_id <> m.workspace_id) AS team,
               coalesce((m.assignment_settings->>'reviewRequired')::boolean, true) AS review_required, (m.assignment_settings->>'closedAt') IS NOT NULL AS closed,
               coalesce(c.team_name, (SELECT p.title FROM workspaces p WHERE p.id = c.workspace_id AND p.id <> m.workspace_id),
                        (SELECT coalesce(pr.full_name, pr.username) FROM profiles pr WHERE pr.id = c.assignee_id), 'Member') AS who,
               (SELECT count(*)::int FROM workspace_nodes n WHERE n.task_id = c.id AND n.type = 'file' AND n.deleted_at IS NULL) AS files,
               (c.submission->>'version')::int AS version, c.status, c.review_status, c.due_date::text AS due_date,
               c.review_submitted_at::text AS submitted_at, c.completed_at::text AS completed_at, c.excused_at::text AS excused_at
        FROM tasks m JOIN tasks c ON c.assignment_id = m.id AND c.deleted_at IS NULL
        WHERE m.workspace_id = ${orgId} AND m.kind = 'assignment' AND m.deleted_at IS NULL
        ORDER BY m.due_date DESC NULLS LAST, m.title, 5
        LIMIT 5001`);
    const groups = new Map<string, SubmissionGroup>();
    const at = (v: string | null) => (v ? new Date(v) : null);
    for (const r of rows) {
        // Audit N76: each assignment's own Late after, as its roster and list use.
        const { state, late } = copyState({ status: r.status, reviewStatus: r.review_status, dueDate: at(r.due_date), submittedAt: at(r.submitted_at), completedAt: at(r.completed_at), excusedAt: at(r.excused_at) }, new Date(), lateAfterMs({ lateAfterMinutes: r.late_after ?? undefined }));
        const group = groups.get(r.master_id) ?? { id: r.master_id, title: r.title, dueDate: r.master_due, rows: [], reviewRequired: r.review_required, closed: r.closed };
        // Files report D2: accepted work reads Approved when the assignment needs review, as on the board.
        const status = state === 'done' && r.review_required ? 'Approved' : ASSIGNMENT_STATE_LABELS[state];
        group.rows.push({ copyId: r.copy_id, who: r.who, files: r.files, version: r.version, submittedAt: r.submitted_at ?? r.completed_at, late, status,
            by: r.by, projectId: r.project_id, avatarUrl: r.avatar_url, team: r.team });
        groups.set(r.master_id, group);
    }
    // Audit 10.3: past 5,000 hand-ins the newest assignments are listed whole and the cut-off one is left out, never
    // shown half; the page says older ones aren't listed.
    const truncated = rows.length > 5000;
    const assignments = [...groups.values()];
    if (truncated && assignments.length > 1) assignments.pop();
    return { success: true, assignments, truncated };
}

/**
 * Files report §1 level 3: one hand-in's files (as the Files tab lists them) and its earlier versions (D3). Admins who
 * may download submissions, as Submissions itself; group work is read where it lives (the copy's own workspace).
 */
export async function readHandInFilesAction(copyId: string): Promise<{ success: true; projectId: string; current: BrowserFile[]; versions: Array<{ version: number; at: string; files: BrowserFile[] }> } | Failure> {
    if (!UUID_RE.test(copyId)) return DENIED;
    const [copy] = await db.execute<{ org_id: string; project_id: string; version: number | null }>(sql`
        SELECT m.workspace_id AS org_id, c.workspace_id AS project_id, (c.submission->>'version')::int AS version
        FROM tasks c JOIN tasks m ON m.id = c.assignment_id WHERE c.id = ${copyId} AND c.deleted_at IS NULL AND m.deleted_at IS NULL`);
    if (!copy || !(await orgAdmin(copy.org_id, 'read', 'download_all'))) return DENIED;
    const fileCols = sql`n.id AS node_id, n.name, n.size, n.updated_at::text AS updated_at,
        (SELECT coalesce(p.full_name, p.username) FROM profiles p WHERE p.id = n.created_by) AS by, (SELECT p.avatar_url FROM profiles p WHERE p.id = n.created_by) AS by_avatar`;
    type F = { node_id: string; name: string; size: number | null; updated_at: string | null; by: string | null; by_avatar: string | null };
    const asFile = (f: F): BrowserFile => ({ nodeId: f.node_id, name: f.name, size: f.size == null ? null : Number(f.size), updatedAt: f.updated_at ? new Date(f.updated_at).toISOString() : null, by: f.by, byAvatarUrl: f.by_avatar });
    const current = await db.execute<F>(sql`SELECT ${fileCols} FROM workspace_nodes n WHERE n.task_id = ${copyId} AND n.type = 'file' AND n.deleted_at IS NULL ORDER BY n.name LIMIT 200`);
    const older = await db.execute<F & { version: number; at: string }>(sql`
        SELECT s.version, s.submitted_at::text AS at, ${fileCols}
        FROM assignment_submissions s CROSS JOIN jsonb_array_elements(s.files) f JOIN workspace_nodes n ON n.id = (f->>'nodeId')::uuid AND n.deleted_at IS NULL
        WHERE s.copy_id = ${copyId} AND s.version < coalesce(${copy.version}, 2147483647) ORDER BY s.version DESC, n.name`);
    const versions = new Map<number, { version: number; at: string; files: BrowserFile[] }>();
    for (const r of older) {
        const v = versions.get(r.version) ?? { version: r.version, at: new Date(r.at).toISOString(), files: [] };
        v.files.push(asFile(r));
        versions.set(r.version, v);
    }
    return { success: true, projectId: copy.project_id, current: current.map(asFile), versions: [...versions.values()] };
}

export type ChildFinalFileRow = { nodeId: string; name: string; assignment: string; review: string;
    /** Files report §1 (Final files the same way): grouped by assignment, with the list's columns. */
    assignmentId: string; size: number | null; updatedAt: string | null; by: string | null };

/** A workspace's Final files (report §18.6): its group work handed in, with "Reviewed by CSE 3B" once completed. */
export async function readChildFinalFilesAction(childProjectId: string): Promise<{ success: true; orgTitle: string; rows: ChildFinalFileRow[] } | Failure> {
    const { userId } = await getViewerAuthContext();
    if (!userId || !UUID_RE.test(childProjectId)) return DENIED;
    const access = await getWorkspaceAccessById(childProjectId, userId);
    const [org] = access.project?.parentId ? await db.select({ id: workspaces.id, title: workspaces.title }).from(workspaces).where(eq(workspaces.id, access.project.parentId)).limit(1) : [];
    const orgRole = org ? await readViewerOrgRole(org.id, userId) : null;
    if (!org || !(access.isOwner || access.isMember || orgRole === 'owner' || orgRole === 'admin')) return DENIED;
    const rows = await db.execute<{ node_id: string; name: string; assignment: string; status: string; review_status: string; due_date: string | null; submitted_at: string | null; completed_at: string | null; excused_at: string | null;
        assignment_id: string; size: number | null; updated_at: string | null; by: string | null }>(sql`
        SELECT n.id AS node_id, n.name, m.title AS assignment, m.id AS assignment_id, n.size, n.updated_at::text AS updated_at,
               (SELECT coalesce(p.full_name, p.username) FROM profiles p WHERE p.id = n.created_by) AS by,
               c.status, c.review_status, c.due_date::text AS due_date,
               c.review_submitted_at::text AS submitted_at, c.completed_at::text AS completed_at, c.excused_at::text AS excused_at
        FROM tasks c JOIN tasks m ON m.id = c.assignment_id AND m.workspace_id = ${org.id}
        JOIN workspace_nodes n ON n.task_id = c.id AND n.type = 'file' AND n.deleted_at IS NULL
        WHERE c.workspace_id = ${childProjectId} AND c.deleted_at IS NULL
        ORDER BY m.title, n.name LIMIT 500`);
    const at = (v: string | null) => (v ? new Date(v) : null);
    return {
        success: true, orgTitle: org.title,
        rows: rows.map((r) => {
            const { state } = copyState({ status: r.status, reviewStatus: r.review_status, dueDate: at(r.due_date), submittedAt: at(r.submitted_at), completedAt: at(r.completed_at), excusedAt: at(r.excused_at) });
            return { nodeId: r.node_id, name: r.name, assignment: r.assignment, review: state === 'done' ? `Reviewed by ${org.title}` : ASSIGNMENT_STATE_LABELS[state],
                assignmentId: r.assignment_id, size: r.size == null ? null : Number(r.size), updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null, by: r.by };
        }),
    };
}

export type OrgStorageBreakdown = {
    usedBytes: number
    limitBytes: number
    byType: Record<'documents' | 'images' | 'video' | 'code' | 'submissions' | 'other', number>
    trashBytes: number
    largeFiles: number
    oldVersionBytes: number
    byWorkspace: Array<{ id: string; title: string; bytes: number }>
}

const LARGE_FILE_BYTES = 100 * 1024 * 1024;

/** Versions beyond the latest 3 of the organization's own files; hand-ins keep their whole history. */
const OLD_VERSIONS = (orgId: string) => sql`
    SELECT v.id, v.node_id, v.size, v.asset_id FROM (
        SELECT v.*, row_number() OVER (PARTITION BY v.node_id ORDER BY v.version DESC) AS rn, n.current_version
        FROM file_versions v JOIN workspace_nodes n ON n.id = v.node_id
        WHERE n.workspace_id = ${orgId} AND n.deleted_at IS NULL AND n.task_id IS NULL) v
    WHERE v.rn > 3 AND v.version <> v.current_version`;

/** One file's storage type, for a node aliased `n`: the same groups the bar shows. */
const FILE_KIND = sql`CASE WHEN n.task_id IS NOT NULL AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = n.task_id AND t.assignment_id IS NOT NULL) THEN 'submissions'
                     WHEN n.mime_type LIKE 'image/%' THEN 'images'
                     WHEN n.mime_type LIKE 'video/%' THEN 'video'
                     WHEN n.mime_type IN ('application/pdf', 'text/plain', 'text/markdown', 'application/rtf', 'application/msword')
                       OR n.mime_type LIKE 'application/vnd.openxmlformats%' OR n.mime_type LIKE 'application/vnd.ms-%' OR n.mime_type LIKE 'application/vnd.oasis.opendocument%' THEN 'documents'
                     WHEN n.mime_type LIKE 'text/%' OR n.mime_type IN ('application/json', 'application/javascript', 'application/xml', 'application/x-sh') THEN 'code'
                     ELSE 'other' END`;

const STORAGE_KINDS = ['documents', 'images', 'video', 'code', 'other'] as const;

/** A By type row opened (step 9 gap): that type's 20 largest files, each opening in Files. Admins only. */
export async function readOrgStorageFilesAction(orgId: string, kind: (typeof STORAGE_KINDS)[number]): Promise<{ success: true; files: Array<{ id: string; name: string; path: string; size: number }> } | Failure> {
    if (!(STORAGE_KINDS as readonly string[]).includes(kind) || !(await orgAdmin(orgId, 'read', 'see_storage'))) return DENIED;
    const files = await db.execute<{ id: string; name: string; path: string; size: number }>(sql`
        SELECT n.id, n.name, n.path, coalesce(n.size, 0)::bigint AS size FROM workspace_nodes n
        WHERE n.workspace_id = ${orgId} AND n.type = 'file' AND n.deleted_at IS NULL AND ${FILE_KIND} = ${kind}
        ORDER BY n.size DESC NULLS LAST LIMIT 20`);
    return { success: true, files: Array.from(files).map((f) => ({ ...f, size: Number(f.size) })) };
}

/**
 * Settings → Storage (report §7.12): the bar by type, recommendations that say what they free, and each workspace's
 * own use, read only (team storage stays separate, 19.2). Admins only.
 */
export async function readOrgStorageBreakdownAction(orgId: string): Promise<{ success: true; storage: OrgStorageBreakdown } | Failure> {
    if (!(await orgAdmin(orgId, 'read', 'see_storage'))) return DENIED;
    // ponytail: summed on open, one query per part. Upgrade: cache the type totals when organizations get large.
    const [types] = await db.execute<{ documents: number; images: number; video: number; code: number; submissions: number; other: number; trash: number; large: number }>(sql`
        WITH f AS (
            SELECT n.size, n.deleted_at, ${FILE_KIND} AS kind
            FROM workspace_nodes n WHERE n.workspace_id = ${orgId} AND n.type = 'file')
        SELECT ${sql.join((['documents', 'images', 'video', 'code', 'submissions', 'other'] as const).map((k) => sql`coalesce(sum(size) FILTER (WHERE deleted_at IS NULL AND kind = ${k}), 0)::bigint AS ${sql.raw(k)}`), sql`, `)},
               coalesce(sum(size) FILTER (WHERE deleted_at IS NOT NULL), 0)::bigint AS trash,
               count(*) FILTER (WHERE deleted_at IS NULL AND size > ${LARGE_FILE_BYTES})::int AS large
        FROM f`);
    const [old] = await db.execute<{ bytes: number }>(sql`SELECT coalesce(sum(size), 0)::bigint AS bytes FROM (${OLD_VERSIONS(orgId)}) o`);
    const [quota] = await db.execute<{ used: number | null }>(sql`SELECT (retained_bytes + reserved_bytes)::bigint AS used FROM storage_quota_scopes WHERE scope_type = 'project' AND scope_id = ${orgId}`);
    const children = await db.execute<{ id: string; title: string; bytes: number }>(sql`
        SELECT w.id, w.title, coalesce(q.retained_bytes, 0)::bigint AS bytes FROM workspaces w
        LEFT JOIN storage_quota_scopes q ON q.scope_type = 'project' AND q.scope_id = w.id
        WHERE w.parent_id = ${orgId} AND w.deleted_at IS NULL ORDER BY 3 DESC, w.title LIMIT 200`);
    const n = (v: unknown) => Number(v ?? 0);
    return {
        success: true,
        storage: {
            usedBytes: n(quota?.used),
            limitBytes: ORG_LIMITS.orgStorageBytes,
            byType: { documents: n(types?.documents), images: n(types?.images), video: n(types?.video), code: n(types?.code), submissions: n(types?.submissions), other: n(types?.other) },
            trashBytes: n(types?.trash),
            largeFiles: n(types?.large),
            oldVersionBytes: n(old?.bytes),
            byWorkspace: children.map((c) => ({ id: c.id, title: c.title, bytes: n(c.bytes) })),
        },
    };
}

/** Review large files (report §37.5): the organization's biggest files, largest first, to open or move to Trash. */
export async function readLargeFilesAction(orgId: string): Promise<{ success: true; files: Array<{ id: string; name: string; path: string; size: number }> } | Failure> {
    if (!(await orgAdmin(orgId, 'read', 'see_storage'))) return DENIED;
    const files = await db.select({ id: workspaceNodes.id, name: workspaceNodes.name, path: workspaceNodes.path, size: workspaceNodes.size }).from(workspaceNodes)
        .where(and(eq(workspaceNodes.projectId, orgId), eq(workspaceNodes.type, 'file'), isNull(workspaceNodes.deletedAt), sql`${workspaceNodes.size} IS NOT NULL`))
        .orderBy(desc(workspaceNodes.size)).limit(50);
    return { success: true, files: files.map((f) => ({ ...f, size: Number(f.size ?? 0) })) };
}

/**
 * Old versions → Keep latest 3 (report §37.5): without `confirm` it says what goes; with it, older versions of the
 * organization's own files are removed. Hand-ins keep every version, and the current version always stays.
 */
export async function keepLatestVersionsAction(orgId: string, confirm: boolean): Promise<{ success: true; files: number; versions: number; bytes: number } | Failure> {
    if (!(await orgAdmin(orgId, 'write', 'see_storage'))) return DENIED;
    return db.transaction(async (tx) => {
        const rows = Array.from(await tx.execute<{ id: string; node_id: string; size: number; asset_id: string | null }>(OLD_VERSIONS(orgId)));
        const summary = { success: true as const, files: new Set(rows.map((r) => r.node_id)).size, versions: rows.length, bytes: rows.reduce((sum, r) => sum + Number(r.size), 0) };
        if (!confirm || rows.length === 0) return summary;
        await tx.execute(sql`DELETE FROM file_versions WHERE id IN ${rows.map((r) => r.id)}`);
        const assets = rows.map((r) => r.asset_id).filter((id): id is string => Boolean(id));
        if (assets.length) await scheduleAssetDeletionIfUnreferenced(tx, assets, { lastErrorCode: "FILE_VERSION_DETACHED" });
        return summary;
    });
}
