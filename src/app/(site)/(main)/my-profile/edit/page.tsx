import { redirect, notFound } from 'next/navigation';
import { EditProfileEditor } from '@/components/profile/edit/EditProfileEditor';
import { getProfileDetails } from '@/lib/data/profile';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { hasCompletedOnboarding } from '@/lib/onboarding/completion';
import { buildRouteMetadata } from '@/lib/metadata/route-metadata';
import { buildAuthPageHref } from '@/lib/auth/redirects';
import { parseProfileEditSection, profileEditHref } from '@/lib/profile/edit-route';
import { db } from '@/lib/db';
import { profileAuditEvents } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';

/** The same 30 days updateProfileAction enforces; null when the username can change now (or the lookup fails: the save re-checks). */
async function usernameNextChangeAt(userId: string): Promise<string | null> {
    const last = await db.query.profileAuditEvents.findFirst({
        columns: { createdAt: true },
        where: and(eq(profileAuditEvents.userId, userId), eq(profileAuditEvents.eventType, 'username_changed')),
        orderBy: [desc(profileAuditEvents.createdAt)],
    }).catch(() => undefined);
    const next = last ? last.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000 : 0;
    return next > Date.now() ? new Date(next).toISOString() : null;
}

export const metadata = buildRouteMetadata({
    title: 'Edit profile · NetworkBase',
    description: 'Manage your profile details, contributions, skills and role preferences.',
    path: '/my-profile/edit',
    robots: { index: false, follow: false, noarchive: true },
});

export default async function EditProfilePage({ searchParams }: {
    searchParams: Promise<{ section?: string; returnTab?: string; contribution?: string; field?: string }>;
}) {
    const params = await searchParams;
    const section = parseProfileEditSection(params.section);
    const { user } = await getViewerAuthContext();
    const currentHref = profileEditHref(section, params.returnTab, { contribution: params.contribution, field: params.field });
    if (!user) redirect(buildAuthPageHref('/login', currentHref));

    const data = await getProfileDetails(undefined, { viewerUser: user, recordViewEvent: false });
    if (!data.profile || !(await hasCompletedOnboarding(user))) redirect(`/onboarding?next=${encodeURIComponent(currentHref)}`);
    if (!data.isOwner || data.profile.id !== user.id) notFound();

    return <EditProfileEditor key={data.profile.id} profile={data.profile}
        contributions={data.collaborationSummary?.contributions ?? []} initialSection={section}
        usernameNextChangeAt={await usernameNextChangeAt(user.id)} />;
}
