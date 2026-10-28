import { buildRouteMetadata } from '@/lib/metadata/route-metadata'

// The page is a client component, so its tab title lives here.
export const metadata = buildRouteMetadata({
    title: 'Verify your email | NetworkBase',
    description: 'Confirm your email to finish setting up NetworkBase.',
    path: '/verify-email',
})

export default function Layout({ children }: { children: React.ReactNode }) {
    return children
}
