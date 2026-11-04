'use client'

import { useRefreshSidebar } from '@/hooks/useRefreshSidebar'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'

import { transferWorkspaceOwnership } from '@/app/actions/account'
import { useIdentityStepUp } from '@/hooks/useIdentityStepUp'
import { archiveOrgAction, askToTakeOverAction, deleteOrgAction, duplicateOrgAction, inviteBackAction, readOrgLifecyclePreviewAction, readTakeoverAction, refuseTakeoverAction, restoreOrgAction, takeOverNowAction, unarchiveOrgAction } from '@/app/actions/org-lifecycle'
import { DownloadLink } from '@/components/ui/download-link'
import { typeProfile } from '@/lib/organizations/type-profile'
import { readOrgMembersAction, readProgressExportAction } from '@/app/actions/org-members'
import { saveBlob, toCsvBlob } from '@/lib/download'
import { toast } from '@/lib/feedback'
import { SettingsCard } from '@/components/workspaces/settings/SettingsFormFields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { OrgDetail } from '@/lib/organizations/detail'

// The owner's danger zone for an organization (report §30.5): Transfer (admins only, two steps), Archive or
// Unarchive, Duplicate, Delete with a 30-day grace (and Restore while it lasts).

const label = 'nb-ui-label text-sm font-semibold text-foreground'
const help = 'nb-compact mt-0.5 text-xs text-muted-foreground'
const DATE = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })
type Preview = {
    children: number; members: number; files: number; sprints: number; waitingReviews: number
    childProjects: Array<{ id: string; title: string; lead: string; members: number; files: number; mine: boolean }>
    assignments: Array<{ id: string; title: string }>
    detached: Array<{ id: string; title: string }>
}

function useRun() {
    const router = useRouter()
    const refreshSidebar = useRefreshSidebar()
    const [pending, start] = useTransition()
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
    const run = (action: () => Promise<{ success: boolean; error?: string }>, ok: string, after?: () => void) => start(async () => {
        const result = await action()
        setMessage(result.success ? { ok: true, text: ok } : { ok: false, text: result.error ?? 'Couldn’t finish that.' })
        if (result.success) { after?.(); refreshSidebar(); router.refresh() }
    })
    const status = message ? <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'}>{message.text}</p> : null
    return { pending, run, status }
}

export function OrgDangerZone({ orgId, organization, handle }: { orgId: string; organization: OrgDetail; handle: string | null }) {
    const [preview, setPreview] = useState<Preview | null>(null)
    const [admins, setAdmins] = useState<Array<{ userId: string; name: string }>>([])
    useEffect(() => {
        void readOrgLifecyclePreviewAction(orgId).then((r) => { if (r.success) setPreview(r.preview) })
        void readOrgMembersAction(orgId).then((r) => { if (r.success) setAdmins(r.rows.filter((m) => m.role === 'admin').map((m) => ({ userId: m.userId, name: m.name }))) })
    }, [orgId])

    if (organization.deletionScheduledAt) return <RestoreCard orgId={orgId} at={organization.deletionScheduledAt} />
    return (
        <SettingsCard title="Organization management" headingLevel={2} danger description="Transfer, archive, duplicate and delete. Each one asks before it changes anything.">
            <div className="space-y-8">
                {preview?.detached.length ? <InviteBackRow orgId={orgId} detached={preview.detached} /> : null}
                <TransferRow orgId={orgId} admins={admins} organization={organization} />
                <ArchiveRow orgId={orgId} archived={organization.archived} preview={preview} handle={handle} />
                <DuplicateRow orgId={orgId} handle={handle} termStart={organization.termStart} type={organization.type} />
                <DeleteRow orgId={orgId} handle={handle} preview={preview} />
            </div>
        </SettingsCard>
    )
}

function RestoreCard({ orgId, at }: { orgId: string; at: string }) {
    const { pending, run, status } = useRun()
    const purgeAt = new Date(new Date(at).getTime() + 30 * 86_400_000)
    return (
        <SettingsCard title="Scheduled for deletion" headingLevel={2} danger description={`This organization will be removed for good on ${DATE.format(purgeAt)}. Until then you can bring it back.`}>
            <div className="flex items-center gap-3">
                <Button disabled={pending} onClick={() => run(() => restoreOrgAction(orgId), 'Restored. Invite the workspaces that were kept apart back from Management.')}>Restore</Button>
                {status}
            </div>
        </SettingsCard>
    )
}

/** After a restore (report §19.1): the workspaces kept apart, each with Invite back. */
function InviteBackRow({ orgId, detached }: { orgId: string; detached: Array<{ id: string; title: string }> }) {
    const { pending, run, status } = useRun()
    return (
        <div>
            <p className={label}>Workspaces kept apart</p>
            <p className={help}>They became personal when the organization was deleted. Their team leads can move them back in with one click once invited.</p>
            <ul className="mt-2 space-y-1.5 text-sm">
                {detached.map((d) => (
                    <li key={d.id} className="flex items-center gap-2">{d.title}
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => inviteBackAction(orgId, d.id), `${d.title}’s lead was invited back.`)}>Invite back</Button>
                    </li>
                ))}
            </ul>
            {status}
        </div>
    )
}

function TransferRow({ orgId, admins, organization }: { orgId: string; admins: Array<{ userId: string; name: string }>; organization: OrgDetail }) {
    const [target, setTarget] = useState('')
    const [confirming, setConfirming] = useState(false)
    const { pending, run, status } = useRun()
    const identity = useIdentityStepUp('Confirm it’s you', 'Transferring an organization needs a recent check.')
    const name = admins.find((a) => a.userId === target)?.name
    // The identity check opens here when needed, then the transfer carries on (decision 134).
    const transfer = async () => (await identity.withIdentity(() => transferWorkspaceOwnership(orgId, target))) ?? { success: false, error: 'The transfer was stopped.' }
    return (
        <div>
            {identity.dialog}
            <p className={label}>Transfer ownership</p>
            <p className={help}>Only to an existing admin. You stay an admin. Workspaces keep their team leads.</p>
            {admins.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Make someone an admin first.</p> : (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select aria-label="New owner" value={target} onChange={(e) => { setTarget(e.target.value); setConfirming(false) }} className="h-9 rounded-[5px] border border-border bg-background px-2 text-sm">
                        <option value="">Choose an admin</option>
                        {admins.map((a) => <option key={a.userId} value={a.userId}>{a.name}</option>)}
                    </select>
                    {!confirming
                        ? <Button variant="outline" disabled={!target} onClick={() => setConfirming(true)}>Transfer…</Button>
                        : <Button variant="destructive" disabled={pending} onClick={() => run(transfer, `${name} owns the organization now.`)}>Yes, make {name} the owner</Button>}
                    {status}
                </div>
            )}
            {confirming && name ? (
                // Report §27.6: what changes for each of you, in the organization's role names.
                <p className="mt-2 text-sm">{name} becomes {organization.roleNames.owner} (Owner). You become {organization.roleNames.admin} (Admin). Only {name} can archive, delete or transfer.</p>
            ) : null}
        </div>
    )
}

/**
 * Records before Archive or Delete (report §45.7, decision 176): Export progress (the Members sheet: statuses and
 * dates, never anyone's work), then each assignment's Download all, one at a time to stay under 2 GB.
 */
function Records({ orgId, preview }: { orgId: string; preview: Preview | null }) {
    const [exporting, startExport] = useTransition()
    if (!preview?.assignments.length) return null
    return (
        <div className="mt-2 rounded-md border border-border p-3 text-sm">
            <p className="font-medium">Keep a record first</p>
            <p className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <span className={help}>Everyone’s status and dates for every assignment, as a sheet.</span>
                <Button type="button" size="sm" variant="outline" disabled={exporting} onClick={() => startExport(async () => {
                    const r = await readProgressExportAction(orgId)
                    if (!r.success) return void toast.error(r.error)
                    saveBlob(toCsvBlob(r.rows), `progress-${new Date().toISOString().slice(0, 10)}.csv`)
                })}>Export progress</Button>
            </p>
            <p className={help}>Download everyone’s files for each assignment, one at a time.</p>
            <ul className="mt-2 space-y-1">
                {preview.assignments.map((a) => <li key={a.id} className="flex items-center justify-between gap-2">{a.title}<Button asChild size="sm" variant="outline"><DownloadLink href={`/api/v1/workspaces/${orgId}/tasks/${a.id}/submissions`}>Download all</DownloadLink></Button></li>)}
            </ul>
        </div>
    )
}

function ArchiveRow({ orgId, archived, preview, handle }: { orgId: string; archived: boolean; preview: Preview | null; handle: string | null }) {
    const [confirming, setConfirming] = useState(false)
    const { pending, run, status } = useRun()
    return (
        <div>
            <p className={label}>{archived ? 'Unarchive' : 'Archive'}</p>
            <p className={help}>{archived
                ? 'Everything opens again with a new join code (off until you switch it on). Sprints never start late.'
                : 'Everything becomes read-only: the join code turns off, reminders and digests stop, and messages are read-only. Members keep read access and you are asked to verify contributions.'}</p>
            {!archived && confirming && preview ? (
                <>
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-foreground">
                        <li>{preview.children} {preview.children === 1 ? 'workspace is' : 'workspaces are'} archived with it</li>
                        <li>{preview.sprints} planned or running {preview.sprints === 1 ? 'sprint stops' : 'sprints stop'}</li>
                        {preview.waitingReviews ? <li>{preview.waitingReviews} {preview.waitingReviews === 1 ? 'submission is' : 'submissions are'} still waiting for review · <a className="text-primary hover:underline" href={`/org/${encodeURIComponent(handle ?? orgId)}?tab=tasks&taskScope=review`}>Review them</a></li> : null}
                        <li>{preview.members} members are told by email</li>
                    </ul>
                    <Records orgId={orgId} preview={preview} />
                </>
            ) : null}
            <div className="mt-2 flex items-center gap-3">
                {archived
                    ? <Button variant="outline" disabled={pending} onClick={() => run(() => unarchiveOrgAction(orgId), 'Open again. Switch the new join code on in Access when you are ready.')}>Unarchive</Button>
                    : !confirming
                        ? <Button variant="outline" onClick={() => setConfirming(true)}>Archive…</Button>
                        : <Button variant="destructive" disabled={pending} onClick={() => run(() => archiveOrgAction(orgId), 'Archived. Everything is read-only now.', () => setConfirming(false))}>Archive the organization</Button>}
                {status}
            </div>
        </div>
    )
}

const COPY_ITEMS = [
    { key: 'about', text: 'About, settings and role names' },
    { key: 'docs', text: 'Documents' },
    { key: 'files', text: 'Folders and admin files (never submissions)' },
    { key: 'sprints', text: 'Sprint plan, with dates moved, and its materials' },
    { key: 'assignments', text: 'Assignments as drafts, with their files and dates moved' },
    { key: 'channels', text: 'Channel names and topics' },
    { key: 'admins', text: 'Invite the current admins' },
] as const

function DuplicateRow({ orgId, handle, termStart, type }: { orgId: string; handle: string | null; termStart: string | null; type: OrgDetail['type'] }) {
    const startWord = typeProfile(type).termDates ? 'Term start' : 'Start date'
    const [open, setOpen] = useState(false)
    const [title, setTitle] = useState('')
    const [newHandle, setNewHandle] = useState(handle ? `${handle}-copy` : '')
    const [start, setStart] = useState(termStart ?? '')
    const [copy, setCopy] = useState({ about: true, docs: true, files: true, sprints: true, assignments: true, channels: true, admins: false })
    const { pending, run, status } = useRun()
    return (
        <div>
            <p className={label}>Duplicate</p>
            <p className={help}>A new organization for the next term. Never members, workspaces, submissions, messages, posts, contributions or the join code.</p>
            {!open ? <Button className="mt-2" variant="outline" onClick={() => setOpen(true)}>Duplicate…</Button> : (
                <div className="mt-3 space-y-3">
                    <div className="grid gap-2 sm:grid-cols-3">
                        <Input aria-label="Name" placeholder="Name (e.g. CSE-3A 2027)" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
                        <Input aria-label="Organization URL" placeholder="your-organization" value={newHandle} onChange={(e) => setNewHandle(e.target.value)} />
                        <label className="text-xs text-muted-foreground">{startWord}<Input aria-label={startWord} type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1" /></label>
                    </div>
                    <fieldset className="space-y-1.5 text-sm">
                        <legend className="sr-only">What to copy</legend>
                        {COPY_ITEMS.map((item) => (
                            <label key={item.key} className="flex items-center gap-2">
                                <input type="checkbox" checked={copy[item.key]} onChange={(e) => setCopy({ ...copy, [item.key]: e.target.checked })} /> {item.text}
                            </label>
                        ))}
                    </fieldset>
                    <div className="flex items-center gap-3">
                        <Button disabled={pending || title.trim().length < 3 || title.trim().length > 100} onClick={() => run(() => duplicateOrgAction(orgId, { title, handle: newHandle, termStart: start || null, copy }), "Duplicating in the background. You’ll get a notification when it’s ready.", () => setOpen(false))}>Duplicate</Button>
                        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                        {status}
                    </div>
                </div>
            )}
        </div>
    )
}

function DeleteRow({ orgId, handle, preview }: { orgId: string; handle: string | null; preview: Preview | null }) {
    const [open, setOpen] = useState(false)
    const [confirm, setConfirm] = useState('')
    const [choices, setChoices] = useState<Record<string, 'keep' | 'delete'>>({})
    const { pending, run, status } = useRun()
    const rows = preview?.childProjects ?? []
    const deleted = rows.filter((w) => w.mine && choices[w.id] === 'delete').length
    return (
        <div>
            <p className={label}>Delete</p>
            <p className={help}>Hidden at once and removed for good after 30 days; you can restore it until then. Everyone gets an email with the date and a reminder to download their submissions.</p>
            {!open ? <Button className="mt-2" variant="destructive" onClick={() => setOpen(true)}>Delete…</Button> : (
                <div className="mt-3 space-y-3">
                    {preview ? <p className="text-sm text-foreground">{preview.members} members · {preview.files} files</p> : null}
                    {rows.length ? (
                        // Report §19.1, decision 29: one choice per workspace you lead; anyone else's is always kept.
                        <fieldset className="space-y-2 text-sm">
                            <legend className={label}>Workspaces</legend>
                            {rows.map((w) => (
                                <div key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                                    <span>{w.title}<span className="block text-[12px] text-muted-foreground">{w.lead} · {w.members} {w.members === 1 ? 'member' : 'members'} · {w.files} {w.files === 1 ? 'file' : 'files'}</span></span>
                                    {w.mine ? (
                                        <select aria-label={`What happens to ${w.title}`} value={choices[w.id] ?? 'keep'} onChange={(e) => setChoices({ ...choices, [w.id]: e.target.value as 'keep' | 'delete' })} className="h-8 rounded-md border border-border bg-background px-2 text-sm">
                                            <option value="keep">Keep as personal</option><option value="delete">Delete</option>
                                        </select>
                                    ) : <span className="text-[12px] text-muted-foreground">Kept · goes to {w.lead}</span>}
                                </div>
                            ))}
                        </fieldset>
                    ) : null}
                    <Records orgId={orgId} preview={preview} />
                    {preview ? <p className="text-sm">{rows.length - deleted} kept, {deleted} deleted, {preview.members} people notified.</p> : null}
                    <label className="block text-sm">Type <span className="font-mono font-semibold">{handle}</span> to confirm
                        <Input className="mt-1 max-w-xs" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Type the handle to confirm" />
                    </label>
                    <div className="flex items-center gap-3">
                        <Button variant="destructive" disabled={pending || confirm.trim().toLowerCase() !== (handle ?? '').toLowerCase()} onClick={() => run(() => deleteOrgAction(orgId, { confirmHandle: confirm, choices }), 'Scheduled for deletion.')}>Delete the organization</Button>
                        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                        {status}
                    </div>
                </div>
            )}
        </div>
    )
}

/** Ownership (report §45.2): Ask to take over when the owner has been away 30 days; the owner can refuse within 7. */
export function OrgOwnershipPanel({ orgId }: { orgId: string }) {
    const [state, setState] = useState<Awaited<ReturnType<typeof readTakeoverAction>> | null>(null)
    const { pending, run, status } = useRun()
    const identity = useIdentityStepUp('Confirm it’s you', 'Taking over an organization needs a recent check.')
    const load = () => void readTakeoverAction(orgId).then(setState)
    useEffect(load, [orgId])
    if (!state?.success || state.state === 'hidden') return null
    const day = (iso: string) => DATE.format(new Date(iso))
    return (
        <SettingsCard title="Ownership" headingLevel={2} description="When the owner has been away from the organization for 30 days.">
            {identity.dialog}
            <div className="space-y-2 text-sm">
                {state.state === 'can_ask' ? <><p>The owner hasn’t been active here for 30 days. You can ask to take over; they’ll have 7 days to refuse.</p><Button disabled={pending} onClick={() => run(askToTakeOverAction.bind(null, orgId), 'Asked. The owner has 7 days to refuse.', load)}>Ask to take over</Button></> : null}
                {state.state === 'asked_by_other' ? <p>Take-over asked by {state.by}.</p> : null}
                {state.state === 'waiting' ? <p>You asked to take over. The owner can refuse until {day(state.refuseBy)}.</p> : null}
                {state.state === 'ready' ? <><p>The owner didn’t refuse in 7 days.</p><Button disabled={pending} onClick={() => run(async () => (await identity.withIdentity(() => takeOverNowAction(orgId))) ?? { success: false as const, error: 'Stopped.' }, 'You own the organization now.', load)}>Take over now</Button></> : null}
                {state.state === 'owner_can_refuse' ? <><p>{state.by} asked to take over. If you don’t refuse by {day(state.refuseBy)}, they can.</p><Button variant="outline" disabled={pending} onClick={() => run(refuseTakeoverAction.bind(null, orgId), 'Refused.', load)}>Refuse</Button></> : null}
                {status}
            </div>
        </SettingsCard>
    )
}
