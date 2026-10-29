import { buildRouteMetadata } from '@/lib/metadata/route-metadata'

// The page is a client component, so its tab title lives here.
export const metadata = buildRouteMetadata({
    title: 'Reset your password · NetworkBase',
    description: 'Get a link to choose a new NetworkBase password.',
    path: '/forgot-password',
})

export default function Layout({ children }: { children: React.ReactNode }) {
    return children
}
