'use server';

import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { profiles, workspaceMembers, workspaceNodeEvents, workspaceNodes, workspaceOpenRoles, workspaces, workspaceSprints, workspaceUpdates, roleApplications, taskActivityEvents, taskTeamMembers, tasks } from '@/lib/db/schema';
import { getWorkspaceAccessById, type WorkspaceAccess } from '@/lib/data/workspace-access';
import { orgFileAccessSql } from '@/lib/files/internal-helpers';
import { copyState, type CopyState } from '@/lib/organizations/assignment-rules';
import { activityVisible, getStartedSteps, journeyFromSprints, needsAttention, type ActivityKind } from '@/lib/organizations/dashboard-rules';
import { readViewerOrgRole } from '@/lib/organizations/detail';
import { readOrgDocsAction } from '@/app/actions/org-docs';
import { normalizeWorkspacePublicTabVisibility } from '@/lib/workspaces/settings-policies';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { copyColumns, leadSprintRows, ownCopies, plural, readNeedsYou, stateOf, type NeedsYouRow, type OrgViewer } from '@/lib/organizations/needs-you';

export type { NeedsYouRow };
export type ActivityItem = { id: string; kind: ActivityKind; text: string; at: string; href: string };

// Org Dashboard (report §27), About (§22) and Projects (§28). Everything is derived; no new tables.

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You don’t have permission to see this." };
const DAY = 86_400_000;


async function orgViewer(orgId: string): Promise<OrgViewer | null> {
    const { userId } = await getViewerAuthContext();
    const access = await getWorkspaceAccessById(orgId, userId);
    if (access.project?.kind !== 'organization' || !access.canRead) return null;
    const [org] = await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, status: workspaces.status }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
    return org ? {
        userId,
        access,
        isAdmin: access.isOwner || access.memberRole === 'admin',
        isInside: access.isOwner || access.isMember,
        isGuest: access.memberRole === 'viewer',
        org,
    } : null;
}

/** Org activity with the privacy filter (report §27.2); `publicOnly` is About's public-safe list (§22.2). */
async function readActivity(v: OrgViewer, filter: string, opts: { publicOnly?: boolean; limit?: number } = {}): Promise<ActivityItem[]> {
    const base = `/org/${encodeURIComponent(v.org.slug ?? v.org.id)}`;
    const since = new Date(Date.now() - 30 * DAY);
    const want = (k: ActivityKind) => filter === 'all' || (filter === 'assignments' && (k === 'assignment' || k === 'submission')) || (filter === 'people' && k === 'joins') || (filter === 'files' && (k === 'file' || k === 'doc')) || (filter === 'projects' && k === 'project');
    const items: Array<ActivityItem & { actorId: string | null; public?: boolean }> = [];
    const [sprints, children, joins, posts, files, masters, submissions] = await Promise.all([
        db.select({ id: workspaceSprints.id, name: workspaceSprints.name, status: workspaceSprints.status, startDate: workspaceSprints.startDate, completedAt: workspaceSprints.completedAt })
            .from(workspaceSprints).where(and(eq(workspaceSprints.projectId, v.org.id), or(gte(workspaceSprints.completedAt, since), and(eq(workspaceSprints.status, 'active'), gte(workspaceSprints.startDate, since))))),
        db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, visibility: workspaces.visibility, createdAt: workspaces.createdAt, ownerId: workspaces.ownerId })
            .from(workspaces).where(and(eq(workspaces.parentId, v.org.id), isNull(workspaces.deletedAt), gte(workspaces.createdAt, since))),
        db.select({ n: sql<number>`count(*)::int` }).from(workspaceMembers).where(and(eq(workspaceMembers.projectId, v.org.id), gte(workspaceMembers.joinedAt, new Date(Date.now() - 7 * DAY)))),
        db.select({ id: workspaceUpdates.id, content: workspaceUpdates.content, createdAt: workspaceUpdates.createdAt, visibility: workspaceUpdates.visibility, audience: workspaceUpdates.audience, authorId: workspaceUpdates.authorId })
            .from(workspaceUpdates).where(and(eq(workspaceUpdates.projectId, v.org.id), eq(workspaceUpdates.updateType, 'announcement'), isNull(workspaceUpdates.deletedAt), gte(workspaceUpdates.createdAt, since))),
        opts.publicOnly ? Promise.resolve([]) : db.select({ id: workspaceNodeEvents.id, nodeId: workspaceNodes.id, name: workspaceNodes.name, at: workspaceNodeEvents.createdAt, actorId: workspaceNodeEvents.actorId })
            .from(workspaceNodeEvents).innerJoin(workspaceNodes, and(eq(workspaceNodes.id, workspaceNodeEvents.nodeId), isNull(workspaceNodes.deletedAt), isNull(workspaceNodes.taskId)))
            .where(and(eq(workspaceNodeEvents.projectId, v.org.id), eq(workspaceNodeEvents.type, 'create_file'), gte(workspaceNodeEvents.createdAt, since), orgFileAccessSql(v.access)))
            .orderBy(desc(workspaceNodeEvents.createdAt)).limit(10),
        opts.publicOnly ? Promise.resolve([]) : db.select({ id: tasks.id, title: tasks.title, createdAt: tasks.createdAt, creatorId: tasks.creatorId }).from(tasks)
            .where(and(eq(tasks.projectId, v.org.id), eq(tasks.kind, 'assignment'), isNull(tasks.assignmentId), isNull(tasks.deletedAt), gte(tasks.createdAt, since))),
        opts.publicOnly ? Promise.resolve([]) : db.select({ id: taskActivityEvents.id, at: taskActivityEvents.createdAt, actorId: taskActivityEvents.actorId, title: tasks.title, name: profiles.fullName, username: profiles.username })
            .from(taskActivityEvents).innerJoin(tasks, eq(tasks.id, taskActivityEvents.taskId)).leftJoin(profiles, eq(profiles.id, taskActivityEvents.actorId))
            .where(and(eq(taskActivityEvents.projectId, v.org.id), eq(taskActivityEvents.eventType, 'review_submitted'), isNotNull(tasks.assignmentId), gte(taskActivityEvents.createdAt, since)))
            .orderBy(desc(taskActivityEvents.createdAt)).limit(20),
    ]);
    for (const s of sprints) {
        if (s.completedAt) items.push({ id: `sprint-done:${s.id}`, kind: 'sprint', text: `${s.name} completed`, at: s.completedAt.toISOString(), href: `${base}?tab=sprints`, actorId: null });
        else items.push({ id: `sprint-start:${s.id}`, kind: 'sprint', text: `${s.name} started`, at: s.startDate.toISOString(), href: `${base}?tab=sprints`, actorId: null });
    }
    for (const c of children) {
        const seen = c.visibility === 'public' || (v.isInside && (c.visibility !== 'private' || v.isAdmin));
        if ((opts.publicOnly && c.visibility !== 'public') || !seen) continue;
        items.push({ id: `project:${c.id}`, kind: 'project', text: `${c.title} was created`, at: c.createdAt.toISOString(), href: `/workspaces/${encodeURIComponent(c.slug ?? c.id)}`, actorId: c.ownerId });
    }
    if (joins[0] && joins[0].n > 0) items.push({ id: 'joins:week', kind: 'joins', text: `${plural(joins[0].n, 'person')} joined this week`.replace('persons', 'people'), at: new Date().toISOString(), href: base, actorId: null });
    for (const p of posts) {
        const everyone = !p.audience || Object.keys(p.audience as object).length === 0;
        if (!v.isAdmin && !everyone) continue;
        if (!v.isInside && p.visibility !== 'public') continue;
        items.push({ id: `post:${p.id}`, kind: 'announcement', text: p.content.slice(0, 120), at: p.createdAt.toISOString(), href: `${base}?tab=updates&updateId=${p.id}`, actorId: p.authorId, public: p.visibility === 'public' && everyone });
    }
    if (v.isInside) {
        for (const f of files) items.push({ id: `file:${f.id}`, kind: 'file', text: `${f.name} added`, at: f.at.toISOString(), href: `${base}?tab=files&fileId=${f.nodeId}`, actorId: f.actorId });
        for (const m of masters) items.push({ id: `assignment:${m.id}`, kind: 'assignment', text: `${m.title} was assigned`, at: m.createdAt.toISOString(), href: `${base}?tab=tasks`, actorId: m.creatorId });
        for (const s of submissions) items.push({ id: `submission:${s.id}`, kind: 'submission', text: `${s.name || s.username || 'Someone'} submitted ${s.title}`, at: s.at.toISOString(), href: `${base}?tab=tasks`, actorId: s.actorId });
    }
    const viewer = { isAdmin: v.isAdmin, userId: v.userId, publicOnly: opts.publicOnly };
    return items
        .filter((e) => want(e.kind) && activityVisible(e, viewer))
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, opts.limit ?? 30)
        .map(({ actorId: _actor, public: _public, ...item }) => item);
}

export type SprintItem = { masterId: string; title: string; dueDate: string | null; counts?: { done: number; total: number; missing: number }; own?: { state: CopyState; late: boolean } };

export type OrgDashboardData = {
    success: true;
    role: 'admin' | 'member' | 'guest';
    pinned: { id: string; content: string } | null;
    needsYou: NeedsYouRow[];
    thisSprint: { sprint: { id: string; name: string; endDate: string } | null; next: { name: string; startDate: string } | null; items: SprintItem[] };
    comingUp: Array<{ date: string; label: string }>;
    activity: ActivityItem[];
    projects: Array<{ id: string; title: string; slug: string | null; lastActivityAt: string }>;
    people: { avatars: Array<{ id: string; name: string; avatarUrl: string | null }>; total: number; joinedThisWeek: number; requests: number };
    getStarted: string[];
    /** Archived orgs (report §27.4): "CSE-3A ended Dec 2026 · 5 sprints · 40 assignments · 64 members". */
    archivedSummary: string | null;
};

/** The org Dashboard for people in the org (report §27); visitors never see it. */
export async function readOrgDashboardAction(orgId: string, activityFilter = 'all'): Promise<OrgDashboardData | Failure> {
    const v = await orgViewer(orgId);
    if (!v || !v.isInside) return DENIED;
    const now = new Date();
    const [[pinned], sprints, masters, needsYou, activity, people, [counts]] = await Promise.all([
        db.select({ id: workspaceUpdates.id, content: workspaceUpdates.content }).from(workspaceUpdates).where(and(
            eq(workspaceUpdates.projectId, orgId), eq(workspaceUpdates.isPinned, true), isNull(workspaceUpdates.deletedAt),
            or(isNull(workspaceUpdates.pinnedUntil), gt(workspaceUpdates.pinnedUntil, now)),
            v.isAdmin ? undefined : sql`${workspaceUpdates.audience} = '{}'::jsonb`,
        )).orderBy(desc(workspaceUpdates.createdAt)).limit(1),
        db.select({ id: workspaceSprints.id, name: workspaceSprints.name, status: workspaceSprints.status, startDate: workspaceSprints.startDate, endDate: workspaceSprints.endDate })
            .from(workspaceSprints).where(and(eq(workspaceSprints.projectId, orgId), ne(workspaceSprints.status, 'completed'))).orderBy(asc(workspaceSprints.startDate)),
        db.select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, sprintId: tasks.sprintId }).from(tasks)
            .where(and(eq(tasks.projectId, orgId), eq(tasks.kind, 'assignment'), isNull(tasks.assignmentId), isNull(tasks.deletedAt))),
        readNeedsYou(v, now),
        readActivity(v, activityFilter),
        db.select({ id: profiles.id, name: profiles.fullName, username: profiles.username, avatarUrl: profiles.avatarUrl, joinedAt: workspaceMembers.joinedAt, show: workspaceMembers.showOnProfile })
            .from(workspaceMembers).innerJoin(profiles, eq(profiles.id, workspaceMembers.userId)).where(eq(workspaceMembers.projectId, orgId)).orderBy(desc(workspaceMembers.joinedAt)),
        db.select({
            requests: sql<number>`(SELECT count(*)::int FROM role_applications WHERE workspace_id = ${orgId} AND role_id IS NULL AND status = 'pending')`,
            files: sql<number>`(SELECT count(*)::int FROM workspace_nodes WHERE workspace_id = ${orgId} AND type = 'file' AND deleted_at IS NULL)`,
            announcements: sql<number>`(SELECT count(*)::int FROM workspace_updates WHERE workspace_id = ${orgId} AND update_type = 'announcement' AND deleted_at IS NULL)`,
            allSprints: sql<number>`(SELECT count(*)::int FROM workspace_sprints WHERE workspace_id = ${orgId})`,
        }).from(workspaces).where(eq(workspaces.id, orgId)),
    ]);
    const active = sprints.find((s) => s.status === 'active') ?? null;
    const next = sprints.find((s) => s.status !== 'active' && s.startDate > now) ?? null;
    const inSprint = active ? masters.filter((m) => m.sprintId === active.id) : [];
    const copies = inSprint.length ? await db.select(copyColumns).from(tasks).where(and(inArray(tasks.assignmentId, inSprint.map((m) => m.id)), isNull(tasks.deletedAt))) : [];
    const mine = v.userId && !v.isAdmin ? new Set((await ownCopies(orgId, v.userId)).map((c) => c.id)) : new Set<string>();
    const items: SprintItem[] = inSprint.map((m) => {
        const of = copies.filter((c) => c.assignmentId === m.id).map((c) => ({ c, s: stateOf(c, now) }));
        const counted = of.filter(({ s }) => s.state !== 'excused');
        const own = of.find(({ c }) => mine.has(c.id));
        return {
            masterId: m.id, title: m.title, dueDate: m.dueDate?.toISOString() ?? null,
            ...(v.isAdmin || v.isGuest ? { counts: { done: counted.filter(({ s }) => s.state === 'done').length, total: counted.length, missing: counted.filter(({ s }) => s.state === 'missing').length } } : {}),
            ...(own ? { own: own.s } : {}),
        };
    });
    // Coming up · next 7 days (report §27.2): members their own due items; admins everything.
    const horizon = now.getTime() + 7 * DAY;
    const within = (d: Date | null) => Boolean(d && d.getTime() >= now.getTime() && d.getTime() <= horizon);
    const comingUp: Array<{ date: string; label: string }> = [];
    for (const s of sprints) {
        if (within(s.endDate)) comingUp.push({ date: s.endDate.toISOString(), label: `${s.name} ends` });
        if (s.status !== 'active' && within(s.startDate)) comingUp.push({ date: s.startDate.toISOString(), label: `${s.name} starts` });
    }
    if (v.isAdmin || v.isGuest) for (const m of masters) { if (within(m.dueDate)) comingUp.push({ date: m.dueDate!.toISOString(), label: `${m.title} due` }) }
    else if (v.userId) for (const c of await ownCopies(orgId, v.userId)) { if (within(c.dueDate) && stateOf(c, now).state !== 'done') comingUp.push({ date: c.dueDate!.toISOString(), label: `${c.title} due` }) }
    comingUp.sort((a, b) => a.date.localeCompare(b.date));

    const projectRows = await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, updatedAt: workspaces.updatedAt, visibility: workspaces.visibility }).from(workspaces)
        .where(and(eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt), ne(workspaces.status, 'archived'),
            v.isAdmin ? undefined : sql`EXISTS (SELECT 1 FROM workspace_members pm WHERE pm.workspace_id = ${workspaces.id} AND pm.user_id = ${v.userId})`))
        .orderBy(desc(workspaces.updatedAt)).limit(5);
    const weekAgo = now.getTime() - 7 * DAY;
    const archived = v.org.status === 'archived';
    let archivedSummary: string | null = null;
    if (archived) {
        const [org] = await db.select({ title: workspaces.title, termEnd: workspaces.termEnd, updatedAt: workspaces.updatedAt }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
        const ended = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(org?.termEnd ? new Date(org.termEnd) : org?.updatedAt ?? now);
        const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
        archivedSummary = `${org?.title ?? 'This organization'} ended ${ended} · ${n(counts?.allSprints ?? 0, 'sprint')} · ${n(masters.length, 'assignment')} · ${n(people.length, 'member')}`;
    }
    // Archived: admins keep end-of-term verification (report §27.4); everything else is read-only.
    const archivedNeeds: NeedsYouRow[] = archived && v.isAdmin ? [{ kind: 'verify', label: 'Verify contributions for the term', href: `/org/${encodeURIComponent(v.org.slug ?? orgId)}?tab=members` }] : [];
    return {
        success: true,
        role: v.isAdmin ? 'admin' : v.isGuest ? 'guest' : 'member',
        pinned: pinned ?? null,
        needsYou: v.isGuest ? [] : archived ? archivedNeeds : needsYou,
        thisSprint: {
            sprint: active ? { id: active.id, name: active.name, endDate: active.endDate.toISOString() } : null,
            next: !active && next ? { name: next.name, startDate: next.startDate.toISOString() } : null,
            items,
        },
        comingUp: comingUp.slice(0, 12),
        activity,
        projects: projectRows.map((p) => ({ id: p.id, title: p.title, slug: p.slug, lastActivityAt: p.updatedAt.toISOString() })),
        people: {
            avatars: people.filter((p) => p.show).slice(0, 8).map((p) => ({ id: p.id, name: p.name || p.username || 'Member', avatarUrl: p.avatarUrl })),
            total: people.length,
            joinedThisWeek: people.filter((p) => p.joinedAt && p.joinedAt.getTime() > weekAgo).length,
            requests: v.isAdmin ? counts?.requests ?? 0 : 0,
        },
        archivedSummary,
        getStarted: v.isAdmin && !archived ? getStartedSteps({ members: people.length, sprints: counts?.allSprints ?? 0, files: counts?.files ?? 0, announcements: counts?.announcements ?? 0, assignments: masters.length }) : [],
    };
}

export type OrgAboutData = {
    success: true;
    projects: Array<{ id: string; title: string; slug: string | null; visibility: string | null }>;
    journey: ReturnType<typeof journeyFromSprints> | null;
    activity: ActivityItem[];
    leaders: Array<{ id: string; name: string; username: string | null; role: 'owner' | 'admin'; title: string | null }>;
    card: { kind: 'invite'; joinCode: string | null } | { kind: 'member' | 'guest'; joinedAt: string | null } | { kind: 'visitor' };
};

/** About (report §22): projects, the Journey from sprints, public-safe activity, the per-person card, Leaders. */
export async function readOrgAboutAction(orgId: string): Promise<OrgAboutData | Failure> {
    const v = await orgViewer(orgId);
    if (!v) return DENIED;
    const tabs = normalizeWorkspacePublicTabVisibility(v.access.project?.publicTabVisibility);
    const [children, sprints, leaders, [org], [me]] = await Promise.all([
        db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, visibility: workspaces.visibility }).from(workspaces).where(and(
            eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt), ne(workspaces.status, 'archived'),
            v.isAdmin ? undefined : v.isInside
                ? or(ne(workspaces.visibility, 'private'), sql`EXISTS (SELECT 1 FROM workspace_members pm WHERE pm.workspace_id = ${workspaces.id} AND pm.user_id = ${v.userId})`)
                : eq(workspaces.visibility, 'public'),
        )).orderBy(desc(workspaces.updatedAt)).limit(3),
        v.isInside || tabs.sprints
            ? db.select({ name: workspaceSprints.name, status: workspaceSprints.status, startDate: workspaceSprints.startDate, endDate: workspaceSprints.endDate, completedAt: workspaceSprints.completedAt }).from(workspaceSprints).where(eq(workspaceSprints.projectId, orgId))
            : Promise.resolve(null),
        db.select({ id: profiles.id, name: profiles.fullName, username: profiles.username, role: workspaceMembers.role, title: workspaceMembers.title, show: workspaceMembers.showOnProfile })
            .from(workspaceMembers).innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
            .where(and(eq(workspaceMembers.projectId, orgId), inArray(workspaceMembers.role, ['owner', 'admin']))),
        db.select({ joinCode: workspaces.joinCode, joinCodeEnabled: workspaces.joinCodeEnabled, ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1),
        v.userId ? db.select({ joinedAt: workspaceMembers.joinedAt }).from(workspaceMembers).where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.userId, v.userId))).limit(1) : Promise.resolve([]),
    ]);
    const card: OrgAboutData['card'] = v.isAdmin ? { kind: 'invite', joinCode: org?.joinCodeEnabled ? org.joinCode : null }
        : v.isInside ? { kind: v.isGuest ? 'guest' : 'member', joinedAt: me?.joinedAt?.toISOString() ?? null }
            : { kind: 'visitor' };
    return {
        success: true,
        projects: children,
        journey: sprints && sprints.length ? journeyFromSprints(sprints) : null,
        activity: await readActivity(v, 'all', { publicOnly: true, limit: 5 }),
        // Visitors see only leaders who show the org on their profile (report §22.3).
        leaders: leaders.filter((l) => v.isInside || l.show).sort((a, b) => (a.id === org?.ownerId ? -1 : b.id === org?.ownerId ? 1 : 0))
            .map((l) => ({ id: l.id, name: l.name || l.username || 'Admin', username: l.username, role: l.id === org?.ownerId ? 'owner' as const : 'admin' as const, title: l.title })),
        card,
    };
}

export type OrgWorkspaceRow = {
    id: string; title: string; slug: string | null; visibility: string | null; status: string | null;
    lead: { id: string; name: string } | null; members: number; units: number;
    open: number; overdue: number; inReview: number; groupCopy: { title: string; state: CopyState } | null;
    lastActivityAt: string; reasons: string[]; mine: boolean;
    /** Journey stage, the running sprint and whether it sits inside the org's running sprint (report §28.2–28.3). */
    stage: string | null; sprint: { name: string; inOrgSprint: boolean } | null; newInOrg: boolean;
};

/** Projects tab (report §28): admins see every child project (Private too) with Needs attention; others what they may. */
export async function readOrgWorkspacesAction(orgId: string): Promise<{ success: true; isAdmin: boolean; canCreate: boolean; rows: OrgWorkspaceRow[]; summary: { total: number; attention: number; quiet: number; notInProject: number } } | Failure> {
    const v = await orgViewer(orgId);
    if (!v || !v.isInside) return DENIED;
    const now = new Date();
    // ponytail: every child project in one read, sized for ORG_LIMITS.childProjectsPerOrg (200). Upgrade: 50-row pages.
    const rows = await db.select({
        id: workspaces.id, title: workspaces.title, slug: workspaces.slug, visibility: workspaces.visibility, status: workspaces.status, updatedAt: workspaces.updatedAt, ownerId: workspaces.ownerId,
        leadName: profiles.fullName, leadUsername: profiles.username,
        members: sql<number>`(SELECT count(*)::int FROM workspace_members pm WHERE pm.workspace_id = ${workspaces.id})`,
        units: sql<number>`(SELECT count(*)::int FROM ${workspaceOpenRoles} r WHERE r.workspace_id = ${workspaces.id})`,
        open: sql<number>`(SELECT count(*)::int FROM tasks t WHERE t.workspace_id = ${workspaces.id} AND t.deleted_at IS NULL AND t.status <> 'done')`,
        overdue: sql<number>`(SELECT count(*)::int FROM tasks t WHERE t.workspace_id = ${workspaces.id} AND t.deleted_at IS NULL AND t.status <> 'done' AND t.due_date < now())`,
        inReview: sql<number>`(SELECT count(*)::int FROM tasks t WHERE t.workspace_id = ${workspaces.id} AND t.deleted_at IS NULL AND t.review_status = 'pending')`,
        lastTaskAt: sql<Date | null>`(SELECT max(t.updated_at) FROM tasks t WHERE t.workspace_id = ${workspaces.id})`,
        stage: sql<string | null>`${workspaces.lifecycleStages}->>coalesce(${workspaces.currentStageIndex}, 0)`,
        sprintName: sql<string | null>`(SELECT s.name FROM workspace_sprints s WHERE s.workspace_id = ${workspaces.id} AND s.status = 'active' ORDER BY s.start_date DESC LIMIT 1)`,
        inOrgSprint: sql<boolean>`EXISTS (SELECT 1 FROM workspace_sprints s JOIN workspace_sprints o ON o.id = s.parent_sprint_id AND o.status = 'active' WHERE s.workspace_id = ${workspaces.id} AND s.status = 'active')`,
        newInOrg: sql<boolean>`coalesce((${workspaces.orgSettings}->>'movedInAt')::timestamptz > now() - interval '7 days', false)`,
        mine: v.userId ? sql<boolean>`EXISTS (SELECT 1 FROM workspace_members pm WHERE pm.workspace_id = ${workspaces.id} AND pm.user_id = ${v.userId})` : sql<boolean>`false`,
        leadInOrg: sql<boolean>`(${workspaces.ownerId} = ${v.access.project!.ownerId} OR EXISTS (SELECT 1 FROM workspace_members pm WHERE pm.workspace_id = ${orgId} AND pm.user_id = ${workspaces.ownerId}))`,
    }).from(workspaces).leftJoin(profiles, eq(profiles.id, workspaces.ownerId))
        .where(and(eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt)))
        .orderBy(desc(workspaces.updatedAt)).limit(200);
    const visible = rows.filter((r) => v.isAdmin || r.mine || r.visibility !== 'private');
    const groupCopies = visible.length ? await db.select(copyColumns).from(tasks).where(and(inArray(tasks.projectId, visible.map((r) => r.id)), isNotNull(tasks.assignmentId), isNull(tasks.deletedAt))).orderBy(desc(tasks.dueDate)) : [];
    const out: OrgWorkspaceRow[] = visible.map((r) => {
        const copy = groupCopies.find((c) => c.projectId === r.id);
        const state = copy ? stateOf(copy, now).state : null;
        const lastActivity = [r.updatedAt, r.lastTaskAt ? new Date(r.lastTaskAt) : null].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? r.updatedAt;
        return {
            id: r.id, title: r.title, slug: r.slug, visibility: r.visibility, status: r.status,
            lead: { id: r.ownerId, name: r.leadName || r.leadUsername || 'Owner' },
            members: r.members, units: r.units, open: r.open, overdue: r.overdue, inReview: r.inReview,
            groupCopy: copy && state ? { title: copy.title, state } : null,
            lastActivityAt: lastActivity.toISOString(),
            reasons: v.isAdmin ? needsAttention({ overdue: r.overdue, lastActivityAt: lastActivity, groupCopyState: state, leadInOrg: Boolean(r.leadInOrg), status: r.status, now }) : [],
            mine: Boolean(r.mine),
            stage: r.stage ?? null,
            sprint: r.sprintName ? { name: r.sprintName, inOrgSprint: Boolean(r.inOrgSprint) } : null,
            newInOrg: Boolean(r.newInOrg),
        };
    });
    const [{ n: notInProject } = { n: 0 }] = v.isAdmin ? await db.select({ n: sql<number>`count(*)::int` }).from(workspaceMembers).where(and(
        eq(workspaceMembers.projectId, orgId),
        sql`NOT EXISTS (SELECT 1 FROM workspace_members cm JOIN workspaces c ON c.id = cm.workspace_id WHERE c.parent_id = ${orgId} AND c.deleted_at IS NULL AND cm.user_id = ${workspaceMembers.userId})`,
    )) : [{ n: 0 }];
    // + New project (report §14.1 E1): admins always; members when the org lets members create.
    const [org] = await db.select({ settings: workspaces.orgSettings, status: workspaces.status }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
    const canCreate = !v.isGuest && org?.status !== 'archived' && !v.access.writeBlocked
        && (v.isAdmin || (org?.settings as { childCreation?: string } | null)?.childCreation !== 'admins');
    return {
        success: true,
        isAdmin: v.isAdmin,
        canCreate,
        rows: out,
        summary: { total: out.length, attention: out.filter((r) => r.reasons.length > 0).length, quiet: out.filter((r) => r.reasons.includes('quiet 7 days')).length, notInProject },
    };
}

/** `Part of CSE-3A · CO2 ends Fri · 1 assignment due` on a child project's Dashboard (report §22.5, §27.5). */
export async function readChildOrgLineAction(childProjectId: string) {
    const { userId } = await getViewerAuthContext();
    const [child] = await db.select({ parentId: workspaces.parentId, ownerId: workspaces.ownerId, slug: workspaces.slug }).from(workspaces).where(and(eq(workspaces.id, childProjectId), isNull(workspaces.deletedAt))).limit(1);
    if (!child?.parentId || !(await readViewerOrgRole(child.parentId, userId))) return null; // outside people don't get the org line
    // Org membership alone doesn't open a private child project: its sprint and group copies need read access.
    if (!userId || !(await getWorkspaceAccessById(childProjectId, userId)).canRead) return null;
    const [[org], [sprint], due, [ownSprint]] = await Promise.all([
        db.select({ title: workspaces.title, slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, child.parentId)).limit(1),
        db.select({ name: workspaceSprints.name, endDate: workspaceSprints.endDate }).from(workspaceSprints).where(and(eq(workspaceSprints.projectId, child.parentId), eq(workspaceSprints.status, 'active'))).limit(1),
        db.select({ ...copyColumns, title: tasks.title }).from(tasks).where(and(eq(tasks.projectId, childProjectId), isNotNull(tasks.assignmentId), isNull(tasks.deletedAt))),
        // The project's own running sprint and the org sprint holding it: "Inside CO2 (CSE-3A) · ends Fri" (report §27.5).
        db.execute<{ name: string; end_date: string; parent: string | null }>(sql`
            SELECT s.name, s.end_date::text, p.name AS parent FROM workspace_sprints s LEFT JOIN workspace_sprints p ON p.id = s.parent_sprint_id
            WHERE s.workspace_id = ${childProjectId} AND s.status = 'active' ORDER BY s.start_date DESC LIMIT 1`),
    ]);
    if (!org) return null;
    const now = new Date();
    const open = due.filter((c) => ['not_started', 'in_progress', 'returned', 'missing'].includes(stateOf(c, now).state));
    // What's happening (report §27.5): the org's group copies for this project and, for the lead, linked-sprint items.
    const projectHref = `/workspaces/${encodeURIComponent(child.slug ?? childProjectId)}`;
    const needsYou: NeedsYouRow[] = open.map((c) => ({ kind: 'group', label: `${c.title} for the workspace${stateOf(c, now).state === 'missing' ? ' · missing' : ''}`, href: `${projectHref}?tab=tasks` }));
    if (userId && child.ownerId === userId) needsYou.push(...(await leadSprintRows(child.parentId, userId)).filter((r) => r.href.startsWith(projectHref)));
    return {
        orgTitle: org.title, orgSlug: org.slug, sprint: sprint ? { name: sprint.name, endDate: sprint.endDate.toISOString() } : null, dueCount: open.length,
        needsYou: needsYou.slice(0, 5),
        ownSprint: ownSprint ? { name: ownSprint.name, endDate: ownSprint.end_date, parent: ownSprint.parent } : null,
    };
}

/**
 * Remind leads (report §28.4, §28.7): each selected project's lead hears what's open, "CSE-3A reminded you: Proposal
 * is missing" or "3 tasks overdue". Admins only; at most once per lead and project every 12 hours.
 */
export async function remindLeadsAction(orgId: string, projectIds: string[]): Promise<{ success: true; reminded: number } | Failure> {
    const v = await orgViewer(orgId);
    if (!v?.isAdmin || !v.userId) return DENIED;
    const read = await readOrgWorkspacesAction(orgId);
    if (!read.success) return read;
    const { notifyOrg } = await import('@/lib/organizations/notify');
    const window = Math.floor(Date.now() / (12 * 3_600_000));
    let reminded = 0;
    for (const row of read.rows.filter((r) => projectIds.includes(r.id) && r.lead)) {
        const what = row.groupCopy && ['missing', 'returned', 'not_started', 'in_progress'].includes(row.groupCopy.state)
            ? `${row.groupCopy.title} is ${row.groupCopy.state === 'missing' ? 'missing' : row.groupCopy.state === 'returned' ? 'returned' : 'not submitted yet'}`
            : row.overdue ? `${row.overdue} ${row.overdue === 1 ? 'task is' : 'tasks are'} overdue in ${row.title}` : null;
        if (!what) continue;
        await notifyOrg({ orgId, eventKey: 'assignments.due_changed', actorId: v.userId, to: [row.lead!.id], title: `${v.org.title} reminded you: ${what}`,
            href: `/workspaces/${encodeURIComponent(row.slug ?? row.id)}?tab=tasks`, sourceEventId: `remind-lead:${row.id}:${window}` });
        reminded += 1;
    }
    return { success: true, reminded };
}
