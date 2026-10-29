'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'

import { transferProjectOwnership } from '@/app/actions/account'
import { archiveOrgAction, deleteOrgAction, duplicateOrgAction, readOrgLifecyclePreviewAction, restoreOrgAction, unarchiveOrgAction } from '@/app/actions/org-lifecycle'
import { readOrgMembersAction } from '@/app/actions/org-members'
import { SettingsCard } from '@/components/projects/settings/SettingsFormFields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { OrgDetail } from '@/lib/organizations/detail'

// The owner's danger zone for an organization (report §30.5): Transfer (admins only, two steps), Archive or
// Unarchive, Duplicate, Delete with a 30-day grace (and Restore while it lasts).

const label = 'nb-ui-label text-sm font-semibold text-foreground'
const help = 'nb-compact mt-0.5 text-xs text-muted-foreground'
const DATE = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })
type Preview = { children: number; members: number; files: number; sprints: number; childProjects: Array<{ id: string; title: string }> }

function useRun() {
    const router = useRouter()
    const [pending, start] = useTransition()
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
    const run = (action: () => Promise<{ success: boolean; error?: string }>, ok: string, after?: () => void) => start(async () => {
        const result = await action()
        setMessage(result.success ? { ok: true, text: ok } : { ok: false, text: result.error ?? 'Couldn’t finish that.' })
        if (result.success) { after?.(); router.refresh() }
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
        <SettingsCard title="Organization management" headingLevel={2} danger description="Ownership, archive, duplicate and delete. Each one asks before it changes anything.">
            <div className="space-y-8">
                <TransferRow orgId={orgId} admins={admins} />
                <ArchiveRow orgId={orgId} archived={organization.archived} preview={preview} />
                <DuplicateRow orgId={orgId} handle={handle} termStart={organization.termStart} />
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
                <Button disabled={pending} onClick={() => run(() => restoreOrgAction(orgId), 'Restored. Detached workspaces stay personal; they can move back in.')}>Restore</Button>
                {status}
            </div>
        </SettingsCard>
    )
}

function TransferRow({ orgId, admins }: { orgId: string; admins: Array<{ userId: string; name: string }> }) {
    const [target, setTarget] = useState('')
    const [confirming, setConfirming] = useState(false)
    const { pending, run, status } = useRun()
    const name = admins.find((a) => a.userId === target)?.name
    return (
        <div>
            <p className={label}>Transfer ownership</p>
            <p className={help}>Only to an existing admin. You stay an admin.</p>
            {admins.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Make someone an admin first.</p> : (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select aria-label="New owner" value={target} onChange={(e) => { setTarget(e.target.value); setConfirming(false) }} className="h-9 rounded-[5px] border border-border bg-background px-2 text-sm">
                        <option value="">Choose an admin</option>
                        {admins.map((a) => <option key={a.userId} value={a.userId}>{a.name}</option>)}
                    </select>
                    {!confirming
                        ? <Button variant="outline" disabled={!target} onClick={() => setConfirming(true)}>Transfer…</Button>
                        : <Button variant="destructive" disabled={pending} onClick={() => run(() => transferProjectOwnership(orgId, target), `${name} owns the organization now.`)}>Yes, make {name} the owner</Button>}
                    {status}
                </div>
            )}
        </div>
    )
}

function ArchiveRow({ orgId, archived, preview }: { orgId: string; archived: boolean; preview: Preview | null }) {
    const [confirming, setConfirming] = useState(false)
    const { pending, run, status } = useRun()
    return (
        <div>
            <p className={label}>{archived ? 'Unarchive' : 'Archive'}</p>
            <p className={help}>{archived
                ? 'Everything opens again with a new join code (off until you switch it on). Sprints never start late.'
                : 'Everything becomes read-only: the join code turns off, reminders and digests stop, and messages are read-only. Members keep read access and you are asked to verify contributions.'}</p>
            {!archived && confirming && preview ? (
                <p className="mt-2 text-sm text-foreground">{preview.children} {preview.children === 1 ? 'workspace is' : 'workspaces are'} archived with it; {preview.sprints} planned or active {preview.sprints === 1 ? 'sprint stops' : 'sprints stop'}; {preview.members} members are told by email.</p>
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
    { key: 'docs', text: 'Docs' },
    { key: 'files', text: 'Folders and admin files (never submissions)' },
    { key: 'sprints', text: 'Sprint plan, with dates moved to the new term' },
    { key: 'assignments', text: 'Assignments as drafts, with dates moved' },
    { key: 'channels', text: 'Channel names and topics' },
    { key: 'admins', text: 'Invite the current admins' },
] as const

function DuplicateRow({ orgId, handle, termStart }: { orgId: string; handle: string | null; termStart: string | null }) {
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
                        <Input aria-label="Name" placeholder="Name (e.g. CSE-3A 2027)" value={title} onChange={(e) => setTitle(e.target.value)} />
                        <Input aria-label="Handle" placeholder="handle" value={newHandle} onChange={(e) => setNewHandle(e.target.value)} />
                        <Input aria-label="Term start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
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
                        <Button disabled={pending || title.trim().length < 2} onClick={() => run(() => duplicateOrgAction(orgId, { title, handle: newHandle, termStart: start || null, copy }), "Duplicating in the background. You’ll get a notification when it’s ready.", () => setOpen(false))}>Duplicate</Button>
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
    const [childMode, setChildMode] = useState<'detach' | 'delete'>('detach')
    const { pending, run, status } = useRun()
    return (
        <div>
            <p className={label}>Delete</p>
            <p className={help}>Hidden at once and removed for good after 30 days; you can restore it until then. Everyone gets an email with the date and a reminder to download their submissions.</p>
            {!open ? <Button className="mt-2" variant="destructive" onClick={() => setOpen(true)}>Delete…</Button> : (
                <div className="mt-3 space-y-3">
                    {preview ? <p className="text-sm text-foreground">{preview.children} child {preview.children === 1 ? 'project' : 'projects'} · {preview.members} members · {preview.files} files</p> : null}
                    {preview && preview.children > 0 ? (
                        <fieldset className="space-y-1.5 text-sm">
                            <legend className={label}>Workspaces in this organization</legend>
                            <label className="flex items-center gap-2"><input type="radio" name="org-delete-children" checked={childMode === 'detach'} onChange={() => setChildMode('detach')} /> Give them to their leads as personal workspaces (now)</label>
                            <label className="flex items-center gap-2"><input type="radio" name="org-delete-children" checked={childMode === 'delete'} onChange={() => setChildMode('delete')} /> Delete them with the organization (same 30 days)</label>
                        </fieldset>
                    ) : null}
                    <label className="block text-sm">Type <span className="font-mono font-semibold">{handle}</span> to confirm
                        <Input className="mt-1 max-w-xs" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Type the handle to confirm" />
                    </label>
                    <div className="flex items-center gap-3">
                        <Button variant="destructive" disabled={pending || confirm.trim().toLowerCase() !== (handle ?? '').toLowerCase()} onClick={() => run(() => deleteOrgAction(orgId, { confirmHandle: confirm, childMode }), 'Scheduled for deletion.')}>Delete the organization</Button>
                        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                        {status}
                    </div>
                </div>
            )}
        </div>
    )
}
