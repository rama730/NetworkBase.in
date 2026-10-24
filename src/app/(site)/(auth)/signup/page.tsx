import { buildRouteMetadata } from '@/lib/metadata/route-metadata'
import { SignupForm } from '@/components/auth/SignupForm'

export const metadata = buildRouteMetadata({
    title: 'Create your account | NetworkBase',
    description: 'Create a NetworkBase account to find collaborators and build projects together.',
    path: '/signup',
})

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined) {
    return (Array.isArray(value) ? value[0] : value) ?? null
}

export default async function SignupPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
    const params = await searchParams
    return <SignupForm redirect={first(params.redirect)} invite={first(params.invite)} referral={first(params.ref)} project={first(params.project)} />
}
