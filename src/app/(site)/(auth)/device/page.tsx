import { redirect } from 'next/navigation'
import { normalizeAuthNextPath } from '@/lib/auth/redirects'
import { findPendingDeviceCode, listAgentWorkspaces } from '@/lib/extension/device-codes'
import { buildRouteMetadata } from '@/lib/metadata/route-metadata'
import { hasCompletedOnboarding } from '@/lib/onboarding/completion'
import { getViewerAuthContext } from '@/lib/server/viewer-context'
import DeviceClient from './DeviceClient'

export const metadata = buildRouteMetadata({
    title: 'Sign in a terminal · NetworkBase',
    description: 'Approve a NetworkBase CLI or AI agent that showed you a code.',
    path: '/device',
})

type SearchParams = Record<string, string | string[] | undefined>

/** Sign-in with a code for terminals without a browser (report A3.1, A3.2). */
export default async function DevicePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
    const raw = (await searchParams).code
    const code = typeof raw === 'string' ? raw.slice(0, 20) : ''
    const { user } = await getViewerAuthContext()
    if (user && !(await hasCompletedOnboarding(user))) {
        redirect(`/onboarding?next=${encodeURIComponent(normalizeAuthNextPath(`/device${code ? `?code=${encodeURIComponent(code)}` : ''}`))}`)
    }
    // Details of a waiting sign-in are only shown to someone signed in.
    const pending = user && code ? await findPendingDeviceCode(code, user.id) : null
    const workspaces = user ? await listAgentWorkspaces(user.id, { includeViewer: true }) : []
    return (
        <DeviceClient
            viewerEmail={user?.email ?? null}
            viewerId={user?.id ?? null}
            code={code}
            pending={pending ? { ...pending, createdAt: pending.createdAt.toISOString(), expiresAt: pending.expiresAt.toISOString() } : null}
            workspaces={workspaces}
        />
    )
}
