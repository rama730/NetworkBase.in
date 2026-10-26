'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Archive, UserPlus } from 'lucide-react'

import { cancelJoinRequestAction, joinPublicOrgAction, regenerateJoinCodeAction } from '@/app/actions/organizations'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { OrgDetail } from '@/lib/organizations/detail'

// The organization parts of the project header (report §18.1–18.2, §18.6). ProjectLayout keeps its layout;
// these fill the identity line, the facts and the visitor's actions.

const TYPE_LABEL: Record<string, string> = { education: 'Education', company: 'Company', community: 'Community', research: 'Research', club: 'Club' }

/** `@handle · Education · Teacher`, plus the archived line (report §18.1, §18.6). */
export function OrgIdentityLine({ handle, organization, memberRole, archived }: {
    handle: string | null
    organization: OrgDetail
    memberRole: 'owner' | 'admin' | 'member' | 'viewer' | null
    archived: boolean
}) {
    const parts = [handle ? `@${handle}` : null, organization.type ? TYPE_LABEL[organization.type] : null, memberRole ? organization.roleNames[memberRole] : null].filter(Boolean)
    return (
        <div className="space-y-1">
            <p className="nb-compact text-muted-foreground" data-testid="org-identity-line">{parts.join(' · ')}</p>
            {archived ? (
                <p className="nb-compact flex items-center gap-1.5 text-muted-foreground">
                    <span className="nb-status inline-flex items-center gap-1" data-status="archived"><Archive className="size-3" aria-hidden="true" />Archived</span>
                    This organization is archived. Everything is read-only.
                </p>
            ) : null}
        </div>
    )
}

/** Visitors on a public org: Join, Request to join, or Request pending with Cancel (report §18.2). */
export function OrgVisitorActions({ orgId, href, joinMode, requestPending, loggedIn }: {
    orgId: string
    href: string
    joinMode: 'instant' | 'approval'
    requestPending: boolean
    loggedIn: boolean
}) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)

    if (!loggedIn) {
        return <Button asChild size="sm"><Link href={`/login?redirect=${encodeURIComponent(href)}`}>{joinMode === 'approval' ? 'Request to join' : 'Join'}</Link></Button>
    }
    const run = (action: () => Promise<{ success: boolean; error?: string }>) =>
        startTransition(async () => {
            const result = await action()
            if (!result.success) return setError(result.error ?? 'Something went wrong.')
            setError(null)
            router.refresh()
        })

    return (
        <span className="inline-flex items-center gap-2">
            {requestPending ? (
                <>
                    <Button size="sm" variant="outline" disabled>Request pending</Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelJoinRequestAction(orgId))}>Cancel request</Button>
                </>
            ) : (
                <Button size="sm" disabled={pending} onClick={() => run(() => joinPublicOrgAction(orgId))}>
                    {joinMode === 'approval' ? 'Request to join' : 'Join'}
                </Button>
            )}
            {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
        </span>
    )
}

/** Admins' Invite: the join code with Copy, Copy invite message and Regenerate (report §18.2, §6.1). Email lists come with Members (P10). */
export function OrgInviteDialog({ orgId, title, joinCode, open, onOpenChange }: {
    orgId: string
    title: string
    joinCode: string | null
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const router = useRouter()
    const [code, setCode] = useState(joinCode)
    const [message, setMessage] = useState<string | null>(null)
    const [confirming, setConfirming] = useState(false)
    const [pending, startTransition] = useTransition()

    const copy = async (text: string, label: string) => {
        try {
            await navigator.clipboard.writeText(text)
            setMessage(label)
        } catch {
            setMessage('Copy failed. Select the text and copy it yourself.')
        }
    }
    const regenerate = () =>
        startTransition(async () => {
            const result = await regenerateJoinCodeAction(orgId)
            setConfirming(false)
            if (!result.success) return setMessage(result.error)
            setCode(result.joinCode)
            setMessage('New code ready. The old code no longer works.')
            router.refresh()
        })

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><UserPlus className="size-4" aria-hidden="true" />Invite people to {title}</DialogTitle>
                    <DialogDescription>Share the code. People enter it at /join or open the link.</DialogDescription>
                </DialogHeader>
                {code ? (
                    <div className="space-y-4">
                        <p className="select-all text-center font-mono text-4xl font-semibold tracking-[0.25em]" aria-label={`Join code ${code.split('').join(' ')}`}>{code}</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                            <Button variant="outline" onClick={() => copy(code, 'Code copied')}>Copy code</Button>
                            <Button variant="outline" onClick={() => copy(`Join ${title} on NetworkBase with code ${code}: ${window.location.origin}/join/${code}`, 'Invite message copied')}>Copy invite message</Button>
                        </div>
                        {confirming ? (
                            <div className="rounded-md border border-border p-3 text-sm">
                                <p>The current code stops working at once. People who haven&apos;t joined need the new one.</p>
                                <div className="mt-3 flex gap-2">
                                    <Button size="sm" variant="destructive" disabled={pending} onClick={regenerate}>Make a new code</Button>
                                    <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Keep this code</Button>
                                </div>
                            </div>
                        ) : (
                            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>Regenerate code</Button>
                        )}
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">Only owners and admins see the join code.</p>
                )}
                <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">{message}</p>
            </DialogContent>
        </Dialog>
    )
}
