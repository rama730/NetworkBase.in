import { buildRouteMetadata } from '@/lib/metadata/route-metadata'
import { SignupForm } from '@/components/auth/SignupForm'

export const metadata = buildRouteMetadata({
    title: 'Create your account · NetworkBase',
    description: 'Create a NetworkBase account to find people and work together in workspaces.',
    path: '/signup',
    image: '/og/signup-card.png',
    imageAlt: 'NetworkBase sign up: Your first workspace is three steps away.',
    imageWidth: 1200,
    imageHeight: 630,
})

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined) {
    return (Array.isArray(value) ? value[0] : value) ?? null
}

export default async function SignupPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
    const params = await searchParams
    return <SignupForm redirect={first(params.redirect)} invite={first(params.invite)} referral={first(params.ref)} project={first(params.project)} />
}
