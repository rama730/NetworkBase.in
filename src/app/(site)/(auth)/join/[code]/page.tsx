import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getJoinPreviewAction } from '@/app/actions/organizations'
import { JoinOrgButton } from '@/components/organizations/JoinOrgButton'
import { ProjectAvatar } from '@/components/projects/ProjectAvatar'
import { AUTH_LINK, AuthShell } from '@/components/auth/AuthShell'
import { Button } from '@/components/ui/button'
import { buildAuthPageHref } from '@/lib/auth/redirects'
import { buildRouteMetadata } from '@/lib/metadata/route-metadata'
import { hasOnboardingClaims } from '@/lib/onboarding/state'
import { normalizeJoinCode } from '@/lib/organizations/join-rules'
import { getViewerAuthContext } from '@/lib/server/viewer-context'

export const metadata = buildRouteMetadata({
    title: 'Join an organization | NetworkBase',
    description: 'You have been invited to join an organization on NetworkBase.',
    path: '/join',
})

const JOIN_PANEL = { eyebrow: 'Organizations', title: 'Your class or team, in one place.' }

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
            <AuthShell title={result?.error ?? "That code doesn’t match an organization."} description="If your organization made a new code, ask for it." panel={JOIN_PANEL}>
                <Button asChild variant="outline" className="h-11 w-full"><Link href="/join">Enter a code</Link></Button>
            </AuthShell>
        )
    }

    const { preview } = result
    const facts = [preview.orgType, preview.memberCount !== null ? `${preview.memberCount} ${preview.memberCount === 1 ? 'member' : 'members'}` : null]
        .filter(Boolean)
        .join(' · ')
    const orgHref = `/projects/${preview.slug ?? ''}`

    return (
        <AuthShell title={preview.title} description="You’ve been invited to join this organization." panel={JOIN_PANEL}>
            <div className="space-y-6">
                <div className="flex items-center gap-3 rounded-md border border-border bg-card p-3.5">
                    <ProjectAvatar project={{ title: preview.title, coverImage: preview.coverImage }} showPresence={false} />
                    <p className="min-w-0 truncate text-sm text-muted-foreground">{facts || 'Organization'}</p>
                </div>

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
                ) : preview.viewer === 'member' ? (
                    <Button asChild className="h-11 w-full font-medium"><Link href={orgHref}>Open {preview.title}</Link></Button>
                ) : preview.viewer === 'pending' ? (
                    <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-center text-sm">Request pending. The admins will review it.</p>
                ) : (
                    <JoinOrgButton code={code!} joinMode={preview.joinMode} orgHref={orgHref} />
                )}
            </div>
        </AuthShell>
    )
}
