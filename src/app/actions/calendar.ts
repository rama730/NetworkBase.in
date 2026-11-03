'use server';

import { getWorkspaceAccessById } from '@/lib/data/workspace-access';
import { calendarToken, readCalendarEntries, type CalendarEntry } from '@/lib/calendar/feed';
import { shareOrigin } from '@/lib/sharing/presentation';
import { getViewerAuthContext } from '@/lib/server/viewer-context';

// Calendar (report §33.5): the Sprints view's list of the viewer's own due work and sprints, and their private link.

export async function readCalendarAction(projectId: string): Promise<{ success: true; entries: CalendarEntry[] } | { success: false; error: string }> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return { success: false, error: 'Sign in to continue' };
    const access = await getWorkspaceAccessById(projectId, userId);
    if (!access.canRead) return { success: false, error: 'You don’t have access to this' };
    return { success: true, entries: await readCalendarEntries(userId, projectId) };
}

/** The private calendar link; `reset` makes a new one and the old link stops working. */
export async function readCalendarLinkAction(reset = false): Promise<{ success: true; url: string } | { success: false; error: string }> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return { success: false, error: 'Sign in to continue' };
    const token = await calendarToken(userId, reset);
    return { success: true, url: `${shareOrigin()}/api/v1/calendar/${token}.ics` };
}
