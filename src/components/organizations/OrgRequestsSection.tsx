'use client'

import Link from 'next/link'
import { ACCESS_LEVEL_LABELS } from '@/lib/copy/terms'
import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { acceptOrgInviteAction, approveJoinRequestsAction, declineJoinRequestAction, declineOrgInviteAction } from '@/app/actions/org-members'
import { readOrgRequestsForMeAction } from '@/app/actions/org-workspace'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/feedback'

// Org invitations and admins' join requests (report §29.2 My work, §30.6 Network). My work decides join requests
// in place (first 5 per org, then Review all); Network only links to the Members tab.

export const ORG_REQUESTS_KEY = ['org-requests-for-me'] as const
const ROLE: Record<string, string> = ACCESS_LEVEL_LABELS

export function useOrgRequests(enabled = true) {
    return useQuery({ queryKey: ORG_REQUESTS_KEY, queryFn: () => readOrgRequestsForMeAction(), enabled, staleTime: 30_000 })
}

export function OrgRequestsSection({ joinRequests = 'decide', onNavigate, enabled = true }: { joinRequests?: 'decide' | 'link'; onNavigate?: () => void; enabled?: boolean }) {
    const query = useOrgRequests(enabled)
    const client = useQueryClient()
    const [hidden, setHidden] = useState<Set<string>>(new Set())
    const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
    const data = query.data
    if (!data || (data.invites.length === 0 && data.joinRequests.length === 0)) return null
    const refresh = () => void client.invalidateQueries({ queryKey: ORG_REQUESTS_KEY })
    const hide = (id: string, on: boolean) => setHidden((prev) => { const next = new Set(prev); if (on) next.add(id); else next.delete(id); return next })

    /** Decline waits 5 seconds so Undo can cancel it. */
    const declineInvite = (id: string, title: string) => {
        hide(id, true)
        timers.current.set(id, setTimeout(async () => { timers.current.delete(id); await declineOrgInviteAction(id); refresh() }, 5000))
        toast.info(`Declined ${title}`, { action: { label: 'Undo', onClick: () => { clearTimeout(timers.current.get(id)); timers.current.delete(id); hide(id, false) } } })
    }
    const invites = data.invites.filter((invite) => !hidden.has(invite.id))

    return (
        <div className="mb-6 space-y-6">
            {invites.length > 0 ? (
                <section aria-labelledby="org-invitations-heading">
                    <h4 id="org-invitations-heading" className="nb-micro mb-3 pl-1">Organization invitations ({invites.length})</h4>
                    <div className="space-y-2">
                        {invites.map((invite) => (
                            <div key={invite.id} className="flex flex-wrap items-center gap-2 rounded-[6px] border border-border bg-card px-3 py-2 text-sm">
                                <span className="min-w-0 flex-1"><span className="font-medium text-foreground">{invite.orgTitle}</span><span className="text-muted-foreground"> · {ROLE[invite.role] ?? invite.role}{invite.title ? ` · ${invite.title}` : ''}</span></span>
                                <Button size="sm" onClick={async () => {
                                    const result = await acceptOrgInviteAction(invite.id)
                                    if (!result.success) return void toast.error(result.error)
                                    toast.success(`You're in ${invite.orgTitle}`)
                                    refresh()
                                }}>Accept</Button>
                                <Button size="sm" variant="outline" onClick={() => declineInvite(invite.id, invite.orgTitle)}>Decline</Button>
                            </div>
                        ))}
                    </div>
                </section>
            ) : null}
            {data.joinRequests.map((group) => {
                const members = `/org/${encodeURIComponent(group.slug ?? group.orgId)}?tab=members`
                if (joinRequests === 'link') {
                    return <p key={group.orgId} className="pl-1 text-sm"><Link href={members} onClick={onNavigate} className="text-primary hover:underline">{group.count} join {group.count === 1 ? 'request' : 'requests'} in {group.title} → Members</Link></p>
                }
                return (
                    <section key={group.orgId} aria-label={`${group.title} join requests`}>
                        <h4 className="nb-micro mb-3 pl-1">{group.title} · {group.count} join {group.count === 1 ? 'request' : 'requests'}</h4>
                        <div className="space-y-2">
                            {group.first.filter((r) => !hidden.has(r.id)).map((request) => (
                                <div key={request.id} className="flex flex-wrap items-center gap-2 rounded-[6px] border border-border bg-card px-3 py-2 text-sm">
                                    <span className="min-w-0 flex-1 truncate"><span className="font-medium text-foreground">{request.name}</span>{request.note ? <span className="text-muted-foreground"> · {request.note}</span> : null}</span>
                                    <Button size="sm" onClick={async () => { hide(request.id, true); const r = await approveJoinRequestsAction(group.orgId, [request.id]); if (!r.success) { hide(request.id, false); toast.error(r.error) } refresh() }}>Approve</Button>
                                    <Button size="sm" variant="outline" onClick={async () => { hide(request.id, true); const r = await declineJoinRequestAction(group.orgId, request.id); if (!r.success) { hide(request.id, false); toast.error(r.error) } refresh() }}>Decline</Button>
                                </div>
                            ))}
                        </div>
                        <Link href={members} onClick={onNavigate} className="mt-2 inline-block pl-1 text-xs font-semibold text-primary hover:underline">Review all →</Link>
                    </section>
                )
            })}
        </div>
    )
}
