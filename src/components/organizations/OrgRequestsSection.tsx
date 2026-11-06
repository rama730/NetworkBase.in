'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { approveJoinRequestsAction, declineJoinRequestAction } from '@/app/actions/org-members'
import { readOrgRequestsForMeAction } from '@/app/actions/org-workspace'
import { cancelJoinRequestAction } from '@/app/actions/organizations'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/feedback'
import { ReasonDialog } from '@/components/organizations/ReasonDialog'
import { useInviteAnswer } from '@/components/organizations/org-ui'
import { withCount } from '@/lib/organizations/display'
import WorkspaceAvatar from '@/components/workspaces/WorkspaceAvatar'

// Org invitations and admins' join requests (report §29.2 My work, §30.6 Network). My work decides join requests
// in place (first 5 per org, then Review all); Network only links to the Members tab.

export const ORG_REQUESTS_KEY = ['org-requests-for-me'] as const

export function useOrgRequests(enabled = true) {
    return useQuery({ queryKey: ORG_REQUESTS_KEY, queryFn: () => readOrgRequestsForMeAction(), enabled, staleTime: 30_000 })
}

// One list container, padded rows (spec §05 "complex row containers"), 56px request rows.
const list = 'divide-y divide-border overflow-hidden rounded-lg border border-border bg-card'
const row = 'flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-[13px]'

export function OrgRequestsSection({ joinRequests = 'decide', onNavigate, enabled = true }: { joinRequests?: 'decide' | 'link'; onNavigate?: () => void; enabled?: boolean }) {
    const query = useOrgRequests(enabled)
    const client = useQueryClient()
    const [hidden, setHidden] = useState<Set<string>>(new Set())
    const [declining, setDeclining] = useState<{ orgId: string; id: string; name: string } | null>(null)
    const refresh = () => void client.invalidateQueries({ queryKey: ORG_REQUESTS_KEY })
    const answer = useInviteAnswer(refresh)
    const data = query.data
    if (!data || (data.invites.length === 0 && data.joinRequests.length === 0 && data.mine.length === 0)) return null
    const hide = (id: string, on: boolean) => setHidden((prev) => { const next = new Set(prev); if (on) next.add(id); else next.delete(id); return next })
    const invites = data.invites.filter((invite) => !answer.hidden.has(invite.id))

    return (
        <div className="mb-6 space-y-6">
            {invites.length > 0 ? (
                <section aria-labelledby="org-invitations-heading">
                    <h3 id="org-invitations-heading" className="nb-micro mb-3">{withCount('Organization invitations', invites.length)}</h3>
                    <ul className={list}>
                        {invites.map((invite) => (
                            <li key={invite.id} className={row}>
                                <WorkspaceAvatar project={{ title: invite.orgTitle, coverImage: null }} size="row" placeholder />
                                <span className="min-w-0 flex-1"><span className="block truncate font-medium text-foreground">{invite.orgTitle}</span><span className="block truncate text-muted-foreground">Invited as {invite.roleLabel}{invite.title ? ` · ${invite.title}` : ''}</span></span>
                                <Button size="sm" disabled={answer.pending} onClick={() => answer.accept(invite)}>Accept</Button>
                                <Button size="sm" variant="outline" disabled={answer.pending} onClick={() => answer.decline(invite)}>Decline</Button>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}
            {data.mine.length > 0 ? (
                <section aria-labelledby="org-my-requests-heading">
                    <h3 id="org-my-requests-heading" className="nb-micro mb-3">{withCount('Your requests', data.mine.length)}</h3>
                    <ul className={list}>
                        {data.mine.map((r) => (
                            <li key={r.orgId} className={row}>
                                <WorkspaceAvatar project={{ title: r.title, coverImage: null }} size="row" placeholder />
                                <span className="min-w-0 flex-1"><Link href={`/org/${encodeURIComponent(r.slug ?? r.orgId)}`} onClick={onNavigate} className="block truncate font-medium text-foreground hover:underline">{r.title}</Link><span className="nb-status mt-1" data-tone="info">Requested</span></span>
                                <Button size="sm" variant="outline" onClick={async () => {
                                    const result = await cancelJoinRequestAction(r.orgId)
                                    if (!result.success) return void toast.error(result.error)
                                    toast.success('Request canceled')
                                    refresh()
                                }}>Cancel request</Button>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}
            {data.joinRequests.map((group) => {
                const members = `/org/${encodeURIComponent(group.slug ?? group.orgId)}?tab=members`
                const words = `${group.count} join ${group.count === 1 ? 'request' : 'requests'}`
                if (joinRequests === 'link') {
                    return <p key={group.orgId} className="text-[13px]"><Link href={members} onClick={onNavigate} className="nb-link">{words} in {group.title}</Link></p>
                }
                return (
                    <section key={group.orgId} aria-label={`${group.title} join requests`}>
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <h3 className="nb-micro min-w-0 truncate">{group.title} · {words}</h3>
                            <Link href={members} onClick={onNavigate} className="nb-link shrink-0 text-[13px]">Review all</Link>
                        </div>
                        <ul className={list}>
                            {group.first.filter((r) => !hidden.has(r.id)).map((request) => (
                                <li key={request.id} className={row}>
                                    <span className="min-w-0 flex-1"><span className="block truncate font-medium text-foreground">{request.name}</span>{request.note ? <span className="block truncate text-muted-foreground">“{request.note}”</span> : null}</span>
                                    <Button size="sm" onClick={async () => { hide(request.id, true); const r = await approveJoinRequestsAction(group.orgId, [request.id]); if (!r.success) { hide(request.id, false); toast.error(r.error) } else toast.success(`${request.name} approved`); refresh() }}>Approve</Button>
                                    <Button size="sm" variant="outline" onClick={() => setDeclining({ orgId: group.orgId, id: request.id, name: request.name })}>Decline</Button>
                                </li>
                            ))}
                        </ul>
                    </section>
                )
            })}
            {/* The same decline as Members: an optional reason the person reads. */}
            <ReasonDialog open={Boolean(declining)} onOpenChange={(v) => { if (!v) setDeclining(null) }} title={`Decline ${declining?.name ?? 'this request'}?`}
                label="Reason (optional)" confirmLabel="Decline" variant="destructive"
                onConfirm={async (reason) => {
                    const d = declining
                    if (!d) return
                    hide(d.id, true)
                    const r = await declineJoinRequestAction(d.orgId, d.id, reason || undefined)
                    if (!r.success) { hide(d.id, false); throw new Error(r.error) }
                    toast.success('Request declined')
                    refresh()
                }} />
        </div>
    )
}
