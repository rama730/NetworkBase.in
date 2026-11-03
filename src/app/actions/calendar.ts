'use server';

import { getWorkspaceAccessById } from '@/lib/data/workspace-access';
import { calendarToken, hasCalendarToken, readCalendarEntries, type CalendarEntry } from '@/lib/calendar/feed';
import { shareOrigin } from '@/lib/sharing/presentation';
import { getViewerAuthContext } from '@/lib/server/viewer-context';

// Calendar (report §33.5): the Sprints view's list of the viewer's own due work and sprints, and their private link.

export async function readCalendarAction(projectId: string): Promise<{ success: true; entries: CalendarEntry[]; hasLink: boolean } | { success: false; error: string }> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return { success: false, error: 'Sign in to continue' };
    const access = await getWorkspaceAccessById(projectId, userId);
    if (!access.canRead) return { success: false, error: 'You don’t have access to this' };
    const [entries, hasLink] = await Promise.all([readCalendarEntries(userId, projectId), hasCalendarToken(userId)]);
    return { success: true, entries, hasLink };
}

/**
 * The private calendar link, shown once when it's made; `reset` makes a new one and the old link stops working.
 * `url` is null when a link already exists and wasn't reset: it isn't stored, so it can't be shown again.
 */
export async function readCalendarLinkAction(reset = false): Promise<{ success: true; url: string | null } | { success: false; error: string }> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return { success: false, error: 'Sign in to continue' };
    const token = await calendarToken(userId, reset);
    return { success: true, url: token ? `${shareOrigin()}/api/v1/calendar/${token}.ics` : null };
}
