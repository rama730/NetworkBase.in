import { SignupForm } from '@/components/auth/SignupForm'

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined) {
    return (Array.isArray(value) ? value[0] : value) ?? null
}

export default async function SignupPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
    const params = await searchParams
    return <SignupForm redirect={first(params.redirect)} invite={first(params.invite)} ref={first(params.ref)} project={first(params.project)} />
}
