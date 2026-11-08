'use server';

import { and, desc, eq, ilike, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { docTitle } from '@/lib/organizations/doc-rules';
import { sidebarPins, tasks, workspaceMembers, workspaces } from '@/lib/db/schema';
import { orgTaskReadFilter } from '@/lib/organizations/assignments';
import { getWorkspaceAccessById } from '@/lib/data/workspace-access';
import { orgFileAccessSql } from '@/lib/files/internal-helpers';
import { readNeedsYou, type OrgViewer } from '@/lib/organizations/needs-you';
import { formatDueDay } from '@/lib/organizations/notify-rules';
import { peopleByZone } from '@/lib/organizations/notify';
import { listWorkspaceDocsAction } from '@/app/actions/workspace/doc';
import { readOrgDocsAction } from '@/app/actions/org-docs';
import { openInvitesFor } from '@/lib/organizations/members';
import { readOrgRules } from '@/lib/organizations/settings';
import { audienceSql } from '@/lib/organizations/org-updates';
import { getViewerAuthContext } from '@/lib/server/viewer-context';

// The app-wide org pieces (report §29.2 My work, §29.3 left navigation, §30.1 search, §30.6 Network).

const ROWS = <T,>(query: ReturnType<typeof sql>) => db.execute(query) as unknown as Promise<T[]>;

/** Documents this viewer may open here, by the same rules as the Documents tab: drafts and hidden ones never show (§32.2). */
async function visibleDocIds(projectId: string) {
    const listed = await listWorkspaceDocsAction(projectId);
    return new Set(listed.success ? listed.docs.map((d) => d.id) : []);
}

async function viewer() {
    const { userId } = await getViewerAuthContext();
    return userId;
}

/** A workspace row in the sidebar: names only (sidebar report §1); `unseen` is the new-updates dot (G5). */
export type SidebarRow = { id: string; title: string; slug: string | null; unseen: boolean };
export type SidebarOrg = {
    id: string; title: string; slug: string | null; isAdmin: boolean; canCreate: boolean;
    needsYou: number; unseenAnnouncement: boolean;
    /** Every workspace of the org you're in, by your own visits; the list shows 5 plus the one you're on (G2). */
    children: SidebarRow[];
};
export type SidebarWorkspaces = {
    orgs: SidebarOrg[];
    requested: Array<{ id: string; title: string; slug: string | null }>;
    outside: Array<SidebarRow & { orgTitle: string }>;
    /** Up to 50; the list shows 12, then More (N) (G3). */
    personal: SidebarRow[];
    archived: Array<{ id: string; title: string; slug: string | null; kind: string }>;
    /** Pinned to the top, in the order they were pinned (G9). */
    pinned: string[];
};

/**
 * The sidebar's Workspaces, in one request (report §29.3): orgs first (most recently opened), each with its
 * Needs you count, an unseen-announcement dot and the child projects you belong to; then personal projects;
 * then Archived. Requests waiting for approval and child projects of orgs you're not in show their own way.
 */
export async function readSidebarWorkspacesAction(): Promise<SidebarWorkspaces | null> {
    const userId = await viewer();
    if (!userId) return null;
    // G4: ordered by your own visits (0065), never by other people's edits. G5: a workspace (not an org; orgs keep their
    // announcement rule) has unseen updates when someone else posted after you last opened it.
    const mine = await ROWS<{ id: string; title: string; slug: string | null; kind: string; status: string | null; parent_id: string | null; role: string; opened: string | null; last_seen: string | null; settings: unknown; org_title: string | null; in_org: boolean; unseen: boolean }>(sql`
        SELECT p.id, p.title, p.slug, p.kind, p.status, p.parent_id,
          CASE WHEN p.owner_id = ${userId}::uuid THEN 'owner' ELSE pm.role END AS role,
          coalesce(pm.last_opened_at, pm.joined_at, p.created_at)::text AS opened, pm.last_seen_updates_at::text AS last_seen, p.org_settings AS settings,
          (p.kind <> 'organization' AND EXISTS (SELECT 1 FROM workspace_updates u WHERE u.workspace_id = p.id AND u.deleted_at IS NULL
            AND u.author_id IS DISTINCT FROM ${userId}::uuid
            -- Opening the workspace counts as seeing it (the user, 5 Nov): newer than your last visit or your last read of Updates.
            AND u.created_at > greatest(pm.last_opened_at, pm.last_seen_updates_at, coalesce(pm.joined_at, p.created_at)))) AS unseen,
          o.title AS org_title,
          (o.id IS NOT NULL AND (o.owner_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM workspace_members om WHERE om.workspace_id = o.id AND om.user_id = ${userId}::uuid))) AS in_org
        FROM workspaces p
        LEFT JOIN workspace_members pm ON pm.workspace_id = p.id AND pm.user_id = ${userId}::uuid
        LEFT JOIN workspaces o ON o.id = p.parent_id AND o.kind = 'organization' AND o.deleted_at IS NULL
        WHERE p.deleted_at IS NULL AND p.deletion_scheduled_at IS NULL AND (p.owner_id = ${userId}::uuid OR pm.user_id IS NOT NULL)
        ORDER BY opened DESC NULLS LAST LIMIT 300`);
    const orgRows = mine.filter((r) => r.kind === 'organization' && r.status !== 'archived');
    const childRows = mine.filter((r) => r.parent_id && r.in_org && r.status !== 'archived');
    const now = new Date();
    // Smaller bug 8: organizations are read side by side, not one after another.
    const orgs: SidebarOrg[] = await Promise.all(orgRows.map(async (org): Promise<SidebarOrg> => {
        const access = await getWorkspaceAccessById(org.id, userId);
        const isAdmin = org.role === 'owner' || org.role === 'admin';
        const v: OrgViewer = { userId, access, isAdmin, isInside: true, isGuest: org.role === 'viewer', org: { id: org.id, title: org.title, slug: org.slug, status: org.status } };
        const kids = childRows.filter((c) => c.parent_id === org.id);
        // The dot follows the post's audience and skips your own posts (decision 154, report §42.15 problem 47).
        const audience = audienceSql({ isOrgAdmin: isAdmin, viewerRole: org.role as 'owner' | 'admin' | 'member' | 'viewer', viewerChildIds: kids.map((k) => k.id) }, userId);
        const [needs, [latest]] = await Promise.all([
            readNeedsYou(v, now).catch(() => []),
            ROWS<{ at: string | null }>(sql`SELECT max(created_at)::text AS at FROM workspace_updates WHERE workspace_id = ${org.id} AND update_type = 'announcement' AND deleted_at IS NULL
                AND author_id IS DISTINCT FROM ${userId}::uuid ${audience ? sql`AND ${audience}` : sql``}`),
        ]);
        const rules = readOrgRules(org.settings);
        return {
            id: org.id, title: org.title, slug: org.slug, isAdmin,
            canCreate: !access.writeBlocked && org.role !== 'viewer' && (isAdmin || rules.childCreation === 'members'),
            needsYou: needs.length,
            unseenAnnouncement: Boolean(latest?.at && (!org.last_seen || latest.at > org.last_seen)),
            children: kids.slice(0, 50).map((c) => ({ id: c.id, title: c.title, slug: c.slug, unseen: Boolean(c.unseen) })),
        };
    }));
    const pins = (await db.select({ id: sidebarPins.workspaceId }).from(sidebarPins).where(eq(sidebarPins.userId, userId)).orderBy(sidebarPins.pinnedAt)).map((p) => p.id);
    const requested = await ROWS<{ id: string; title: string; slug: string | null }>(sql`
        SELECT p.id, p.title, p.slug FROM role_applications a JOIN workspaces p ON p.id = a.workspace_id AND p.kind = 'organization' AND p.deleted_at IS NULL
        WHERE a.applicant_id = ${userId}::uuid AND a.role_id IS NULL AND a.status = 'pending' ORDER BY a.created_at DESC LIMIT 10`);
    return {
        orgs,
        requested,
        outside: mine.filter((r) => r.parent_id && !r.in_org && r.org_title && r.status !== 'archived').map((r) => ({ id: r.id, title: r.title, slug: r.slug, orgTitle: r.org_title!, unseen: Boolean(r.unseen) })),
        personal: mine.filter((r) => r.kind === 'workspace' && !r.parent_id && r.status !== 'archived').slice(0, 50).map((r) => ({ id: r.id, title: r.title, slug: r.slug, unseen: Boolean(r.unseen) })),
        archived: mine.filter((r) => r.status === 'archived' && (r.kind === 'organization' || !r.parent_id)).map((r) => ({ id: r.id, title: r.title, slug: r.slug, kind: r.kind })),
        pinned: pins.filter((id) => mine.some((r) => r.id === id && r.status !== 'archived')),
    };
}

/** Up to 10 pins: the top of the list stays short. */
const SIDEBAR_PIN_LIMIT = 10;

/**
 * Sidebar report G9, D4: pin a workspace or organization you're in to the top of your Workspaces list, on every
 * device. Unpinning is always allowed; pinning needs membership.
 */
export async function setSidebarPinAction(workspaceId: string, pinned: boolean): Promise<{ success: true } | { success: false; error: string }> {
    const userId = await viewer();
    if (!userId || !/^[0-9a-f-]{36}$/i.test(workspaceId)) return { success: false, error: 'Sign in.' };
    if (!pinned) {
        await db.delete(sidebarPins).where(and(eq(sidebarPins.userId, userId), eq(sidebarPins.workspaceId, workspaceId)));
        return { success: true };
    }
    const [member] = await ROWS<{ ok: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM workspaces w WHERE w.id = ${workspaceId}::uuid AND w.deleted_at IS NULL
        AND (w.owner_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${userId}::uuid))) AS ok`);
    if (!member?.ok) return { success: false, error: 'You can pin only workspaces you’re in.' };
    const [count] = await ROWS<{ n: number }>(sql`SELECT count(*)::int AS n FROM sidebar_pins WHERE user_id = ${userId}::uuid`);
    if ((count?.n ?? 0) >= SIDEBAR_PIN_LIMIT) return { success: false, error: `You can pin up to ${SIDEBAR_PIN_LIMIT}. Unpin one first.` };
    await db.insert(sidebarPins).values({ userId, workspaceId }).onConflictDoNothing();
    return { success: true };
}

export type JoinRequestGroup = { orgId: string; title: string; slug: string | null; count: number; first: Array<{ id: string; userId: string; name: string; note: string | null }> };

/** My work and Network (report §29.2, §30.6): my org invitations, and for orgs I run, their join requests. */
export async function readOrgRequestsForMeAction(): Promise<{ invites: Awaited<ReturnType<typeof openInvitesFor>>; joinRequests: JoinRequestGroup[]; mine: Array<{ orgId: string; title: string; slug: string | null; at: string }> } | null> {
    const userId = await viewer();
    if (!userId) return null;
    const [invites, requests, mine] = await Promise.all([
        openInvitesFor(userId),
        ROWS<{ id: string; user_id: string; name: string | null; note: string | null; org_id: string; title: string; slug: string | null }>(sql`
            SELECT a.id, a.applicant_id AS user_id, coalesce(pr.full_name, pr.username) AS name, a.message AS note, o.id AS org_id, o.title, o.slug
            FROM role_applications a JOIN workspaces o ON o.id = a.workspace_id AND o.kind = 'organization' AND o.deleted_at IS NULL
            JOIN profiles pr ON pr.id = a.applicant_id
            WHERE a.role_id IS NULL AND a.status = 'pending'
              AND (o.owner_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = o.id AND m.user_id = ${userId}::uuid AND m.role = 'admin'))
              -- Audit N8: the same block rule as the Members tab, here too.
              AND NOT app_private.review_hidden_by_block(${userId}::uuid, a.applicant_id, o.id)
            ORDER BY a.created_at ASC LIMIT 500`),
        // Your own requests (report §30.7): waiting, with Cancel.
        ROWS<{ org_id: string; title: string; slug: string | null; at: Date | string }>(sql`
            SELECT o.id AS org_id, o.title, o.slug, a.created_at AS at
            FROM role_applications a JOIN workspaces o ON o.id = a.workspace_id AND o.kind = 'organization' AND o.deleted_at IS NULL
            WHERE a.applicant_id = ${userId}::uuid AND a.role_id IS NULL AND a.status = 'pending' ORDER BY a.created_at DESC LIMIT 50`),
    ]);
    const groups = new Map<string, JoinRequestGroup>();
    for (const r of requests) {
        const g = groups.get(r.org_id) ?? { orgId: r.org_id, title: r.title, slug: r.slug, count: 0, first: [] };
        g.count++;
        if (g.first.length < 5) g.first.push({ id: r.id, userId: r.user_id, name: r.name ?? 'Someone', note: r.note });
        groups.set(r.org_id, g);
    }
    return { invites, joinRequests: [...groups.values()], mine: mine.map((r) => ({ orgId: r.org_id, title: r.title, slug: r.slug, at: new Date(r.at).toISOString() })) };
}

export type ToReviewRow = { id: string; title: string; who: string; context: string; submittedAt: string | null; href: string };

/**
 * To review (report §29.2): every submission waiting for me across orgs and projects — org admins (their org's
 * copies and child projects' group copies), child leads and project reviewers.
 */
export async function fetchToReviewAction(): Promise<ToReviewRow[] | null> {
    const userId = await viewer();
    if (!userId) return null;
    const rows = await ROWS<{ id: string; title: string; who: string | null; team_name: string | null; context: string; org_title: string | null; submitted_at: string | null; slug: string | null; project_id: string; kind: string }>(sql`
        SELECT t.id, t.title, coalesce(pr.full_name, pr.username) AS who, t.team_name, p.title AS context, o.title AS org_title,
          to_char(t.review_submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS submitted_at, p.slug, p.id AS project_id, p.kind
        FROM tasks t JOIN workspaces p ON p.id = t.workspace_id AND p.deleted_at IS NULL
        LEFT JOIN workspaces o ON o.id = p.parent_id AND o.kind = 'organization'
        LEFT JOIN profiles pr ON pr.id = t.assignee_id
        WHERE t.review_status = 'pending' AND t.deleted_at IS NULL AND t.excused_at IS NULL AND (
          p.owner_id = ${userId}::uuid
          OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = p.id AND m.user_id = ${userId}::uuid AND m.role = 'admin')
          OR o.owner_id = ${userId}::uuid
          OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = o.id AND m.user_id = ${userId}::uuid AND m.role = 'admin'))
        ORDER BY t.review_submitted_at DESC NULLS LAST LIMIT 100`);
    return rows.map((r) => ({
        id: r.id, title: r.title, who: r.team_name ?? r.who ?? 'Someone',
        context: r.org_title ? `${r.org_title} / ${r.context}` : r.context,
        submittedAt: r.submitted_at,
        href: `/${r.kind === 'organization' ? 'org' : 'workspaces'}/${encodeURIComponent(r.slug ?? r.project_id)}?tab=${r.kind === 'organization' ? 'assignments' : 'tasks'}&drawerType=task&drawerId=${r.id}`,
    }));
}

/**
 * Shared-org chip (report §30.1, §30.6): an org both people are in, only where the other person shows it on
 * their profile. One org per person, the most recent.
 */
export async function readSharedOrgsAction(userIds: string[]): Promise<Record<string, string>> {
    const userId = await viewer();
    const ids = [...new Set(userIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id) && id !== userId).slice(0, 100);
    if (!userId || ids.length === 0) return {};
    const rows = await ROWS<{ user_id: string; title: string }>(sql`
        SELECT them.user_id, o.title
        FROM workspace_members them JOIN workspaces o ON o.id = them.workspace_id AND o.kind = 'organization' AND o.deleted_at IS NULL
        WHERE them.user_id = ANY(${sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]`}) AND them.show_on_profile
          AND (o.owner_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM workspace_members me WHERE me.workspace_id = o.id AND me.user_id = ${userId}::uuid))
        ORDER BY them.user_id, them.joined_at DESC`);
    // Report §31.7: the most recent first, then "+2" for the rest.
    const byUser = new Map<string, string[]>();
    for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.title]);
    return Object.fromEntries([...byUser].map(([id, titles]) => [id, titles.length > 1 ? `${titles[0]} +${titles.length - 1}` : titles[0]!]));
}

export type OrgSearchResult = { id: string; kind: 'org' | 'assignment' | 'task' | 'doc' | 'child' | 'sprint' | 'member' | 'file' | 'action'; title: string; subtitle: string; href: string; chip: string | null };

/**
 * Org results for ⌘K (report §30.1). Without `orgId`: organizations (yours first, then public — never a private
 * org you aren't in), your assignments and docs. With `orgId` ("Search CSE-3A"): its docs, assignments, child
 * projects, files you can open, sprints, members (admins only), plus quick actions.
 */
export async function searchOrgPreviewsAction(query: string, orgIdentifier?: string | null): Promise<OrgSearchResult[]> {
    const userId = await viewer();
    const q = query.trim().slice(0, 80);
    if (!userId || q.length < 2) return [];
    const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const results: OrgSearchResult[] = [];
    const memberOf = sql`(o.owner_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = o.id AND m.user_id = ${userId}::uuid))`;
    const isAdminOf = sql`(o.owner_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = o.id AND m.user_id = ${userId}::uuid AND m.role = 'admin'))`;

    let scope: { id: string; title: string; slug: string | null; isAdmin: boolean; isGuest: boolean; canCreate: boolean } | null = null;
    if (orgIdentifier) {
        const [org] = await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, settings: workspaces.orgSettings }).from(workspaces)
            .where(and(sql`(${workspaces.slug} = ${orgIdentifier} OR ${workspaces.id}::text = ${orgIdentifier})`, eq(workspaces.kind, 'organization'), isNull(workspaces.deletedAt))).limit(1);
        const access = org ? await getWorkspaceAccessById(org.id, userId) : null;
        if (org && access && (access.isOwner || access.isMember)) {
            const isAdmin = access.isOwner || access.memberRole === 'admin';
            scope = { id: org.id, title: org.title, slug: org.slug, isAdmin, isGuest: access.memberRole === 'viewer', canCreate: !access.writeBlocked && access.memberRole !== 'viewer' && (isAdmin || readOrgRules(org.settings).childCreation === 'members') };
            const base = `/org/${encodeURIComponent(org.slug ?? org.id)}`;
            const [docs, children, sprints, members, files, orgTasks] = await Promise.all([
                ROWS<{ id: string; slug: string; filename: string }>(sql`SELECT id, slug, filename FROM workspace_documents WHERE workspace_id = ${org.id} AND (filename ILIKE ${pattern} OR slug ILIKE ${pattern}) LIMIT 5`),
                ROWS<{ id: string; title: string; slug: string | null }>(sql`SELECT c.id, c.title, c.slug FROM workspaces c WHERE c.parent_id = ${org.id} AND c.deleted_at IS NULL AND c.title ILIKE ${pattern}
                    AND (c.visibility <> 'private' OR ${isAdmin} OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = c.id AND m.user_id = ${userId}::uuid)) LIMIT 5`),
                ROWS<{ id: string; name: string }>(sql`SELECT id, name FROM workspace_sprints WHERE workspace_id = ${org.id} AND name ILIKE ${pattern} LIMIT 3`),
                isAdmin ? ROWS<{ id: string; name: string | null; username: string | null }>(sql`SELECT pr.id, pr.full_name AS name, pr.username FROM workspace_members m JOIN profiles pr ON pr.id = m.user_id
                    WHERE m.workspace_id = ${org.id} AND pr.deleted_at IS NULL AND (pr.full_name ILIKE ${pattern} OR pr.username ILIKE ${pattern} OR m.title ILIKE ${pattern}) LIMIT 5`) : Promise.resolve([]),
                db.execute(sql`SELECT n.id, n.name, n.path FROM workspace_nodes n WHERE n.workspace_id = ${org.id} AND n.type = 'file' AND n.deleted_at IS NULL AND n.task_id IS NULL AND n.name ILIKE ${pattern} AND NOT EXISTS (SELECT 1 FROM workspace_documents wd WHERE wd.linked_node_id = n.id) AND ${orgFileAccessSql(access, { projectId: sql`n.workspace_id`, path: sql`n.path`, taskId: sql`n.task_id` }) ?? sql`TRUE`} LIMIT 5`) as unknown as Promise<Array<{ id: string; name: string; path: string }>>,
                // The organization's own tasks (not assignment copies), by the board's read rule: members see theirs.
                db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(and(eq(tasks.projectId, org.id), eq(tasks.kind, 'task'), isNull(tasks.assignmentId),
                    isNull(tasks.deletedAt), ilike(tasks.title, pattern), orgTaskReadFilter(access, userId))).limit(5),
            ]);
            const canOpen = docs.length ? await visibleDocIds(org.id) : new Set<string>();
            for (const d of docs) if (canOpen.has(d.id)) results.push({ id: `doc:${d.id}`, kind: 'doc', title: docTitle(d.filename), subtitle: `Doc · ${org.title}`, href: `${base}?tab=docs&doc=${encodeURIComponent(d.slug)}`, chip: null });
            for (const c of children) results.push({ id: `child:${c.id}`, kind: 'child', title: c.title, subtitle: `Workspace · ${org.title}`, href: `/workspaces/${encodeURIComponent(c.slug ?? c.id)}`, chip: null });
            for (const s of sprints) results.push({ id: `sprint:${s.id}`, kind: 'sprint', title: s.name, subtitle: `Sprint · ${org.title}`, href: `${base}?tab=sprints`, chip: null });
            for (const m of members) results.push({ id: `member:${m.id}`, kind: 'member', title: m.name ?? m.username ?? 'Member', subtitle: `Member · ${org.title}`, href: `${base}?tab=members`, chip: null });
            for (const t of orgTasks) results.push({ id: `task:${t.id}`, kind: 'task', title: t.title, subtitle: `Task · ${org.title}`, href: `${base}?tab=tasks&drawerType=task&drawerId=${t.id}`, chip: null });
            for (const f of files) results.push({ id: `file:${f.id}`, kind: 'file', title: f.name, subtitle: `File · ${f.path}`, href: `${base}?tab=files&path=${encodeURIComponent(f.path)}`, chip: null });
        } else {
            // Inside a child project: its org's docs and files, marked "From CSE-3A" — never for outside people.
            const [child] = await db.select({ id: workspaces.id, parentId: workspaces.parentId }).from(workspaces)
                .where(and(sql`(${workspaces.slug} = ${orgIdentifier} OR ${workspaces.id}::text = ${orgIdentifier})`, isNull(workspaces.deletedAt))).limit(1);
            const orgAccess = child?.parentId ? await getWorkspaceAccessById(child.parentId, userId) : null;
            if (!child?.parentId || !orgAccess || !(orgAccess.isOwner || orgAccess.isMember)) return [];
            const [parent] = await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, child.parentId)).limit(1);
            const base = `/org/${encodeURIComponent(parent!.slug ?? parent!.id)}`;
            const [docs, files] = await Promise.all([
                ROWS<{ slug: string; filename: string; id: string }>(sql`SELECT id, slug, filename FROM workspace_documents WHERE workspace_id = ${parent!.id} AND (filename ILIKE ${pattern} OR slug ILIKE ${pattern}) LIMIT 5`),
                db.execute(sql`SELECT n.id, n.name, n.path FROM workspace_nodes n WHERE n.workspace_id = ${parent!.id} AND n.type = 'file' AND n.deleted_at IS NULL AND n.task_id IS NULL AND n.name ILIKE ${pattern} AND NOT EXISTS (SELECT 1 FROM workspace_documents wd WHERE wd.linked_node_id = n.id) AND ${orgFileAccessSql(orgAccess, { projectId: sql`n.workspace_id`, path: sql`n.path`, taskId: sql`n.task_id` }) ?? sql`TRUE`} LIMIT 5`) as unknown as Promise<Array<{ id: string; name: string; path: string }>>,
            ]);
            // The From <org> section's rules: published and shown in workspaces only.
            const shown = docs.length ? await readOrgDocsAction(child.id) : null;
            const canOpen = new Set(shown?.success && shown.data ? shown.data.docs.map((d) => d.id) : []);
            for (const d of docs) if (canOpen.has(d.id)) results.push({ id: `doc:${d.id}`, kind: 'doc', title: docTitle(d.filename), subtitle: 'Doc', href: `${base}?tab=docs&doc=${encodeURIComponent(d.slug)}`, chip: `From ${parent!.title}` });
            for (const f of files) results.push({ id: `file:${f.id}`, kind: 'file', title: f.name, subtitle: f.path, href: `${base}?tab=files&path=${encodeURIComponent(f.path)}`, chip: `From ${parent!.title}` });
            return results;
        }
    }

    // Organizations: yours first, then public ones; a private org you aren't in never shows, not even its name.
    if (!scope) {
        const orgs = await ROWS<{ id: string; title: string; slug: string | null; org_type: string | null; members: number; mine: boolean }>(sql`
            SELECT o.id, o.title, o.slug, o.org_type, (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = o.id) AS members, ${memberOf} AS mine
            FROM workspaces o WHERE o.kind = 'organization' AND o.deleted_at IS NULL AND o.deletion_scheduled_at IS NULL AND o.suspended_at IS NULL AND o.discover_hidden_at IS NULL
              AND (o.title ILIKE ${pattern} OR o.slug ILIKE ${pattern}) AND (${memberOf} OR o.visibility = 'public')
            ORDER BY ${memberOf} DESC, o.title LIMIT 5`);
        for (const o of orgs) results.push({ id: `org:${o.id}`, kind: 'org', title: o.title, subtitle: [o.org_type ? o.org_type[0]!.toUpperCase() + o.org_type.slice(1) : 'Organization', `${o.members} ${o.members === 1 ? "member" : "members"}`].join(' · '), href: `/org/${encodeURIComponent(o.slug ?? o.id)}`, chip: o.mine ? 'Member' : null });
    }

    // Assignments: members find their own copy (with its state), admins the master with counts, guests counts only.
    const assignments = await ROWS<{ id: string; title: string; org_id: string; org_title: string; slug: string | null; zone: string | null; due: string | null; admin: boolean; guest: boolean; copy_id: string | null; copy_status: string | null; copy_review: string | null; submitted: number; total: number }>(sql`
        SELECT m.id, m.title, o.id AS org_id, o.title AS org_title, o.slug, o.time_zone AS zone, m.due_date::text AS due, ${isAdminOf} AS admin,
          EXISTS (SELECT 1 FROM workspace_members g WHERE g.workspace_id = o.id AND g.user_id = ${userId}::uuid AND g.role = 'viewer') AS guest,
          (SELECT c.id FROM tasks c WHERE c.assignment_id = m.id AND c.deleted_at IS NULL AND (c.assignee_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = c.id AND tm.user_id = ${userId}::uuid)) LIMIT 1) AS copy_id,
          (SELECT c.status FROM tasks c WHERE c.assignment_id = m.id AND c.deleted_at IS NULL AND (c.assignee_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = c.id AND tm.user_id = ${userId}::uuid)) LIMIT 1) AS copy_status,
          (SELECT c.review_status FROM tasks c WHERE c.assignment_id = m.id AND c.deleted_at IS NULL AND (c.assignee_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = c.id AND tm.user_id = ${userId}::uuid)) LIMIT 1) AS copy_review,
          (SELECT count(*)::int FROM tasks c WHERE c.assignment_id = m.id AND c.deleted_at IS NULL AND (c.review_status = 'pending' OR c.status = 'done')) AS submitted,
          (SELECT count(*)::int FROM tasks c WHERE c.assignment_id = m.id AND c.deleted_at IS NULL AND c.excused_at IS NULL) AS total
        FROM tasks m JOIN workspaces o ON o.id = m.workspace_id AND o.kind = 'organization' AND o.deleted_at IS NULL
        WHERE m.kind = 'assignment' AND m.deleted_at IS NULL AND m.title ILIKE ${pattern} AND ${memberOf}
          ${scope ? sql`AND o.id = ${scope.id}` : sql``}
          AND (m.assignment_settings->>'publishedAt' IS NOT NULL OR ${isAdminOf})
        ORDER BY m.due_date DESC NULLS LAST LIMIT 5`);
    for (const a of assignments) {
        // Viewers get no assignments (report §32.2); dates read in the viewer's own zone (§32.5).
        if (a.guest && !a.admin) continue;
        const base = `/org/${encodeURIComponent(a.slug ?? a.org_id)}?tab=tasks`;
        const due = a.due ? ` · due ${formatDueDay(new Date(a.due), [...(await peopleByZone([userId], a.zone)).keys()][0])}` : '';
        if (a.admin) results.push({ id: `assignment:${a.id}`, kind: 'assignment', title: a.title, subtitle: `${a.org_title}${due}`, href: `${base}&drawerType=task&drawerId=${a.id}`, chip: `${a.submitted}/${a.total} submitted` });
        else if (a.copy_id) results.push({ id: `assignment:${a.id}`, kind: 'assignment', title: a.title, subtitle: `${a.org_title}${due}`, href: `${base}&drawerType=task&drawerId=${a.copy_id}`, chip: a.copy_review === 'pending' ? 'In review' : a.copy_review === 'rejected' ? 'Returned' : a.copy_status === 'done' ? 'Done' : a.copy_status === 'in_progress' ? 'In progress' : a.copy_status === 'blocked' ? 'Blocked' : 'To do' });
    }

    // Org docs (outside an org's own search): docs of orgs you're in.
    if (!scope) {
        const docs = await ROWS<{ id: string; slug: string; filename: string; org_id: string; org_title: string; org_slug: string | null }>(sql`
            SELECT d.id, d.slug, d.filename, o.id AS org_id, o.title AS org_title, o.slug AS org_slug FROM workspace_documents d JOIN workspaces o ON o.id = d.workspace_id AND o.kind = 'organization' AND o.deleted_at IS NULL
            WHERE (d.filename ILIKE ${pattern} OR d.slug ILIKE ${pattern}) AND ${memberOf} LIMIT 20`);
        const canOpen = new Map<string, Set<string>>();
        for (const orgId of new Set(docs.map((d) => d.org_id))) canOpen.set(orgId, await visibleDocIds(orgId));
        for (const d of docs.filter((d) => canOpen.get(d.org_id)?.has(d.id)).slice(0, 5)) results.push({ id: `doc:${d.id}`, kind: 'doc', title: docTitle(d.filename), subtitle: `Doc · ${d.org_title}`, href: `/org/${encodeURIComponent(d.org_slug ?? d.org_id)}?tab=docs&doc=${encodeURIComponent(d.slug)}`, chip: null });
    }

    // Quick actions (report §30.1).
    const lower = q.toLowerCase();
    if ('join with code'.includes(lower) || lower.startsWith('join')) results.push({ id: 'action:join', kind: 'action', title: 'Join with code', subtitle: 'Enter an organization code', href: '/join', chip: null });
    // One button (problem 4): New task, which becomes an assignment when it goes to many people.
    if (scope?.isAdmin && ('new task'.includes(lower) || lower.startsWith('new t') || lower.startsWith('assign'))) results.push({ id: 'action:task', kind: 'action', title: `New task in ${scope.title}`, subtitle: 'Quick action', href: `/org/${encodeURIComponent(scope.slug ?? scope.id)}?tab=tasks&new=1`, chip: null });
    if (scope?.canCreate && ('new workspace'.includes(lower) || lower.startsWith('new p'))) results.push({ id: 'action:project', kind: 'action', title: `New workspace in ${scope.title}`, subtitle: 'Quick action', href: `/workspaces/new?org=${encodeURIComponent(scope.id)}`, chip: null });
    return results;
}

/** Org badge maths for the Network page and My work: open invitations plus admins' join requests. */
export async function readOrgPendingCountAction(): Promise<number> {
    const data = await readOrgRequestsForMeAction();
    return data ? data.invites.length + data.joinRequests.reduce((n, g) => n + g.count, 0) : 0;
}

/** Projects I'm a member of, grouped under the org they belong to (for My work's org filter). */
export async function readMyOrgsAction() {
    const userId = await viewer();
    if (!userId) return [];
    return db.select({ id: workspaces.id, title: workspaces.title }).from(workspaces)
        .where(and(eq(workspaces.kind, 'organization'), isNull(workspaces.deletedAt),
            sql`(${workspaces.ownerId} = ${userId} OR EXISTS (SELECT 1 FROM ${workspaceMembers} m WHERE m.workspace_id = ${workspaces.id} AND m.user_id = ${userId}))`))
        .orderBy(desc(workspaces.updatedAt)).limit(50);
}

