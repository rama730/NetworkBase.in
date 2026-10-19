import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { CreateProjectRouteClient } from '@/components/projects/create-wizard/CreateProjectRouteClient'
import { buildRouteMetadata } from '@/lib/metadata/route-metadata'
import { getViewerAuthContext } from '@/lib/server/viewer-context'
import { buildAuthPageHref } from '@/lib/auth/redirects'

const VALID_CREATE_PROJECT_SOURCES = new Set(['scratch', 'github', 'upload'] as const)

export const metadata: Metadata = buildRouteMetadata({
    title: 'Create project | NetworkBase',
    description: 'Start a new project on NetworkBase.',
    path: '/projects/new',
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
        const nextTarget = initialSource ? `/projects/new?source=${initialSource}` : '/projects/new'
        redirect(buildAuthPageHref('/login', nextTarget))
    }

    // A normal page in the app shell: fills the main content area; the wizard body is the only scroller.
    return (
        <div data-scroll-root="route" className="h-full min-h-0">
            <CreateProjectRouteClient initialSource={initialSource} />
        </div>
    )
}
