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
    const docs = await readOrgDocsAction(v.org.id);
    if (docs.success && docs.data) for (const d of docs.data.docs) if (d.required && d.label === 'new') rows.push({ kind: 'doc', label: `Read ${d.filename.replace(/\.(md|mdx|markdown)$/i, '')}`, href: `${base}?tab=readme&doc=${d.slug}` });
    return rows;
}

