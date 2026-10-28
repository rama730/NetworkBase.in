import { buildRouteMetadata } from '@/lib/metadata/route-metadata'
import { LoginForm } from '@/components/auth/LoginForm'

export const metadata = buildRouteMetadata({
    title: 'Sign in | NetworkBase',
    description: 'Sign in to NetworkBase to reach your projects, people and messages.',
    path: '/login',
})

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined) {
    return (Array.isArray(value) ? value[0] : value) ?? null
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
    const params = await searchParams
    return <LoginForm redirect={first(params.redirect)} error={first(params.error)} step={first(params.step)} />
}
