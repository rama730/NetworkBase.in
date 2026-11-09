'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

import { JoinRequestPending } from '@/components/organizations/JoinOrgButton'
import { WorkspaceAvatar } from '@/components/workspaces/WorkspaceAvatar'
import { Button } from '@/components/ui/button'
import { privateOrgLine, type PrivateOrgState } from '@/lib/organizations/join-rules'
import { useInviteAnswer } from '@/components/organizations/org-ui'

/**
 * What people outside a private org see (report §18.2, §26.9, decision 48): picture, name, "Private organization",
 * and one line about their own state with its actions. Nothing else from inside.
 */
export function PrivateOrgHeader({ orgId, title, coverImage, state = { kind: 'none' }, signedIn = true }: { orgId: string; title: string; coverImage: string | null; state?: PrivateOrgState; signedIn?: boolean }) {
    const { line, join, action } = privateOrgLine(state, title)
    const router = useRouter()
    const pathname = usePathname()
    // Audit N22: after Accept or Decline the page shows their new state, not "You're invited" with no buttons.
    const answer = useInviteAnswer(() => router.refresh())
    return (
        <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
            <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
                <WorkspaceAvatar project={{ title, coverImage }} size="detail" placeholder />
                <h1 className="nb-page-title text-foreground">{title}</h1>
                <p className="text-[13px] text-muted-foreground">Private organization</p>
                {line && action !== 'cancel' ? <p role="status" className="text-[13px] text-foreground">{line}</p> : null}
                {action === 'invite' && state.kind === 'invited' && state.inviteId && !answer.hidden.has(state.inviteId) ? (
                    <div className="flex gap-2">
                        <Button disabled={answer.pending} onClick={() => answer.accept({ id: state.inviteId!, orgTitle: title })}>Accept</Button>
                        <Button variant="outline" disabled={answer.pending} onClick={() => answer.decline({ id: state.inviteId!, orgTitle: title })}>Decline</Button>
                    </div>
                ) : null}
                {action === 'cancel' ? <JoinRequestPending orgId={orgId} /> : null}
                {join ? <Button asChild className="nb-touch-target mt-2"><Link href="/join">Join with code</Link></Button> : null}
                {/* Audit 4.3: signing in comes back here. */}
                {join && !signedIn ? <Link href={`/login?redirect=${encodeURIComponent(pathname ?? '/')}`} className="nb-link text-[13px]">Sign in</Link> : null}
            </div>
        </div>
    )
}
