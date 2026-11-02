'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { orgInviteMessage } from '@/lib/organizations/creation'

export type CreatedOrganization = {
    title: string
    joinCode: string
    /** Invites sent at creation (report §34.8). */
    invites?: { coAdmins: number; members: number; skipped: number }
    creatorTitle?: string | null
    /** Report §27.3: whether people join at once or wait for approval. */
    joinMode?: 'instant' | 'approval' | null
}

/** After creating an org (report §34.8): the join code large, Copy code, Copy invite message, what was sent, then Go to organization. */
export function OrganizationCreatedScreen({ title, joinCode, invites, creatorTitle, joinMode, onContinue }: CreatedOrganization & { onContinue: () => void }) {
    const [copied, setCopied] = useState<string | null>(null)
    const { user } = useAuth()
    const name = (user?.user_metadata?.full_name as string | undefined)?.trim()
    const signedBy = [name, creatorTitle?.trim()].filter(Boolean).join(', ') || null
    const link = typeof window === 'undefined' ? '' : ` ${window.location.origin}/join/${joinCode}`
    const invite = `${orgInviteMessage({ title, joinCode, signedBy })}${link}`
    const sent = [
        invites?.coAdmins ? `${invites.coAdmins} co-admin ${invites.coAdmins === 1 ? 'invite' : 'invites'}` : null,
        invites?.members ? `${invites.members} member ${invites.members === 1 ? 'invite' : 'invites'}` : null,
    ].filter(Boolean).join(' and ')
    const joining = joinMode === 'approval' ? 'Needs your approval' : joinMode === 'instant' ? 'People join right away' : null
    const skipped = invites?.skipped ?? 0

    const copy = async (text: string, label: string) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(label)
        } catch {
            setCopied('Copy failed. Select the text and copy it yourself.')
        }
    }

    return (
        <main className="flex h-full min-h-0 items-center justify-center bg-card px-4 py-12">
            <div className="w-full max-w-md space-y-6 text-center">
                <div className="space-y-1">
                    <h1 className="text-2xl font-semibold tracking-tight">{title} is ready</h1>
                    <p className="text-sm text-muted-foreground">People join with this code. You can copy or regenerate it later in Settings.</p>
                </div>
                <p className="select-all font-mono text-5xl font-semibold tracking-[0.25em] text-foreground" aria-label={`Join code ${joinCode.split('').join(' ')}`}>
                    {joinCode}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                    <Button type="button" variant="outline" className="min-h-11" onClick={() => copy(joinCode, 'Code copied')}>Copy code</Button>
                    <Button type="button" variant="outline" className="min-h-11" onClick={() => copy(invite, 'Invite message copied')}>Copy invite message</Button>
                </div>
                <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">{copied}</p>
                {joining || sent ? <p className="text-sm text-foreground" data-testid="org-created-invites">{[joining, sent ? `${sent} sent` : null].filter(Boolean).join(' · ')}</p> : null}
                {skipped ? <p className="text-sm text-muted-foreground">{skipped} {skipped === 1 ? 'address' : 'addresses'} looked wrong and {skipped === 1 ? 'was' : 'were'} skipped</p> : null}
                <Button type="button" className="min-h-11 w-full" onClick={onContinue}>Go to organization</Button>
            </div>
        </main>
    )
}
