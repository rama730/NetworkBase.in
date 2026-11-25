'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db';
import { docOpens, workspaceDocuments, workspaceMembers, workspaceNodes, workspaceOpenRoles, workspaces, workspaceSprints, sprintMaterials } from '@/lib/db/schema';
import { getWorkspaceAccessById } from '@/lib/data/workspace-access';
import { enqueueWorkspaceNotificationEvent } from '@/lib/notifications/workspace-events';
import { ORG_LIMITS } from '@/lib/organizations/config';
import { readViewerOrgRole } from '@/lib/organizations/detail';
import { orgGrant, type OrgAction } from '@/lib/organizations/permissions';
import { docFileName, docLabel, docState, docTitle, fillDocTemplate, needsReview, nextReviewBy, readDocGroups, readOrgDocOptions, templateCopyTitle, type DocGroup, type OrgDocOptions } from '@/lib/organizations/doc-rules';
import { getOrBuildWorkspaceDocPublishMetadata } from '@/lib/workspaces/doc';
import { readWorkspaceFileText } from '@/lib/files/content-reader';
import { notifyOrg, orgHref, orgLabel, remindedRecently } from '@/lib/organizations/notify';
import { workspaceDocumentVersions } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import { normalizeWorkspaceDocSettings } from '@/lib/workspaces/doc';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { listWorkspaceDocsAction, readWorkspaceDocAction } from '@/app/actions/workspace/doc';
import { createFolder } from '@/app/actions/files/mutations';

// Org Docs (report §19): groups, Required / Template / Show in child projects, New and Updated labels,
// Publish & notify, the From <org> section in child projects, and template copies.

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You don’t have permission to do this." };

export type OrgDocItem = OrgDocOptions & {
    id: string; slug: string; filename: string; label: 'new' | 'updated' | null; sprint: string | null; sprintId: string | null
    /** Admins (report §37.4): Draft, Published, or Published with changes waiting. Members always get 'published'. */
    state: 'draft' | 'published' | 'changed'
    /** Admins on Required documents (report §28.4, decision 58): members who opened it at this re-read version. */
    readers: { read: number; total: number } | null
    /** Report 33.2 (B4.1): past Review by (never hidden), the owner's name, and an owner who left the organization. */
    needsReview: boolean
    ownerName: string | null
    ownerGone: boolean
}
export type OrgDocsData = {
    mode: 'org' | 'child';
    orgId: string;
    orgTitle: string;
    orgSlug: string | null;
    isAdmin: boolean;
    /** In the organization (any role); visitors aren't. */
    isInside: boolean;
    /** Members counted for Read by and Tell members (report §28.4, §37.4). Admins only. */
    memberCount: number;
    /** Signed in: opens are recorded and labels shown. */
    signedIn: boolean;
    groups: DocGroup[];
    docs: OrgDocItem[];
    /** Admins link a doc to one of these (report §19.3 Linked sprint). */
    sprints: Array<{ id: string; name: string }>;
    /** Report 33.2 (B4.1): the viewer (page owners publish and review their pages), the handbook's review cycle in
     * months (0 = off), and, for admins, the people who can own a page. */
    viewerId: string | null;
    reviewMonths: number;
    people: Array<{ id: string; name: string }>;
};

async function readOrg(orgId: string) {
    const [org] = await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, orgSettings: workspaces.orgSettings, timeZone: workspaces.timeZone, orgType: workspaces.orgType })
        .from(workspaces).where(and(eq(workspaces.id, orgId), eq(workspaces.kind, 'organization'), isNull(workspaces.deletedAt))).limit(1);
    return org ?? null;
}

/** The viewer when they own or admin `orgId` (an org, with the flag on), and the permissions table gives them `action`. */
async function orgAdmin(orgId: string, action?: OrgAction) {
    const { userId } = await getViewerAuthContext();
    const role = userId ? await readViewerOrgRole(orgId, userId) : null;
    if (!userId || (role !== 'owner' && role !== 'admin')) return null;
    return !action || orgGrant(role, action) === 'yes' ? userId : null;
}

async function orgDocRow(orgId: string, docId: string) {
    const [doc] = await db.select({ id: workspaceDocuments.id, slug: workspaceDocuments.slug, filename: workspaceDocuments.filename, settings: workspaceDocuments.settings, linkedNodeId: workspaceDocuments.linkedNodeId })
        .from(workspaceDocuments).where(and(eq(workspaceDocuments.id, docId), eq(workspaceDocuments.projectId, orgId))).limit(1);
    return doc ?? null;
}

async function writeOrgOptions(docId: string, settings: unknown, patch: Partial<OrgDocOptions>, extra: Record<string, unknown> = {}) {
    // Audit N85: read and write under the row lock, so a publish in between isn't overwritten with older settings.
    void settings;
    await db.transaction(async (tx) => {
        const [fresh] = await tx.select({ settings: workspaceDocuments.settings }).from(workspaceDocuments).where(eq(workspaceDocuments.id, docId)).for('update');
        const current = normalizeWorkspaceDocSettings(fresh?.settings);
        await tx.update(workspaceDocuments).set({
            settings: { ...current, ...extra, org: { ...(current.org ?? {}), ...patch } },
            updatedAt: new Date(),
        }).where(eq(workspaceDocuments.id, docId));
    });
}

const touch = (slug: string | null, id: string) => revalidatePath(`/org/${slug ?? id}`);

const reviewMonthsOf = (settings: unknown) => { const m = (settings as { handbook?: { reviewMonths?: unknown } } | null)?.handbook?.reviewMonths; return m === 6 || m === 12 ? m : 0; };
const todayUtc = () => new Date().toISOString().slice(0, 10);

/** People who can own a handbook page: the org's owner and its members other than Viewers. */
async function pageOwners(orgId: string) {
    return Array.from(await db.execute<{ id: string; name: string | null }>(sql`
        SELECT p.id, coalesce(p.full_name, p.username) AS name FROM profiles p
        WHERE p.id IN (SELECT owner_id FROM workspaces WHERE id = ${orgId}::uuid UNION SELECT user_id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND role <> 'viewer') ORDER BY 2`))
        .map((p) => ({ id: p.id, name: p.name ?? 'Someone' }));
}

/** An admin, or the page's owner while they're still in the organization (report 33.2 People: owners edit, publish, mark Still correct). */
async function adminOrPageOwner(orgId: string, doc: { settings: unknown }, action?: OrgAction) {
    const admin = await orgAdmin(orgId, action);
    if (admin) return admin;
    const { userId } = await getViewerAuthContext();
    const owner = readOrgDocOptions(normalizeWorkspaceDocSettings(doc.settings).org).owner;
    return userId && owner === userId && (await pageOwners(orgId)).some((p) => p.id === userId) ? userId : null;
}

/**
 * The org's docs with their options and the viewer's labels. In a child project: the From <org> section,
 * for org people only (outside people never see it, report §19.7). Null when neither applies.
 */
export async function readOrgDocsAction(projectId: string): Promise<{ success: true; data: OrgDocsData | null } | Failure> {
    const { userId } = await getViewerAuthContext();
    const [project] = await db.select({ id: workspaces.id, kind: workspaces.kind, parentId: workspaces.parentId })
        .from(workspaces).where(and(eq(workspaces.id, projectId), isNull(workspaces.deletedAt))).limit(1);
    const mode = project?.kind === 'organization' ? 'org' : project?.parentId ? 'child' : null;
    const orgId = mode === 'org' ? project!.id : project?.parentId ?? null;
    if (!mode || !orgId) return { success: true, data: null };
    const [org, role] = await Promise.all([readOrg(orgId), readViewerOrgRole(orgId, userId)]);
    if (!org || (mode === 'child' && !role)) return { success: true, data: null };

    const listed = await listWorkspaceDocsAction(orgId);
    if (!listed.success) return { success: false, error: listed.error };
    const ids = listed.docs.map((d) => d.id);
    const groups = readDocGroups((org.orgSettings as { docGroups?: unknown } | null)?.docGroups, org.orgType);
    const [rows, opens, sprints] = ids.length === 0 ? [[], [], []] : await Promise.all([
        db.select({ id: workspaceDocuments.id, settings: workspaceDocuments.settings, updatedAt: workspaceNodes.updatedAt, linkedNodeId: workspaceDocuments.linkedNodeId,
            publishedVersionId: workspaceDocuments.publishedVersionId,
            latestVersionId: sql<string | null>`(SELECT v.id FROM workspace_document_versions v WHERE v.doc_id = ${workspaceDocuments.id} ORDER BY v.version_number DESC LIMIT 1)` })
            .from(workspaceDocuments).leftJoin(workspaceNodes, eq(workspaceNodes.id, workspaceDocuments.linkedNodeId)).where(inArray(workspaceDocuments.id, ids)),
        userId ? db.select({ docId: docOpens.docId, version: docOpens.version, at: docOpens.openedAt }).from(docOpens)
            .where(and(eq(docOpens.userId, userId), inArray(docOpens.docId, ids))) : Promise.resolve([]),
        db.select({ docId: sprintMaterials.docId, name: workspaceSprints.name, sprintId: workspaceSprints.id }).from(sprintMaterials)
            .innerJoin(workspaceSprints, eq(workspaceSprints.id, sprintMaterials.sprintId)).where(inArray(sprintMaterials.docId, ids)),
    ]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const openById = new Map(opens.map((o) => [o.docId, o]));
    const sprintById = new Map(sprints.map((s) => [s.docId, s]));
    const isAdmin = role === 'owner' || role === 'admin';
    const people = mode === 'org' && role ? await pageOwners(orgId) : [];
    const nameOf = new Map(people.map((p) => [p.id, p.name]));
    const today = todayUtc();
    // Read by N of M (report §28.4): members only; owners, admins and viewers aren't counted.
    const readers = isAdmin && mode === 'org' ? await readRequiredReaders(orgId, rows.filter((r) => readOrgDocOptions(normalizeWorkspaceDocSettings(r.settings).org).required).map((r) => r.id)) : new Map<string, { read: number; total: number }>();
    const docs = listed.docs.flatMap((d): OrgDocItem[] => {
        const row = byId.get(d.id);
        const options = readOrgDocOptions(normalizeWorkspaceDocSettings(row?.settings).org, groups);
        if (mode === 'child' && (!options.showInChildren || options.lifecycle === 'draft')) return [];
        const opened = openById.get(d.id);
        const state = docState({ lifecycle: options.lifecycle, publishedAt: options.publishedAt, fileUpdatedAt: row?.updatedAt ?? null, latestVersionId: row?.latestVersionId ?? null, publishedVersionId: row?.publishedVersionId ?? null, linked: Boolean(row?.linkedNodeId) });
        // Members see "Updated" from the publish, not from edits still waiting (report §37.4).
        const changedAt = options.lifecycle === 'published' && options.publishedAt ? new Date(options.publishedAt) : row?.updatedAt ?? null;
        return [{
            id: d.id, slug: d.slug, filename: d.filename, ...options,
            label: userId ? docLabel({ readVersion: options.readVersion, opened: opened ? { version: opened.version, at: opened.at } : null, updatedAt: changedAt }) : null,
            sprint: sprintById.get(d.id)?.name ?? null,
            sprintId: sprintById.get(d.id)?.sprintId ?? null,
            state: isAdmin || (userId && options.owner === userId && nameOf.has(userId)) ? state : 'published',
            readers: readers.get(d.id) ?? null,
            needsReview: needsReview(options.reviewBy, today),
            ownerName: options.owner ? nameOf.get(options.owner) ?? null : null,
            ownerGone: Boolean(options.owner && mode === 'org' && !nameOf.has(options.owner)),
        }];
    });
    const linkable = mode === 'org' && isAdmin
        ? await db.select({ id: workspaceSprints.id, name: workspaceSprints.name }).from(workspaceSprints)
            .where(and(eq(workspaceSprints.projectId, orgId), inArray(workspaceSprints.status, ['planning', 'active']))).orderBy(workspaceSprints.startDate)
        : [];
    const [members] = isAdmin ? await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = ${orgId} AND role IN ('member', 'viewer')`) : [];
    return { success: true, data: { mode, orgId, orgTitle: org.title, orgSlug: org.slug, isAdmin, isInside: Boolean(role), memberCount: members?.n ?? 0, signedIn: Boolean(userId), groups, docs, sprints: linkable,
        viewerId: userId ?? null, reviewMonths: reviewMonthsOf(org.orgSettings), people: isAdmin ? people : [] } };
}

const optionsSchema = z.object({
    group: z.string().max(40).optional(),
    required: z.boolean().optional(),
    template: z.boolean().optional(),
    showInChildren: z.boolean().optional(),
    visibility: z.enum(['members_only', 'public']).optional(),
    /** Linked sprint: the doc joins that sprint's Materials, which gives it the sprint chip. */
    sprintId: z.string().uuid().nullable().optional(),
    /** Report 33.2 call 3: the page's owner and Review by (YYYY-MM-DD), or none. */
    owner: z.string().uuid().nullable().optional(),
    reviewBy: z.string().date().nullable().optional(),
}).strict();

/** Group, Required, Template, Show in child projects and visibility for one org doc (owners and admins). */
export async function updateOrgDocOptionsAction(orgId: string, docId: string, input: z.input<typeof optionsSchema>): Promise<{ success: true } | Failure> {
    const adminId = await orgAdmin(orgId);
    if (!adminId) return DENIED;
    const parsed = optionsSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'Check the doc options.' };
    const doc = await orgDocRow(orgId, docId);
    if (!doc) return { success: false, error: 'That doc is no longer available.' };
    const { visibility, sprintId, ...patch } = parsed.data;
    const org = await readOrg(orgId);
    // Report §37.4: Public only when the organization itself is public.
    if (visibility === 'public' && org && !(await orgIsPublic(orgId))) return { success: false, error: `${org.title} is private, so its documents can’t be public.` };
    // A template moves to the Templates group unless a group is chosen too (report §37.4).
    if (patch.template === true && patch.group === undefined && readDocGroups((org?.orgSettings as { docGroups?: unknown } | null)?.docGroups, org?.orgType).some((g) => g.id === 'templates')) patch.group = 'templates';
    if (patch.owner && !(await pageOwners(orgId)).some((p) => p.id === patch.owner)) return { success: false, error: 'Pick someone in the organization as the owner.' };
    if (sprintId !== undefined) {
        const [sprint] = sprintId ? await db.select({ id: workspaceSprints.id }).from(workspaceSprints)
            .where(and(eq(workspaceSprints.id, sprintId), eq(workspaceSprints.projectId, orgId))).limit(1) : [];
        if (sprintId && !sprint) return { success: false, error: 'That sprint is no longer available.' };
        await db.transaction(async (tx) => {
            await tx.delete(sprintMaterials).where(and(eq(sprintMaterials.docId, doc.id),
                inArray(sprintMaterials.sprintId, db.select({ id: workspaceSprints.id }).from(workspaceSprints).where(eq(workspaceSprints.projectId, orgId)))));
            if (sprint) await tx.insert(sprintMaterials).values({ sprintId: sprint.id, docId: doc.id, addedBy: adminId });
        });
    }
    if (Object.keys(patch).length > 0 || visibility) await writeOrgOptions(doc.id, doc.settings, patch, visibility ? { visibilityOverride: visibility } : {});
    touch(org?.slug ?? null, orgId);
    return { success: true };
}

const publishSchema = z.object({ summary: z.string().trim().max(200), reread: z.boolean(), notify: z.boolean() }).strict();

/**
 * Publish (report §37.4, decision 101): the document as it is now becomes what members read, with "What changed" in
 * its history. Telling members is off unless chosen; Ask to re-read counts again from zero (Required only).
 */
export async function publishOrgDocAction(orgId: string, docId: string, input: z.input<typeof publishSchema>): Promise<{ success: true } | Failure> {
    const parsed = publishSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'Keep the summary under 200 characters.' };
    const [doc, org] = await Promise.all([orgDocRow(orgId, docId), readOrg(orgId)]);
    if (!doc || !org) return { success: false, error: 'That doc is no longer available.' };
    const userId = await adminOrPageOwner(orgId, doc, 'publish_document');
    if (!userId) return DENIED;
    const options = readOrgDocOptions(normalizeWorkspaceDocSettings(doc.settings).org);
    let content: string | null = null;
    if (doc.linkedNodeId) {
        const access = await getWorkspaceAccessById(orgId, userId);
        if (!access.project) return DENIED;
        content = await readWorkspaceFileText({ ...access, project: access.project }, orgId, doc.linkedNodeId).catch(() => null);
    } else {
        const [latest] = await db.select({ content: workspaceDocumentVersions.content }).from(workspaceDocumentVersions)
            .where(eq(workspaceDocumentVersions.docId, doc.id)).orderBy(desc(workspaceDocumentVersions.versionNumber)).limit(1);
        content = latest?.content ?? null;
    }
    if (content === null) return { success: false, error: 'Couldn’t read the document to publish it. Try again.' };
    const metadata = getOrBuildWorkspaceDocPublishMetadata(content);
    const now = new Date();
    await db.transaction(async (tx) => {
        // Audit N86, N85: the document row is locked and its settings read here, so two publishes (or a publish and an
        // options change) can't race to the same version number or overwrite each other's settings.
        const [fresh] = await tx.select({ settings: workspaceDocuments.settings }).from(workspaceDocuments).where(eq(workspaceDocuments.id, doc.id)).for('update');
        const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`coalesce(max(${workspaceDocumentVersions.versionNumber}), 0)::int` }).from(workspaceDocumentVersions).where(eq(workspaceDocumentVersions.docId, doc.id));
        const [version] = await tx.insert(workspaceDocumentVersions).values({
            projectId: orgId, docId: doc.id, versionNumber: n + 1, content: metadata.content, excerpt: metadata.excerpt, headings: metadata.headings,
            qualityReport: metadata.qualityReport, contentHash: metadata.contentHash, changeSummary: parsed.data.summary || 'Published', createdBy: userId,
        }).returning({ id: workspaceDocumentVersions.id });
        const current = normalizeWorkspaceDocSettings(fresh?.settings ?? doc.settings);
        await tx.update(workspaceDocuments).set({
            publishedVersionId: version!.id, updatedAt: now,
            settings: { ...current, org: { ...(current.org ?? {}), lifecycle: 'published', publishedAt: now.toISOString(), readVersion: options.required && parsed.data.reread ? options.readVersion + 1 : options.readVersion,
                // Report 33.2: publishing starts the page's review cycle again (when the handbook has one).
                ...(reviewMonthsOf(org.orgSettings) ? { reviewBy: nextReviewBy(todayUtc(), reviewMonthsOf(org.orgSettings)) } : {}) } },
        }).where(eq(workspaceDocuments.id, doc.id));
    });
    if (parsed.data.notify) {
        const name = docTitle(doc.filename);
        await enqueueWorkspaceNotificationEvent({
            projectId: orgId,
            actorUserId: userId,
            eventKey: 'readme.published',
            title: `${name} updated`,
            body: parsed.data.summary || `${name} was updated in ${org.title}.`,
            href: `/org/${encodeURIComponent(org.slug ?? orgId)}?tab=docs&doc=${encodeURIComponent(doc.slug)}`,
            entityRefs: { projectId: orgId },
            sourceEventId: `doc:${doc.id}:${Date.now()}`,
        });
    }
    touch(org.slug, orgId);
    return { success: true };
}

/** Opening an org doc clears its New label at the current re-read version (report §19.4). */
export async function markDocOpenedAction(orgId: string, docSlug: string): Promise<{ success: true } | Failure> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return DENIED;
    const listed = await listWorkspaceDocsAction(orgId);
    const visible = listed.success ? listed.docs.find((d) => d.slug === docSlug) : null;
    if (!visible || !(await readOrg(orgId))) return { success: false, error: 'That doc is no longer available.' };
    const [doc] = await db.select({ settings: workspaceDocuments.settings }).from(workspaceDocuments).where(eq(workspaceDocuments.id, visible.id)).limit(1);
    const version = readOrgDocOptions(normalizeWorkspaceDocSettings(doc?.settings).org).readVersion;
    await db.insert(docOpens).values({ docId: visible.id, userId, version, openedAt: new Date() })
        .onConflictDoUpdate({ target: [docOpens.docId, docOpens.userId], set: { version, openedAt: new Date() } });
    return { success: true };
}

const groupsSchema = z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    name: z.string().trim().min(1).max(40),
}).strict()).min(1).max(ORG_LIMITS.docGroupsPerOrg)
    .refine((groups) => new Set(groups.map((g) => g.id)).size === groups.length, 'Duplicate group');

/** Rename, reorder and add doc groups (report §19.2). A removed group's docs fall back to the first group. */
export async function saveOrgDocGroupsAction(orgId: string, groups: DocGroup[]): Promise<{ success: true } | Failure> {
    if (!(await orgAdmin(orgId))) return DENIED;
    const parsed = groupsSchema.safeParse(groups);
    if (!parsed.success) return { success: false, error: 'Use 1 to 20 groups with names up to 40 characters.' };
    await db.update(workspaces).set({
        orgSettings: sql`${workspaces.orgSettings} || ${JSON.stringify({ docGroups: parsed.data })}::jsonb`,
        updatedAt: new Date(),
    }).where(eq(workspaces.id, orgId));
    const org = await readOrg(orgId);
    touch(org?.slug ?? null, orgId);
    return { success: true };
}

/**
 * Use this template (report §19.7): the org template, filled for this child project. The browser then
 * saves it as a new file in the project's Docs folder and adds it to Docs, as Files does for any new file.
 */
export async function readOrgTemplateCopyAction(childProjectId: string, orgDocId: string): Promise<{ success: true; filename: string; content: string } | Failure> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return DENIED;
    const [child] = await db.select({ id: workspaces.id, title: workspaces.title, parentId: workspaces.parentId, kind: workspaces.kind })
        .from(workspaces).where(and(eq(workspaces.id, childProjectId), isNull(workspaces.deletedAt))).limit(1);
    // Live-fix 26: the organization itself starts a document from one of its own templates too.
    const orgId = child?.parentId ?? (child?.kind === 'organization' ? child.id : null);
    if (!child || !orgId) return DENIED;
    const [role, access, org, doc] = await Promise.all([
        readViewerOrgRole(orgId, userId),
        getWorkspaceAccessById(child.id, userId),
        readOrg(orgId),
        orgDocRow(orgId, orgDocId),
    ]);
    if (!role || !access.canWrite || !org) return DENIED; // outside people get no org templates
    if (!doc || !readOrgDocOptions(normalizeWorkspaceDocSettings(doc.settings).org).template) return { success: false, error: 'That template is no longer available.' };
    const source = await readWorkspaceDocAction(org.id, doc.slug);
    if (!source.success || !source.data.version) return { success: false, error: 'That template is no longer available.' };
    const [unit] = await db.select({ name: sql<string | null>`coalesce(${workspaceOpenRoles.title}, ${workspaceOpenRoles.role})` })
        .from(workspaceMembers).innerJoin(workspaceOpenRoles, eq(workspaceOpenRoles.id, workspaceMembers.unitId))
        .where(and(eq(workspaceMembers.projectId, child.id), eq(workspaceMembers.userId, userId))).limit(1);
    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: org.timeZone ?? 'UTC' });
    // Audit 8.5: a second copy the same day gets " (2)", not a "name already exists" error after the upload.
    const base = templateCopyTitle(doc.filename, child.title, date);
    const taken = new Set((await db.execute<{ name: string }>(sql`
        SELECT lower(name) AS name FROM workspace_nodes WHERE workspace_id = ${child.id}::uuid AND deleted_at IS NULL AND name LIKE ${`${base.replace(/[%_\\]/g, (c) => `\\${c}`)}%`}`)).map((r) => r.name));
    let title = base;
    for (let n = 2; taken.has(docFileName(title).toLowerCase()) && n < 50; n += 1) title = `${base} (${n})`;
    return {
        success: true,
        filename: docFileName(title),
        content: fillDocTemplate(source.data.version.content, { project: child.title, team: unit?.name ?? child.title, date }),
    };
}

/** The project's top-level Docs folder, made on first use; New doc and template copies land here (report §19.3). */
export async function ensureDocsFolderAction(projectId: string): Promise<{ success: true; folderId: string } | Failure> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return DENIED;
    const [existing] = await db.select({ id: workspaceNodes.id }).from(workspaceNodes).where(and(
        eq(workspaceNodes.projectId, projectId), isNull(workspaceNodes.parentId), eq(workspaceNodes.type, 'folder'),
        eq(workspaceNodes.name, 'Docs'), isNull(workspaceNodes.deletedAt), isNull(workspaceNodes.taskId),
    )).limit(1);
    if (existing) return { success: true, folderId: existing.id };
    try {
        const folder = await createFolder(projectId, null, 'Docs');
        return { success: true, folderId: folder.id };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Couldn’t create the Docs folder." };
    }
}

async function orgIsPublic(orgId: string) {
    const [row] = await db.select({ visibility: workspaces.visibility }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
    return row?.visibility === 'public';
}

/** Members (not owners, admins or viewers) who have opened each Required document at its re-read version. */
async function readRequiredReaders(orgId: string, docIds: string[]) {
    if (docIds.length === 0) return new Map<string, { read: number; total: number }>();
    const rows = await db.execute<{ id: string; read: number; total: number }>(sql`
        SELECT d.id,
               (SELECT count(*)::int FROM doc_opens o JOIN workspace_members m ON m.user_id = o.user_id AND m.workspace_id = ${orgId} AND m.role = 'member'
                 WHERE o.doc_id = d.id AND o.version >= coalesce((d.settings->'org'->>'readVersion')::int, 0)) AS read,
               (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = ${orgId} AND m.role = 'member') AS total
        FROM workspace_documents d WHERE d.id IN ${docIds}`);
    return new Map(rows.map((r) => [r.id, { read: r.read, total: r.total }]));
}

const UNREAD = (orgId: string, docId: string) => sql`
    SELECT m.user_id AS id, coalesce(p.full_name, p.username, 'Someone') AS name
    FROM workspace_members m JOIN workspace_documents d ON d.id = ${docId} AND d.workspace_id = ${orgId}
    LEFT JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId} AND m.role = 'member'
      AND NOT EXISTS (SELECT 1 FROM doc_opens o WHERE o.doc_id = d.id AND o.user_id = m.user_id AND o.version >= coalesce((d.settings->'org'->>'readVersion')::int, 0))
    ORDER BY 2`;

/** Read by N of M → who hasn't (report §28.4): admins only, on Required documents. */
export async function readUnreadDocPeopleAction(orgId: string, docId: string): Promise<{ success: true; people: Array<{ id: string; name: string }> } | Failure> {
    if (!(await orgAdmin(orgId))) return DENIED;
    return { success: true, people: [...await db.execute<{ id: string; name: string }>(UNREAD(orgId, docId))] };
}

/** Remind who hasn't read a Required document: once per 12 hours each, with an honest count (decision 60). */
export async function remindUnreadDocAction(orgId: string, docId: string): Promise<{ success: true; reminded: number; skipped: number } | Failure> {
    const adminId = await orgAdmin(orgId);
    const doc = adminId ? await orgDocRow(orgId, docId) : null;
    const org = await orgLabel(orgId);
    if (!adminId || !doc || !org) return DENIED;
    const unread = (await db.execute<{ id: string }>(UNREAD(orgId, docId))).map((r) => r.id);
    const subject = `remind-doc-${docId}`;
    const recent = await remindedRecently(orgId, subject, unread);
    const send = unread.filter((id) => !recent.has(id));
    const minute = Math.floor(Date.now() / 60_000);
    const name = docTitle(doc.filename);
    for (const userId of send) {
        await notifyOrg({ orgId, eventKey: 'assignments.reminded', actorId: adminId, to: [userId], title: `Reminder: read ${name} in ${org.title}`,
            href: orgHref(org, `?tab=readme&doc=${encodeURIComponent(doc.slug)}`), sourceEventId: `${subject}:${userId}:${minute}` });
    }
    return { success: true, reminded: send.length, skipped: unread.length - send.length };
}

/** Use this template (report §28.4): the workspaces in this organization where the viewer can add documents. */
export async function readTemplateTargetsAction(orgId: string): Promise<{ success: true; workspaces: Array<{ id: string; title: string }> } | Failure> {
    const { userId } = await getViewerAuthContext();
    if (!userId || !(await readViewerOrgRole(orgId, userId))) return DENIED;
    const rows = await db.select({ id: workspaces.id, title: workspaces.title }).from(workspaces)
        .innerJoin(workspaceMembers, and(eq(workspaceMembers.projectId, workspaces.id), eq(workspaceMembers.userId, userId)))
        .where(and(eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt), sql`${workspaces.status} <> 'archived'`, inArray(workspaceMembers.role, ['owner', 'admin', 'member'])))
        .orderBy(workspaces.title);
    return { success: true, workspaces: rows };
}

/** Still correct (report 33.2 flow "Review a page"): the owner or an admin sets the next Review by from the cycle. */
export async function markOrgDocStillCorrectAction(orgId: string, docId: string): Promise<{ success: true; reviewBy: string | null } | Failure> {
    const [doc, org] = await Promise.all([orgDocRow(orgId, docId), readOrg(orgId)]);
    if (!doc || !org) return { success: false, error: 'That doc is no longer available.' };
    if (!(await adminOrPageOwner(orgId, doc))) return DENIED;
    const reviewBy = nextReviewBy(todayUtc(), reviewMonthsOf(org.orgSettings) || 12);
    await writeOrgOptions(doc.id, doc.settings, { reviewBy });
    touch(org.slug, orgId);
    return { success: true, reviewBy };
}

/** Settings → Handbook (report 33.2 layer 2): the default review cycle — 6 or 12 months, or off. Owners and admins. */
export async function saveHandbookSettingsAction(orgId: string, input: { reviewMonths: number }): Promise<{ success: true } | Failure> {
    if (!(await orgAdmin(orgId))) return DENIED;
    if (![0, 6, 12].includes(input?.reviewMonths)) return { success: false, error: 'Pick 6 months, 12 months or off.' };
    await db.update(workspaces).set({
        orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || ${JSON.stringify({ handbook: { reviewMonths: input.reviewMonths } })}::jsonb`,
        updatedAt: new Date(),
    }).where(eq(workspaces.id, orgId));
    const org = await readOrg(orgId);
    touch(org?.slug ?? null, orgId);
    return { success: true };
}
