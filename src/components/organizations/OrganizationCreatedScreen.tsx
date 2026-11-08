'use client'

import { CopyButton } from '@/components/ui/copy-button'
import { JoinCode } from '@/components/organizations/org-ui'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { orgInviteMessage } from '@/lib/organizations/creation'

export type CreatedOrganization = {
    title: string
    joinCode: string
    /** The web address (2026-11-05 findings §3): networkbase.in/org/<handle>. */
    handle?: string | null
    /** Invites sent at creation (report §34.8). */
    invites?: { coAdmins: number; members: number; skipped: number }
    creatorTitle?: string | null
    /** Report §27.3: whether people join at once or wait for approval. */
    joinMode?: 'instant' | 'approval' | null
}

/** After creating an org (report §34.8): the join code large, Copy code, Copy invite message, what was sent, then Go to organization. */
export function OrganizationCreatedScreen({ title, joinCode, handle, invites, creatorTitle, joinMode, onContinue }: CreatedOrganization & { onContinue: () => void }) {
    const { user } = useAuth()
    const name = (user?.user_metadata?.full_name as string | undefined)?.trim()
    const signedBy = [name, creatorTitle?.trim()].filter(Boolean).join(', ') || null
    // The same hosts as everywhere else (org design plan CR13): the join link on this site, as the invite panel
    // gives it; the web address as networkbase.in, as Settings and About show it.
    const origin = typeof window === 'undefined' ? 'https://networkbase.in' : window.location.origin
    const invite = `${orgInviteMessage({ title, joinCode, signedBy })} ${origin}/join/${joinCode}`
    const orgLink = handle ? `https://networkbase.in/org/${handle}` : null
    const sent = [
        invites?.coAdmins ? `${invites.coAdmins} co-admin ${invites.coAdmins === 1 ? 'invite' : 'invites'}` : null,
        invites?.members ? `${invites.members} member ${invites.members === 1 ? 'invite' : 'invites'}` : null,
    ].filter(Boolean).join(' and ')
    const joining = joinMode === 'approval' ? 'Needs your approval' : joinMode === 'instant' ? 'People join right away' : null
    const skipped = invites?.skipped ?? 0
    return (
        // A section, not a second <main>: the app shell already has one (spec §34).
        <section aria-labelledby="org-created-title" className="flex h-full min-h-0 items-center justify-center bg-card px-4 py-12">
            <div className="w-full max-w-md space-y-6 text-center">
                <div className="space-y-1">
                    <h1 id="org-created-title" className="nb-page-title text-foreground">{title} is ready</h1>
                    <p className="text-[13px] text-muted-foreground">People join with this code. You can copy or regenerate it later in Settings.</p>
                </div>
                <div className="rounded-lg bg-muted p-5"><JoinCode code={joinCode} className="text-3xl" /></div>
                <div className="grid gap-2 sm:grid-cols-2">
                    <CopyButton text={joinCode} label="Copy code" size="default" className="nb-touch-target" />
                    <CopyButton text={invite} label="Copy invite message" size="default" className="nb-touch-target" />
                </div>
                {orgLink ? (
                    <div className="space-y-2 border-t border-border pt-4 text-left" data-testid="org-created-link">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="min-w-0 text-[13px]"><span className="block text-muted-foreground">Your organization’s link</span><span className="nb-meta break-all text-foreground">{orgLink.replace(/^https?:\/\//, '')}</span></p>
                            <CopyButton text={orgLink} label="Copy link" size="default" className="nb-touch-target" />
                        </div>
                        <p className="text-[13px] text-muted-foreground">It shows on Discover once it has a description and a workspace or a second member, or once it’s verified. Settings → Visibility and discovery says where it stands.</p>
                    </div>
                ) : null}
                {joining || sent ? <p className="text-[13px] text-foreground" data-testid="org-created-invites">{[joining, sent ? `${sent} sent` : null].filter(Boolean).join(' · ')}</p> : null}
                {skipped ? <p className="text-[13px] text-muted-foreground">{skipped} {skipped === 1 ? 'address' : 'addresses'} looked wrong and {skipped === 1 ? 'was' : 'were'} skipped</p> : null}
                <Button type="button" size="lg" className="w-full" onClick={onContinue}>Go to organization</Button>
                {/* Report §45.8: the teacher guide, from the Ready screen. */}
                <a href="/help/running-a-class" target="_blank" rel="noopener" className="nb-link block text-center text-[13px]">Running a class on NetworkBase</a>
            </div>
        </section>
    )
}
