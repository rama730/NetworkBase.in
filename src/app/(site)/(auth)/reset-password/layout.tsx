import { buildRouteMetadata } from '@/lib/metadata/route-metadata'

// The page is a client component, so its tab title lives here.
export const metadata = buildRouteMetadata({
    title: 'Choose a new password | NetworkBase',
    description: 'Finish resetting your NetworkBase password.',
    path: '/reset-password',
})

export default function Layout({ children }: { children: React.ReactNode }) {
    return children
}
