import { buildRouteMetadata } from '@/lib/metadata/route-metadata'
import { LoginForm } from '@/components/auth/LoginForm'

export const metadata = buildRouteMetadata({
    title: 'Sign in · NetworkBase',
    description: 'Sign in to NetworkBase to reach your workspaces, people and messages.',
    path: '/login',
    image: '/og/login-card.png',
    imageAlt: 'NetworkBase sign in: Pick up where you left off.',
    imageWidth: 1200,
    imageHeight: 630,
})

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined) {
    return (Array.isArray(value) ? value[0] : value) ?? null
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
    const params = await searchParams
    return <LoginForm redirect={first(params.redirect)} error={first(params.error)} step={first(params.step)} />
}
