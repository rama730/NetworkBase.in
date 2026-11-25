'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { ACCESS_LEVEL_LABELS, accessLevelLabel, type AccessLevel } from '@/lib/copy/terms'
import Link from 'next/link'

import {
    addMembersToChildAction,
    approveJoinRequestsAction,
    cancelOrgInviteAction,
    declineJoinRequestAction,
    dismissTeamChangeAction,
    inviteByEmailAction,
    moveMemberToWorkspaceAction,
    readMemberActivityAction,
    readMemberWorkAction,
    readMemberAwayAction,
    markAwayAction,
    endAwayAction,
    type AwayRow,
    readOrgMembersAction,
    readProgressExportAction,
    remindMembersAction,
    removeOutsidePersonAction,
    resendOrgInviteAction,
    setMemberTitleAction,
    type MemberActivityRow,
    type MemberWorkRow,
    type OrgMembersData,
} from '@/app/actions/org-members'
import { regenerateJoinCodeAction } from '@/app/actions/organizations'
import { verifyOrgContributionsAction } from '@/app/actions/org-profile'
import { FormerList, RemoveDialog, RevokeDialog, RoleDialog } from '@/components/organizations/OrgMemberDialogs'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ReasonDialog } from '@/components/organizations/ReasonDialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { filterRoster, remindSummary, type RosterFilter, type RosterRow } from '@/lib/organizations/member-rules'
import { toast } from '@/lib/feedback'
import { saveBlob, toCsvBlob } from '@/lib/download'
import { useAuth } from '@/hooks/use-auth'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { userTopic } from '@/lib/messaging/constants'
import { subscribeBroadcast } from '@/lib/realtime/private-broadcast'
import { OrgInvitePanel } from '@/components/organizations/OrgInvitePanel'
import { formatDistanceToNow } from '@/lib/utils/date'
import { useUrlMirror } from '@/lib/navigation/url-state'
import { useOverlayHistory } from '@/lib/navigation/overlay-history'
import { cn } from '@/lib/utils'
import { ErrorNotice } from '@/components/ui/ErrorNotice'
import { EmptyState } from '@/components/ui/EmptyState'
import { RailSection } from '@/components/ui/rail-section'
import { useBottomStickyRail } from '@/hooks/useBottomStickyRail'
import { StatusBadge, VerifiedMark } from '@/components/organizations/org-ui'
import { fieldLabel, formatOrgDate, withCount } from '@/lib/organizations/display'
import { rolePlural } from '@/lib/organizations/role-words'
import { ASSIGNMENT_STATE_LABELS } from '@/lib/copy/terms'
import { ChevronRight, Mail, Search } from 'lucide-react'
import { MessageUserLink } from "@/components/messages/MessageUserLink";
import { RELATIONSHIP_EVENT, useBlockFlow } from '@/components/privacy/BlockDialog'
import { Ban } from 'lucide-react'
import { serverFirst } from '@/lib/server-first'
import { useQueryClient } from '@tanstack/react-query'

// Members tab (report §20): roster with filters and bulk actions, Requests / Invite / summary rail, member drawer.

type RoleNames = Partial<Record<'owner' | 'admin' | 'member' | 'viewer', string>>
type Row = OrgMembersData['rows'][number]

const ago = (iso: string | null) => (iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : '—')
/** Last active here (report §29.4, §41.4): empty until they next open the organization. */
const activeHere = (iso: string | null) => (iso ? ago(iso) : 'No data yet')
const workLine = (w: RosterRow['work']) => (w.total === 0 ? 'No work yet' : `${w.done} of ${w.total} done${w.missing ? ` · ${w.missing} missing` : ''}`)

export function OrgMembersTab({ orgId, roleNames, started = null }: { orgId: string; roleNames?: RoleNames; started?: ReturnType<typeof readOrgMembersAction> | null }) {
    const [data, setData] = useState<OrgMembersData | null>(null)
    const [error, setError] = useState<string | null>(null)
    // Workspaces report §4 F5: "Place them" (and the Overview's standing links) open Members already filtered.
    // The filter lives in the address (unified back R3), so back returns to it; `project`/`status` are links already sent.
    const [filter, setFilter] = useState<RosterFilter & { invited?: boolean; outside?: boolean; former?: boolean }>(() => {
        const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
        const project = params.get('mproject') ?? params.get('project'); const status = params.get('mstatus') ?? params.get('status')
        const role = params.get('mrole'); const sort = params.get('msort'); const q = params.get('mq')
        return {
            sort: sort === 'joined' || sort === 'active' || sort === 'behind' ? sort : 'name',
            ...(q ? { q } : {}),
            ...(role === 'admins' || role === 'members' || role === 'guests' ? { role } : {}),
            ...(project ? { project } : {}),
            ...(status === 'behind' || status === 'inactive' ? { status } : {}),
            ...(params.get('minv') === '1' ? { invited: true } : {}),
            ...(params.get('mout') === '1' ? { outside: true } : {}),
            ...(params.get('mformer') === '1' ? { former: true } : {}),
        }
    })
    useUrlMirror({
        mq: filter.q || null,
        mrole: filter.role && filter.role !== 'all' ? filter.role : null,
        msort: filter.sort && filter.sort !== 'name' ? filter.sort : null,
        mproject: filter.project && filter.project !== 'all' ? filter.project : null,
        mstatus: filter.status && filter.status !== 'all' ? filter.status : null,
        minv: filter.invited ? '1' : null,
        mout: filter.outside ? '1' : null,
        mformer: filter.former ? '1' : null,
    })
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [open, setOpen] = useState<Row | null>(null)
    useOverlayHistory('member', open !== null, () => setOpen(null)) // back closes the member drawer (A3)
    const [roleAsk, setRoleAsk] = useState<{ ids: string[]; names: string[]; role: 'admin' | 'member' | 'viewer' } | null>(null)
    const [removeAsk, setRemoveAsk] = useState<{ ids: string[]; names: string[]; block: boolean } | null>(null)
    const [revoke, setRevoke] = useState<{ userId: string; name: string } | null>(null)
    const [outsideAsk, setOutsideAsk] = useState<{ userId: string; name: string; projectId: string; title: string } | null>(null)
    const [pending, startTransition] = useTransition()
    // Report §4.3: the organization's own name beside the base access level ("TA · Admin").
    const label = (role: string) => (role in ACCESS_LEVEL_LABELS ? accessLevelLabel(role as AccessLevel, roleNames?.[role as keyof RoleNames]) : role)
    // The organization's own words for the filters (org spec §2 rule 5): Teachers and TAs, Students, Guests.
    const word = (role: 'owner' | 'admin' | 'member' | 'viewer', fallback: string) => roleNames?.[role] ?? fallback
    const stickyRail = useBottomStickyRail({ topInset: 'calc(var(--workspace-tabs-height, 0px) + 24px)' })

    // The page started this read on the server; a browser runs actions one at a time (live-fix phase 1).
    const [read] = useState(() => serverFirst(started, () => readOrgMembersAction(orgId)))
    const client = useQueryClient()
    const load = useCallback(() => void read().then((r) => {
        // The invite panel's data came with the roster; seed its cache before it mounts.
        if (r.success) { client.setQueryData(['org-invite-panel', orgId], r.invitePanel); setData(r); setError(null) } else setError(r.error)
    }), [client, orgId, read])
    useEffect(() => { load() }, [load])
    // Report §32.4: requests update by themselves (0053), combined over 2 seconds.
    const viewerId = useAuth().user?.id
    useEffect(() => {
        if (!viewerId) return
        let timer: ReturnType<typeof setTimeout> | null = null
        const live = subscribeBroadcast(userTopic(viewerId), (event, payload) => {
            if (event === 'org.requests.changed' && payload.workspace_id === orgId && !timer) timer = setTimeout(() => { timer = null; load() }, 2_000)
        })
        return () => { live.unsubscribe(); if (timer) clearTimeout(timer) }
    }, [load, orgId, viewerId])
    // A block or unblock anywhere refreshes the private "Blocked" tags.
    useEffect(() => {
        window.addEventListener(RELATIONSHIP_EVENT, load)
        return () => window.removeEventListener(RELATIONSHIP_EVENT, load)
    }, [load])
    const rows = useMemo(() => (data ? (filterRoster(data.rows, filter) as Row[]) : []), [data, filter])

    const run = <R extends { success: boolean; error?: string }>(work: () => Promise<R>, done: string | ((result: R) => string)) => startTransition(async () => {
        const result = await work()
        if (!result.success) return void toast.error(result.error ?? 'Something went wrong.')
        toast.success(typeof done === 'string' ? done : done(result))
        setSelected(new Set())
        load()
    })

    if (error) return <ErrorNotice message={error} onRetry={load} />
    if (!data) return (
        <div role="status" aria-label="Loading members" className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-3 lg:col-span-8" aria-hidden="true"><div className="nb-skeleton h-7 rounded-md" />{[0, 1, 2, 3, 4].map((i) => <div key={i} className="nb-skeleton h-14 rounded-md" />)}</div>
            <div className="space-y-6 lg:col-span-4" aria-hidden="true">{[0, 1].map((i) => <div key={i} className="nb-skeleton h-32 rounded-lg" />)}</div>
        </div>
    )
    // Bulk actions reach only ticked people still on screen, so a changed filter never removes someone hidden (smaller bug 9).
    const ids = rows.filter((r) => selected.has(r.userId)).map((r) => r.userId)
    const s = data.summary

    const narrowed = Boolean(filter.q?.trim() || (filter.role && filter.role !== 'all') || (filter.project && filter.project !== 'all') || (filter.status && filter.status !== 'all') || (filter.verified && filter.verified !== 'all'))
    const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`
    const plural = (role: 'owner' | 'admin' | 'member' | 'viewer', fallback: string) => rolePlural(word(role, fallback))

    return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="min-w-0 space-y-3 lg:col-span-8">
                <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Filter members">
                    <Input value={filter.q ?? ''} onChange={(e) => setFilter({ ...filter, q: e.target.value })} placeholder="Search members" aria-label="Search members" className="h-[var(--ui-control-height-sm)] w-full text-[13px] sm:w-56" />
                    <select aria-label="Role" className="nb-select" data-size="sm" value={filter.role ?? 'all'} onChange={(e) => setFilter({ ...filter, role: e.target.value as RosterFilter['role'] })}>
                        <option value="all">All roles</option><option value="admins">{plural('owner', 'Owner')} and {plural('admin', 'Admin')}</option><option value="members">{plural('member', 'Member')}</option><option value="guests">{plural('viewer', 'Viewer')}</option>
                    </select>
                    <select aria-label="Workspace" className="nb-select" data-size="sm" value={filter.project ?? 'all'} onChange={(e) => setFilter({ ...filter, project: e.target.value })}>
                        <option value="all">All workspaces</option><option value="none">Not in a workspace</option>
                        {data.children.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                    <select aria-label="Status" className="nb-select" data-size="sm"
                        value={filter.invited ? 'invited' : filter.outside ? 'outside' : filter.former ? 'former' : filter.verified && filter.verified !== 'all' ? `verified_${filter.verified}` : filter.status ?? 'all'}
                        onChange={(e) => {
                            const v = e.target.value
                            const list = v === 'invited' || v === 'outside' || v === 'former'
                            setFilter({ ...filter, invited: v === 'invited', outside: v === 'outside', former: v === 'former',
                                verified: v.startsWith('verified_') ? (v.slice(9) as 'yes' | 'no') : 'all',
                                status: list || v.startsWith('verified_') ? 'all' : (v as RosterFilter['status']) })
                        }}>
                        <option value="all">Any status</option><option value="behind">Needs attention</option><option value="inactive">Inactive for 14 days</option>
                        <option value="verified_yes">Verified</option><option value="verified_no">Not verified</option><option value="invited">Invited</option>
                        <option value="outside">Outside people</option><option value="former">Former</option>
                    </select>
                    <select aria-label="Sort" className="nb-select" data-size="sm" value={filter.sort ?? 'name'} onChange={(e) => setFilter({ ...filter, sort: e.target.value as RosterFilter['sort'] })}>
                        <option value="name">Sort by name</option><option value="behind">Sort by needs attention</option><option value="active">Sort by last active here</option><option value="joined">Sort by joined</option>
                    </select>
                    {/* Report §33.5: statuses and dates only, never what anyone handed in. */}
                    <Button type="button" size="sm" variant="outline" className="sm:ml-auto" disabled={pending} onClick={() => startTransition(async () => {
                        const r = await readProgressExportAction(orgId)
                        if (!r.success) return void toast.error(r.error)
                        saveBlob(toCsvBlob(r.rows), `progress-${new Date().toISOString().slice(0, 10)}.csv`)
                    if (r.truncated) toast.warning('This sheet has the first 50,000 rows only. Contact support for the full export.')
                    })}>Export CSV</Button>
                </div>

                {data.requests.length + data.teamChanges.length > 0 ? <div className="lg:hidden"><Requests orgId={orgId} data={data} pending={pending} run={run} /></div> : null}

                {ids.length > 0 && !filter.former ? <BulkBar label={label} orgId={orgId} data={data} ids={ids} pending={pending} run={run} onClear={() => setSelected(new Set())}
                    onRole={(role) => setRoleAsk({ ids, names: ids.map((id) => data.rows.find((r) => r.userId === id)?.name ?? 'Someone'), role })}
                    onRemove={(block) => setRemoveAsk({ ids, names: ids.map((id) => data.rows.find((r) => r.userId === id)?.name ?? 'Someone'), block })} /> : null}

                {filter.former ? <FormerList orgId={orgId} q={filter.q ?? ''} pending={pending} run={run} /> : filter.outside ? (
                    data.outside.length === 0 ? <EmptyState figure="person" title="No outside people" description="People added to a workspace from outside the organization show here." /> : (
                    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card" aria-label="Outside people">
                        {data.outside.map((o) => (
                            <li key={o.userId} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[13px]">
                                <span className="font-medium">{o.name}</span>
                                <StatusBadge state="neutral">Outside</StatusBadge>
                                <span className="min-w-0 truncate text-muted-foreground">{o.projects.map((p) => p.title).join(', ')}</span>
                                <span className="ml-auto flex flex-wrap items-center gap-1.5">
                                    <MessageUserLink userId={o.userId} className="nb-link px-1" />
                                    {o.projects.map((p) => (
                                        <Button key={p.id} type="button" size="sm" variant="outline" disabled={pending} onClick={() => setOutsideAsk({ userId: o.userId, name: o.name, projectId: p.id, title: p.title })}>
                                            Remove from {p.title}
                                        </Button>
                                    ))}
                                </span>
                            </li>
                        ))}
                    </ul>)
                ) : filter.invited ? (
                    data.invites.length === 0 ? <EmptyState icon={Mail} title="No invites waiting" description="Invites you send by email wait here until they’re accepted." /> : (
                    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card" aria-label="Invites">
                        {data.invites.map((i) => (
                            <li key={i.id} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[13px]">
                                <span className="font-medium">{i.email}</span>
                                <span className="text-muted-foreground">{label(i.role)}{i.title ? ` · ${i.title}` : ''}</span>
                                {i.expired ? <StatusBadge state="expired">Expired</StatusBadge> : <span className="nb-meta">Expires {formatOrgDate(i.expiresAt, { month: 'short', day: 'numeric' })}</span>}
                                {/* Only the owner manages admin invites (audit 3.4). */}
                                {i.role !== 'admin' || data.viewerRole === 'owner' ? <span className="ml-auto flex gap-1.5">
                                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => resendOrgInviteAction(orgId, i.id), 'Invite resent')}>Resend</Button>
                                    <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelOrgInviteAction(orgId, i.id), 'Invite canceled')}>Cancel invite</Button>
                                </span> : null}
                            </li>
                        ))}
                    </ul>)
                ) : rows.length === 0 && narrowed ? (
                    <EmptyState icon={Search} title="No members match" description="Try another role, workspace or status." action={<Button type="button" variant="outline" size="sm" onClick={() => setFilter({ sort: filter.sort ?? 'name' })}>Clear filters</Button>} />
                ) : (
                    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                        <li className="flex min-h-10 items-center gap-3 px-3 py-2">
                            <input type="checkbox" className="nb-check" aria-label="Select all in filter" checked={rows.length > 0 && rows.every((r) => selected.has(r.userId))}
                                onChange={(e) => setSelected(e.target.checked ? new Set(rows.filter((r) => r.role !== 'owner').map((r) => r.userId)) : new Set())} />
                            <span className="nb-micro">{people(rows.length)}</span>
                        </li>
                        {rows.map((r) => (
                            <li key={r.userId} className="flex min-h-14 items-start gap-3 px-3 py-2.5 text-[13px]">
                                <input type="checkbox" className="nb-check mt-2" aria-label={`Select ${r.name}`} disabled={r.role === 'owner'} checked={selected.has(r.userId)}
                                    onChange={(e) => setSelected((cur) => { const next = new Set(cur); if (e.target.checked) next.add(r.userId); else next.delete(r.userId); return next })} />
                                {/* Live-fix 39: a photo on every row. */}
                                <UserAvatar identity={{ id: r.userId, fullName: r.name, username: r.username, avatarUrl: r.avatarUrl }} size={34} />
                                <button type="button" onClick={() => setOpen(r)} className="min-w-0 flex-1 text-left">
                                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                                        <span className="font-medium text-foreground hover:underline">{r.name}</span>
                                        {r.verified ? <VerifiedMark label="Contribution verified" size={14} /> : null}
                                        <span className="text-muted-foreground">· {label(r.role)}</span>
                                        {/* Your personal block, seen only by you (Blocking B51). */}
                                        {r.blockedByMe ? <StatusBadge state="blocked">Blocked</StatusBadge> : null}
                                        {r.title ? <span className="text-muted-foreground">· {r.title}</span> : null}
                                    </span>
                                    <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                                        {r.projects.length ? r.projects.map((p) => (p.unit ? `${p.title} · ${p.unit}` : p.title)).join(', ') : 'Not in a workspace'}
                                    </span>
                                    <span className={cn('mt-0.5 block text-[12px] sm:hidden', r.behind ? 'text-[var(--status-warning)]' : 'text-muted-foreground')}>{workLine(r.work)} · active here {activeHere(r.lastActiveAt)}</span>
                                </button>
                                <span className={cn('hidden shrink-0 pt-2 text-[12px] sm:inline', r.behind ? 'text-[var(--status-warning)]' : 'text-muted-foreground')}>{workLine(r.work)}</span>
                                <span className="nb-meta hidden w-28 shrink-0 pt-2 text-right sm:inline">{activeHere(r.lastActiveAt)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <aside {...stickyRail} aria-label="Members summary" className="min-w-0 space-y-6 lg:col-span-4 lg:sticky lg:self-start">
                <div className={data.requests.length + data.teamChanges.length > 0 ? 'hidden lg:block' : undefined}><Requests orgId={orgId} data={data} pending={pending} run={run} /></div>
                {/* Report §7.11: the same invite panel as the header and About. Live-fix 40: alone, it leads with a plain line. */}
                <RailSection title="Invite people">
                    {data.summary.members <= 1 ? <p className="mb-3 text-[13px] font-medium">You’re the only one here so far</p> : null}
                    <OrgInvitePanel orgId={orgId} orgHandle={null} prominent={data.summary.members <= 1} onChanged={load} />
                </RailSection>
                <RailSection title="Summary">
                    <ul className="space-y-1 text-[13px]">
                        {([
                            [`${s.members} ${s.members === 1 ? 'member' : 'members'}`, { sort: 'name' }],
                            [`${s.admins} ${plural('owner', 'Owner')} and ${plural('admin', 'Admin')} · ${s.guests} ${s.guests === 1 ? word('viewer', 'Viewer') : plural('viewer', 'Viewer')}`, { role: 'admins' }],
                            [`${s.behind} behind`, { status: 'behind', sort: 'behind' }],
                            [`${s.notInProject} not in a workspace`, { project: 'none' }],
                            [`${s.inactive} inactive for 14 days`, { status: 'inactive' }],
                        ] as Array<[string, RosterFilter]>).map(([text, next]) => (
                            <li key={text}><button type="button" className="flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-2 -mx-2 text-left hover:bg-muted" onClick={() => setFilter(next)}><span className="tabular-nums">{text}</span><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></button></li>
                        ))}
                    </ul>
                </RailSection>
            </aside>

            <Dialog open={Boolean(open)} onOpenChange={(v) => { if (!v) setOpen(null) }}>
                <DialogContent presentation="right-drawer" className="overflow-y-auto p-5 sm:max-w-[560px]">
                    <DialogTitle className="sr-only">{open ? `Member: ${open.name}` : 'Member'}</DialogTitle>
                    {open ? <MemberDrawer orgId={orgId} row={open} isSelf={open.userId === viewerId} data={data} label={label} pending={pending} run={(w, d) => { run(w, d); setOpen(null) }}
                        onRole={(role) => { setOpen(null); setRoleAsk({ ids: [open.userId], names: [open.name], role }) }}
                        onRemove={(block) => { setOpen(null); setRemoveAsk({ ids: [open.userId], names: [open.name], block }) }}
                        onRevoke={() => { setOpen(null); setRevoke({ userId: open.userId, name: open.name }) }} /> : null}
                </DialogContent>
            </Dialog>
            <RoleDialog orgId={orgId} userIds={roleAsk?.ids ?? []} names={roleAsk?.names ?? []} role={roleAsk?.role ?? null} label={label} run={run} onClose={() => setRoleAsk(null)} />
            <RemoveDialog orgId={orgId} userIds={removeAsk?.ids ?? []} names={removeAsk?.names ?? []} block={removeAsk ? removeAsk.block : null} run={run} onClose={() => setRemoveAsk(null)} />
            <RevokeDialog orgId={orgId} person={revoke} run={run} onClose={() => setRevoke(null)} />
            <ConfirmDialog open={Boolean(outsideAsk)} onOpenChange={(v) => { if (!v) setOutsideAsk(null) }} variant="destructive"
                title={`Remove ${outsideAsk?.name ?? 'them'} from ${outsideAsk?.title ?? 'this workspace'}?`}
                description="Their open tasks there are unassigned; handed-in work stays. Its workspace lead is told."
                confirmLabel="Remove" onConfirm={() => { const a = outsideAsk; setOutsideAsk(null); if (a) run(() => removeOutsidePersonAction(orgId, a.userId, a.projectId), `${a.name} was removed from ${a.title}`) }} />
        </div>
    )
}

type Run = <R extends { success: boolean; error?: string }>(work: () => Promise<R>, done: string | ((result: R) => string)) => void

function BulkBar({ orgId, data, label, ids, pending, run, onClear, onRole, onRemove }: { orgId: string; data: OrgMembersData; label: (role: string) => string; ids: string[]; pending: boolean; run: Run; onClear: () => void; onRole: (role: 'admin' | 'member' | 'viewer') => void; onRemove: (block: boolean) => void }) {
    const [childId, setChildId] = useState('')
    const [unitId, setUnitId] = useState('')
    const units = data.children.find((c) => c.id === childId)?.units ?? []
    return (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted p-2 text-[13px]" role="group" aria-label="Bulk actions">
            <span className="px-1 font-medium tabular-nums">{ids.length} selected</span>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => remindMembersAction(orgId, ids), (r) => ('reminded' in r ? remindSummary(r) : ''))}>Remind</Button>
            <select aria-label="Change access level" className="nb-select" data-size="sm" value="" disabled={pending} onChange={(e) => {
                const role = e.target.value as 'admin' | 'member' | 'viewer'
                if (role) onRole(role)
            }}>
                <option value="">Change access level…</option>
                <option value="member">{label('member')}</option><option value="viewer">{label('viewer')}</option>
                {data.viewerRole === 'owner' ? <option value="admin">{label('admin')}</option> : null}
            </select>
            <select aria-label="Add to workspace" className="nb-select" data-size="sm" value={childId} onChange={(e) => { setChildId(e.target.value); setUnitId('') }}>
                <option value="">Add to workspace…</option>
                {data.children.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            {childId ? (
                <>
                    <select aria-label="Team" className="nb-select" data-size="sm" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                        <option value="">No team</option>
                        {units.map((u) => <option key={u.id} value={u.id}>{u.title}</option>)}
                    </select>
                    <Button type="button" size="sm" disabled={pending} onClick={() => run(() => addMembersToChildAction(orgId, childId, ids, unitId || null), 'Added to the workspace')}>Add</Button>
                </>
            ) : null}
            {/* End-of-term verification (report §20.6, §24.5): role and dates, never the story text. */}
            <Button type="button" size="sm" variant="outline" disabled={pending} title="Verify covers role and dates, not what they wrote"
                onClick={() => run(() => verifyOrgContributionsAction(orgId, ids), 'Verified. It covers role and dates, not what they wrote.')}>Verify {ids.length}</Button>
            {/* Two named actions, each with its own confirmation (Blocking B50): removal, and the organization's own block. */}
            <DropdownMenu>
                <DropdownMenuTrigger asChild><Button type="button" size="sm" variant="outline" className="ml-auto text-destructive" disabled={pending}>Remove…</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem variant="destructive" onSelect={() => onRemove(false)}>Remove from organization</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => onRemove(true)}>Remove and block from rejoining</DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <Button type="button" size="sm" variant="ghost" onClick={onClear}>Clear</Button>
        </div>
    )
}

/** Audit N9: the toast says what happened, including people who stay waiting because they're in 50 organizations. */
function approvedLine(name?: string) {
    return (r: { success: boolean; approved?: number; atLimit?: number }) => {
        const approved = r.approved ?? 0, waiting = r.atLimit ?? 0
        if (name) return approved ? `${name} approved` : `${name} stays waiting: they’re in 50 organizations`
        return waiting ? `${approved} approved · ${waiting} stay waiting (in 50 organizations)` : 'All approved'
    }
}

function Requests({ orgId, data, pending, run }: { orgId: string; data: OrgMembersData; pending: boolean; run: Run }) {
    const [declining, setDeclining] = useState<{ id: string; name: string } | null>(null)
    const total = data.requests.length + data.teamChanges.length
    return (
        <RailSection title={withCount('Requests', total)} action={data.requests.length > 1 ? <Button type="button" size="sm" disabled={pending} onClick={() => run(() => approveJoinRequestsAction(orgId, data.requests.map((r) => r.id)), approvedLine())}>Approve all</Button> : undefined}>
            {total === 0 ? <p className="text-[13px] text-muted-foreground">No one is waiting.</p> : null}
            <ul className="divide-y divide-border">
                {/* Ask to change team (report §25.5, decision 46): admins only, since it can be about a block. */}
                {data.teamChanges.map((c) => (
                    <li key={`${c.userId}:${c.workspaceId}`} className="space-y-2 py-2.5 text-[13px] first:pt-0 last:pb-0">
                        <p><span className="font-medium">{c.name}</span> asks to change team <span className="text-muted-foreground">· in {c.workspace} · {ago(c.at)}</span></p>
                        <MoveToWorkspace orgId={orgId} data={data} userId={c.userId} fromId={c.workspaceId} pending={pending} run={run}>
                            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => dismissTeamChangeAction(orgId, c.userId, c.workspaceId), 'Dismissed')}>Dismiss</Button>
                        </MoveToWorkspace>
                    </li>
                ))}
                {data.requests.map((r) => (
                    <li key={r.id} className="space-y-2 py-2.5 text-[13px] first:pt-0 last:pb-0">
                        <p><span className="font-medium">{r.name}</span> <span className="text-muted-foreground">· asked with the code · {ago(r.createdAt)}</span></p>
                        {r.note ? <p className="text-muted-foreground">“{r.note}”</p> : null}
                        <div className="flex gap-1.5">
                            {/* Approve all is the area's filled button; each row is outline (spec §10, one dominant action). */}
                            <Button type="button" size="sm" variant={data.requests.length > 1 ? 'outline' : 'default'} disabled={pending} onClick={() => run(() => approveJoinRequestsAction(orgId, [r.id]), approvedLine(r.name))}>Approve</Button>
                            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setDeclining({ id: r.id, name: r.name })}>Decline</Button>
                        </div>
                    </li>
                ))}
            </ul>
            <ReasonDialog open={Boolean(declining)} onOpenChange={(v) => { if (!v) setDeclining(null) }} title={`Decline ${declining?.name ?? 'this request'}?`}
                label="Reason (optional)" confirmLabel="Decline" variant="destructive"
                onConfirm={(reason) => { if (declining) run(() => declineJoinRequestAction(orgId, declining.id, reason || undefined), 'Request declined') }} />
        </RailSection>
    )
}

/** Move to another workspace (report §25.5): pick the workspace and team; the old lead hears only that a seat opened. */
function MoveToWorkspace({ orgId, data, userId, fromId, pending, run, children }: { orgId: string; data: OrgMembersData; userId: string; fromId: string; pending: boolean; run: Run; children?: React.ReactNode }) {
    const [toId, setToId] = useState('')
    const [unitId, setUnitId] = useState('')
    const units = data.children.find((c) => c.id === toId)?.units ?? []
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <select aria-label="Move to workspace" className="nb-select" data-size="sm" value={toId} onChange={(e) => { setToId(e.target.value); setUnitId('') }}>
                <option value="">Move to…</option>
                {data.children.filter((c) => c.id !== fromId).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            {toId ? (
                <select aria-label="Team" className="nb-select" data-size="sm" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                    <option value="">No team</option>
                    {units.map((u) => <option key={u.id} value={u.id}>{u.title}</option>)}
                </select>
            ) : null}
            {toId ? <Button type="button" size="sm" disabled={pending} onClick={() => run(() => moveMemberToWorkspaceAction(orgId, userId, fromId, toId, unitId || null), 'Moved. They’re told.')}>Move</Button> : null}
            {children}
        </div>
    )
}

function MemberDrawer({ orgId, row, isSelf, data, label, pending, run, onRole, onRemove, onRevoke }: {
    /** Live-fix 41: your own panel offers nothing aimed at yourself. */
    isSelf: boolean
    orgId: string; row: Row; data: OrgMembersData; label: (role: string) => string; pending: boolean; run: Run
    onRole: (role: 'admin' | 'member' | 'viewer') => void; onRemove: (block: boolean) => void; onRevoke: () => void
}) {
    const [work, setWork] = useState<MemberWorkRow[] | null>(null)
    const [activity, setActivity] = useState<MemberActivityRow[] | null>(null)
    const [title, setTitle] = useState(row.title ?? '')
    const blocking = useBlockFlow('member_list')
    useEffect(() => {
        void readMemberWorkAction(orgId, row.userId).then((r) => setWork(r.success ? r.work : []))
        void readMemberActivityAction(orgId, row.userId).then((r) => setActivity(r.success ? r.activity : []))
    }, [orgId, row.userId])
    const canChange = row.role !== 'owner' && (data.viewerRole === 'owner' || row.role !== 'admin')
    const section = (title: string, children: React.ReactNode) => <section className="space-y-2"><h3 className="nb-micro">{title}</h3>{children}</section>
    const lines = <div role="status" aria-label="Loading" className="space-y-1.5" aria-busy="true">{[0, 1].map((i) => <div key={i} className="nb-skeleton h-5 rounded-md" aria-hidden="true" />)}</div>
    return (
        <div className="space-y-6 text-[13px]">
            <header className="flex items-start gap-3">
                <UserAvatar identity={{ id: row.userId, fullName: row.name, username: row.username, avatarUrl: row.avatarUrl }} size={48} />
                <div className="min-w-0 space-y-1">
                    <h2 className="nb-section-title text-foreground">{row.name}</h2>
                    <p className="text-muted-foreground">{label(row.role)}{row.title ? ` · ${row.title}` : ''}</p>
                    <p className="nb-meta">Joined {ago(row.joinedAt)} · active here {activeHere(row.lastActiveAt)}</p>
                    <p className="flex gap-4">
                        {row.username ? <Link href={`/u/${row.username}`} className="nb-link">View profile</Link> : null}
                        <MessageUserLink userId={row.userId} className="nb-link" />
                    </p>
                </div>
            </header>
            {section('Work', work === null ? lines : work.length === 0 ? <p className="text-muted-foreground">No assignments yet.</p> : (
                <ul className="divide-y divide-border">
                    {work.map((w) => (
                        <li key={w.copyId} className="flex min-h-9 items-center justify-between gap-2 py-1.5">
                            <span className="truncate">{w.title}</span>
                            <span className="flex shrink-0 items-center gap-1.5">{w.mark ? <span className="font-mono text-[12px]" data-testid="drawer-mark">{w.mark.total} / {w.mark.outOf}{w.mark.visible ? '' : ' · draft'}</span> : null}<StatusBadge state={w.state}>{ASSIGNMENT_STATE_LABELS[w.state as keyof typeof ASSIGNMENT_STATE_LABELS] ?? w.state}</StatusBadge>{w.late ? <StatusBadge state="late">Late</StatusBadge> : null}</span>
                        </li>
                    ))}
                </ul>
            ))}
            {row.role === 'member' ? <MemberAway orgId={orgId} userId={row.userId} name={row.name} /> : null}
            {section('Contribution credit', <>
                <p className="flex items-center gap-1.5 text-muted-foreground">{row.verified ? <><VerifiedMark label="Verified" size={14} />Verified. It covers role and dates, not what they wrote.</> : 'Not verified yet.'}</p>
                {isSelf ? null : row.verified
                    ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onRevoke}>Revoke verification</Button>
                    : <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => verifyOrgContributionsAction(orgId, [row.userId]), 'Contribution verified')}>Verify contribution</Button>}
            </>)}
            {section('Workspaces and teams', row.projects.length === 0 ? <p className="text-muted-foreground">Not in a workspace.</p> : <div className="space-y-3">{row.projects.map((p) => (
                <div key={p.id} className="space-y-1.5">
                    <p>{p.title}{p.unit ? <span className="text-muted-foreground"> · {p.unit}</span> : null}</p>
                    {data.children.length > 1 ? <MoveToWorkspace orgId={orgId} data={data} userId={row.userId} fromId={p.id} pending={pending} run={run} /> : null}
                </div>
            ))}</div>)}
            {section('Recent activity', activity === null ? lines : activity.length === 0 ? <p className="text-muted-foreground">Nothing recent.</p> : (
                <ul className="space-y-1.5">
                    {activity.map((a, i) => (
                        <li key={i} className="flex justify-between gap-2">
                            <span className="min-w-0 truncate">{a.what} · {a.task} <span className="text-muted-foreground">in {a.project}</span></span>
                            <span className="nb-meta shrink-0">{ago(a.at)}</span>
                        </li>
                    ))}
                </ul>
            ))}
            {section('Membership', <>
                <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => setMemberTitleAction(orgId, row.userId, title), 'Title saved') }}>
                    <label className="min-w-0 flex-1"><span className={fieldLabel}>Title</span><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="Section B" className="mt-1.5" /></label>
                    <Button type="submit" variant="outline" disabled={pending}>Save title</Button>
                </form>
                {canChange ? (
                    <div className="flex flex-wrap items-end gap-2">
                        <label><span className={fieldLabel}>Access level</span>
                            <select aria-label="Access level" className="nb-select mt-1.5 block" value={row.role} disabled={pending} onChange={(e) => onRole(e.target.value as 'admin' | 'member' | 'viewer')}>
                                <option value="member">{label('member')}</option><option value="viewer">{label('viewer')}</option>
                                {data.viewerRole === 'owner' ? <option value="admin">{label('admin')}</option> : null}
                            </select>
                        </label>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button type="button" variant="outline" className="text-destructive" disabled={pending}>Remove…</Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem variant="destructive" onSelect={() => onRemove(false)}>Remove from organization</DropdownMenuItem>
                                <DropdownMenuItem variant="destructive" onSelect={() => onRemove(true)}>Remove and block from rejoining</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                ) : null}
                {/* A personal block is yours alone: it changes nothing about their place here (Blocking B45, B50). */}
                {isSelf ? null : <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" onClick={() => (row.blockedByMe ? blocking.openUnblock : blocking.openBlock)({ id: row.userId, name: row.name })}>
                    <Ban className="size-4" aria-hidden="true" /> {row.blockedByMe ? `Unblock ${row.name}` : `Block ${row.name}`}
                </Button>}
                {blocking.dialog}
            </>)}
        </div>
    )
}

/** Away (report §33.5, §33.7): dates and an optional reason; their own work due then is excused, and they're told. */
function MemberAway({ orgId, userId, name }: { orgId: string; userId: string; name: string }) {
    const [rows, setRows] = useState<AwayRow[] | null>(null)
    const [form, setForm] = useState<{ from: string; to: string; reason: string } | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const load = useCallback(() => void readMemberAwayAction(orgId, userId).then((r) => setRows(r.success ? r.away : [])), [orgId, userId])
    useEffect(() => { load() }, [load])
    const day = (iso: string) => formatOrgDate(iso, { day: 'numeric', month: 'short' })
    const save = () => startTransition(async () => {
        if (!form) return
        const r = await markAwayAction(orgId, userId, { from: form.from, to: form.to, reason: form.reason.trim() || null })
        if (!r.success) return setError(r.error)
        toast.success(r.excused ? `${name} is away. ${r.excused} excused.` : `${name} is away.`)
        setForm(null); setError(null); load()
    })
    return (
        <section className="space-y-2">
            <h3 className="nb-micro">Away</h3>
            {rows?.length ? rows.map((a) => (
                <p key={a.id} className="flex flex-wrap items-center gap-2">
                    {day(a.from)}–{day(a.to)}{a.reason ? ` · ${a.reason}` : ''}
                    <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => startTransition(async () => {
                        const r = await endAwayAction(orgId, a.id)
                        if (!r.success) return void toast.error(r.error ?? 'Couldn’t end it.')
                        toast.success(`${name} is back`)
                        load()
                    })}>End now</Button>
                </p>
            )) : <p className="text-muted-foreground">Not marked away.</p>}
            {form ? (
                <div className="space-y-3 rounded-md bg-muted p-3">
                    <div className="flex flex-wrap gap-2">
                        <label><span className={fieldLabel}>First day</span><Input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} className="mt-1.5" /></label>
                        <label><span className={fieldLabel}>Last day</span><Input type="date" value={form.to} min={form.from} onChange={(e) => setForm({ ...form, to: e.target.value })} className="mt-1.5" /></label>
                    </div>
                    <label className="block"><span className={fieldLabel}>Reason (optional)</span><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} maxLength={300} className="mt-1.5" /></label>
                    <p className="text-[13px] text-muted-foreground">They see the reason. Their own work due in these days is excused, and work given then starts excused.</p>
                    {error ? <p role="alert" className="text-[13px] text-destructive">{error}</p> : null}
                    <span className="flex gap-1.5">
                        <Button type="button" size="sm" disabled={pending || !form.from || !form.to} onClick={save}>Mark away</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => { setForm(null); setError(null) }}>Cancel</Button>
                    </span>
                </div>
            ) : <Button type="button" size="sm" variant="outline" onClick={() => { const today = new Date().toISOString().slice(0, 10); setForm({ from: today, to: today, reason: '' }) }}>Mark away</Button>}
        </section>
    )
}
