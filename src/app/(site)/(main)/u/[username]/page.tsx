import { notFound, permanentRedirect } from 'next/navigation';
import { getProfileDetails } from '@/lib/data/profile';
import { ProfileV2Client } from '@/components/profile/v2/ProfileV2Client';
import { Metadata } from 'next';
import { cache, Suspense } from 'react';
import { resolvePublicUsernameRoute } from '@/lib/usernames/service';
import { buildRouteMetadata, DEFAULT_ROUTE_OG_IMAGE } from '@/lib/metadata/route-metadata';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { buildProfileMetadataDescription, buildPublicProfileTitle } from '@/lib/profile/display';
import { getProfileProjectsWithOpenRolesAction } from '@/app/actions/project';
import { ProfileRouteSkeleton } from '@/components/profile/v2/ProfileRouteSkeleton';

export const dynamicParams = true; // Allow new profiles to be generated on demand

function decodeUsernameParam(username: string): string | null {
    try {
        return decodeURIComponent(username);
    } catch {
        return null;
    }
}

// Metadata and body share the same auth-qualified profile read.
const readPublicProfileRoute = cache(async (username: string) => {
    const decodedUsername = decodeUsernameParam(username);
    if (!decodedUsername) return { status: 'not_found' as const, currentUsername: username };

    const route = await resolvePublicUsernameRoute({ username: decodedUsername });
    if (route.status === 'not_found') {
        return { status: 'not_found' as const, currentUsername: decodedUsername };
    }

    const viewerAuth = await getViewerAuthContext();
    const data = await getProfileDetails(route.currentUsername, {
        viewerUser: viewerAuth.user ?? null,
    });
    return { status: route.status, currentUsername: route.currentUsername, viewerAuth, data };
});

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
    const { username } = await params;
    const route = await readPublicProfileRoute(username);
    if (route.status === 'not_found' || route.data.privacyStatus === 'not_found' || !route.data.profile || route.data.lockedShell) {
        return buildRouteMetadata({
            title: 'Profile Not Found | NetworkBase',
            description: 'The requested profile could not be found.',
            path: `/u/${encodeURIComponent(route.currentUsername)}`,
            robots: { index: false, follow: false, noarchive: true },
        });
    }

    const profile = route.data.profile;
    const isPrivate = profile.visibility === 'private';
    return buildRouteMetadata({
        title: buildPublicProfileTitle({
            username: profile.username,
            fullName: profile.fullName,
        }),
        description: buildProfileMetadataDescription({
            username: profile.username,
            fullName: profile.fullName,
            headline: profile.headline,
            location: profile.location,
            bio: profile.bio,
        }),
        path: `/u/${encodeURIComponent(profile.username ?? route.currentUsername)}`,
        image: profile.avatarUrl || DEFAULT_ROUTE_OG_IMAGE,
        ...(isPrivate ? { robots: { index: false, follow: false, noarchive: true } } : {}),
    });
}

async function ResolvedPublicProfile({
    params,
}: {
    params: Promise<{ username: string }>;
}) {
    const { username } = await params;

    const route = await readPublicProfileRoute(username);
    if (route.status === 'not_found') {
        notFound();
    }
    if (route.status === 'redirect') {
        permanentRedirect(`/u/${encodeURIComponent(route.currentUsername)}`);
    }

    const { data } = route;

    if (data.privacyStatus === 'not_found' || !data.profile) {
        notFound();
    }

    const openRolesProjects = await getProfileProjectsWithOpenRolesAction(data.profile.id);

    return (
        <ProfileV2Client
            profile={data.profile}
            stats={data.stats}
            isOwner={data.isOwner}
            currentUser={data.currentUser}
            connectionStatus={data.connectionStatus}
            privacyRelationship={data.privacyRelationship}
            lockedShell={data.lockedShell}
            collaborationSummary={data.collaborationSummary}
            initialOpenRolesProjects={openRolesProjects.items}
        />
    );
}

export default function PublicProfilePage({
    params,
}: {
    params: Promise<{ username: string }>;
}) {
    return (
        <div
            data-scroll-root="route"
            className="h-full min-h-0 overflow-hidden app-scroll app-scroll-y app-scroll-gutter bg-background text-foreground"
        >
            <Suspense fallback={<ProfileRouteSkeleton />}>
                <ResolvedPublicProfile params={params} />
            </Suspense>
        </div>
    );
}
