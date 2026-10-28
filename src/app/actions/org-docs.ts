'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db';
import { docOpens, projectDocs, projectMembers, projectNodes, projectOpenRoles, projects, projectSprints, sprintMaterials } from '@/lib/db/schema';
import { getProjectAccessById } from '@/lib/data/project-access';
import { enqueueProjectNotificationEvent } from '@/lib/notifications/project-events';
import { ORG_LIMITS } from '@/lib/organizations/config';
import { readViewerOrgRole } from '@/lib/organizations/detail';
import { docFileName, docLabel, fillDocTemplate, readDocGroups, readOrgDocOptions, templateCopyTitle, type DocGroup, type OrgDocOptions } from '@/lib/organizations/doc-rules';
import { normalizeProjectDocSettings } from '@/lib/projects/doc';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { listProjectDocsAction, readProjectDocAction } from '@/app/actions/project/doc';
import { createFolder } from '@/app/actions/files/mutations';

// Org Docs (report §19): groups, Required / Template / Show in child projects, New and Updated labels,
// Publish & notify, the From <org> section in child projects, and template copies.

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You don't have permission to do this." };

export type OrgDocItem = OrgDocOptions & { id: string; slug: string; filename: string; label: 'new' | 'updated' | null; sprint: string | null };
export type OrgDocsData = {
    mode: 'org' | 'child';
    orgId: string;
    orgTitle: string;
    orgSlug: string | null;
    isAdmin: boolean;
    /** Signed in: opens are recorded and labels shown. */
    signedIn: boolean;
    groups: DocGroup[];
    docs: OrgDocItem[];
};

async function readOrg(orgId: string) {
    const [org] = await db.select({ id: projects.id, title: projects.title, slug: projects.slug, orgSettings: projects.orgSettings, timeZone: projects.timeZone })
        .from(projects).where(and(eq(projects.id, orgId), eq(projects.kind, 'organization'), isNull(projects.deletedAt))).limit(1);
    return org ?? null;
}

/** The viewer when they own or admin `orgId` (an org, with the flag on). */
async function orgAdmin(orgId: string) {
    const { userId } = await getViewerAuthContext();
    const role = userId ? await readViewerOrgRole(orgId, userId) : null;
    return userId && (role === 'owner' || role === 'admin') ? userId : null;
}

async function orgDocRow(orgId: string, docId: string) {
    const [doc] = await db.select({ id: projectDocs.id, slug: projectDocs.slug, filename: projectDocs.filename, settings: projectDocs.settings })
        .from(projectDocs).where(and(eq(projectDocs.id, docId), eq(projectDocs.projectId, orgId))).limit(1);
    return doc ?? null;
}

async function writeOrgOptions(docId: string, settings: unknown, patch: Partial<OrgDocOptions>, extra: Record<string, unknown> = {}) {
    const current = normalizeProjectDocSettings(settings);
    await db.update(projectDocs).set({
        settings: { ...current, ...extra, org: { ...(current.org ?? {}), ...patch } },
        updatedAt: new Date(),
    }).where(eq(projectDocs.id, docId));
}

const touch = (slug: string | null, id: string) => revalidatePath(`/org/${slug ?? id}`);

/**
 * The org's docs with their options and the viewer's labels. In a child project: the From <org> section,
 * for org people only (outside people never see it, report §19.7). Null when neither applies.
 */
export async function readOrgDocsAction(projectId: string): Promise<{ success: true; data: OrgDocsData | null } | Failure> {
    const { userId } = await getViewerAuthContext();
    const [project] = await db.select({ id: projects.id, kind: projects.kind, parentId: projects.parentId })
        .from(projects).where(and(eq(projects.id, projectId), isNull(projects.deletedAt))).limit(1);
    const mode = project?.kind === 'organization' ? 'org' : project?.parentId ? 'child' : null;
    const orgId = mode === 'org' ? project!.id : project?.parentId ?? null;
    if (!mode || !orgId) return { success: true, data: null };
    const [org, role] = await Promise.all([readOrg(orgId), readViewerOrgRole(orgId, userId)]);
    if (!org || (mode === 'child' && !role)) return { success: true, data: null };

    const listed = await listProjectDocsAction(orgId);
    if (!listed.success) return { success: false, error: listed.error };
    const ids = listed.docs.map((d) => d.id);
    const groups = readDocGroups((org.orgSettings as { docGroups?: unknown } | null)?.docGroups);
    const [rows, opens, sprints] = ids.length === 0 ? [[], [], []] : await Promise.all([
        db.select({ id: projectDocs.id, settings: projectDocs.settings, updatedAt: projectNodes.updatedAt })
            .from(projectDocs).leftJoin(projectNodes, eq(projectNodes.id, projectDocs.linkedNodeId)).where(inArray(projectDocs.id, ids)),
        userId ? db.select({ docId: docOpens.docId, version: docOpens.version, at: docOpens.openedAt }).from(docOpens)
            .where(and(eq(docOpens.userId, userId), inArray(docOpens.docId, ids))) : Promise.resolve([]),
        db.select({ docId: sprintMaterials.docId, name: projectSprints.name }).from(sprintMaterials)
            .innerJoin(projectSprints, eq(projectSprints.id, sprintMaterials.sprintId)).where(inArray(sprintMaterials.docId, ids)),
    ]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const openById = new Map(opens.map((o) => [o.docId, o]));
    const sprintById = new Map(sprints.map((s) => [s.docId, s.name]));
    const docs = listed.docs.flatMap((d): OrgDocItem[] => {
        const options = readOrgDocOptions(normalizeProjectDocSettings(byId.get(d.id)?.settings).org, groups);
        if (mode === 'child' && !options.showInChildren) return [];
        const opened = openById.get(d.id);
        return [{
            id: d.id, slug: d.slug, filename: d.filename, ...options,
            label: userId ? docLabel({ readVersion: options.readVersion, opened: opened ? { version: opened.version, at: opened.at } : null, updatedAt: byId.get(d.id)?.updatedAt ?? null }) : null,
            sprint: sprintById.get(d.id) ?? null,
        }];
    });
    return { success: true, data: { mode, orgId, orgTitle: org.title, orgSlug: org.slug, isAdmin: role === 'owner' || role === 'admin', signedIn: Boolean(userId), groups, docs } };
}

const optionsSchema = z.object({
    group: z.string().max(40).optional(),
    required: z.boolean().optional(),
    template: z.boolean().optional(),
    showInChildren: z.boolean().optional(),
    visibility: z.enum(['members_only', 'public']).optional(),
}).strict();

/** Group, Required, Template, Show in child projects and visibility for one org doc (owners and admins). */
export async function updateOrgDocOptionsAction(orgId: string, docId: string, input: z.input<typeof optionsSchema>): Promise<{ success: true } | Failure> {
    if (!(await orgAdmin(orgId))) return DENIED;
    const parsed = optionsSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'Check the doc options.' };
    const doc = await orgDocRow(orgId, docId);
    if (!doc) return { success: false, error: 'That doc is no longer available.' };
    const { visibility, ...patch } = parsed.data;
    await writeOrgOptions(doc.id, doc.settings, patch, visibility ? { visibilityOverride: visibility } : {});
    const org = await readOrg(orgId);
    touch(org?.slug ?? null, orgId);
    return { success: true };
}

const publishSchema = z.object({ summary: z.string().trim().max(200), reread: z.boolean(), notify: z.boolean() }).strict();

/** Publish & notify (report §19.3): tell members what changed; Ask members to re-read makes it New again. */
export async function publishOrgDocAction(orgId: string, docId: string, input: z.input<typeof publishSchema>): Promise<{ success: true } | Failure> {
    const userId = await orgAdmin(orgId);
    if (!userId) return DENIED;
    const parsed = publishSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'Keep the summary under 200 characters.' };
    const [doc, org] = await Promise.all([orgDocRow(orgId, docId), readOrg(orgId)]);
    if (!doc || !org) return { success: false, error: 'That doc is no longer available.' };
    if (parsed.data.reread) {
        const current = readOrgDocOptions(normalizeProjectDocSettings(doc.settings).org);
        await writeOrgOptions(doc.id, doc.settings, { readVersion: current.readVersion + 1 });
    }
    if (parsed.data.notify) {
        const name = doc.filename.replace(/\.(md|mdx|markdown)$/i, '');
        await enqueueProjectNotificationEvent({
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
    const listed = await listProjectDocsAction(orgId);
    const visible = listed.success ? listed.docs.find((d) => d.slug === docSlug) : null;
    if (!visible || !(await readOrg(orgId))) return { success: false, error: 'That doc is no longer available.' };
    const [doc] = await db.select({ settings: projectDocs.settings }).from(projectDocs).where(eq(projectDocs.id, visible.id)).limit(1);
    const version = readOrgDocOptions(normalizeProjectDocSettings(doc?.settings).org).readVersion;
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
    if (!parsed.success) return { success: false, error: `Use 1 to ${ORG_LIMITS.docGroupsPerOrg} groups with names up to 40 characters.` };
    await db.update(projects).set({
        orgSettings: sql`${projects.orgSettings} || ${JSON.stringify({ docGroups: parsed.data })}::jsonb`,
        updatedAt: new Date(),
    }).where(eq(projects.id, orgId));
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
    const [child] = await db.select({ id: projects.id, title: projects.title, parentId: projects.parentId })
        .from(projects).where(and(eq(projects.id, childProjectId), isNull(projects.deletedAt))).limit(1);
    if (!child?.parentId) return DENIED;
    const [role, access, org, doc] = await Promise.all([
        readViewerOrgRole(child.parentId, userId),
        getProjectAccessById(child.id, userId),
        readOrg(child.parentId),
        orgDocRow(child.parentId, orgDocId),
    ]);
    if (!role || !access.canWrite || !org) return DENIED; // outside people get no org templates
    if (!doc || !readOrgDocOptions(normalizeProjectDocSettings(doc.settings).org).template) return { success: false, error: 'That template is no longer available.' };
    const source = await readProjectDocAction(org.id, doc.slug);
    if (!source.success || !source.data.version) return { success: false, error: 'That template is no longer available.' };
    const [unit] = await db.select({ name: sql<string | null>`coalesce(${projectOpenRoles.title}, ${projectOpenRoles.role})` })
        .from(projectMembers).innerJoin(projectOpenRoles, eq(projectOpenRoles.id, projectMembers.unitId))
        .where(and(eq(projectMembers.projectId, child.id), eq(projectMembers.userId, userId))).limit(1);
    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: org.timeZone ?? 'UTC' });
    return {
        success: true,
        filename: docFileName(templateCopyTitle(doc.filename, child.title, date)),
        content: fillDocTemplate(source.data.version.content, { project: child.title, team: unit?.name ?? child.title, date }),
    };
}

/** The project's top-level Docs folder, made on first use; New doc and template copies land here (report §19.3). */
export async function ensureDocsFolderAction(projectId: string): Promise<{ success: true; folderId: string } | Failure> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return DENIED;
    const [existing] = await db.select({ id: projectNodes.id }).from(projectNodes).where(and(
        eq(projectNodes.projectId, projectId), isNull(projectNodes.parentId), eq(projectNodes.type, 'folder'),
        eq(projectNodes.name, 'Docs'), isNull(projectNodes.deletedAt), isNull(projectNodes.taskId),
    )).limit(1);
    if (existing) return { success: true, folderId: existing.id };
    try {
        const folder = await createFolder(projectId, null, 'Docs');
        return { success: true, folderId: folder.id };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Couldn't create the Docs folder." };
    }
}
