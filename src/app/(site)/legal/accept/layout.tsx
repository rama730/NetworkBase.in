import { buildRouteMetadata } from '@/lib/metadata/route-metadata'

// The page is a client component, so its tab title lives here.
export const metadata = buildRouteMetadata({
    title: 'Before you continue · NetworkBase',
    description: 'Review and accept the current NetworkBase terms.',
    path: '/legal/accept',
    robots: { index: false, follow: false },
})

export default function Layout({ children }: { children: React.ReactNode }) {
    return children
}
