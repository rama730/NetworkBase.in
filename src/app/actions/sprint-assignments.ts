'use server';

import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import type { AssignmentRow } from '@/app/actions/assignments';
import { db } from '@/lib/db';
import { profiles, projectSprintEvents, projects, taskTeamMembers, tasks } from '@/lib/db/schema';
import { getProjectAccessById } from '@/lib/data/project-access';
import type { AssignmentSettings, CopyState } from '@/lib/organizations/assignment-rules';
import { stateOf } from '@/lib/organizations/needs-you';
import { getViewerAuthContext } from '@/lib/server/viewer-context';

// Assignment rows in a sprint's timeline (report §15.4–15.5): admins and guests see counts (guests without names),
// members their own copy, and a child project the org's group copies with a "From <org>" chip.

export type SprintAssignmentRows =
    | { view: 'admin' | 'guest'; rows: AssignmentRow[]; completed: { by: string; assignments: number; missingPeople: number } | null }
    | { view: 'member'; rows: Array<{ masterId: string; title: string; dueDate: string | null; state: CopyState | null; late: boolean }> }
    | { view: 'child'; orgTitle: string; rows: Array<{ copyId: string; title: string; dueDate: string | null; state: CopyState; late: boolean }> }
    | null;

const emptyCounts = (): AssignmentRow['counts'] => ({ not_started: 0, in_progress: 0, submitted: 0, returned: 0, done: 0, missing: 0, excused: 0, total: 0 });

export async function readSprintAssignmentsAction(projectId: string, sprintId: string): Promise<SprintAssignmentRows> {
    const { userId } = await getViewerAuthContext();
    const access = await getProjectAccessById(projectId, userId);
    if (!access.canRead || !access.project) return null;
    const now = new Date();
    const copyColumns = { id: tasks.id, assignmentId: tasks.assignmentId, assigneeId: tasks.assigneeId, status: tasks.status, reviewStatus: tasks.reviewStatus, dueDate: tasks.dueDate, reviewSubmittedAt: tasks.reviewSubmittedAt, completedAt: tasks.completedAt, excusedAt: tasks.excusedAt };

    // A child project: the org's group copies sitting in this sprint.
    if (access.project.kind !== 'organization') {
        if (!access.project.parentId) return null;
        const copies = await db.select({ ...copyColumns, title: tasks.title }).from(tasks)
            .where(and(eq(tasks.projectId, projectId), eq(tasks.sprintId, sprintId), isNotNull(tasks.assignmentId), isNull(tasks.deletedAt)));
        if (copies.length === 0) return null;
        const [org] = await db.select({ title: projects.title }).from(projects).where(eq(projects.id, access.project.parentId)).limit(1);
        return { view: 'child', orgTitle: org?.title ?? 'the organization', rows: copies.map((c) => ({ copyId: c.id, title: c.title, dueDate: c.dueDate?.toISOString() ?? null, ...stateOf(c, now) })) };
    }

    const masters = await db.select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, settings: tasks.assignmentSettings }).from(tasks)
        .where(and(eq(tasks.projectId, projectId), eq(tasks.sprintId, sprintId), eq(tasks.kind, 'assignment'), isNull(tasks.deletedAt), isNull(tasks.assignmentId)));
    const published = masters.filter((m) => (m.settings as AssignmentSettings | null)?.publishedAt);
    if (published.length === 0) return null;
    const isAdmin = access.isOwner || access.memberRole === 'admin';
    const isGuest = access.memberRole === 'viewer';

    if (!isAdmin && !isGuest) {
        // Visitors (public Sprints tab): titles and dates only, no counts or names (report §15.4).
        if (!userId || !access.isMember) return { view: 'member', rows: published.map((m) => ({ masterId: m.id, title: m.title, dueDate: m.dueDate?.toISOString() ?? null, state: null, late: false })) };
        const mine = await db.select(copyColumns).from(tasks).where(and(
            inArray(tasks.assignmentId, published.map((m) => m.id)), isNull(tasks.deletedAt),
            or(eq(tasks.assigneeId, userId), sql`EXISTS (SELECT 1 FROM ${taskTeamMembers} tm WHERE tm.task_id = ${tasks.id} AND tm.user_id = ${userId})`),
        ));
        return {
            view: 'member',
            rows: published.map((m) => {
                const copy = mine.find((c) => c.assignmentId === m.id)
                return { masterId: m.id, title: m.title, dueDate: (copy?.dueDate ?? m.dueDate)?.toISOString() ?? null, ...(copy ? stateOf(copy, now) : { state: null, late: false }) }
            }),
        };
    }

    const copies = await db.select(copyColumns).from(tasks).where(and(inArray(tasks.assignmentId, published.map((m) => m.id)), isNull(tasks.deletedAt)));
    const missingPeople = new Set<string>();
    const rows: AssignmentRow[] = published.map((m) => {
        const s = m.settings as AssignmentSettings;
        const counts = emptyCounts();
        for (const c of copies.filter((copy) => copy.assignmentId === m.id)) {
            const { state } = stateOf(c, now);
            counts[state] += 1;
            counts.total += 1;
            if (state === 'missing' && c.assigneeId) missingPeople.add(c.assigneeId);
        }
        return { masterId: m.id, title: m.title, dueDate: m.dueDate?.toISOString() ?? null, status: s.closedAt ? 'closed' : 'open', submissionType: s.submissionType,
            reviewRequired: s.reviewRequired, teams: s.target.mode === 'teams', counts, mine: null };
    });
    // The completed row (report §15.3): "Ms. Rao completed CO1 · 4 assignments · 2 people with missing work".
    const [done] = await db.select({ by: sql<string | null>`coalesce(${profiles.fullName}, ${profiles.username})` }).from(projectSprintEvents)
        .leftJoin(profiles, eq(profiles.id, projectSprintEvents.actorId))
        .where(and(eq(projectSprintEvents.sprintId, sprintId), eq(projectSprintEvents.eventType, 'completed'))).limit(1);
    return {
        view: isAdmin ? 'admin' : 'guest',
        rows,
        completed: done ? { by: done.by ?? 'An admin', assignments: rows.length, missingPeople: missingPeople.size } : null,
    };
}
