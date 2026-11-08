'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { readOrgJoinBlocksAction, readOrgStandingAction, unblockFromOrgAction } from '@/app/actions/moderation-org'
import { OrgReportsSection } from '@/components/organizations/OrgReportsSection'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { SettingsCard } from '@/components/workspaces/settings/SettingsFormFields'
import { toast } from '@/lib/feedback'

// Settings → Moderation (report §22.4, §29.2, §29.3): the organization's standing, its open reports, and the people
// blocked from rejoining. Owners and admins; only the owner appeals.

const ACTION_TEXT: Record<string, string> = {
    restrict: 'This organization is restricted for now.',
    suspend_workspace: 'This organization is suspended. Everything is read only.',
    remove_workspace: 'This organization is scheduled for removal.',
    hide_discover: 'This organization is hidden from Discover.',
    remove_verified: 'The Verified badge was removed.',
}
const DATE = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' })

export function OrgModerationSection({ orgId }: { orgId: string }) {
    const client = useQueryClient()
    const standing = useQuery({ queryKey: ['org-standing', orgId], queryFn: () => readOrgStandingAction(orgId) })
    const blocks = useQuery({ queryKey: ['org-join-blocks', orgId], queryFn: () => readOrgJoinBlocksAction(orgId) })
    const [unblock, setUnblock] = useState<{ userId: string; name: string } | null>(null)
    const s = standing.data?.success ? standing.data.standing : undefined
    const people = blocks.data?.success ? blocks.data.people : []
    return (
        <section id="project-settings-org-moderation" data-project-settings-section className="space-y-6">
            <SettingsCard title="Standing" headingLevel={2} description="What NetworkBase thinks of this organization right now.">
                {s === undefined ? <div className="nb-skeleton h-6 w-48 rounded-md" role="status" aria-label="Loading standing" /> : s === null ? <p className="text-[13px]">In good standing.</p> : (
                    <div className="space-y-2 text-[13px]">
                        <p className="font-medium">{ACTION_TEXT[s.action] ?? 'NetworkBase took action on this organization.'}</p>
                        {s.reason ? <p className="text-muted-foreground">Reason: {s.reason}{s.caseLabel ? ` · ${s.caseLabel}` : ''}</p> : null}
                        {s.appealSent ? <p className="text-muted-foreground">Appeal sent. We’ll email you the decision.</p>
                            : s.canAppeal && s.caseLabel ? <Button asChild size="sm" variant="outline"><a href={`/appeal/${s.caseLabel}`}>Appeal</a></Button>
                                : <p className="text-muted-foreground">Only the owner can appeal.</p>}
                    </div>
                )}
            </SettingsCard>
            <SettingsCard title="Reports" headingLevel={2} description="Reports about content here. Unanswered ones pass to NetworkBase at their deadline. Reporters are never named.">
                <OrgReportsSection orgId={orgId} showEmpty />
            </SettingsCard>
            <SettingsCard title="Blocked people" headingLevel={2} description="People blocked from rejoining. They see “You can’t join this organization.”">
                {blocks.isPending ? <div className="nb-skeleton h-14 rounded-md" role="status" aria-label="Loading blocked people" /> : people.length === 0 ? <p className="text-[13px] text-muted-foreground">Nobody is blocked.</p> : (
                    <ul className="divide-y divide-border text-[13px]">
                        {people.map((p) => (
                            <li key={p.userId} className="flex min-h-14 flex-wrap items-center justify-between gap-2 py-2">
                                <span>{p.name}<span className="nb-meta block">Blocked{p.blockedBy ? ` by ${p.blockedBy}` : ''} · {DATE.format(new Date(p.at))}</span></span>
                                <Button size="sm" variant="outline" onClick={() => setUnblock({ userId: p.userId, name: p.name })}>Unblock</Button>
                            </li>
                        ))}
                    </ul>
                )}
            </SettingsCard>
            <ConfirmDialog open={Boolean(unblock)} onOpenChange={(open) => { if (!open) setUnblock(null) }} title={`Unblock ${unblock?.name ?? ''}?`}
                description="They can join again with the code or an invite. They aren’t told." confirmLabel="Unblock"
                onConfirm={async () => {
                    if (!unblock) return
                    const r = await unblockFromOrgAction(orgId, unblock.userId)
                    if (!r.success) throw new Error(r.error)
                    toast.success(`${unblock.name} can join again`)
                    void client.invalidateQueries({ queryKey: ['org-join-blocks', orgId] })
                }} />
        </section>
    )
}
