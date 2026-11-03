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
import { filterRoster, remindSummary, type RosterFilter, type RosterRow } from '@/lib/organizations/member-rules'
import { toast } from '@/lib/feedback'
import { saveBlob, toCsvBlob } from '@/lib/download'
import { useAuth } from '@/hooks/use-auth'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { userTopic } from '@/lib/messaging/constants'
import { subscribeBroadcast } from '@/lib/realtime/private-broadcast'
import { OrgInvitePanel } from '@/components/organizations/OrgInvitePanel'
import { formatDistanceToNow } from '@/lib/utils/date'
import { cn } from '@/lib/utils'
import { messageUserInWindow } from '@/components/messages/message-user'
import { RELATIONSHIP_EVENT, useBlockFlow } from '@/components/privacy/BlockDialog'
import { Ban } from 'lucide-react'
import { serverFirst } from '@/lib/server-first'
import { useQueryClient } from '@tanstack/react-query'

// Members tab (report §20): roster with filters and bulk actions, Requests / Invite / summary rail, member drawer.

type RoleNames = Partial<Record<'owner' | 'admin' | 'member' | 'viewer', string>>
type Row = OrgMembersData['rows'][number]

const select = 'h-9 rounded-md border border-border bg-background px-2 text-sm'
const ago = (iso: string | null) => (iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : '—')
/** Last active here (report §29.4, §41.4): empty until they next open the organization. */
const activeHere = (iso: string | null) => (iso ? ago(iso) : 'No data yet')
const workLine = (w: RosterRow['work']) => (w.total === 0 ? '—' : `${w.done} of ${w.total} done${w.missing ? ` · ${w.missing} missing` : ''}`)

export function OrgMembersTab({ orgId, roleNames, started = null }: { orgId: string; roleNames?: RoleNames; started?: ReturnType<typeof readOrgMembersAction> | null }) {
    const [data, setData] = useState<OrgMembersData | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [filter, setFilter] = useState<RosterFilter & { invited?: boolean; outside?: boolean; former?: boolean }>({ sort: 'name' })
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [open, setOpen] = useState<Row | null>(null)
    const [roleAsk, setRoleAsk] = useState<{ ids: string[]; names: string[]; role: 'admin' | 'member' | 'viewer' } | null>(null)
    const [removeAsk, setRemoveAsk] = useState<{ ids: string[]; names: string[]; block: boolean } | null>(null)
    const [revoke, setRevoke] = useState<{ userId: string; name: string } | null>(null)
    const [outsideAsk, setOutsideAsk] = useState<{ userId: string; name: string; projectId: string; title: string } | null>(null)
    const [pending, startTransition] = useTransition()
    // Report §4.3: the organization's own name beside the base access level ("TA · Admin").
    const label = (role: string) => (role in ACCESS_LEVEL_LABELS ? accessLevelLabel(role as AccessLevel, roleNames?.[role as keyof RoleNames]) : role)

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

    if (error) return <p role="alert" className="py-10 text-center text-sm text-muted-foreground">{error}</p>
    if (!data) return <p className="py-10 text-center text-sm text-muted-foreground">Loading members…</p>
    // Bulk actions reach only ticked people still on screen, so a changed filter never removes someone hidden (smaller bug 9).
    const ids = rows.filter((r) => selected.has(r.userId)).map((r) => r.userId)
    const s = data.summary

    return (
        <div className="mx-auto grid w-full max-w-[1240px] gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                    <Input value={filter.q ?? ''} onChange={(e) => setFilter({ ...filter, q: e.target.value })} placeholder="Search members…" aria-label="Search members" className="h-9 w-full sm:w-56" />
                    <select aria-label="Role" className={select} value={filter.role ?? 'all'} onChange={(e) => setFilter({ ...filter, role: e.target.value as RosterFilter['role'] })}>
                        <option value="all">All roles</option><option value="admins">Admins</option><option value="members">Members</option><option value="guests">Viewers</option>
                    </select>
                    <select aria-label="Workspace" className={select} value={filter.project ?? 'all'} onChange={(e) => setFilter({ ...filter, project: e.target.value })}>
                        <option value="all">All workspaces</option><option value="none">Not in a workspace</option>
                        {data.children.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                    <select aria-label="Status" className={select}
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
                    <select aria-label="Sort" className={select} value={filter.sort ?? 'name'} onChange={(e) => setFilter({ ...filter, sort: e.target.value as RosterFilter['sort'] })}>
                        <option value="name">Sort: Name</option><option value="behind">Needs attention</option><option value="active">Last active here</option><option value="joined">Joined</option>
                    </select>
                    {/* Report §33.5: statuses and dates only, never what anyone handed in. */}
                    <Button type="button" size="sm" variant="outline" className="sm:ml-auto" disabled={pending} onClick={() => startTransition(async () => {
                        const r = await readProgressExportAction(orgId)
                        if (!r.success) return void toast.error(r.error)
                        saveBlob(toCsvBlob(r.rows), `progress-${new Date().toISOString().slice(0, 10)}.csv`)
                    })}>Export CSV</Button>
                </div>

                {data.requests.length + data.teamChanges.length > 0 ? <div className="lg:hidden"><Requests orgId={orgId} data={data} pending={pending} run={run} /></div> : null}

                {ids.length > 0 && !filter.former ? <BulkBar label={label} orgId={orgId} data={data} ids={ids} pending={pending} run={run} onClear={() => setSelected(new Set())}
                    onRole={(role) => setRoleAsk({ ids, names: ids.map((id) => data.rows.find((r) => r.userId === id)?.name ?? 'Someone'), role })}
                    onRemove={(block) => setRemoveAsk({ ids, names: ids.map((id) => data.rows.find((r) => r.userId === id)?.name ?? 'Someone'), block })} /> : null}

                {filter.former ? <FormerList orgId={orgId} q={filter.q ?? ''} pending={pending} run={run} /> : filter.outside ? (
                    <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Outside people">
                        {data.outside.length === 0 ? <li className="p-4 text-sm text-muted-foreground">No outside people in this organization’s workspaces.</li> : null}
                        {data.outside.map((o) => (
                            <li key={o.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
                                <span className="font-medium">{o.name}</span>
                                <span className="rounded-[3px] border border-border px-1 text-[11px] text-muted-foreground">Outside</span>
                                <span className="min-w-0 truncate text-muted-foreground">{o.projects.map((p) => p.title).join(', ')}</span>
                                <span className="ml-auto flex flex-wrap gap-1.5">
                                    <Link href={`/messages?userId=${o.userId}`} onClick={(e) => messageUserInWindow(o.userId, e)} className="text-[13px] underline underline-offset-4">Message</Link>
                                    {o.projects.map((p) => (
                                        <Button key={p.id} type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOutsideAsk({ userId: o.userId, name: o.name, projectId: p.id, title: p.title })}>
                                            Remove from {p.title}
                                        </Button>
                                    ))}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : filter.invited ? (
                    <ul className="divide-y divide-border rounded-lg border border-border">
                        {data.invites.length === 0 ? <li className="p-4 text-sm text-muted-foreground">No invites waiting.</li> : null}
                        {data.invites.map((i) => (
                            <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
                                <span className="font-medium">{i.email}</span>
                                <span className="text-muted-foreground">{label(i.role)}{i.title ? ` · ${i.title}` : ''} · {i.expired ? 'Expired' : `Invited · expires ${new Date(i.expiresAt).toLocaleDateString()}`}</span>
                                {i.expired ? <span className="nb-status" data-status="archived">Expired</span> : null}
                                <span className="ml-auto flex gap-1.5">
                                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => resendOrgInviteAction(orgId, i.id), 'Invite extended')}>Resend</Button>
                                    <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelOrgInviteAction(orgId, i.id), 'Invite canceled')}>Cancel</Button>
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <ul className="divide-y divide-border rounded-lg border border-border">
                        <li className="flex items-center gap-2 px-3 py-2 text-[12px] text-muted-foreground">
                            <input type="checkbox" aria-label="Select all in filter" checked={rows.length > 0 && rows.every((r) => selected.has(r.userId))}
                                onChange={(e) => setSelected(e.target.checked ? new Set(rows.filter((r) => r.role !== 'owner').map((r) => r.userId)) : new Set())} />
                            {rows.length} {rows.length === 1 ? 'person' : 'people'}
                        </li>
                        {rows.map((r) => (
                            <li key={r.userId} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                                <input type="checkbox" className="mt-1" aria-label={`Select ${r.name}`} disabled={r.role === 'owner'} checked={selected.has(r.userId)}
                                    onChange={(e) => setSelected((cur) => { const next = new Set(cur); if (e.target.checked) next.add(r.userId); else next.delete(r.userId); return next })} />
                                {/* Live-fix 39: a photo on every row. */}
                                <UserAvatar identity={{ id: r.userId, fullName: r.name, username: r.username, avatarUrl: r.avatarUrl }} size={32} roundedClassName="rounded-full" />
                                <button type="button" onClick={() => setOpen(r)} className="min-w-0 flex-1 text-left">
                                    <span className="flex flex-wrap items-center gap-x-1.5">
                                        <span className="font-medium">{r.name}</span>
                                        <span className="rounded-[3px] border border-border px-1 text-[11px] text-muted-foreground">{label(r.role)}</span>
                                        {r.verified ? <span className="text-[12px] text-muted-foreground" title="Contribution verified"><span aria-hidden="true">✓</span><span className="sr-only">Verified</span></span> : null}
                                        {/* Your personal block, seen only by you (Blocking B51). */}
                                        {r.blockedByMe ? <span className="rounded-[3px] border border-border px-1 text-[11px] text-muted-foreground">Blocked</span> : null}
                                        {r.title ? <span className="text-muted-foreground">· {r.title}</span> : null}
                                    </span>
                                    <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                                        {r.projects.length ? r.projects.map((p) => (p.unit ? `${p.title} · ${p.unit}` : p.title)).join(', ') : '— not in a workspace'}
                                    </span>
                                    <span className={cn('mt-0.5 block text-[12px] sm:hidden', r.behind ? 'text-destructive' : 'text-muted-foreground')}>{workLine(r.work)} · active here {activeHere(r.lastActiveAt)}</span>
                                </button>
                                <span className={cn('hidden shrink-0 text-[12px] sm:inline', r.behind ? 'text-destructive' : 'text-muted-foreground')}>{workLine(r.work)}</span>
                                <span className="hidden w-24 shrink-0 text-right font-mono text-[11px] text-muted-foreground sm:inline">{activeHere(r.lastActiveAt)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <aside className="space-y-5">
                <div className={data.requests.length + data.teamChanges.length > 0 ? 'hidden lg:block' : undefined}><Requests orgId={orgId} data={data} pending={pending} run={run} /></div>
                {/* Report §7.11: the same invite panel as the header and About. */}
                {/* Live-fix 40: alone, the invite panel leads with a plain line. */}
                <div className="border-t border-border pt-4">
                    {data.summary.members <= 1 ? <p className="mb-2 text-sm font-medium">You’re the only one here so far</p> : null}
                    <OrgInvitePanel orgId={orgId} orgHandle={null} prominent={data.summary.members <= 1} />
                </div>
                <section aria-label="Summary" className="space-y-1 text-sm">
                    <button type="button" className="block hover:underline" onClick={() => setFilter({ sort: 'name' })}>{s.members} {s.members === 1 ? 'member' : 'members'}</button>
                    <button type="button" className="block hover:underline" onClick={() => setFilter({ role: 'admins' })}>{s.admins} {s.admins === 1 ? 'owner or admin' : 'owners and admins'} · {s.guests} {s.guests === 1 ? 'viewer' : 'viewers'}</button>
                    <button type="button" className="block hover:underline" onClick={() => setFilter({ status: 'behind', sort: 'behind' })}>{s.behind} behind</button>
                    <button type="button" className="block hover:underline" onClick={() => setFilter({ project: 'none' })}>{s.notInProject} not in a workspace</button>
                    <button type="button" className="block hover:underline" onClick={() => setFilter({ status: 'inactive' })}>{s.inactive} inactive for 14 days</button>
                </section>
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
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2 text-sm" role="group" aria-label="Bulk actions">
            <span className="font-medium">{ids.length} selected</span>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => remindMembersAction(orgId, ids), (r) => ('reminded' in r ? remindSummary(r) : ''))}>Remind</Button>
            <select aria-label="Change access level" className={select} value="" disabled={pending} onChange={(e) => {
                const role = e.target.value as 'admin' | 'member' | 'viewer'
                if (role) onRole(role)
            }}>
                <option value="">Change access level…</option>
                <option value="member">{label('member')}</option><option value="viewer">{label('viewer')}</option>
                {data.viewerRole === 'owner' ? <option value="admin">Admin</option> : null}
            </select>
            <select aria-label="Workspace" className={select} value={childId} onChange={(e) => { setChildId(e.target.value); setUnitId('') }}>
                <option value="">Add to workspace…</option>
                {data.children.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            {childId ? (
                <>
                    <select aria-label="Team" className={select} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
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
            <Button type="button" size="sm" variant="destructive" className="ml-auto" disabled={pending} onClick={() => onRemove(false)}>Remove</Button>
            <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => onRemove(true)}>Remove and block from organization</Button>
            <Button type="button" size="sm" variant="ghost" onClick={onClear}>Clear</Button>
        </div>
    )
}

function Requests({ orgId, data, pending, run }: { orgId: string; data: OrgMembersData; pending: boolean; run: Run }) {
    const [declining, setDeclining] = useState<{ id: string; name: string } | null>(null)
    return (
        <section aria-label="Requests" className="space-y-2">
            <h3 className="text-sm font-semibold">Requests · {data.requests.length + data.teamChanges.length}</h3>
            {data.requests.length + data.teamChanges.length === 0 ? <p className="text-[13px] text-muted-foreground">No one is waiting.</p> : null}
            {/* Ask to change team (report §25.5, decision 46): admins only, since it can be about a block. */}
            {data.teamChanges.map((c) => (
                <div key={`${c.userId}:${c.workspaceId}`} className="space-y-1 rounded-md border border-border p-2 text-[13px]">
                    <p><span className="font-medium">{c.name}</span> asks to change team <span className="text-muted-foreground">· in {c.workspace} · {ago(c.at)}</span></p>
                    <MoveToWorkspace orgId={orgId} data={data} userId={c.userId} fromId={c.workspaceId} pending={pending} run={run}>
                        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => dismissTeamChangeAction(orgId, c.userId, c.workspaceId), 'Dismissed')}>Dismiss</Button>
                    </MoveToWorkspace>
                </div>
            ))}
            {data.requests.map((r) => (
                <div key={r.id} className="space-y-1 rounded-md border border-border p-2 text-[13px]">
                    <p><span className="font-medium">{r.name}</span> <span className="text-muted-foreground">· via code · {ago(r.createdAt)}</span></p>
                    {r.note ? <p className="text-muted-foreground">“{r.note}”</p> : null}
                    <div className="flex gap-1.5">
                        <Button type="button" size="sm" disabled={pending} onClick={() => run(() => approveJoinRequestsAction(orgId, [r.id]), `${r.name} approved`)}>Approve</Button>
                        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setDeclining({ id: r.id, name: r.name })}>Decline</Button>
                    </div>
                </div>
            ))}
            {data.requests.length > 1 ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => approveJoinRequestsAction(orgId, data.requests.map((r) => r.id)), 'All approved')}>Approve all</Button> : null}
            <ReasonDialog open={Boolean(declining)} onOpenChange={(v) => { if (!v) setDeclining(null) }} title={`Decline ${declining?.name ?? 'this request'}?`}
                label="Reason (optional)" confirmLabel="Decline" variant="destructive"
                onConfirm={(reason) => { if (declining) run(() => declineJoinRequestAction(orgId, declining.id, reason || undefined), 'Request declined') }} />
        </section>
    )
}

/** Move to another workspace (report §25.5): pick the workspace and team; the old lead hears only that a seat opened. */
function MoveToWorkspace({ orgId, data, userId, fromId, pending, run, children }: { orgId: string; data: OrgMembersData; userId: string; fromId: string; pending: boolean; run: Run; children?: React.ReactNode }) {
    const [toId, setToId] = useState('')
    const [unitId, setUnitId] = useState('')
    const units = data.children.find((c) => c.id === toId)?.units ?? []
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <select aria-label="Move to workspace" className={select} value={toId} onChange={(e) => { setToId(e.target.value); setUnitId('') }}>
                <option value="">Move to…</option>
                {data.children.filter((c) => c.id !== fromId).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            {toId ? (
                <select aria-label="Team" className={select} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
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
    return (
        <div className="space-y-5 text-sm">
            <header className="space-y-1">
                <p className="text-lg font-semibold">{row.name}</p>
                <p className="text-muted-foreground">{label(row.role)}{row.title ? ` · ${row.title}` : ''}</p>
                <p className="font-mono text-[11px] text-muted-foreground">Joined {ago(row.joinedAt)} · active here {activeHere(row.lastActiveAt)}</p>
                <p className="flex gap-3 text-[13px]">
                    {row.username ? <Link href={`/u/${row.username}`} className="underline underline-offset-4">View profile</Link> : null}
                    <Link href={`/messages?userId=${row.userId}`} onClick={(e) => messageUserInWindow(row.userId, e)} className="underline underline-offset-4">Message</Link>
                </p>
            </header>
            <section className="space-y-1.5">
                <h4 className="font-semibold">Work</h4>
                {work === null ? <p className="text-muted-foreground">Loading…</p> : work.length === 0 ? <p className="text-muted-foreground">No assignments yet.</p> : (
                    <ul className="space-y-1">
                        {work.map((w) => (
                            <li key={w.copyId} className="flex justify-between gap-2">
                                <span className="truncate">{w.title}</span>
                                <span className={cn('shrink-0 text-[12px]', w.state === 'missing' ? 'text-destructive' : 'text-muted-foreground')}>{w.state.replace('_', ' ')}{w.late ? ' · late' : ''}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
            {row.role === 'member' ? <MemberAway orgId={orgId} userId={row.userId} name={row.name} /> : null}
            <section className="space-y-1.5">
                <h4 className="font-semibold">Contribution credit</h4>
                <p className="text-muted-foreground">{row.verified ? '✓ Verified. It covers role and dates, not what they wrote.' : 'Not verified yet.'}</p>
                <div className="flex flex-wrap gap-1.5">
                    {isSelf ? null : row.verified
                        ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onRevoke}>Revoke</Button>
                        : <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => verifyOrgContributionsAction(orgId, [row.userId]), 'Contribution verified')}>Verify contribution</Button>}
                </div>
            </section>
            <section className="space-y-1">
                <h4 className="font-semibold">Workspaces and teams</h4>
                {row.projects.length === 0 ? <p className="text-muted-foreground">Not in a workspace.</p> : row.projects.map((p) => (
                    <div key={p.id} className="space-y-1">
                        <p>{p.title}{p.unit ? ` · ${p.unit}` : ''}</p>
                        {data.children.length > 1 ? <MoveToWorkspace orgId={orgId} data={data} userId={row.userId} fromId={p.id} pending={pending} run={run} /> : null}
                    </div>
                ))}
            </section>
            <section className="space-y-1.5">
                <h4 className="font-semibold">Recent activity</h4>
                {activity === null ? <p className="text-muted-foreground">Loading…</p> : activity.length === 0 ? <p className="text-muted-foreground">Nothing recent.</p> : (
                    <ul className="space-y-1 text-[13px]">
                        {activity.map((a, i) => (
                            <li key={i} className="flex justify-between gap-2">
                                <span className="min-w-0 truncate">{a.what} · {a.task} <span className="text-muted-foreground">in {a.project}</span></span>
                                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{ago(a.at)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
            <section className="space-y-2">
                <h4 className="font-semibold">Membership</h4>
                <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); run(() => setMemberTitleAction(orgId, row.userId, title), 'Title saved') }}>
                    <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="Title" aria-label="Title" className="h-9" />
                    <Button type="submit" size="sm" variant="outline" disabled={pending}>Save</Button>
                </form>
                {canChange ? (
                    <div className="flex flex-wrap gap-1.5">
                        <select aria-label="Role" className={select} value={row.role} disabled={pending} onChange={(e) => onRole(e.target.value as 'admin' | 'member' | 'viewer')}>
                            <option value="member">{label('member')}</option><option value="viewer">{label('viewer')}</option>
                            {data.viewerRole === 'owner' ? <option value="admin">{label('admin')}</option> : null}
                        </select>
                        <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => onRemove(false)}>Remove</Button>
                        <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => onRemove(true)}>Remove and block from organization</Button>
                    </div>
                ) : null}
                {/* A personal block is yours alone: it changes nothing about their place here (Blocking B45, B50). */}
                {isSelf ? null : <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" onClick={() => (row.blockedByMe ? blocking.openUnblock : blocking.openBlock)({ id: row.userId, name: row.name })}>
                    <Ban className="size-4" aria-hidden="true" /> {row.blockedByMe ? `Unblock ${row.name}` : `Block ${row.name}`}
                </Button>}
                {blocking.dialog}
            </section>
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
    const day = (iso: string) => new Date(iso).toLocaleDateString('en', { day: 'numeric', month: 'short' })
    const save = () => startTransition(async () => {
        if (!form) return
        const r = await markAwayAction(orgId, userId, { from: form.from, to: form.to, reason: form.reason.trim() || null })
        if (!r.success) return setError(r.error)
        toast.success(r.excused ? `${name} is away. ${r.excused} excused.` : `${name} is away.`)
        setForm(null); setError(null); load()
    })
    return (
        <section className="space-y-1.5">
            <h4 className="font-semibold">Away</h4>
            {rows?.length ? rows.map((a) => (
                <p key={a.id} className="flex flex-wrap items-center gap-2">
                    {day(a.from)}–{day(a.to)}{a.reason ? ` · ${a.reason}` : ''}
                    <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => startTransition(async () => { await endAwayAction(orgId, a.id); load() })}>End now</Button>
                </p>
            )) : <p className="text-muted-foreground">Not marked away.</p>}
            {form ? (
                <div className="space-y-2 rounded-md border border-border p-3">
                    <div className="flex flex-wrap gap-2">
                        <label className="space-y-1"><span className="block text-[12px]">First day</span><Input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} className="h-9" /></label>
                        <label className="space-y-1"><span className="block text-[12px]">Last day</span><Input type="date" value={form.to} min={form.from} onChange={(e) => setForm({ ...form, to: e.target.value })} className="h-9" /></label>
                    </div>
                    <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} maxLength={300} placeholder="Reason (optional, they see it)" aria-label="Reason" className="h-9" />
                    <p className="text-[12px] text-muted-foreground">Their own work due in these days is excused, and work given then starts excused.</p>
                    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
                    <span className="flex gap-1.5">
                        <Button type="button" size="sm" disabled={pending || !form.from || !form.to} onClick={save}>Mark away</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => { setForm(null); setError(null) }}>Cancel</Button>
                    </span>
                </div>
            ) : <Button type="button" size="sm" variant="outline" onClick={() => { const today = new Date().toISOString().slice(0, 10); setForm({ from: today, to: today, reason: '' }) }}>Mark away</Button>}
        </section>
    )
}
