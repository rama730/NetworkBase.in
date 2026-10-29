import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { CreateProjectRouteClient } from '@/components/workspaces/create-wizard/CreateWorkspaceRouteClient'
import { buildRouteMetadata } from '@/lib/metadata/route-metadata'
import { getViewerAuthContext } from '@/lib/server/viewer-context'
import { buildAuthPageHref } from '@/lib/auth/redirects'
import { listCreateLocations } from '@/lib/organizations/detail'

const VALID_CREATE_PROJECT_SOURCES = new Set(['scratch', 'github', 'upload'] as const)

export const metadata: Metadata = buildRouteMetadata({
    title: 'Create workspace | NetworkBase',
    description: 'Start a new workspace on NetworkBase.',
    path: '/workspaces/new',
})

export default async function NewProjectPage({
    searchParams,
}: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
    const resolvedSearchParams = (await searchParams) ?? {}
    const rawSource = typeof resolvedSearchParams.source === 'string'
        ? resolvedSearchParams.source
        : typeof resolvedSearchParams.createProjectSource === 'string'
            ? resolvedSearchParams.createProjectSource
            : null
    const initialSource = rawSource && VALID_CREATE_PROJECT_SOURCES.has(rawSource as 'scratch' | 'github' | 'upload')
        ? (rawSource as 'scratch' | 'github' | 'upload')
        : null

    const { user } = await getViewerAuthContext()

    if (!user) {
        const nextTarget = initialSource ? `/workspaces/new?source=${initialSource}` : '/workspaces/new'
        redirect(buildAuthPageHref('/login', nextTarget))
    }

    // Where the project goes (report §14.1): ?org=<handle> locks it to that org when the person may create
    // there; otherwise it falls back to Personal with one line saying why.
    const locations = await listCreateLocations(user.id)
    const orgParam = typeof resolvedSearchParams.org === 'string' ? resolvedSearchParams.org.trim().toLowerCase() : ''
    const requestedOrg = orgParam ? locations.find((location) => location.slug === orgParam) : undefined
    const initialOrgId = requestedOrg && !requestedOrg.block ? requestedOrg.id : null
    const locationNotice = orgParam && !initialOrgId
        ? `${requestedOrg?.block ?? `You’re not a member of ${orgParam}.`} This will be a personal workspace.`
        : null

    // A normal page in the app shell: fills the main content area; the wizard body is the only scroller.
    return (
        <div data-scroll-root="route" className="h-full min-h-0">
            <CreateProjectRouteClient initialSource={initialSource} createLocations={locations} initialOrgId={initialOrgId} locationNotice={locationNotice} />
        </div>
    )
}
