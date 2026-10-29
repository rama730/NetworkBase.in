import { notFound } from 'next/navigation'

import { ConsoleHeader } from '@/components/trust/ConsoleHeader'
import { buildRouteMetadata } from '@/lib/metadata/route-metadata'
import { getVerifiedTotpFactors, listSecurityMfaFactors } from '@/lib/security/mfa'
import { getViewerAuthContext } from '@/lib/server/viewer-context'
import { consoleCounts } from '@/lib/trust/console'
import { staffRoleOf } from '@/lib/trust/staff'

export function generateMetadata() {
    return buildRouteMetadata({ title: 'Trust & safety · NetworkBase', description: 'Reports, cases, appeals and actions.', path: '/admin/trust', robots: { index: false, follow: false } })
}

/** The staff console (docs/trust-and-safety-concept.md §17): inside the app shell; anyone but staff gets a 404 (C1). */
export default async function TrustConsoleLayout({ children }: { children: React.ReactNode }) {
    const { supabase, user } = await getViewerAuthContext()
    if (!staffRoleOf(user)) notFound()
    const [counts, factors] = await Promise.all([consoleCounts(), listSecurityMfaFactors(supabase).catch(() => [])])
    return (
        <div data-scroll-root="route" className="h-full min-h-0 app-scroll app-scroll-y app-scroll-gutter bg-background">
            <div className="mx-auto w-full max-w-[1600px] px-4 pb-16 pt-6 md:px-8">
                <ConsoleHeader counts={counts} />
                {getVerifiedTotpFactors(factors).length ? null : (
                    <p role="note" className="mb-4 rounded-[5px] border border-[var(--status-warning)]/30 bg-[var(--status-warning-soft)] px-3 py-2 text-[13px]">
                        Staff accounts need an authenticator. <a href="/settings#settings-security" className="font-medium underline underline-offset-4">Set one up in Settings → Security</a>.
                    </p>
                )}
                {children}
            </div>
        </div>
    )
}
