import "server-only";
import { readOrgCases } from '@/lib/trust/console';

import { and, asc, eq, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import { readOrgDocsAction } from "@/app/actions/org-docs";
import { db } from "@/lib/db";
import { docTitle } from "@/lib/organizations/doc-rules";
import { workspaceMembers, workspaces, workspaceSprints, roleApplications, taskTeamMembers, tasks } from "@/lib/db/schema";
import type { WorkspaceAccess } from "@/lib/data/workspace-access";
import { copyState } from "@/lib/organizations/assignment-rules";
import { reviewRow } from "@/lib/organizations/dashboard-rules";
import { formatDistanceToNow } from "@/lib/utils/date";
import { memberStatus } from "@/lib/organizations/member-rules";
import { lastActiveHereSince } from "@/lib/organizations/members";
import { JOIN_SPIKE_PER_HOUR } from "@/lib/organizations/trust-rules";

// Needs you (report §26.4) and the copy helpers the org dashboard shares. Not a server action: it trusts its viewer.

export type OrgViewer = { userId: string | null; access: WorkspaceAccess; isAdmin: boolean; isInside: boolean; isGuest: boolean; org: { id: string; title: string; slug: string | null; status: string | null } };
const DAY = 86_400_000;

export const stateOf = (c: { status: string; reviewStatus: string; dueDate: Date | null; reviewSubmittedAt: Date | null; completedAt: Date | null; excusedAt: Date | null }, now: Date) =>
    copyState({ status: c.status, reviewStatus: c.reviewStatus, dueDate: c.dueDate, submittedAt: c.reviewSubmittedAt, completedAt: c.completedAt, excusedAt: c.excusedAt }, now)
export const copyColumns = { id: tasks.id, title: tasks.title, projectId: tasks.projectId, assigneeId: tasks.assigneeId, assignmentId: tasks.assignmentId, sprintId: tasks.sprintId, status: tasks.status, reviewStatus: tasks.reviewStatus, dueDate: tasks.dueDate, reviewSubmittedAt: tasks.reviewSubmittedAt, completedAt: tasks.completedAt, excusedAt: tasks.excusedAt }
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** `title` and `detail` are the row's bold line and quiet line (report §7.2); `approveId` approves one join request in place. */
export type NeedsYouRow = { kind: string; label: string; href: string; tone?: 'amber'; title?: string; detail?: string; approveId?: string };

/** A person's own assignment copies in the org, theirs or their team's. */
export async function ownCopies(orgId: string, userId: string) {
    return db.select(copyColumns).from(tasks).where(and(eq(tasks.projectId, orgId), isNotNull(tasks.assignmentId), isNull(tasks.deletedAt), or(
        eq(tasks.assigneeId, userId),
        sql`EXISTS (SELECT 1 FROM ${taskTeamMembers} tm WHERE tm.task_id = ${tasks.id} AND tm.user_id = ${userId})`,
    )));
}

/** A workspace asking to move in or to leave, for Workspaces → Requests (report §28.6, decision 57). */
export type OrgWorkspaceRequest = { id: string; title: string; slug: string | null; kind: 'move_in' | 'leave'; lead: string; members: number; at: string | null };

/** Admins only: pending move-in (through workspaces_move_in_request_idx) and leave requests, oldest first. */
export async function readWorkspaceRequests(orgId: string): Promise<OrgWorkspaceRequest[]> {
    const rows = await db.execute<{ id: string; title: string | null; slug: string | null; kind: 'move_in' | 'leave'; lead: string | null; members: number; at: string | null }>(sql`
        SELECT w.id, w.title, w.slug, CASE WHEN w.parent_id IS NULL THEN 'move_in' ELSE 'leave' END AS kind,
            coalesce(p.full_name, p.username) AS lead, (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = w.id) AS members,
            coalesce(w.org_settings->'moveInRequest'->>'at', w.org_settings->'detachRequest'->>'at') AS at
        FROM (
            SELECT * FROM workspaces WHERE deleted_at IS NULL AND parent_id IS NULL AND org_settings ? 'moveInRequest' AND org_settings->'moveInRequest'->>'orgId' = ${orgId}
            UNION ALL SELECT * FROM workspaces WHERE deleted_at IS NULL AND parent_id = ${orgId} AND org_settings ? 'detachRequest'
        ) w LEFT JOIN profiles p ON p.id = w.owner_id
        WHERE w.kind = 'workspace'
        ORDER BY at NULLS FIRST LIMIT 200`);
    return rows.map((r) => ({ id: r.id, title: r.title || 'Workspace', slug: r.slug, kind: r.kind, lead: r.lead || 'Owner', members: r.members, at: r.at }));
}

/** Needs you (report §26.4), derived from state, so rows clear by themselves. Shared by the dashboard and the sidebar badge. */
export async function readNeedsYou(v: OrgViewer, now: Date): Promise<NeedsYouRow[]> {
    const base = `/org/${encodeURIComponent(v.org.slug ?? v.org.id)}`;
    const rows: NeedsYouRow[] = [];
    if (v.isAdmin) {
        const [reviews, [requests], ended, children, [cap]] = await Promise.all([
            db.select({ title: tasks.title, n: sql<number>`count(*)::int`, oldest: sql<string | null>`min(${tasks.reviewSubmittedAt})::text` }).from(tasks)
                .innerJoin(workspaces, eq(workspaces.id, tasks.projectId))
                .where(and(isNotNull(tasks.assignmentId), isNull(tasks.deletedAt), isNull(tasks.excusedAt), eq(tasks.reviewStatus, 'pending'), or(eq(tasks.projectId, v.org.id), eq(workspaces.parentId, v.org.id))))
                .groupBy(tasks.title).orderBy(asc(tasks.title)),
            db.select({ n: sql<number>`count(*)::int`, id: sql<string>`min(${roleApplications.id}::text)`, at: sql<string>`min(${roleApplications.createdAt})::text`,
                name: sql<string | null>`min(COALESCE(p.full_name, p.username))` }).from(roleApplications).leftJoin(sql`profiles p`, sql`p.id = ${roleApplications.applicantId}`)
                .where(and(eq(roleApplications.projectId, v.org.id), isNull(roleApplications.roleId), eq(roleApplications.status, 'pending'))),
            db.select({ name: workspaceSprints.name }).from(workspaceSprints).where(and(eq(workspaceSprints.projectId, v.org.id), eq(workspaceSprints.status, 'active'), lt(workspaceSprints.endDate, now))),
            readWorkspaceRequests(v.org.id),
            db.select({ max: workspaces.maxCollaborators, members: sql<number>`(SELECT count(*)::int FROM workspace_members WHERE workspace_id = ${v.org.id})` }).from(workspaces).where(eq(workspaces.id, v.org.id)),
        ]);
        for (const r of reviews) rows.push({ kind: 'review', ...reviewRow(r.title, r.n, r.oldest ? new Date(r.oldest) : null, now), title: `${r.n} ${r.n === 1 ? 'submission' : 'submissions'} to review`,
            detail: `${r.title}${r.oldest ? ` · oldest ${formatDistanceToNow(new Date(r.oldest), { addSuffix: true })}` : ''}`, href: `${base}?tab=tasks&taskScope=review` });
        if (requests && requests.n > 0) rows.push({ kind: 'requests', label: plural(requests.n, 'join request'), title: plural(requests.n, 'join request'), href: `${base}?tab=members`,
            detail: requests.n === 1 ? `${requests.name ?? 'Someone'} · ${formatDistanceToNow(new Date(requests.at), { addSuffix: true })}` : `oldest ${formatDistanceToNow(new Date(requests.at), { addSuffix: true })}`,
            ...(requests.n === 1 ? { approveId: requests.id } : {}) });
        // Report §22.4: reports live in Settings → Moderation, and this row links there.
        const reports = v.userId ? (await readOrgCases(v.org.id, v.userId)).length : 0;
        if (reports > 0) rows.push({ kind: 'reports', label: `${plural(reports, 'report')} to review`, href: `${base}?tab=settings&section=org-moderation` });
        for (const s of ended) rows.push({ kind: 'sprint', label: `${s.name} ended · Complete it?`, href: `${base}?tab=sprints` });
        // Decision 57: move-in and leave requests, each with Approve and Decline on the Workspaces tab.
        for (const c of children) rows.push({ kind: c.kind === 'leave' ? 'detach' : 'move_in', label: `${c.title} asks to ${c.kind === 'leave' ? 'leave' : 'join'}`, href: `${base}?tab=projects` });
        const max = cap?.max ? Number.parseInt(cap.max, 10) : NaN;
        if (Number.isFinite(max) && cap && cap.members >= max) rows.push({ kind: 'full', label: `${v.org.title} is full`, href: `${base}?tab=settings` });
        // Report §30.3: 50+ joins in an hour with the code; §30.5: verify after archive; §30.7: a lead left.
        const [[spike], [state], leaderless] = await Promise.all([
            db.select({ n: sql<number>`count(*)::int`, code: sql<string | null>`(SELECT join_code FROM workspaces WHERE id = ${v.org.id})` }).from(workspaceMembers)
                .where(and(eq(workspaceMembers.projectId, v.org.id), gte(workspaceMembers.joinedAt, new Date(now.getTime() - 3_600_000)))),
            db.select({ status: workspaces.status }).from(workspaces).where(eq(workspaces.id, v.org.id)),
            db.select({ title: workspaces.title }).from(workspaces).where(and(eq(workspaces.parentId, v.org.id), isNull(workspaces.deletedAt), sql`${workspaces.orgSettings} ? 'leadHandover'`)),
        ]);
        if (spike && spike.n >= JOIN_SPIKE_PER_HOUR) rows.push({ kind: 'join_spike', label: `Unusual joins with code ${spike.code ?? ''} · Regenerate?`, href: `${base}?tab=settings&settings=org-access` });
        if (state?.status === 'archived') rows.push({ kind: 'verify', label: "Verify members' contributions", href: `${base}?tab=members` });
        for (const c of leaderless) rows.push({ kind: 'lead', label: `${c.title} needs a new owner`, href: `${base}?tab=projects` });
        rows.push(...await adminStateRows(v.org.id, base, now));
        return rows;
    }
    if (!v.userId || v.isGuest) return rows;
    for (const c of await ownCopies(v.org.id, v.userId)) {
        const { state } = stateOf(c, now);
        const href = `${base}?tab=tasks&drawerType=task&drawerId=${c.id}`;
        if (state === 'missing') rows.push({ kind: 'overdue', label: `${c.title} · overdue`, href });
        else if (state === 'returned') rows.push({ kind: 'returned', label: `${c.title} · returned`, href });
        else if ((state === 'not_started' || state === 'in_progress') && c.dueDate && c.dueDate.getTime() - now.getTime() < 2 * DAY) rows.push({ kind: 'due', label: `${c.title} · due soon`, href });
    }
    // Child leads: the group copies their projects hold (report §26.4).
    const group = await db.select({ ...copyColumns, project: workspaces.title, slug: workspaces.slug }).from(tasks)
        .innerJoin(workspaces, eq(workspaces.id, tasks.projectId))
        .where(and(eq(workspaces.parentId, v.org.id), eq(workspaces.ownerId, v.userId), isNull(workspaces.deletedAt), isNotNull(tasks.assignmentId), isNull(tasks.deletedAt)));
    for (const c of group) {
        const { state } = stateOf(c, now);
        if (state !== 'done' && state !== 'excused' && state !== 'submitted') rows.push({ kind: 'group', label: `${c.project} · ${c.title} for the workspace`, href: `/workspaces/${encodeURIComponent(c.slug ?? c.projectId)}?tab=tasks` });
    }
    rows.push(...await leadSprintRows(v.org.id, v.userId));
    // Important (emailed) announcements stay in Needs you until the Updates tab is opened (report §17.4).
    const role = v.access?.memberRole ?? 'member';
    const unread = await db.execute<{ id: string; content: string }>(sql`
        SELECT u.id, u.content FROM workspace_updates u
        WHERE u.workspace_id = ${v.org.id} AND u.update_type = 'announcement' AND u.notify_level = 'email' AND u.deleted_at IS NULL
          AND u.created_at > now() - interval '14 days' AND u.author_id IS DISTINCT FROM ${v.userId}
          AND u.created_at > coalesce((SELECT last_seen_updates_at FROM workspace_members WHERE workspace_id = ${v.org.id} AND user_id = ${v.userId}), '-infinity'::timestamptz)
          AND (u.audience = '{}'::jsonb OR u.audience->'roles' @> to_jsonb(${role}::text)
            OR EXISTS (SELECT 1 FROM workspace_members c JOIN workspaces p ON p.id = c.workspace_id
              WHERE c.user_id = ${v.userId} AND p.parent_id = ${v.org.id} AND u.audience->'projectIds' @> to_jsonb(p.id::text)))
        ORDER BY u.created_at DESC LIMIT 3`);
    for (const a of unread) rows.push({ kind: 'announcement', label: `Read: ${a.content.replace(/\s+/g, ' ').slice(0, 60)}`, href: `${base}?tab=updates&updateId=${a.id}` });
    // Smaller bug 8: the full document read runs only when a required document is still unread at its version.
    const [unreadDoc] = await db.execute<{ one: number }>(sql`
        SELECT 1 AS one FROM workspace_documents d WHERE d.workspace_id = ${v.org.id} AND d.settings->'org'->>'required' = 'true'
          AND NOT EXISTS (SELECT 1 FROM doc_opens o WHERE o.doc_id = d.id AND o.user_id = ${v.userId}
            AND o.version >= coalesce((d.settings->'org'->>'readVersion')::int, 0)) LIMIT 1`);
    const docs = unreadDoc ? await readOrgDocsAction(v.org.id) : null;
    if (docs?.success && docs.data) for (const d of docs.data.docs) if (d.required && d.label === 'new') rows.push({ kind: 'doc', label: `Read ${docTitle(d.filename)}`, href: `${base}?tab=readme&doc=${d.slug}` });
    return rows;
}

/** Admin rows from state (report §26 A, B, C): late joiners outside teams, members outside projects, a sprint that could not start. */
async function adminStateRows(orgId: string, base: string, now: Date): Promise<NeedsYouRow[]> {
    const rows: NeedsYouRow[] = [];
    const [teams, [unplaced], blocked] = await Promise.all([
        // New members not in a team: they joined after a teams assignment was published and sit in none of its copies.
        db.execute<{ title: string; n: number }>(sql`
            SELECT m.title, count(*)::int AS n FROM tasks m JOIN workspace_members pm ON pm.workspace_id = m.workspace_id AND pm.role = 'member'
            WHERE m.workspace_id = ${orgId} AND m.kind = 'assignment' AND m.deleted_at IS NULL AND m.assignment_settings->'target'->>'mode' = 'teams'
              AND m.assignment_settings->>'publishedAt' IS NOT NULL AND m.assignment_settings->>'closedAt' IS NULL
              AND pm.joined_at > (m.assignment_settings->>'publishedAt')::timestamptz
              AND NOT EXISTS (SELECT 1 FROM tasks c WHERE c.assignment_id = m.id AND c.deleted_at IS NULL AND (c.assignee_id = pm.user_id
                OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = c.id AND tm.user_id = pm.user_id)))
            GROUP BY m.id, m.title ORDER BY m.title`),
        // Members not in a project (report §14.4) once the org has projects; a group assignment with none to go to (E3).
        db.execute<{ n: number; children: number; group_title: string | null }>(sql`
            SELECT (SELECT count(*)::int FROM workspace_members pm WHERE pm.workspace_id = ${orgId} AND pm.role = 'member'
                      AND NOT EXISTS (SELECT 1 FROM workspace_members c JOIN workspaces p ON p.id = c.workspace_id
                        WHERE c.user_id = pm.user_id AND p.parent_id = ${orgId} AND p.deleted_at IS NULL)) AS n,
                   (SELECT count(*)::int FROM workspaces p WHERE p.parent_id = ${orgId} AND p.deleted_at IS NULL) AS children,
                   (SELECT m.title FROM tasks m WHERE m.workspace_id = ${orgId} AND m.kind = 'assignment' AND m.deleted_at IS NULL
                      AND m.assignment_settings->'target'->>'mode' = 'each_child'
                      AND m.assignment_settings->>'publishedAt' IS NOT NULL AND m.assignment_settings->>'closedAt' IS NULL LIMIT 1) AS group_title`),
        // A sprint due to start automatically that could not, because another is still active.
        db.execute<{ name: string; active: string }>(sql`
            SELECT s.name, a.name AS active FROM workspace_sprints s JOIN workspace_sprints a ON a.workspace_id = s.workspace_id AND a.status = 'active'
            WHERE s.workspace_id = ${orgId} AND s.status = 'planning' AND s.auto_start AND s.start_date <= ${now.toISOString()}::timestamptz
            ORDER BY s.start_date LIMIT 3`),
    ]);
    for (const t of teams) rows.push({ kind: 'team', label: `${plural(t.n, 'new member')} not in a team · ${t.title}`, href: `${base}?tab=tasks` });
    if (unplaced && unplaced.children > 0 && unplaced.n > 0) rows.push({ kind: 'unplaced', label: `${plural(unplaced.n, 'member')} not in a workspace`, href: `${base}?tab=projects` });
    if (unplaced && unplaced.children === 0 && unplaced.group_title) rows.push({ kind: 'needs_projects', label: `${unplaced.group_title} needs workspaces · Create one`, href: `/workspaces/new?org=${encodeURIComponent(base.slice('/org/'.length))}` });
    for (const b of blocked) rows.push({ kind: 'autostart', label: `${b.name} couldn’t start: ${b.active} is still active`, href: `${base}?tab=sprints` });
    return rows;
}

/** Child leads (report §26 C): plan inside the org sprint, close a linked sprint, or fix dates that no longer fit. */
export async function leadSprintRows(orgId: string, userId: string): Promise<NeedsYouRow[]> {
    const rows = await db.execute<{ kind: string; org_sprint: string; child_sprint: string | null; title: string; slug: string | null; id: string }>(sql`
        SELECT CASE
                 WHEN o.status = 'active' AND c.id IS NULL THEN 'plan'
                 WHEN o.status = 'completed' AND c.status = 'active' THEN 'complete'
                 ELSE 'dates' END AS kind,
               o.name AS org_sprint, c.name AS child_sprint, p.title, p.slug, p.id
        FROM workspaces p
        JOIN workspace_sprints o ON o.workspace_id = ${orgId} AND o.status IN ('active', 'completed')
        LEFT JOIN workspace_sprints c ON c.workspace_id = p.id AND c.parent_sprint_id = o.id AND c.status <> 'completed'
        WHERE p.parent_id = ${orgId} AND p.owner_id = ${userId} AND p.deleted_at IS NULL AND p.status <> 'archived'
          AND ((o.status = 'active' AND NOT EXISTS (SELECT 1 FROM workspace_sprints x WHERE x.workspace_id = p.id AND x.parent_sprint_id = o.id))
            OR (o.status = 'completed' AND c.status = 'active')
            OR (c.id IS NOT NULL AND (c.start_date < o.start_date OR c.end_date > o.end_date)))
        ORDER BY o.start_date DESC LIMIT 10`);
    return rows.map((r) => {
        const href = `/workspaces/${encodeURIComponent(r.slug ?? r.id)}?tab=sprints`;
        if (r.kind === 'plan') return { kind: 'plan_sprint', label: `${r.org_sprint} started. Plan your sprint in ${r.title}`, href };
        if (r.kind === 'complete') return { kind: 'complete_sprint', label: `${r.org_sprint} ended. Complete ${r.child_sprint}?`, href };
        return { kind: 'sprint_dates', label: `${r.child_sprint} is outside ${r.org_sprint}'s dates`, href };
    });
}

/**
 * Each member's standing (report §33.5, decision 81), the same way the Members tab counts it: behind means any
 * missing work; inactive means 14 days without activity here, counted from joining. Also which sprints each
 * person is behind in, for "CO3 ends Thursday · 4 behind".
 */
export async function readMemberStanding(orgId: string, now: Date) {
    const [people, copies, teams] = await Promise.all([
        db.select({ userId: workspaceMembers.userId, joinedAt: workspaceMembers.joinedAt, lastActiveAt: workspaceMembers.lastActiveHereAt })
            .from(workspaceMembers).where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.role, 'member'))),
        db.execute<{ id: string; assignee_id: string | null; status: string; review_status: string; due_date: Date | null; review_submitted_at: Date | null; completed_at: Date | null; excused_at: Date | null; sprint_id: string | null }>(sql`
            SELECT c.id, c.assignee_id, c.status, c.review_status, c.due_date, c.review_submitted_at, c.completed_at, c.excused_at, m.sprint_id
            FROM tasks c JOIN tasks m ON m.id = c.assignment_id AND m.workspace_id = ${orgId} AND m.deleted_at IS NULL
            WHERE c.deleted_at IS NULL`),
        db.select({ taskId: taskTeamMembers.taskId, userId: taskTeamMembers.userId }).from(taskTeamMembers)
            .innerJoin(tasks, eq(tasks.id, taskTeamMembers.taskId)).where(and(eq(tasks.projectId, orgId), isNull(tasks.deletedAt))),
    ]);
    const missing = new Map<string, Set<string | null>>();
    const add = (userId: string | null, sprintId: string | null) => { if (userId) missing.set(userId, (missing.get(userId) ?? new Set()).add(sprintId)); };
    const teamOf = new Map<string, string[]>();
    for (const t of teams) teamOf.set(t.taskId, [...(teamOf.get(t.taskId) ?? []), t.userId]);
    for (const c of copies) {
        const date = (d: Date | string | null) => (d ? new Date(d) : null);
        if (copyState({ status: c.status, reviewStatus: c.review_status, dueDate: date(c.due_date), submittedAt: date(c.review_submitted_at), completedAt: date(c.completed_at), excusedAt: date(c.excused_at) }, now).state === 'missing') {
            add(c.assignee_id, c.sprint_id);
            for (const userId of teamOf.get(c.id) ?? []) add(userId, c.sprint_id);
        }
    }
    const since = await lastActiveHereSince();
    return people.map((p) => {
        const sprints = missing.get(p.userId) ?? new Set<string | null>();
        const status = memberStatus({ missing: sprints.size, lastActiveAt: p.lastActiveAt, joinedAt: p.joinedAt, now, since });
        return { userId: p.userId, behind: status.behind, inactive: status.inactive, behindIn: sprints };
    });
}
