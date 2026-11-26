'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { UserX } from 'lucide-react'

import {
    changeMemberRoleAction,
    inviteFormerMemberAction,
    readFormerMembersAction,
    readRemovalPreviewAction,
    readRoleChangePreviewAction,
    removeMembersAction,
    type FormerMember,
} from '@/app/actions/org-members'
import { unblockFromOrgAction } from '@/app/actions/moderation-org'
import { revokeOrgVerificationAction } from '@/app/actions/org-profile'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { formatDistanceToNow } from '@/lib/utils/date'
import { MessageUserLink } from "@/components/messages/MessageUserLink";
import { ErrorNotice } from '@/components/ui/ErrorNotice'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusBadge } from '@/components/organizations/org-ui'
import { fieldHint, fieldLabel } from '@/lib/organizations/display'

const checking = <div role="status" aria-label="Checking what changes" className="space-y-1.5">{[0, 1, 2].map((i) => <div key={i} className="nb-skeleton h-5 rounded-md" aria-hidden="true" />)}</div>

// Members tab dialogs (report §36.2, §36.4, §36.5, §28.7): each says what will happen before it does.

type Run = <R extends { success: boolean; error?: string }>(work: () => Promise<R>, done: string | ((result: R) => string)) => void
type Role = 'admin' | 'member' | 'viewer'

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
const who = (names: string[]) => (names.length === 1 ? names[0]! : `${names.length} people`)

/** Change role (report §36.2): what changes for their work, refused for a workspace lead becoming Viewer. */
export function RoleDialog({ orgId, userIds, names, role, label, run, onClose }: { orgId: string; userIds: string[]; names: string[]; role: Role | null; label: (role: string) => string; run: Run; onClose: () => void }) {
    const [preview, setPreview] = useState<Extract<Awaited<ReturnType<typeof readRoleChangePreviewAction>>, { success: true }> | null>(null)
    useEffect(() => {
        setPreview(null)
        if (role) void readRoleChangePreviewAction(orgId, userIds, role).then((r) => setPreview(r.success ? r : null))
    }, [orgId, role, userIds])
    const lines = !preview || !role ? [] : [
        preview.openRemoved ? `${n(preview.openRemoved, 'open assignment')} ${preview.openRemoved === 1 ? 'is' : 'are'} removed from their list` : null,
        preview.submittedKept ? `${n(preview.submittedKept, 'handed-in assignment')} ${preview.submittedKept === 1 ? 'stays' : 'stay'} in their record` : null,
        preview.gainsOpen ? `${n(preview.gainsOpen, 'open assignment')} ${preview.gainsOpen === 1 ? 'is' : 'are'} added to their list` : null,
        role === 'admin' ? 'They can review work, except their own' : null,
        role === 'viewer' ? 'They leave their workspaces and #general, and can read without posting' : null,
    ].filter(Boolean)
    const lead = preview?.leads[0]
    return (
        <ConfirmDialog open={Boolean(role)} onOpenChange={(open) => { if (!open) onClose() }}
            title={`Make ${who(names)} ${role ? label(role) : ''}?`} confirmLabel={lead ? 'Close' : `Make ${role ? label(role) : ''}`}
            onConfirm={() => { if (role && !lead) run(() => changeMemberRoleAction(orgId, userIds, role), 'Role changed. They’re told.'); onClose() }}>
            {!preview ? checking : lead ? (
                <p className="text-sm">{lead.name} leads {lead.workspace}. <Link href={`/workspaces/${encodeURIComponent(lead.slug ?? lead.workspaceId)}?tab=settings`} className="nb-link">Transfer {lead.workspace} first</Link>.</p>
            ) : (
                <ul className="list-disc space-y-1 pl-5 text-[13px]">
                    {lines.length ? lines.map((line) => <li key={line}>{line}</li>) : <li>Nothing else changes for their work</li>}
                </ul>
            )}
        </ConfirmDialog>
    )
}

/** Remove (report §36.5): what goes and what stays, an optional reason they'll see, and the organization's block. */
export function RemoveDialog({ orgId, userIds, names, block, run, onClose }: { orgId: string; userIds: string[]; names: string[]; block: boolean | null; run: Run; onClose: () => void }) {
    const [preview, setPreview] = useState<Extract<Awaited<ReturnType<typeof readRemovalPreviewAction>>, { success: true }> | null>(null)
    const [reason, setReason] = useState('')
    const [blocked, setBlocked] = useState(false)
    useEffect(() => {
        setPreview(null)
        setReason('')
        setBlocked(Boolean(block))
        if (block !== null) void readRemovalPreviewAction(orgId, userIds).then((r) => setPreview(r.success ? r : null))
    }, [block, orgId, userIds])
    const p = preview
    const lines = !p ? [] : [
        p.workspaces ? `Remove them from ${n(p.workspaces, 'workspace')}${p.seats ? `; ${n(p.seats, 'seat')} ${p.seats === 1 ? 'opens' : 'open'}` : ''}` : null,
        p.openRemoved ? `Remove ${n(p.openRemoved, 'unsubmitted assignment')}` : null,
        p.submittedKept ? `Keep ${n(p.submittedKept, 'submitted assignment')} for admins` : null,
        p.tasks ? `Unassign ${n(p.tasks, 'task')}` : null,
        'Remove them from channels here',
        'Hide their profile entry and withdraw verification',
    ].filter(Boolean)
    const confirm = !p || p.people === 0 ? 'Close' : p.skipped.length ? `Remove ${p.people}, skip ${p.skipped.length}` : names.length === 1 ? `Remove ${names[0]}` : `Remove ${p.people}`
    return (
        <ConfirmDialog open={block !== null} onOpenChange={(open) => { if (!open) onClose() }} variant="destructive" size="wide"
            title={`Remove ${who(names)} from this organization?`} confirmLabel={confirm}
            onConfirm={() => {
                if (p?.people) run(() => removeMembersAction(orgId, userIds, { block: blocked, reason: reason.trim() || null }),
                    (r) => ('removed' in r && r.removed === 1 && names.length === 1 ? `${names[0]} was removed. They’re under Former.` : `${'removed' in r ? r.removed : 0} removed. They’re under Former.`))
                onClose()
            }}>
            {!p ? checking : (
                <div className="space-y-4 text-[13px]">
                    {p.skipped.map((s) => <p key={s.userId}>{s.name} leads {s.workspaces.join(', ')}. Transfer it first; they’re left out.</p>)}
                    {p.people ? (
                        <>
                            <div>
                                <p className="font-medium">This will:</p>
                                <ul className="list-disc space-y-1 pl-5">{lines.map((line) => <li key={line}>{line}</li>)}</ul>
                            </div>
                            <label className="block">
                                <span className={fieldLabel}>Reason (optional)</span>
                                <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} className="nb-textarea mt-1.5" />
                                <span className={`block ${fieldHint}`}>They’ll see this. Leave it empty to send no reason.</span>
                            </label>
                            <label className="flex items-start gap-2">
                                <input type="checkbox" className="nb-check mt-0.5" checked={blocked} onChange={(e) => setBlocked(e.target.checked)} />
                                <span>Also block them from rejoining{blocked ? <span className={`block ${fieldHint}`}>They’re never told about the block. If they try, they see “You can’t join this organization.”</span> : null}</span>
                            </label>
                        </>
                    ) : null}
                </div>
            )}
        </ConfirmDialog>
    )
}

/** Revoke verification (report §28.7): a required reason, which they'll see. */
export function RevokeDialog({ orgId, person, run, onClose }: { orgId: string; person: { userId: string; name: string } | null; run: Run; onClose: () => void }) {
    const [reason, setReason] = useState('')
    useEffect(() => { setReason('') }, [person])
    return (
        <ConfirmDialog open={Boolean(person)} onOpenChange={(open) => { if (!open) onClose() }} variant="destructive"
            title={`Revoke ${person?.name ?? 'their'} verification?`} confirmLabel="Revoke"
            onConfirm={() => { if (person) run(() => revokeOrgVerificationAction(orgId, person.userId, reason), 'Verification revoked. They’re told why.'); onClose() }}>
            <label className="block">
                <span className={fieldLabel}>Reason</span>
                <textarea required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} className="nb-textarea mt-1.5" />
                <span className={`block ${fieldHint}`}>They’ll see this.</span>
            </label>
        </ConfirmDialog>
    )
}

const HOW: Record<FormerMember['how'], string> = { left: 'Left', removed: 'Removed', term_ended: 'Term ended', org_deleted: 'Organization ended', finished: 'Finished in the lab' }

/** Members → Status → Former (report §36.4): read only, with Message, Invite back and Unblock. */
export function FormerList({ orgId, q, pending, run }: { orgId: string; q: string; pending: boolean; run: Run }) {
    const [rows, setRows] = useState<FormerMember[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const load = () => void readFormerMembersAction(orgId).then((r) => { if (r.success) setRows(r.rows); else setError(r.error) })
    useEffect(load, [orgId])
    if (error) return <ErrorNotice message={error} onRetry={() => { setError(null); load() }} />
    if (!rows) return <div role="status" aria-label="Loading former members" className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="nb-skeleton h-14 rounded-md" aria-hidden="true" />)}</div>
    const shown = rows.filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()))
    const act: Run = (work, done) => run(async () => { const r = await work(); load(); return r }, done)
    return (
        shown.length === 0 ? <EmptyState icon={UserX} title={rows.length ? 'No one matches' : 'Nobody has left yet'} description={rows.length ? 'Try another name.' : 'People who leave or are removed show here.'} /> :
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card" aria-label="Former members">
            {shown.map((r) => (
                <li key={r.userId} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[13px]">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-muted-foreground">
                        {HOW[r.how]} {formatDistanceToNow(new Date(r.at), { addSuffix: true })}{r.by ? ` · ${r.by}` : ''}{r.note ? ` · “${r.note}”` : ''}
                    </span>
                    {r.blocked ? <StatusBadge state="blocked">Blocked</StatusBadge> : null}
                    {r.total ? <span className="nb-meta">{r.done} of {r.total} done</span> : null}
                    {r.name !== 'Deleted user' ? (
                        <span className="ml-auto flex items-center gap-1.5">
                            {/* Former has Message too (step 11 gap); their own privacy settings still decide. */}
                            {!r.blocked ? <MessageUserLink userId={r.userId} className="nb-link px-1" /> : null}
                            {r.blocked
                                ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => act(() => unblockFromOrgAction(orgId, r.userId), `${r.name} can join again`)}>Unblock</Button>
                                : <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => act(() => inviteFormerMemberAction(orgId, r.userId), `${r.name} was invited back`)}>Invite back</Button>}
                        </span>
                    ) : null}
                </li>
            ))}
        </ul>
    )
}
