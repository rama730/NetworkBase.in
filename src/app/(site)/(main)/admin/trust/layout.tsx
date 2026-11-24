import { notFound } from 'next/navigation'
import { ShieldCheck } from '@/components/ui/icons'

import { ConsoleHeader } from '@/components/trust/ConsoleHeader'
import { Button } from '@/components/ui/button'
import { buildRouteMetadata } from '@/lib/metadata/route-metadata'
import { getVerifiedTotpFactors, listSecurityMfaFactors } from '@/lib/security/mfa'
import { getViewerAuthContext } from '@/lib/server/viewer-context'
import { TrustLiveProvider } from '@/components/trust/live'
import { inboxCounts } from '@/lib/trust/inbox'
import { listStaff, staffRoleOf } from '@/lib/trust/staff'

export function generateMetadata() {
    return buildRouteMetadata({ title: 'Trust and safety · NetworkBase', description: 'Reports, cases, appeals and actions.', path: '/admin/trust', robots: { index: false, follow: false } })
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
                            ? 'Trust and safety opens after you sign in with your authenticator code. Sign out and sign in again.'
                            : 'Trust and safety needs an authenticator app on staff accounts. Add one, then sign in again.'}
                    </p>
                    <Button asChild variant="outline" className="mt-4"><a href="/settings#settings-security">Open Settings → Security</a></Button>
                </div>
            </div>
        )
    }
    const [counts, staff] = await Promise.all([inboxCounts(), listStaff()])
    const me = staff.find((s) => s.id === user!.id)
    // The Inbox's panes scroll on their own (R3); the other tabs wrap themselves in ConsoleScroll.
    return (
        <TrustLiveProvider staffId={user!.id} name={me?.name ?? me?.email ?? 'Staff'}>
            <div className="flex h-full min-h-0 flex-col bg-background">
                <div className="shrink-0 px-4 pt-4 md:px-6">
                    <ConsoleHeader counts={counts} isAdmin={staffRoleOf(user) === 'admin'} />
                </div>
                <div className="min-h-0 flex-1">{children}</div>
            </div>
        </TrustLiveProvider>
    )
}
