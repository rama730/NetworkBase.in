'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { acceptOrgInviteAction, declineOrgInviteAction, listMyOrgInvitesAction } from '@/app/actions/org-members'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/feedback'

/** "You're invited" on an org's page for someone with an open email invite (report §20.5: in-app invitation). */
export function OrgInviteBanner({ orgId }: { orgId: string }) {
    const router = useRouter()
    const [invite, setInvite] = useState<{ id: string; role: string; title: string | null } | null>(null)
    const [pending, startTransition] = useTransition()
    useEffect(() => {
        void listMyOrgInvitesAction().then((all) => setInvite(all.find((i) => i.orgId === orgId) ?? null))
    }, [orgId])
    if (!invite) return null
    const roleLabel = invite.role === 'viewer' ? 'a guest' : invite.role === 'admin' ? 'an admin' : 'a member'
    return (
        <span className="flex flex-wrap items-center gap-2 text-sm">
            <span>You&apos;re invited as {roleLabel}{invite.title ? ` · ${invite.title}` : ''}</span>
            <Button type="button" size="sm" disabled={pending} onClick={() => startTransition(async () => {
                const r = await acceptOrgInviteAction(invite.id)
                if (!r.success) return void toast.error(r.error)
                toast.success('You joined')
                router.refresh()
            })}>Accept</Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => startTransition(async () => {
                const r = await declineOrgInviteAction(invite.id)
                if (r.success) setInvite(null)
            })}>Decline</Button>
        </span>
    )
}
