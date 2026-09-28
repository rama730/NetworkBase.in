import { LoginForm } from '@/components/auth/LoginForm'

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined) {
    return (Array.isArray(value) ? value[0] : value) ?? null
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
    const params = await searchParams
    return <LoginForm redirect={first(params.redirect)} error={first(params.error)} mode={first(params.mode)} />
}
