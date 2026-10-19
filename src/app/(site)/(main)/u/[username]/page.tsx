import { notFound, permanentRedirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getProfileDetails } from '@/lib/data/profile';
import { ProfileV2Client } from '@/components/profile/v2/ProfileV2Client';
import { Metadata } from 'next';
import { cache, Suspense } from 'react';
import { resolvePublicUsernameRoute } from '@/lib/usernames/service';
import { shareMetadata } from '@/lib/sharing/metadata';
import { readSharePreview } from '@/lib/sharing/read';
import { genericSharePreview, isShareCrawler, shareOrigin } from '@/lib/sharing/presentation';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
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

// The body is viewer-qualified. Metadata always uses an independent anonymous projection.
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
    const url = new URL(`/u/${encodeURIComponent(username)}`, shareOrigin()).href;
    const preview = await readSharePreview(url);
    return shareMetadata(preview ?? genericSharePreview({ kind: 'profile', identifier: username, url }, 'unavailable'));
}

async function ResolvedPublicProfile({
    params,
}: {
    params: Promise<{ username: string }>;
}) {
    const { username } = await params;

    if (isShareCrawler((await headers()).get('user-agent'))) {
        const preview = await readSharePreview(new URL(`/u/${encodeURIComponent(username)}`, shareOrigin()).href);
        if (preview?.state === 'ready' && new URL(preview.url).pathname !== `/u/${username}`) permanentRedirect(new URL(preview.url).pathname);
        return <article className="p-6"><h1>{preview?.title ?? 'Profile on NetworkBase'}</h1><p>{preview?.description ?? 'Open this profile on NetworkBase.'}</p>{preview?.portfolio ? <p>{preview.portfolio}</p> : null}{preview?.skills.length ? <p>{preview.skills.join(', ')}</p> : null}<a href={preview?.url ?? '/discover'}>Open NetworkBase</a></article>;
    }

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
