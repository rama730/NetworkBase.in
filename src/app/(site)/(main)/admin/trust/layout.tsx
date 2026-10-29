import { notFound } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'

import { ConsoleHeader } from '@/components/trust/ConsoleHeader'
import { Button } from '@/components/ui/button'
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
    const { supabase, user, snapshot } = await getViewerAuthContext()
    if (!staffRoleOf(user)) notFound()
    // Staff need an authenticator, and this session must have used it (F16).
    if (snapshot?.aal !== 'aal2') {
        const hasAuthenticator = getVerifiedTotpFactors(await listSecurityMfaFactors(supabase).catch(() => [])).length > 0
        return (
            <div data-scroll-root="route" className="h-full min-h-0 app-scroll app-scroll-y bg-background">
                <div className="nb-empty-state mx-4 mt-16 md:mx-auto" role="status">
                    <ShieldCheck className="nb-empty-state-icon" aria-hidden="true" />
                    <p className="nb-empty-state-title mt-4">{hasAuthenticator ? 'Verify with your authenticator' : 'Set up an authenticator'}</p>
                    <p className="nb-empty-state-desc">
                        {hasAuthenticator
                            ? 'Trust & safety opens after you sign in with your authenticator code. Sign out and sign in again.'
                            : 'Trust & safety needs an authenticator app on staff accounts. Add one, then sign in again.'}
                    </p>
                    <Button asChild variant="outline" className="mt-4"><a href="/settings#settings-security">Open Settings → Security</a></Button>
                </div>
            </div>
        )
    }
    const counts = await consoleCounts()
    return (
        <div data-scroll-root="route" className="h-full min-h-0 app-scroll app-scroll-y app-scroll-gutter bg-background">
            <div className="mx-auto w-full max-w-[1600px] px-4 pb-16 pt-6 md:px-8">
                <ConsoleHeader counts={counts} />
                {children}
            </div>
        </div>
    )
}
