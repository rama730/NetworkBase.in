'use client'

import { useEffect, useState } from 'react'

import { listMyOrgInvitesAction } from '@/app/actions/org-members'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { useInviteAnswer } from '@/components/organizations/org-ui'

/** "You're invited" on an org's page for someone with an open email invite (report §20.5), under the name. */
export function OrgInviteBanner({ orgId }: { orgId: string }) {
    const [invite, setInvite] = useState<{ id: string; roleLabel: string; title: string | null; orgTitle: string } | null>(null)
    const answer = useInviteAnswer()
    useEffect(() => {
        void listMyOrgInvitesAction().then((all) => setInvite(all.find((i) => i.orgId === orgId) ?? null))
    }, [orgId])
    if (!invite || answer.hidden.has(invite.id)) return null
    return (
        <Notice tone="info" className="mt-2" action={<>
            <Button type="button" size="sm" disabled={answer.pending} onClick={() => answer.accept(invite)}>Accept</Button>
            <Button type="button" size="sm" variant="outline" disabled={answer.pending} onClick={() => answer.decline(invite)}>Decline</Button>
        </>}>
            You’re invited as {invite.roleLabel}{invite.title ? ` · ${invite.title}` : ''}.
        </Notice>
    )
}
