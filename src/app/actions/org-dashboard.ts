'use server';

import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { docTitle } from '@/lib/organizations/doc-rules';
import { isUuid } from '@/lib/validations/uuid';
import { profileContributions, profiles, workspaceMembers, workspaceUpdateHidden, workspaceNodeEvents, workspaceNodes, workspaceOpenRoles, workspaces, workspaceSprints, workspaceUpdates, roleApplications, taskActivityEvents, taskTeamMembers, tasks } from '@/lib/db/schema';
import { getWorkspaceAccessById, type WorkspaceAccess } from '@/lib/data/workspace-access';
import { orgFileAccessSql } from '@/lib/files/internal-helpers';
import { copyState, type CopyState } from '@/lib/organizations/assignment-rules';
import { activityVisible, classStanding, getStartedCards, journeyFromSprints, needsAttention, todayRows, weekGroup, weekLine, type ActivityKind, type TodayRow } from '@/lib/organizations/dashboard-rules';
import { typeProfile } from '@/lib/organizations/type-profile';
import { readPrivateOrgState } from '@/lib/organizations/join';
import { privateOrgLine } from '@/lib/organizations/join-rules';

/** "How the class is doing" in the type's word (report §34.2). */
const CLASS_WORD: Record<string, string> = { education: 'class', company: 'team', research: 'lab', community: 'group', club: 'club', other: 'group' };
import { activityMatches, activityTime } from '@/lib/organizations/activity-rules';
import { readViewerOrgRole } from '@/lib/organizations/detail';
import { orgTaskReadFilter } from '@/lib/organizations/assignments';
import { childGrant, orgCan, orgRoleOf } from '@/lib/organizations/permissions';
import { audienceSql } from '@/lib/organizations/org-updates';
import { readOrgDocsAction } from '@/app/actions/org-docs';
import { normalizeWorkspacePublicTabVisibility } from '@/lib/workspaces/settings-policies';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { copyColumns, leadSprintRows, ownCopies, plural, readMemberStanding, readNeedsYou, readWorkspaceRequests, stateOf, type NeedsYouRow, type OrgViewer, type OrgWorkspaceRequest } from '@/lib/organizations/needs-you';

export type { NeedsYouRow };
export type ActivityItem = { id: string; kind: ActivityKind; text: string; at: string; href: string };

// Org Dashboard (report §27), About (§22) and Projects (§28). Everything is derived; no new tables.

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You don’t have permission to see this." };
const DAY = 86_400_000;
/** Drafts stay with owners and admins (report §42.2 problem 1). */
const published = sql`${tasks.assignmentSettings}->>'publishedAt' IS NOT NULL`;


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
/** What the audience rule needs about the viewer (decision 154): admin or not, their role, their workspaces. */
async function viewerAudience(v: OrgViewer) {
    const children = v.userId ? await db.select({ id: workspaces.id }).from(workspaces)
        .innerJoin(workspaceMembers, and(eq(workspaceMembers.projectId, workspaces.id), eq(workspaceMembers.userId, v.userId)))
        .where(and(eq(workspaces.parentId, v.org.id), isNull(workspaces.deletedAt))) : [];
    return { isOrgAdmin: v.isAdmin, viewerRole: v.access.isOwner ? 'owner' as const : (v.access.memberRole ?? null), viewerChildIds: children.map((c) => c.id) };
}

async function readActivity(v: OrgViewer, filter: string, opts: { publicOnly?: boolean; limit?: number; audience?: Awaited<ReturnType<typeof viewerAudience>> } = {}): Promise<ActivityItem[]> {
    const base = `/org/${encodeURIComponent(v.org.slug ?? v.org.id)}`;
    const since = new Date(Date.now() - 30 * DAY);
    const want = (k: ActivityKind) => activityMatches(filter, k);
    const items: Array<ActivityItem & { actorId: string | null; public?: boolean }> = [];
    const [sprints, children, joins, posts, files, masters, submissions] = await Promise.all([
        db.select({ id: workspaceSprints.id, name: workspaceSprints.name, status: workspaceSprints.status, startDate: workspaceSprints.startDate, startedAt: workspaceSprints.startedAt, completedAt: workspaceSprints.completedAt })
            .from(workspaceSprints).where(and(eq(workspaceSprints.projectId, v.org.id), or(gte(workspaceSprints.completedAt, since), and(eq(workspaceSprints.status, 'active'), gte(workspaceSprints.startDate, since))))),
        db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, visibility: workspaces.visibility, createdAt: workspaces.createdAt, ownerId: workspaces.ownerId })
            .from(workspaces).where(and(eq(workspaces.parentId, v.org.id), isNull(workspaces.deletedAt), gte(workspaces.createdAt, since))),
        db.select({ n: sql<number>`count(*)::int`, latest: sql<Date | null>`max(${workspaceMembers.joinedAt})` }).from(workspaceMembers).where(and(eq(workspaceMembers.projectId, v.org.id), gte(workspaceMembers.joinedAt, new Date(Date.now() - 7 * DAY)))),
        db.select({ id: workspaceUpdates.id, content: workspaceUpdates.content, createdAt: workspaceUpdates.createdAt, visibility: workspaceUpdates.visibility, audience: workspaceUpdates.audience, authorId: workspaceUpdates.authorId })
            .from(workspaceUpdates).where(and(eq(workspaceUpdates.projectId, v.org.id), eq(workspaceUpdates.updateType, 'announcement'), isNull(workspaceUpdates.deletedAt), gte(workspaceUpdates.createdAt, since),
                opts.audience ? audienceSql(opts.audience, v.userId) : undefined)),
        opts.publicOnly ? Promise.resolve([]) : db.select({ id: workspaceNodeEvents.id, nodeId: workspaceNodes.id, name: workspaceNodes.name, at: workspaceNodeEvents.createdAt, actorId: workspaceNodeEvents.actorId })
            .from(workspaceNodeEvents).innerJoin(workspaceNodes, and(eq(workspaceNodes.id, workspaceNodeEvents.nodeId), isNull(workspaceNodes.deletedAt), isNull(workspaceNodes.taskId)))
            .where(and(eq(workspaceNodeEvents.projectId, v.org.id), eq(workspaceNodeEvents.type, 'create_file'), gte(workspaceNodeEvents.createdAt, since), orgFileAccessSql(v.access)))
            .orderBy(desc(workspaceNodeEvents.createdAt)).limit(10),
        opts.publicOnly ? Promise.resolve([]) : db.select({ id: tasks.id, title: tasks.title, createdAt: tasks.createdAt, creatorId: tasks.creatorId }).from(tasks)
            .where(and(eq(tasks.projectId, v.org.id), eq(tasks.kind, 'assignment'), isNull(tasks.assignmentId), isNull(tasks.deletedAt), gte(tasks.createdAt, since), v.isAdmin ? undefined : published)),
        opts.publicOnly ? Promise.resolve([]) : db.select({ id: taskActivityEvents.id, at: taskActivityEvents.createdAt, actorId: taskActivityEvents.actorId, title: tasks.title, name: profiles.fullName, username: profiles.username })
            .from(taskActivityEvents).innerJoin(tasks, eq(tasks.id, taskActivityEvents.taskId)).leftJoin(profiles, eq(profiles.id, taskActivityEvents.actorId))
            .where(and(eq(taskActivityEvents.projectId, v.org.id), eq(taskActivityEvents.eventType, 'review_submitted'), isNotNull(tasks.assignmentId), gte(taskActivityEvents.createdAt, since)))
            .orderBy(desc(taskActivityEvents.createdAt)).limit(20),
    ]);
    for (const s of sprints) {
        if (s.completedAt) items.push({ id: `sprint-done:${s.id}`, kind: 'sprint', text: `${s.name} completed`, at: s.completedAt.toISOString(), href: `${base}?tab=sprints`, actorId: null });
        // Parity bug 3, report §5.3: when it really started, not the planned date.
        else items.push({ id: `sprint-start:${s.id}`, kind: 'sprint', text: `${s.name} started`, at: activityTime({ kind: 'sprint', startedAt: s.startedAt, plannedStart: s.startDate }).toISOString(), href: `${base}?tab=sprints`, actorId: null });
    }
    for (const c of children) {
        const seen = c.visibility === 'public' || (v.isInside && (c.visibility !== 'private' || v.isAdmin));
        if ((opts.publicOnly && c.visibility !== 'public') || !seen) continue;
        items.push({ id: `project:${c.id}`, kind: 'project', text: `${c.title} was created`, at: c.createdAt.toISOString(), href: `/workspaces/${encodeURIComponent(c.slug ?? c.id)}`, actorId: c.ownerId });
    }
    // Parity bug 4: the grouped row carries the time of the latest join, not the moment the page loaded.
    if (joins[0] && joins[0].n > 0) items.push({ id: 'joins:week', kind: 'joins', text: `${plural(joins[0].n, 'person')} joined this week`.replace('persons', 'people'), at: new Date(joins[0].latest ?? Date.now()).toISOString(), href: base, actorId: null });
    for (const p of posts) {
        const everyone = !p.audience || Object.keys(p.audience as object).length === 0;
        // Audience-limited posts reach only their audience (decision 154); without the viewer's audience, everyone-posts only.
        if (!v.isAdmin && !everyone && !opts.audience) continue;
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

export type SprintItem = { masterId: string; title: string; dueDate: string | null; counts?: { done: number; total: number; missing: number }; own?: { state: CopyState; late: boolean; extended: boolean } };

export type OrgDashboardData = {
    success: true;
    role: 'admin' | 'member' | 'guest';
    /** Live-fix 11: megaphone, author photo, one line, time; a dot until you've opened Updates since. */
    pinned: { id: string; content: string; at: string; authorName: string; authorAvatarUrl: string | null; unread: boolean; canUnpin: boolean } | null;
    needsYou: NeedsYouRow[];
    /** Live-fix 13: a real card. `ended` is a running sprint past its end date (Complete it); progress counts tasks and assignments. */
    thisSprint: { sprint: { id: string; name: string; goal: string | null; status: 'active' | 'ended'; startDate: string; endDate: string } | null; next: { name: string; startDate: string } | null; items: SprintItem[];
        tasks: Array<{ id: string; title: string; assignee: string | null; status: string }>; progress: { done: number; total: number } };
    comingUp: Array<{ date: string; label: string; kind: 'sprint' | 'due' }>;
    thisWeek: Array<{ date: string; label: string; kind: 'sprint' | 'due'; group: 'Today' | 'Tomorrow' | 'This week' }>;
    today: TodayRow[];
    standing: { onTrack: number; behind: number; inactive: number } | null;
    standingWord: string;
    weekLine: string | null;
    welcome: { note: string | null; start: Array<{ kind: string; label: string; href: string }>; addToProfile: boolean } | null;
    restricted: boolean;
    activity: ActivityItem[];
    /** Live-fix 17: avatar, "Lead · N members" and an overdue chip; admins see the most in need first. */
    projects: Array<{ id: string; title: string; slug: string | null; coverImage: string | null; lead: string | null; members: number; overdue: number }>;
    people: { avatars: Array<{ id: string; name: string; avatarUrl: string | null }>; total: number; joinedThisWeek: number; requests: number };
    getStarted: string[];
    /** The organization's time zone, for This week's date tiles. */
    timeZone: string | null;
    /** Archived orgs (report §27.4): "CSE-3A ended Dec 2026 · 5 sprints · 40 assignments · 64 members". */
    archivedSummary: string | null;
    /** Catch up (report §33.5): a late joiner's two weeks of "here's what you missed", with no copies. */
    catchUp: { line: string; sprints: Array<{ id: string; name: string; materials: Array<{ name: string; href: string }> }> } | null;
    /** Term summary (report §33.5): admins see how much work was completed; members their own record. */
    termSummary: { completedPercent: number | null; mine: { done: number; total: number } | null } | null;
};

/** The org Dashboard for people in the org (report §27); visitors never see it. */
export async function readOrgDashboardAction(orgId: string, activityFilter = 'all'): Promise<OrgDashboardData | Failure> {
    const v = await orgViewer(orgId);
    if (!v || !v.isInside) return DENIED;
    const now = new Date();
    const audience = await viewerAudience(v);
    const [[pinned], sprints, masters, needsYou, activity, people, [counts]] = await Promise.all([
        db.select({ id: workspaceUpdates.id, content: workspaceUpdates.content, createdAt: workspaceUpdates.createdAt, authorName: sql<string | null>`COALESCE(${profiles.fullName}, ${profiles.username})`,
            authorAvatarUrl: profiles.avatarUrl,
            unread: v.userId ? sql<boolean>`NOT EXISTS (SELECT 1 FROM workspace_members sm WHERE sm.workspace_id = ${orgId} AND sm.user_id = ${v.userId}::uuid AND sm.last_seen_updates_at >= ${workspaceUpdates.createdAt})` : sql<boolean>`false` })
            .from(workspaceUpdates).leftJoin(profiles, eq(profiles.id, workspaceUpdates.authorId)).where(and(
            eq(workspaceUpdates.projectId, orgId), eq(workspaceUpdates.isPinned, true), isNull(workspaceUpdates.deletedAt),
            or(isNull(workspaceUpdates.pinnedUntil), gt(workspaceUpdates.pinnedUntil, now)),
            audienceSql(audience, v.userId),
            v.userId ? sql`NOT EXISTS (SELECT 1 FROM workspace_update_hidden h WHERE h.update_id = ${workspaceUpdates.id} AND h.user_id = ${v.userId}::uuid)` : undefined,
        )).orderBy(desc(workspaceUpdates.createdAt)).limit(1),
        db.select({ id: workspaceSprints.id, name: workspaceSprints.name, goal: workspaceSprints.goal, status: workspaceSprints.status, startDate: workspaceSprints.startDate, endDate: workspaceSprints.endDate })
            .from(workspaceSprints).where(and(eq(workspaceSprints.projectId, orgId), ne(workspaceSprints.status, 'completed'))).orderBy(asc(workspaceSprints.startDate)),
        db.select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, sprintId: tasks.sprintId }).from(tasks)
            .where(and(eq(tasks.projectId, orgId), eq(tasks.kind, 'assignment'), isNull(tasks.assignmentId), isNull(tasks.deletedAt), v.isAdmin ? undefined : published)),
        readNeedsYou(v, now),
        readActivity(v, activityFilter, { audience }),
        db.select({ id: profiles.id, name: profiles.fullName, username: profiles.username, avatarUrl: profiles.avatarUrl, joinedAt: workspaceMembers.joinedAt, show: workspaceMembers.showOnProfile })
            .from(workspaceMembers).innerJoin(profiles, eq(profiles.id, workspaceMembers.userId)).where(eq(workspaceMembers.projectId, orgId)).orderBy(desc(workspaceMembers.joinedAt)),
        db.select({
            requests: sql<number>`(SELECT count(*)::int FROM role_applications WHERE workspace_id = ${orgId} AND role_id IS NULL AND status = 'pending')`,
            files: sql<number>`(SELECT count(*)::int FROM workspace_nodes WHERE workspace_id = ${orgId} AND type = 'file' AND deleted_at IS NULL)`,
            announcements: sql<number>`(SELECT count(*)::int FROM workspace_updates WHERE workspace_id = ${orgId} AND update_type = 'announcement' AND deleted_at IS NULL)`,
            allSprints: sql<number>`(SELECT count(*)::int FROM workspace_sprints WHERE workspace_id = ${orgId})`,
            tasks: sql<number>`(SELECT count(*)::int FROM tasks WHERE workspace_id = ${orgId} AND deleted_at IS NULL)`,
            workspaces: sql<number>`(SELECT count(*)::int FROM workspaces c WHERE c.parent_id = ${orgId} AND c.deleted_at IS NULL)`,
            documents: sql<number>`(SELECT count(*)::int FROM workspace_documents WHERE workspace_id = ${orgId})`,
            termStart: workspaces.termStart, termEnd: workspaces.termEnd, timeZone: workspaces.timeZone, orgType: workspaces.orgType,
            welcomeNote: workspaces.welcomeNote, restrictedAt: workspaces.restrictedAt,
        }).from(workspaces).where(eq(workspaces.id, orgId)),
    ]);
    const zone = counts?.timeZone ?? null;
    const profile = typeProfile(counts?.orgType);
    const active = sprints.find((s) => s.status === 'active') ?? null;
    const next = sprints.find((s) => s.status !== 'active' && s.startDate > now) ?? null;
    const inSprint = active ? masters.filter((m) => m.sprintId === active.id) : [];
    // Ordinary tasks in the running sprint, by the board's read rule (members see their own).
    const sprintTasks = active ? await db.select({ id: tasks.id, title: tasks.title, status: tasks.status, assignee: sql<string | null>`(SELECT COALESCE(p.full_name, p.username) FROM profiles p WHERE p.id = ${tasks.assigneeId})` })
        .from(tasks).where(and(eq(tasks.projectId, orgId), eq(tasks.sprintId, active.id), eq(tasks.kind, 'task'), isNull(tasks.assignmentId), isNull(tasks.deletedAt), orgTaskReadFilter(v.access, v.userId)))
        .orderBy(asc(tasks.createdAt)) : [];
    const copies = inSprint.length ? await db.select(copyColumns).from(tasks).where(and(inArray(tasks.assignmentId, inSprint.map((m) => m.id)), isNull(tasks.deletedAt))) : [];
    const mine = v.userId && !v.isAdmin ? new Set((await ownCopies(orgId, v.userId)).map((c) => c.id)) : new Set<string>();
    const items: SprintItem[] = inSprint.map((m) => {
        const of = copies.filter((c) => c.assignmentId === m.id).map((c) => ({ c, s: stateOf(c, now) }));
        const counted = of.filter(({ s }) => s.state !== 'excused');
        const own = of.find(({ c }) => mine.has(c.id));
        // Everyone sees their own copy's date, marked Extended when it differs (report §42.10 problem 14).
        const extended = Boolean(own?.c.dueDate && m.dueDate && own.c.dueDate.getTime() !== m.dueDate.getTime());
        return {
            masterId: m.id, title: m.title, dueDate: (own?.c.dueDate ?? m.dueDate)?.toISOString() ?? null,
            ...(v.isAdmin || v.isGuest ? { counts: { done: counted.filter(({ s }) => s.state === 'done').length, total: counted.length, missing: counted.filter(({ s }) => s.state === 'missing').length } } : {}),
            ...(own ? { own: { ...own.s, extended } } : {}),
        };
    });
    // This week (report §33.5, decision 80; was Coming up): calendar days in the organization's zone (parity bug 7).
    const within = (d: Date | null) => Boolean(d && d.getTime() >= now.getTime() && weekGroup(d, now, zone));
    const comingUp: Array<{ date: string; label: string; kind: 'sprint' | 'due' }> = [];
    for (const s of sprints) {
        if (within(s.endDate)) comingUp.push({ date: s.endDate.toISOString(), label: `${s.name} ends`, kind: 'sprint' });
        if (s.status !== 'active' && within(s.startDate)) comingUp.push({ date: s.startDate.toISOString(), label: `${s.name} starts`, kind: 'sprint' });
    }
    if (v.isAdmin || v.isGuest) for (const m of masters) { if (within(m.dueDate)) comingUp.push({ date: m.dueDate!.toISOString(), label: `${m.title} due`, kind: 'due' }) }
    else if (v.userId) for (const c of await ownCopies(orgId, v.userId)) { if (within(c.dueDate) && stateOf(c, now).state !== 'done') comingUp.push({ date: c.dueDate!.toISOString(), label: `${c.title} due`, kind: 'due' }) }
    // Ordinary tasks due this week too (report §7.2 "task and assignment dues"); members see their own.
    const dueTasks = await db.select({ title: tasks.title, dueDate: tasks.dueDate }).from(tasks).where(and(eq(tasks.projectId, orgId), eq(tasks.kind, 'task'), isNull(tasks.assignmentId),
        isNull(tasks.deletedAt), ne(tasks.status, 'done'), gte(tasks.dueDate, now), lt(tasks.dueDate, new Date(now.getTime() + 8 * DAY)), orgTaskReadFilter(v.access, v.userId))).limit(20);
    for (const t of dueTasks) if (within(t.dueDate)) comingUp.push({ date: t.dueDate!.toISOString(), label: `${t.title} due`, kind: 'due' });
    comingUp.sort((a, b) => a.date.localeCompare(b.date));
    const thisWeek = comingUp.map((c) => ({ ...c, group: weekGroup(new Date(c.date), now, zone)! }));

    // Today (report §33.5, decision 80): admins get deadlines, sprint endings and the term-end prompt above the attention rows.
    const archivedNow = v.org.status === 'archived';
    let today: TodayRow[] = v.isGuest || archivedNow ? [] : needsYou;
    let standing: ReturnType<typeof classStanding> | null = null;
    // How the class is doing follows see_class_overview (decisions 33, 109).
    if (orgCan(orgRoleOf(v.access?.memberRole, v.access?.isOwner), 'see_class_overview') && !archivedNow) {
        const members = await readMemberStanding(orgId, now);
        standing = classStanding(members);
        const dueMasters = masters.filter((m) => m.dueDate && m.dueDate.getTime() >= now.getTime() - 12 * 3_600_000 && weekGroup(m.dueDate, now, zone) === 'Today');
        const dueCopies = dueMasters.length ? await db.select(copyColumns).from(tasks).where(and(inArray(tasks.assignmentId, dueMasters.map((m) => m.id)), isNull(tasks.deletedAt))) : [];
        const base = `/org/${encodeURIComponent(v.org.slug ?? orgId)}`;
        const ending = sprints.filter((s) => s.status === 'active' && s.endDate.getTime() >= now.getTime() && ['Today', 'Tomorrow'].includes(weekGroup(s.endDate, now, zone) ?? '')
            || (s.status === 'active' && s.endDate.getTime() >= now.getTime() && s.endDate.getTime() - now.getTime() <= 2 * DAY));
        const daysToTermEnd = counts?.termEnd ? Math.round((Date.parse(`${counts.termEnd}T00:00:00Z`) - Date.parse(new Intl.DateTimeFormat('en-CA', { timeZone: zone ?? 'UTC' }).format(now) + 'T00:00:00Z')) / DAY) : null;
        today = todayRows({
            dueToday: dueMasters.map((m) => {
                const of = dueCopies.filter((c) => c.assignmentId === m.id).map((c) => stateOf(c, now).state).filter((st) => st !== 'excused');
                return { title: m.title, handedIn: of.filter((st) => st === 'submitted' || st === 'done').length, total: of.length, href: `${base}?tab=tasks` };
            }),
            sprintsEnding: ending.map((s) => ({ name: s.name, endDate: s.endDate, behind: members.filter((p) => p.behindIn.has(s.id)).length, href: `${base}?tab=sprints` })),
            // Decision 54: Education only, from 14 days before; nothing archives by itself, so once the term is over the
            // prompt stays until someone archives or duplicates (report §33.7 "Term ends with nothing archived").
            termEnd: profile.termDates && counts?.termEnd && daysToTermEnd !== null && daysToTermEnd <= 14 ? { date: counts.termEnd, ended: daysToTermEnd < 0, href: `${base}?tab=settings` } : null,
            attention: needsYou,
        }, now, zone);
    }

    // Welcome panel (report §26.7, decision 49): once, after joining, until closed.
    const [membership] = v.userId ? await db.select({ dismissed: workspaceMembers.welcomeDismissedAt }).from(workspaceMembers)
        .where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.userId, v.userId))).limit(1) : [];
    let welcome: OrgDashboardData['welcome'] = null;
    // The owner made it rather than joined it, so they get Get started instead.
    if (membership && !membership.dismissed && !archivedNow && !v.access.isOwner) {
        const base = `/org/${encodeURIComponent(v.org.slug ?? orgId)}`;
        const start: Array<{ kind: string; label: string; href: string }> = [];
        const next = v.userId && !v.isAdmin ? (await ownCopies(orgId, v.userId)).filter((c) => c.dueDate && stateOf(c, now).state !== 'done').sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime())[0] : null;
        if (next) start.push({ kind: 'assignment', label: `${next.title} · due ${new Intl.DateTimeFormat('en', { timeZone: zone ?? 'UTC', weekday: 'short' }).format(next.dueDate!)}`, href: `${base}?tab=tasks&drawerType=task&drawerId=${next.id}` });
        if (v.isAdmin) start.push({ kind: 'invite', label: 'Invite people', href: `${base}?tab=members` });
        else start.push({ kind: 'workspace', label: 'Join a workspace', href: `${base}?tab=projects` });
        const [entry] = v.userId ? await db.select({ publishedAt: profileContributions.publishedAt }).from(profileContributions)
            .where(and(eq(profileContributions.projectId, orgId), eq(profileContributions.profileId, v.userId), isNull(profileContributions.deletedAt))).limit(1) : [];
        welcome = { note: counts?.welcomeNote ?? null, start: start.slice(0, 3), addToProfile: !v.isGuest && !entry?.publishedAt };
    }

    const projectRows = await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, updatedAt: workspaces.updatedAt, visibility: workspaces.visibility, coverImage: workspaces.coverImage,
        lead: sql<string | null>`(SELECT COALESCE(p.full_name, p.username) FROM profiles p WHERE p.id = ${workspaces.ownerId})`,
        members: sql<number>`(SELECT count(*)::int FROM workspace_members pm WHERE pm.workspace_id = ${workspaces.id})`,
        overdue: sql<number>`(SELECT count(*)::int FROM tasks t WHERE t.workspace_id = ${workspaces.id} AND t.deleted_at IS NULL AND t.status <> 'done' AND t.due_date < now())` }).from(workspaces)
        .where(and(eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt), ne(workspaces.status, 'archived'),
            v.isAdmin ? undefined : sql`EXISTS (SELECT 1 FROM workspace_members pm WHERE pm.workspace_id = ${workspaces.id} AND pm.user_id = ${v.userId})`))
        .orderBy(v.isAdmin ? sql`(SELECT count(*) FROM tasks t WHERE t.workspace_id = ${workspaces.id} AND t.deleted_at IS NULL AND t.status <> 'done' AND t.due_date < now()) DESC` : sql`1`, desc(workspaces.updatedAt)).limit(5);
    const weekAgo = now.getTime() - 7 * DAY;
    const archived = v.org.status === 'archived';
    let archivedSummary: string | null = null;
    let termSummary: OrgDashboardData['termSummary'] = null;
    if (archived) {
        const [org] = await db.select({ title: workspaces.title, termEnd: workspaces.termEnd, updatedAt: workspaces.updatedAt }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
        const ended = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(org?.termEnd ? new Date(org.termEnd) : org?.updatedAt ?? now);
        const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
        archivedSummary = `${org?.title ?? 'This organization'} ended ${ended} · ${n(counts?.allSprints ?? 0, 'sprint')} · ${n(masters.length, 'assignment')} · ${n(people.length, 'member')}`;
        const copies = await db.select(copyColumns).from(tasks).innerJoin(workspaces, eq(workspaces.id, tasks.projectId))
            .where(and(isNotNull(tasks.assignmentId), isNull(tasks.deletedAt), or(eq(tasks.projectId, orgId), eq(workspaces.parentId, orgId)),
                v.isAdmin ? undefined : sql`(${tasks.assigneeId} = ${v.userId} OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = ${tasks.id} AND tm.user_id = ${v.userId}))`));
        const counted = copies.map((c) => stateOf(c, now).state).filter((st) => st !== 'excused');
        const done = counted.filter((st) => st === 'done').length;
        termSummary = v.isAdmin
            ? { completedPercent: counted.length ? Math.round((done / counted.length) * 100) : null, mine: null }
            : { completedPercent: null, mine: v.isGuest || !counted.length ? null : { done, total: counted.length } };
    }
    // Archived: admins keep end-of-term verification (report §27.4); everything else is read-only.
    const archivedNeeds: NeedsYouRow[] = archived && v.isAdmin ? [{ kind: 'verify', label: 'Verify contributions for the term', href: `/org/${encodeURIComponent(v.org.slug ?? orgId)}?tab=members` }] : [];
    return {
        success: true,
        role: v.isAdmin ? 'admin' : v.isGuest ? 'guest' : 'member',
        pinned: pinned ? { id: pinned.id, content: pinned.content, at: pinned.createdAt.toISOString(), authorName: pinned.authorName ?? 'Someone', authorAvatarUrl: pinned.authorAvatarUrl, unread: Boolean(pinned.unread), canUnpin: v.isAdmin } : null,
        needsYou: v.isGuest ? [] : archived ? archivedNeeds : needsYou,
        thisSprint: {
            sprint: active ? { id: active.id, name: active.name, goal: active.goal ?? null, status: active.endDate < now ? 'ended' : 'active', startDate: active.startDate.toISOString(), endDate: active.endDate.toISOString() } : null,
            next: !active && next ? { name: next.name, startDate: next.startDate.toISOString() } : null,
            items,
            tasks: sprintTasks.slice(0, 8).map((t) => ({ id: t.id, title: t.title, assignee: t.assignee, status: t.status })),
            progress: {
                done: sprintTasks.filter((t) => t.status === 'done').length + items.filter((i) => i.counts ? i.counts.total > 0 && i.counts.done >= i.counts.total : i.own?.state === 'done').length,
                total: sprintTasks.length + items.length,
            },
        },
        comingUp: comingUp.slice(0, 12),
        thisWeek: thisWeek.slice(0, 12),
        today,
        standing,
        standingWord: CLASS_WORD[counts?.orgType ?? ''] ?? 'group',
        weekLine: profile.termDates ? weekLine(counts?.termStart ?? null, counts?.termEnd ?? null, now, zone) : null,
        welcome,
        restricted: Boolean(counts?.restrictedAt),
        activity,
        timeZone: zone,
        projects: projectRows.map((p) => ({ id: p.id, title: p.title, slug: p.slug, coverImage: p.coverImage, lead: p.lead, members: p.members, overdue: p.overdue })),
        people: {
            avatars: people.filter((p) => p.show).slice(0, 8).map((p) => ({ id: p.id, name: p.name || p.username || 'Member', avatarUrl: p.avatarUrl })),
            total: people.length,
            joinedThisWeek: people.filter((p) => p.joinedAt && p.joinedAt.getTime() > weekAgo).length,
            requests: v.isAdmin ? counts?.requests ?? 0 : 0,
        },
        archivedSummary,
        catchUp: v.isAdmin || v.isGuest || archived ? null : await readCatchUp(v, orgId, now, counts?.termStart ?? null, counts?.termEnd ?? null, zone, profile.termDates),
        termSummary,
        // Report §7.2, decision 7: only while the organization is truly empty; any real thing makes it go.
        getStarted: v.isAdmin && !archived ? getStartedCards({ members: people.length, sprints: counts?.allSprints ?? 0, tasks: counts?.tasks ?? 0, workspaces: counts?.workspaces ?? 0,
            announcements: counts?.announcements ?? 0, documents: counts?.documents ?? 0, files: counts?.files ?? 0 }) : [],
    };
}

export type OrgAboutData = {
    success: true;
    formerLine: string | null;
    /** Sprints the viewer can see; Stages teach when there are none (report §7.3). */
    stageCount: number;
    projects: Array<{ id: string; title: string; slug: string | null; visibility: string | null }>;
    journey: ReturnType<typeof journeyFromSprints> | null;
    activity: ActivityItem[];
    leaders: Array<{ id: string; name: string; username: string | null; avatarUrl: string | null; role: 'owner' | 'admin'; title: string | null }>;
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
        db.select({ id: profiles.id, name: profiles.fullName, username: profiles.username, avatarUrl: profiles.avatarUrl, role: workspaceMembers.role, title: workspaceMembers.title, show: workspaceMembers.showOnProfile })
            .from(workspaceMembers).innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
            .where(and(eq(workspaceMembers.projectId, orgId), inArray(workspaceMembers.role, ['owner', 'admin']))),
        db.select({ joinCode: workspaces.joinCode, joinCodeEnabled: workspaces.joinCodeEnabled, ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1),
        v.userId ? db.select({ joinedAt: workspaceMembers.joinedAt }).from(workspaceMembers).where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.userId, v.userId))).limit(1) : Promise.resolve([]),
    ]);
    const card: OrgAboutData['card'] = v.isAdmin ? { kind: 'invite', joinCode: org?.joinCodeEnabled ? org.joinCode : null }
        : v.isInside ? { kind: v.isGuest ? 'guest' : 'member', joinedAt: me?.joinedAt?.toISOString() ?? null }
            : { kind: 'visitor' };
    // Report §26.9: on a public organization a former member sees their own line; nothing from inside.
    let formerLine: string | null = null;
    if (!v.isInside && v.userId) {
        const state = await readPrivateOrgState(orgId, v.userId);
        if (state.kind === 'left' || state.kind === 'removed' || state.kind === 'blocked') formerLine = privateOrgLine(state, v.org.title).line;
    }
    return {
        success: true,
        formerLine,
        stageCount: sprints?.length ?? 0,
        projects: children,
        journey: sprints && sprints.length ? journeyFromSprints(sprints) : null,
        activity: await readActivity(v, 'all', { publicOnly: true, limit: 5 }),
        // Visitors see only leaders who show the org on their profile (report §22.3).
        leaders: leaders.filter((l) => v.isInside || l.show).sort((a, b) => (a.id === org?.ownerId ? -1 : b.id === org?.ownerId ? 1 : 0))
            .map((l) => ({ id: l.id, name: l.name || l.username || 'Admin', username: l.username, avatarUrl: l.avatarUrl, role: l.id === org?.ownerId ? 'owner' as const : 'admin' as const, title: l.title })),
        card,
    };
}

export type OrgWorkspaceRow = {
    id: string; title: string; slug: string | null; visibility: string | null; status: string | null; coverImage: string | null;
    lead: { id: string; name: string } | null; members: number; units: number;
    open: number; overdue: number; inReview: number; groupCopy: { title: string; state: CopyState } | null;
    lastActivityAt: string; reasons: string[]; mine: boolean;
    /** Journey stage, the running sprint and whether it sits inside the org's running sprint (report §28.2–28.3). */
    stage: string | null; sprint: { name: string; inOrgSprint: boolean } | null; newInOrg: boolean;
    /** Report §25.4: seats still open across its teams, for Apply and the Has open seats filter. */
    openSeats: number;
    /** Report §35.4: its lead left and someone holds it until admins assign one. */
    needsLead: boolean;
    /** Report §35.5: who archived it, and whether an admin did. */
    archivedBy: { name: string; admin: boolean } | null;
};

/** Projects tab (report §28): admins see every child project (Private too) with Needs attention; others what they may. */
export async function readOrgWorkspacesAction(orgId: string): Promise<{ success: true; isAdmin: boolean; canCreate: boolean; rows: OrgWorkspaceRow[]; requests: OrgWorkspaceRequest[]; summary: { total: number; attention: number; quiet: number; notInProject: number } } | Failure> {
    const v = await orgViewer(orgId);
    if (!v || !v.isInside) return DENIED;
    const now = new Date();
    // ponytail: every child project in one read, sized for ORG_LIMITS.childProjectsPerOrg (200). Upgrade: 50-row pages.
    const rows = await db.select({
        id: workspaces.id, title: workspaces.title, slug: workspaces.slug, visibility: workspaces.visibility, status: workspaces.status, updatedAt: workspaces.updatedAt, ownerId: workspaces.ownerId, coverImage: workspaces.coverImage,
        leadName: profiles.fullName, leadUsername: profiles.username,
        members: sql<number>`(SELECT count(*)::int FROM workspace_members pm WHERE pm.workspace_id = ${workspaces.id})`,
        units: sql<number>`(SELECT count(*)::int FROM ${workspaceOpenRoles} r WHERE r.workspace_id = ${workspaces.id})`,
        open: sql<number>`(SELECT count(*)::int FROM tasks t WHERE t.workspace_id = ${workspaces.id} AND t.deleted_at IS NULL AND t.status <> 'done')`,
        overdue: sql<number>`(SELECT count(*)::int FROM tasks t WHERE t.workspace_id = ${workspaces.id} AND t.deleted_at IS NULL AND t.status <> 'done' AND t.due_date < now())`,
        inReview: sql<number>`(SELECT count(*)::int FROM tasks t WHERE t.workspace_id = ${workspaces.id} AND t.deleted_at IS NULL AND t.excused_at IS NULL AND t.review_status = 'pending')`,
        lastTaskAt: sql<Date | null>`(SELECT max(t.updated_at) FROM tasks t WHERE t.workspace_id = ${workspaces.id})`,
        stage: sql<string | null>`${workspaces.lifecycleStages}->>coalesce(${workspaces.currentStageIndex}, 0)`,
        sprintName: sql<string | null>`(SELECT s.name FROM workspace_sprints s WHERE s.workspace_id = ${workspaces.id} AND s.status = 'active' ORDER BY s.start_date DESC LIMIT 1)`,
        inOrgSprint: sql<boolean>`EXISTS (SELECT 1 FROM workspace_sprints s JOIN workspace_sprints o ON o.id = s.parent_sprint_id AND o.status = 'active' WHERE s.workspace_id = ${workspaces.id} AND s.status = 'active')`,
        newInOrg: sql<boolean>`coalesce((${workspaces.orgSettings}->>'movedInAt')::timestamptz > now() - interval '7 days', false)`,
        openSeats: sql<number>`(SELECT coalesce(sum(greatest(r.count - r.filled, 0)), 0)::int FROM ${workspaceOpenRoles} r WHERE r.workspace_id = ${workspaces.id})`,
        needsLead: sql<boolean>`${workspaces.orgSettings} ? 'leadHandover'`,
        archivedByAdmin: sql<boolean | null>`(${workspaces.orgSettings}->'archivedBy'->>'admin')::boolean`,
        archivedByName: sql<string | null>`(SELECT coalesce(ap.full_name, ap.username) FROM profiles ap WHERE ap.id::text = ${workspaces.orgSettings}->'archivedBy'->>'userId')`,
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
            id: r.id, title: r.title, slug: r.slug, visibility: r.visibility, status: r.status, coverImage: r.coverImage,
            lead: { id: r.ownerId, name: r.leadName || r.leadUsername || 'Owner' },
            members: r.members, units: r.units, open: r.open, overdue: r.overdue, inReview: r.inReview,
            groupCopy: copy && state ? { title: copy.title, state } : null,
            lastActivityAt: lastActivity.toISOString(),
            reasons: v.isAdmin ? needsAttention({ overdue: r.overdue, lastActivityAt: lastActivity, groupCopyState: state, leadInOrg: Boolean(r.leadInOrg), status: r.status, now }) : [],
            mine: Boolean(r.mine),
            stage: r.stage ?? null,
            sprint: r.sprintName ? { name: r.sprintName, inOrgSprint: Boolean(r.inOrgSprint) } : null,
            newInOrg: Boolean(r.newInOrg),
            openSeats: Number(r.openSeats ?? 0),
            needsLead: Boolean(r.needsLead),
            archivedBy: r.status === 'archived' && r.archivedByAdmin !== null ? { name: r.archivedByName ?? 'Someone', admin: Boolean(r.archivedByAdmin) } : null,
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
        requests: v.isAdmin ? await readWorkspaceRequests(orgId) : [],
        summary: { total: out.length, attention: out.filter((r) => r.reasons.length > 0).length, quiet: out.filter((r) => r.reasons.includes('quiet 7 days')).length, notInProject },
    };
}

/** `Part of CSE-3A · CO2 ends Fri · 1 assignment due` on a child project's Dashboard (report §22.5, §27.5). */
export async function readChildOrgLineAction(childProjectId: string) {
    const { userId } = await getViewerAuthContext();
    const [child] = await db.select({ parentId: workspaces.parentId, ownerId: workspaces.ownerId, slug: workspaces.slug, repo: workspaces.githubRepoUrl, syncedAt: workspaces.githubLastSyncAt }).from(workspaces).where(and(eq(workspaces.id, childProjectId), isNull(workspaces.deletedAt))).limit(1);
    const orgRole = child?.parentId ? await readViewerOrgRole(child.parentId, userId) : null;
    if (!child?.parentId || !orgRole) return null; // outside people don't get the org line
    // Org membership alone doesn't open a private child project: its sprint and group copies need read access.
    const access = userId ? await getWorkspaceAccessById(childProjectId, userId) : null;
    if (!userId || !access?.canRead) return null;
    // The GitHub line follows the permissions table: the team and admins, not every organization member.
    const childRole = child.ownerId === userId ? 'lead' : access.memberRole === 'admin' ? 'project_admin' : orgRole === 'owner' || orgRole === 'admin' ? 'inherited_admin' : access.memberRole ? 'unit_member' : 'org_member';
    const seesGithub = childGrant(childRole, 'github_status') === 'yes';
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
        // Report §24.3: the team and organization admins see where it syncs; the lead has the full GitHub view.
        github: child.repo && child.ownerId !== userId && seesGithub ? { repo: child.repo.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, ''), syncedAt: child.syncedAt?.toISOString() ?? null } : null,
    };
}

/**
 * Remind leads (report §28.4, §28.7): each selected project's lead hears what's open, "CSE-3A reminded you: Proposal
 * is missing" or "3 tasks overdue". Admins only; at most once per lead and project every 12 hours.
 */
export async function remindLeadsAction(orgId: string, projectIds: string[]): Promise<{ success: true; reminded: number; skipped: number } | Failure> {
    const v = await orgViewer(orgId);
    if (!v?.isAdmin || !v.userId) return DENIED;
    const read = await readOrgWorkspacesAction(orgId);
    if (!read.success) return read;
    const { notifyOrg, remindedRecently } = await import('@/lib/organizations/notify');
    const rows = read.rows.filter((r) => projectIds.includes(r.id) && r.lead);
    // Decision 60: a lead reminded about this workspace in the last 12 hours is skipped and counted.
    const recent = await remindedRecently(orgId, 'remind-lead', rows.map((r) => r.lead!.id));
    const minute = Math.floor(Date.now() / 60_000);
    let reminded = 0;
    let skipped = 0;
    for (const row of rows) {
        const what = row.groupCopy && ['missing', 'returned', 'not_started', 'in_progress'].includes(row.groupCopy.state)
            ? `${row.groupCopy.title} is ${row.groupCopy.state === 'missing' ? 'missing' : row.groupCopy.state === 'returned' ? 'returned' : 'not submitted yet'}`
            : row.overdue ? `${row.overdue} ${row.overdue === 1 ? 'task is' : 'tasks are'} overdue in ${row.title}` : null;
        if (!what) continue;
        if (recent.has(row.id)) { skipped += 1; continue; }
        await notifyOrg({ orgId, eventKey: 'assignments.reminded', actorId: v.userId, to: [row.lead!.id], title: `${v.org.title} reminded you: ${what}`,
            href: `/workspaces/${encodeURIComponent(row.slug ?? row.id)}?tab=tasks`, sourceEventId: `remind-lead:${row.id}:${minute}` });
        reminded += 1;
    }
    return { success: true, reminded, skipped };
}

/** The welcome panel's × (report §26.7, decision 49): hidden for good, on every device. */
export async function dismissWelcomeAction(orgId: string): Promise<{ success: true } | Failure> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return DENIED;
    await db.update(workspaceMembers).set({ welcomeDismissedAt: new Date() })
        .where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.userId, userId)));
    return { success: true };
}

/** × on the Overview's pinned announcement (live-fix 11): hidden for you only, on your account. */
export async function hidePinnedForMeAction(orgId: string, updateId: string): Promise<{ success: true } | Failure> {
    const v = await orgViewer(orgId);
    if (!v?.isInside || !v.userId || !isUuid(updateId)) return DENIED;
    const [post] = await db.select({ id: workspaceUpdates.id }).from(workspaceUpdates).where(and(eq(workspaceUpdates.id, updateId), eq(workspaceUpdates.projectId, orgId))).limit(1);
    if (!post) return DENIED;
    await db.insert(workspaceUpdateHidden).values({ userId: v.userId, updateId }).onConflictDoNothing();
    return { success: true };
}

/**
 * Catch up (report §33.5, §33.7): for two weeks after joining, a member who joined once sprints had begun sees the
 * earlier ones and their materials, through the same file and document rules as Files. No copies are made.
 */
async function readCatchUp(v: OrgViewer, orgId: string, now: Date, termStart: string | null, termEnd: string | null, zone: string | null, termDates: boolean): Promise<OrgDashboardData['catchUp']> {
    if (!v.userId) return null;
    const [me] = await db.select({ joinedAt: workspaceMembers.joinedAt }).from(workspaceMembers)
        .where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.userId, v.userId))).limit(1);
    if (!me?.joinedAt || now.getTime() - me.joinedAt.getTime() > 14 * DAY) return null;
    const earlier = await db.select({ id: workspaceSprints.id, name: workspaceSprints.name }).from(workspaceSprints)
        .where(and(eq(workspaceSprints.projectId, orgId), lt(workspaceSprints.startDate, me.joinedAt), inArray(workspaceSprints.status, ['active', 'completed'])))
        .orderBy(asc(workspaceSprints.startDate)).limit(20);
    if (earlier.length === 0) return null;
    const base = `/org/${encodeURIComponent(v.org.slug ?? orgId)}`;
    const ids = earlier.map((s) => s.id);
    const files = await db.execute<{ sprint_id: string; name: string; path: string }>(sql`
        SELECT m.sprint_id, n.name, n.path FROM sprint_materials m JOIN workspace_nodes n ON n.id = m.node_id AND n.deleted_at IS NULL
        WHERE m.sprint_id IN ${ids} AND ${orgFileAccessSql(v.access, { projectId: sql`n.workspace_id`, path: sql`n.path`, taskId: sql`n.task_id` }) ?? sql`TRUE`}`);
    const docRows = await db.execute<{ sprint_id: string; doc_id: string }>(sql`SELECT m.sprint_id, m.doc_id FROM sprint_materials m WHERE m.sprint_id IN ${ids} AND m.doc_id IS NOT NULL`);
    const docs = docRows.length ? await readOrgDocsAction(orgId) : null;
    const docById = new Map(docs?.success && docs.data ? docs.data.docs.map((d) => [d.id, d]) : []);
    const week = termDates ? weekLine(termStart, termEnd, me.joinedAt, zone)?.replace(/ of \d+$/, '') : null;
    return {
        line: week ? `You joined in ${week.toLowerCase()}. Here’s what you missed.` : 'Here’s what happened before you joined.',
        sprints: earlier.map((s) => ({
            id: s.id, name: s.name,
            materials: [
                ...files.filter((f) => f.sprint_id === s.id).map((f) => ({ name: f.name, href: `${base}?tab=files&path=${encodeURIComponent(f.path)}` })),
                ...docRows.filter((d) => d.sprint_id === s.id && docById.has(d.doc_id)).map((d) => { const doc = docById.get(d.doc_id)!; return { name: docTitle(doc.filename), href: `${base}?tab=readme&doc=${encodeURIComponent(doc.slug)}` } }),
            ],
        })),
    };
}
