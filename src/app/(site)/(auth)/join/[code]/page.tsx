import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getJoinPreviewAction } from '@/app/actions/organizations'
import { JoinOrgButton, JoinRequestPending } from '@/components/organizations/JoinOrgButton'
import { JoinReportLink } from '@/components/organizations/JoinReportLink'
import { WorkspaceAvatar } from '@/components/workspaces/WorkspaceAvatar'
import { AUTH_LINK, AuthShell, SignedInAs } from '@/components/auth/AuthShell'
import { AUTH_PANELS } from '@/components/auth/auth-panels'
import { PixelIcon } from '@/components/auth/pixel'
import { Button } from '@/components/ui/button'
import { buildAuthPageHref } from '@/lib/auth/redirects'
import { buildRouteMetadata } from '@/lib/metadata/route-metadata'
import { hasOnboardingClaims } from '@/lib/onboarding/state'
import { normalizeJoinCode } from '@/lib/organizations/join-rules'
import { getViewerAuthContext } from '@/lib/server/viewer-context'

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
    const code = normalizeJoinCode((await params).code)
    return buildRouteMetadata({
        title: 'Join an organization · NetworkBase',
        description: 'You have been invited to join an organization on NetworkBase.',
        path: '/join',
        image: `/api/og/join/${code ?? 'none'}`,
        imageAlt: 'Join an organization on NetworkBase',
        imageWidth: 1200,
        imageHeight: 630,
    })
}

const JOIN_PANEL = AUTH_PANELS.join

/** Join preview (report §6.1, §29.1): the same page for a typed code, a shared link and a logged-out visitor. */
export default async function JoinOrganizationPage({ params }: { params: Promise<{ code: string }> }) {
    const code = normalizeJoinCode((await params).code)
    const { user } = await getViewerAuthContext()
    const here = `/join/${code ?? ''}`
    // Setup comes first; the code rides along and the join happens when it finishes.
    if (user && code && !hasOnboardingClaims(user)) redirect(`/onboarding?next=${encodeURIComponent(here)}`)

    const result = code ? await getJoinPreviewAction(code) : null
    if (!result?.success) {
        return (
            <AuthShell title={result?.error ?? "That code doesn’t work. Ask your organization for the current one."} description="Codes change when an organization makes a new one." panel={JOIN_PANEL} mark="cross" outcome={{ word: 'NO', title: 'Ask for the current code.' }} panelRoute={`join/${code ?? ''}`}>
                <Button asChild variant="outline" className="h-11 w-full"><Link href="/join">Enter a code</Link></Button>
            </AuthShell>
        )
    }

    const { preview } = result
    const facts = [preview.orgType, preview.memberCount !== null ? `${preview.memberCount} ${preview.memberCount === 1 ? 'member' : 'members'}` : null]
        .filter(Boolean)
        .join(' · ')
    const orgHref = `/org/${encodeURIComponent(preview.slug ?? preview.id)}`

    return (
        // Live-fix 49: the owner or a member is already in; only others are invited.
        <AuthShell title={preview.title} description={preview.state === 'member' ? `You’re already in ${preview.title}.` : "Check the details before you join."} panel={JOIN_PANEL} step={[2, 2]} panelRoute={`join/${code}`}>
            <div className="space-y-6">
                <div className="flex items-center gap-3 rounded-md border border-border bg-card p-3.5">
                    {preview.coverImage
                        ? <WorkspaceAvatar project={{ title: preview.title, coverImage: preview.coverImage }} />
                        : <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground"><PixelIcon name="people" size={24} /></span>}
                    <p className="min-w-0 truncate text-sm text-muted-foreground">{facts || 'Organization'}</p>
                </div>

                {user?.email && preview.viewer !== 'member' ? <SignedInAs userId={user.id} email={user.email} name={typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null} next={here} /> : null}

                {!user ? (
                    <div className="space-y-3">
                        {preview.joinMode === 'approval' ? (
                            <p className="text-center text-sm text-muted-foreground">Your request will be reviewed by the admins.</p>
                        ) : null}
                        <Button asChild className="h-11 w-full font-medium"><Link href={buildAuthPageHref('/signup', here)}>Sign up to join</Link></Button>
                        <p className="text-center text-sm text-muted-foreground">
                            Already have an account? <Link className={AUTH_LINK} href={buildAuthPageHref('/login', here)}>Sign in</Link>
                        </p>
                    </div>
                ) : preview.state === 'member' ? (
                    <Button asChild className="h-11 w-full font-medium"><Link href={orgHref}>Open {preview.title}</Link></Button>
                ) : preview.state === 'waiting' ? (
                    // Report §26.1 #6, §26.2: someone waiting can withdraw from here.
                    <JoinRequestPending orgId={preview.id} />
                ) : preview.stateMessage ? (
                    // Full, blocked, ended, recently declined or at the 50-organization limit: said plainly, nothing is created.
                    <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-center text-sm">{preview.stateMessage}</p>
                ) : (
                    <JoinOrgButton code={code!} joinMode={preview.joinMode} orgHref={orgHref} />
                )}
                {/* Report §29.4, decision 63: what admins can see, before anyone joins. */}
                {preview.state === 'open' || preview.state === 'waiting' ? <p className="text-center text-xs text-muted-foreground" data-testid="join-admins-line">{preview.adminsLine}</p> : null}
                {/* Decision 163: launch is 18 and over. */}
                {preview.viewer !== 'member' ? <p className="text-center text-xs text-muted-foreground">You must be 18 or older to join.</p> : null}
                {user && preview.viewer !== 'member' ? <JoinReportLink orgId={preview.id} code={code!} /> : null}
            </div>
        </AuthShell>
    )
}
