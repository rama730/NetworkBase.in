import { redirect } from 'next/navigation'
import { normalizeAuthNextPath } from '@/lib/auth/redirects'
import { buildRouteMetadata } from '@/lib/metadata/route-metadata'
import { hasCompletedOnboarding } from '@/lib/onboarding/completion'
import { getViewerAuthContext } from '@/lib/server/viewer-context'
import AuthorizeClient from './AuthorizeClient'

export const metadata = buildRouteMetadata({
    title: 'Connect Editor | NetworkBase',
    description: 'Authorize your IDE extension to connect with your NetworkBase workspace.',
    path: '/authorize',
})

type SearchParams = Record<string, string | string[] | undefined>

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
    const { user } = await getViewerAuthContext()
    if (user && !(await hasCompletedOnboarding(user))) {
        const query = new URLSearchParams()
        for (const [key, value] of Object.entries(await searchParams)) {
            for (const item of Array.isArray(value) ? value : value ? [value] : []) query.append(key, item)
        }
        const suffix = query.toString()
        const nextPath = normalizeAuthNextPath(`/authorize${suffix ? `?${suffix}` : ''}`)
        redirect(`/onboarding?next=${encodeURIComponent(nextPath)}`)
    }
    return <AuthorizeClient viewerEmail={user?.email ?? null} />
}
