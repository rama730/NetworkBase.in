import { Suspense } from 'react'
import PeopleHubClient from '@/components/people/PeopleHubClient'
import { NetworkRouteSkeleton } from '@/components/people/NetworkRouteSkeleton'
import { getViewerAuthContext } from '@/lib/server/viewer-context'
import { buildRouteMetadata } from '@/lib/metadata/route-metadata'

export function generateMetadata() {
    return buildRouteMetadata({
        title: 'Network | NetworkBase',
        description: 'Discover collaborators, manage your network, and respond to incoming requests on NetworkBase.',
        path: '/network',
    });
}

async function ResolvedPeople() {
    const { user } = await getViewerAuthContext();

    return (
        <PeopleHubClient
            initialUser={user ? { id: user.id } : null}
        />
    )
}

export default function PeoplePage() {
    return (
        <div
            data-scroll-root="route"
            className="h-full min-h-0 overflow-hidden app-scroll app-scroll-y app-scroll-gutter bg-zinc-50 dark:bg-background"
        >
            <Suspense fallback={<NetworkRouteSkeleton />}>
                <ResolvedPeople />
            </Suspense>
        </div>
    )
}
