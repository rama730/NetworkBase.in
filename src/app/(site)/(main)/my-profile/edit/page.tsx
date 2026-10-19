import { redirect, notFound } from 'next/navigation';
import { EditProfileEditor } from '@/components/profile/edit/EditProfileEditor';
import { getProfileDetails } from '@/lib/data/profile';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { buildRouteMetadata } from '@/lib/metadata/route-metadata';
import { buildAuthPageHref } from '@/lib/auth/redirects';
import { parseProfileEditSection, profileEditHref } from '@/lib/profile/edit-route';

export const metadata = buildRouteMetadata({
    title: 'Edit profile | NetworkBase',
    description: 'Manage your profile details, contributions, skills and role preferences.',
    path: '/my-profile/edit',
    robots: { index: false, follow: false, noarchive: true },
});

export default async function EditProfilePage({ searchParams }: {
    searchParams: Promise<{ section?: string; returnTab?: string }>;
}) {
    const params = await searchParams;
    const section = parseProfileEditSection(params.section);
    const { user } = await getViewerAuthContext();
    if (!user) redirect(buildAuthPageHref('/login', profileEditHref(section, params.returnTab)));

    const data = await getProfileDetails(undefined, { viewerUser: user, recordViewEvent: false });
    if (!data.profile || !data.profile.username) redirect('/onboarding');
    if (!data.isOwner || data.profile.id !== user.id) notFound();

    return <EditProfileEditor key={data.profile.id} profile={data.profile}
        contributions={data.collaborationSummary?.contributions ?? []} initialSection={section} />;
}
