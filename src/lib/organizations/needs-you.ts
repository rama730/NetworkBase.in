import "server-only";

import { and, asc, eq, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import { readOrgDocsAction } from "@/app/actions/org-docs";
import { db } from "@/lib/db";
import { projectMembers, projects, projectSprints, roleApplications, taskTeamMembers, tasks } from "@/lib/db/schema";
import type { ProjectAccess } from "@/lib/data/project-access";
import { copyState } from "@/lib/organizations/assignment-rules";
import { JOIN_SPIKE_PER_HOUR } from "@/lib/organizations/trust-rules";

// Needs you (report §26.4) and the copy helpers the org dashboard shares. Not a server action: it trusts its viewer.

export type OrgViewer = { userId: string | null; access: ProjectAccess; isAdmin: boolean; isInside: boolean; isGuest: boolean; org: { id: string; title: string; slug: string | null; status: string | null } };
const DAY = 86_400_000;

export const stateOf = (c: { status: string; reviewStatus: string; dueDate: Date | null; reviewSubmittedAt: Date | null; completedAt: Date | null; excusedAt: Date | null }, now: Date) =>
    copyState({ status: c.status, reviewStatus: c.reviewStatus, dueDate: c.dueDate, submittedAt: c.reviewSubmittedAt, completedAt: c.completedAt, excusedAt: c.excusedAt }, now)
export const copyColumns = { id: tasks.id, title: tasks.title, projectId: tasks.projectId, assigneeId: tasks.assigneeId, assignmentId: tasks.assignmentId, sprintId: tasks.sprintId, status: tasks.status, reviewStatus: tasks.reviewStatus, dueDate: tasks.dueDate, reviewSubmittedAt: tasks.reviewSubmittedAt, completedAt: tasks.completedAt, excusedAt: tasks.excusedAt }
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export type NeedsYouRow = { kind: string; label: string; href: string };

/** A person's own assignment copies in the org, theirs or their team's. */
export async function ownCopies(orgId: string, userId: string) {
    return db.select(copyColumns).from(tasks).where(and(eq(tasks.projectId, orgId), isNotNull(tasks.assignmentId), isNull(tasks.deletedAt), or(
        eq(tasks.assigneeId, userId),
        sql`EXISTS (SELECT 1 FROM ${taskTeamMembers} tm WHERE tm.task_id = ${tasks.id} AND tm.user_id = ${userId})`,
    )));
}

/** Needs you (report §26.4), derived from state, so rows clear by themselves. Shared by the dashboard and the sidebar badge. */
export async function readNeedsYou(v: OrgViewer, now: Date): Promise<NeedsYouRow[]> {
    const base = `/org/${encodeURIComponent(v.org.slug ?? v.org.id)}`;
    const rows: NeedsYouRow[] = [];
    if (v.isAdmin) {
        const [reviews, [requests], ended, children, [cap]] = await Promise.all([
            db.select({ title: tasks.title, n: sql<number>`count(*)::int` }).from(tasks)
                .innerJoin(projects, eq(projects.id, tasks.projectId))
                .where(and(isNotNull(tasks.assignmentId), isNull(tasks.deletedAt), eq(tasks.reviewStatus, 'pending'), or(eq(tasks.projectId, v.org.id), eq(projects.parentId, v.org.id))))
                .groupBy(tasks.title).orderBy(asc(tasks.title)),
            db.select({ n: sql<number>`count(*)::int` }).from(roleApplications).where(and(eq(roleApplications.projectId, v.org.id), isNull(roleApplications.roleId), eq(roleApplications.status, 'pending'))),
            db.select({ name: projectSprints.name }).from(projectSprints).where(and(eq(projectSprints.projectId, v.org.id), eq(projectSprints.status, 'active'), lt(projectSprints.endDate, now))),
            db.select({ title: projects.title, settings: projects.orgSettings }).from(projects).where(and(eq(projects.parentId, v.org.id), isNull(projects.deletedAt), sql`${projects.orgSettings} ? 'detachRequest'`)),
            db.select({ max: projects.maxCollaborators, members: sql<number>`(SELECT count(*)::int FROM project_members WHERE project_id = ${v.org.id})` }).from(projects).where(eq(projects.id, v.org.id)),
        ]);
        for (const r of reviews) rows.push({ kind: 'review', label: `${plural(r.n, 'submission')} to review · ${r.title}`, href: `${base}?tab=tasks` });
        if (requests && requests.n > 0) rows.push({ kind: 'requests', label: plural(requests.n, 'join request'), href: `${base}?tab=members` });
        for (const s of ended) rows.push({ kind: 'sprint', label: `${s.name} ended · Complete it?`, href: `${base}?tab=sprints` });
        for (const c of children) rows.push({ kind: 'detach', label: `${c.title} asks to leave`, href: `${base}?tab=projects` });
        const max = cap?.max ? Number.parseInt(cap.max, 10) : NaN;
        if (Number.isFinite(max) && cap && cap.members >= max) rows.push({ kind: 'full', label: `${v.org.title} is full`, href: `${base}?tab=settings` });
        // Report §30.3: 50+ joins in an hour with the code; §30.5: verify after archive; §30.7: a lead left.
        const [[spike], [state], leaderless] = await Promise.all([
            db.select({ n: sql<number>`count(*)::int`, code: sql<string | null>`(SELECT join_code FROM projects WHERE id = ${v.org.id})` }).from(projectMembers)
                .where(and(eq(projectMembers.projectId, v.org.id), gte(projectMembers.joinedAt, new Date(now.getTime() - 3_600_000)))),
            db.select({ status: projects.status }).from(projects).where(eq(projects.id, v.org.id)),
            db.select({ title: projects.title }).from(projects).where(and(eq(projects.parentId, v.org.id), isNull(projects.deletedAt), sql`${projects.orgSettings} ? 'leadHandover'`)),
        ]);
        if (spike && spike.n >= JOIN_SPIKE_PER_HOUR) rows.push({ kind: 'join_spike', label: `Unusual joins with code ${spike.code ?? ''} · Regenerate?`, href: `${base}?tab=settings&settings=org-access` });
        if (state?.status === 'archived') rows.push({ kind: 'verify', label: "Verify members' contributions", href: `${base}?tab=members` });
        for (const c of leaderless) rows.push({ kind: 'lead', label: `${c.title} needs a new lead`, href: `${base}?tab=projects` });
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
    const group = await db.select({ ...copyColumns, project: projects.title, slug: projects.slug }).from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(and(eq(projects.parentId, v.org.id), eq(projects.ownerId, v.userId), isNull(projects.deletedAt), isNotNull(tasks.assignmentId), isNull(tasks.deletedAt)));
    for (const c of group) {
        const { state } = stateOf(c, now);
        if (state !== 'done' && state !== 'excused' && state !== 'submitted') rows.push({ kind: 'group', label: `${c.project} · ${c.title} for the project`, href: `/projects/${encodeURIComponent(c.slug ?? c.projectId)}?tab=tasks` });
    }
    rows.push(...await leadSprintRows(v.org.id, v.userId));
    const docs = await readOrgDocsAction(v.org.id);
    if (docs.success && docs.data) for (const d of docs.data.docs) if (d.required && d.label === 'new') rows.push({ kind: 'doc', label: `Read ${d.filename.replace(/\.(md|mdx|markdown)$/i, '')}`, href: `${base}?tab=readme&doc=${d.slug}` });
    return rows;
}

/** Admin rows from state (report §26 A, B, C): late joiners outside teams, members outside projects, a sprint that could not start. */
async function adminStateRows(orgId: string, base: string, now: Date): Promise<NeedsYouRow[]> {
    const rows: NeedsYouRow[] = [];
    const [teams, [unplaced], blocked] = await Promise.all([
        // New members not in a team: they joined after a teams assignment was published and sit in none of its copies.
        db.execute<{ title: string; n: number }>(sql`
            SELECT m.title, count(*)::int AS n FROM tasks m JOIN project_members pm ON pm.project_id = m.project_id AND pm.role = 'member'
            WHERE m.project_id = ${orgId} AND m.kind = 'assignment' AND m.deleted_at IS NULL AND m.assignment_settings->'target'->>'mode' = 'teams'
              AND m.assignment_settings->>'publishedAt' IS NOT NULL AND m.assignment_settings->>'closedAt' IS NULL
              AND pm.joined_at > (m.assignment_settings->>'publishedAt')::timestamptz
              AND NOT EXISTS (SELECT 1 FROM tasks c WHERE c.assignment_id = m.id AND c.deleted_at IS NULL AND (c.assignee_id = pm.user_id
                OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = c.id AND tm.user_id = pm.user_id)))
            GROUP BY m.id, m.title ORDER BY m.title`),
        // Members not in a project, while a group assignment is open.
        db.execute<{ n: number }>(sql`
            SELECT count(*)::int AS n FROM project_members pm
            WHERE pm.project_id = ${orgId} AND pm.role = 'member'
              AND EXISTS (SELECT 1 FROM tasks m WHERE m.project_id = ${orgId} AND m.kind = 'assignment' AND m.deleted_at IS NULL
                AND m.assignment_settings->'target'->>'mode' IN ('each_child', 'children')
                AND m.assignment_settings->>'publishedAt' IS NOT NULL AND m.assignment_settings->>'closedAt' IS NULL)
              AND NOT EXISTS (SELECT 1 FROM project_members c JOIN projects p ON p.id = c.project_id
                WHERE c.user_id = pm.user_id AND p.parent_id = ${orgId} AND p.deleted_at IS NULL)`),
        // A sprint due to start automatically that could not, because another is still active.
        db.execute<{ name: string; active: string }>(sql`
            SELECT s.name, a.name AS active FROM project_sprints s JOIN project_sprints a ON a.project_id = s.project_id AND a.status = 'active'
            WHERE s.project_id = ${orgId} AND s.status = 'planning' AND s.auto_start AND s.start_date <= ${now.toISOString()}::timestamptz
            ORDER BY s.start_date LIMIT 3`),
    ]);
    for (const t of teams) rows.push({ kind: 'team', label: `${plural(t.n, 'new member')} not in a team · ${t.title}`, href: `${base}?tab=tasks` });
    if (unplaced && unplaced.n > 0) rows.push({ kind: 'unplaced', label: `${plural(unplaced.n, 'member')} not in a project`, href: `${base}?tab=projects` });
    for (const b of blocked) rows.push({ kind: 'autostart', label: `${b.name} couldn't start: ${b.active} is still active`, href: `${base}?tab=sprints` });
    return rows;
}

/** Child leads (report §26 C): plan inside the org sprint, close a linked sprint, or fix dates that no longer fit. */
async function leadSprintRows(orgId: string, userId: string): Promise<NeedsYouRow[]> {
    const rows = await db.execute<{ kind: string; org_sprint: string; child_sprint: string | null; title: string; slug: string | null; id: string }>(sql`
        SELECT CASE
                 WHEN o.status = 'active' AND c.id IS NULL THEN 'plan'
                 WHEN o.status = 'completed' AND c.status = 'active' THEN 'complete'
                 ELSE 'dates' END AS kind,
               o.name AS org_sprint, c.name AS child_sprint, p.title, p.slug, p.id
        FROM projects p
        JOIN project_sprints o ON o.project_id = ${orgId} AND o.status IN ('active', 'completed')
        LEFT JOIN project_sprints c ON c.project_id = p.id AND c.parent_sprint_id = o.id AND c.status <> 'completed'
        WHERE p.parent_id = ${orgId} AND p.owner_id = ${userId} AND p.deleted_at IS NULL AND p.status <> 'archived'
          AND ((o.status = 'active' AND NOT EXISTS (SELECT 1 FROM project_sprints x WHERE x.project_id = p.id AND x.parent_sprint_id = o.id))
            OR (o.status = 'completed' AND c.status = 'active')
            OR (c.id IS NOT NULL AND (c.start_date < o.start_date OR c.end_date > o.end_date)))
        ORDER BY o.start_date DESC LIMIT 10`);
    return rows.map((r) => {
        const href = `/projects/${encodeURIComponent(r.slug ?? r.id)}?tab=sprints`;
        if (r.kind === 'plan') return { kind: 'plan_sprint', label: `${r.org_sprint} started. Plan your sprint in ${r.title}`, href };
        if (r.kind === 'complete') return { kind: 'complete_sprint', label: `${r.org_sprint} closed · Complete ${r.child_sprint}?`, href };
        return { kind: 'sprint_dates', label: `${r.child_sprint} is outside ${r.org_sprint}'s dates`, href };
    });
}
