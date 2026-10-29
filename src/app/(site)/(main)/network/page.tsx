import { Suspense } from 'react'
import NetworkClient from '@/components/network/NetworkClient'
import { NetworkRouteSkeleton } from '@/components/network/NetworkRouteSkeleton'
import { getViewerAuthContext } from '@/lib/server/viewer-context'
import { buildRouteMetadata } from '@/lib/metadata/route-metadata'

export function generateMetadata() {
    return buildRouteMetadata({
        title: 'Network | NetworkBase',
        description: 'Find people, manage your connections and answer requests on NetworkBase.',
        path: '/network',
    });
}

async function ResolvedPeople() {
    const { user } = await getViewerAuthContext();

    return (
        <NetworkClient
            initialUser={user ? { id: user.id } : null}
        />
    )
}

export default function PeoplePage() {
    return (
        <div
            data-scroll-root="route"
            className="h-full min-h-0 app-scroll app-scroll-y app-scroll-gutter bg-background"
        >
            <Suspense fallback={<NetworkRouteSkeleton />}>
                <ResolvedPeople />
            </Suspense>
        </div>
    )
}
