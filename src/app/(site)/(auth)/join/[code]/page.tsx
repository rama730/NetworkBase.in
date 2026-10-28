import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getJoinPreviewAction } from '@/app/actions/organizations'
import { JoinOrgButton } from '@/components/organizations/JoinOrgButton'
import { ProjectAvatar } from '@/components/projects/ProjectAvatar'
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

const TYPE_LABEL: Record<string, string> = { education: 'Education', company: 'Company', community: 'Community', research: 'Research', club: 'Club' }

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
            <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-12 text-foreground">
                <div className="w-full max-w-sm space-y-4 text-center">
                    <h1 className="text-xl font-semibold">{result?.error ?? "That code doesn't match an organization."}</h1>
                    <p className="text-sm text-muted-foreground">If your organization made a new code, ask for it.</p>
                    <Button asChild variant="outline" className="min-h-11"><Link href="/join">Enter a code</Link></Button>
                </div>
            </main>
        )
    }

    const { preview } = result
    const facts = [preview.orgType ? TYPE_LABEL[preview.orgType] : null, preview.memberCount !== null ? `${preview.memberCount} ${preview.memberCount === 1 ? 'member' : 'members'}` : null]
        .filter(Boolean)
        .join(' · ')
    const orgHref = `/projects/${preview.slug ?? ''}`

    return (
        <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-12 text-foreground">
            <div className="w-full max-w-sm space-y-6">
                <div className="flex flex-col items-center gap-3 text-center">
                    <ProjectAvatar project={{ title: preview.title, coverImage: preview.coverImage }} showPresence={false} />
                    <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">You&apos;ve been invited to join</p>
                        <h1 className="text-2xl font-semibold tracking-tight">{preview.title}</h1>
                        {facts ? <p className="text-sm text-muted-foreground">{facts}</p> : null}
                    </div>
                </div>

                {!user ? (
                    <div className="space-y-3">
                        {preview.joinMode === 'approval' ? (
                            <p className="text-center text-sm text-muted-foreground">Your request will be reviewed by the admins.</p>
                        ) : null}
                        <Button asChild className="min-h-11 w-full"><Link href={buildAuthPageHref('/signup', here)}>Sign up to join</Link></Button>
                        <p className="text-center text-sm text-muted-foreground">
                            Already have an account? <Link className="font-medium text-foreground underline underline-offset-4" href={buildAuthPageHref('/login', here)}>Log in</Link>
                        </p>
                    </div>
                ) : preview.viewer === 'member' ? (
                    <Button asChild className="min-h-11 w-full"><Link href={orgHref}>Open {preview.title}</Link></Button>
                ) : preview.viewer === 'pending' ? (
                    <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-center text-sm">Request pending. The admins will review it.</p>
                ) : (
                    <JoinOrgButton code={code!} joinMode={preview.joinMode} orgHref={orgHref} />
                )}
            </div>
        </main>
    )
}
