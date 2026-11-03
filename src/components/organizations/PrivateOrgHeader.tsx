'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

import { acceptOrgInviteAction, declineOrgInviteAction } from '@/app/actions/org-members'
import { cancelJoinRequestAction } from '@/app/actions/organizations'
import { JoinRequestNote } from '@/components/organizations/JoinOrgButton'
import { WorkspaceAvatar } from '@/components/workspaces/WorkspaceAvatar'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/feedback'
import { privateOrgLine, type PrivateOrgState } from '@/lib/organizations/join-rules'

/**
 * What people outside a private org see (report §18.2, §26.9, decision 48): picture, name, "Private organization",
 * and one line about their own state with its actions. Nothing else from inside.
 */
export function PrivateOrgHeader({ orgId, title, coverImage, state = { kind: 'none' }, signedIn = true }: { orgId: string; title: string; coverImage: string | null; state?: PrivateOrgState; signedIn?: boolean }) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const { line, join, action } = privateOrgLine(state, title)
    const run = (work: () => Promise<{ success: boolean; error?: string }>) => startTransition(async () => {
        const result = await work()
        if (!result.success) return void toast.error(result.error ?? 'Something went wrong.')
        router.refresh()
    })
    return (
        <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
            <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
                <WorkspaceAvatar project={{ title, coverImage }} />
                <h1 className="nb-page-title text-foreground">{title}</h1>
                <p className="text-sm text-muted-foreground">Private organization</p>
                {line ? <p role="status" className="text-sm text-foreground">{line}</p> : null}
                {action === 'invite' && state.kind === 'invited' && state.inviteId ? (
                    <div className="flex gap-2">
                        <Button disabled={pending} onClick={() => run(() => acceptOrgInviteAction(state.inviteId!))}>Accept</Button>
                        <Button variant="outline" disabled={pending} onClick={() => run(() => declineOrgInviteAction(state.inviteId!))}>Decline</Button>
                    </div>
                ) : null}
                {action === 'cancel' ? (
                    <div className="flex flex-col items-center gap-2">
                        <JoinRequestNote orgId={orgId} />
                        <Button variant="outline" disabled={pending} onClick={() => run(() => cancelJoinRequestAction(orgId))}>Cancel request</Button>
                    </div>
                ) : null}
                {join ? <Button asChild className="mt-2 min-h-11"><Link href="/join">Join with code</Link></Button> : null}
                {join && !signedIn ? <Link href="/login" className="text-sm text-primary hover:underline">Sign in</Link> : null}
            </div>
        </div>
    )
}
