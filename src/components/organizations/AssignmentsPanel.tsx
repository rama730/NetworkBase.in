'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { ClipboardList, Plus, Shuffle, X } from 'lucide-react'

import {
    addAssignmentStepAction,
    approveAllSubmittedAction,
    closeAssignmentAction,
    createAssignmentAction,
    deleteAssignmentAction,
    excuseCopyAction,
    excuseTeamMemberAction,
    extendCopyAction,
    listAssignmentsAction,
    listProjectGroupCopiesAction,
    moveTeamMemberAction,
    publishAssignmentAction,
    readAssignmentComposerOptionsAction,
    readAssignmentRosterAction,
    readAssignmentTeamsAction,
    readReviewQueueAction,
    remindCopiesAction,
    reviewAssignmentCopyAction,
    submitAssignmentAction,
    type AssignmentRow,
    type GroupCopyRow,
    type ReviewQueueRow,
    type RosterRow,
} from '@/app/actions/assignments'
import { listOrgRosterAction, type OrgRosterPerson } from '@/app/actions/organizations'
import { listProjectDocsAction } from '@/app/actions/project/doc'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatDistanceToNow } from '@/lib/utils/date'
import { splitIntoTeams, type AssignmentTarget, type CopyState } from '@/lib/organizations/assignment-rules'

// Assignments in the org Tasks tab (report §16.2–16.5, §16.11) and group copies in a child project (§16.6).
// The Kanban board below stays as it is: members' own copies appear there through the read rule.

const DUE = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const STATE_LABEL: Record<CopyState, string> = {
    not_started: 'Not started', in_progress: 'In progress', submitted: 'Submitted', returned: 'Returned', done: 'Done', missing: 'Missing', excused: 'Excused',
}
const due = (iso: string | null) => (iso ? `due ${DUE.format(new Date(iso))}` : 'no due date')
const area = 'w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
const select = 'h-[var(--ui-control-height)] rounded-md border border-input bg-background px-2 text-sm'

function Status({ text, tone = 'draft' }: { text: string; tone?: string }) {
    return <span className="nb-status" data-status={tone}>{text}</span>
}

function countsLine(row: AssignmentRow) {
    const c = row.counts
    const parts = [`${c.done} of ${c.total} done`]
    if (c.submitted) parts.push(`${c.submitted} submitted`)
    if (c.missing) parts.push(`${c.missing} missing`)
    if (c.excused) parts.push(`${c.excused} excused`)
    return parts.join(' · ')
}

/** Submit dialog: a link or text, or a reminder to attach the file to the task (report §16.4). */
function SubmitDialog({ copyId, submissionType, title, open, onOpenChange, onDone, docsProjectId }: { copyId: string; submissionType: string; title: string; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void; docsProjectId?: string }) {
    const [link, setLink] = useState('')
    // Submit with a doc (report §19.7): a child project's doc becomes the submitted link.
    const [projectDocs, setProjectDocs] = useState<Array<{ slug: string; filename: string }>>([])
    useEffect(() => {
        if (!docsProjectId || submissionType !== 'link') return
        void listProjectDocsAction(docsProjectId).then((r) => setProjectDocs(r.success ? r.docs : []))
    }, [docsProjectId, submissionType])
    const [text, setText] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const submit = () => startTransition(async () => {
        const result = await submitAssignmentAction(copyId, submissionType === 'link' ? { link } : submissionType === 'text' ? { text } : {})
        if (!result.success) return setError(result.error)
        setError(null)
        onOpenChange(false)
        onDone()
    })
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Submit {title}</DialogTitle>
                    <DialogDescription>{submissionType === 'file' ? 'Attach your file to this task first (Tasks → open the card → Files), then submit.' : 'Hand in your work. You can resubmit until it is reviewed.'}</DialogDescription>
                </DialogHeader>
                {submissionType === 'link' ? <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" aria-label="Link to your work" /> : null}
                {submissionType === 'link' && projectDocs.length > 0 ? (
                    <select defaultValue="" aria-label="Or pick a project doc" className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                        onChange={(e) => { if (e.target.value) setLink(`${window.location.origin}/projects/${encodeURIComponent(docsProjectId!)}?tab=docs&doc=${encodeURIComponent(e.target.value)}`) }}>
                        <option value="">Or pick a project doc…</option>
                        {projectDocs.map((doc) => <option key={doc.slug} value={doc.slug}>{doc.filename}</option>)}
                    </select>
                ) : null}
                {submissionType === 'text' ? <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} maxLength={10000} className={area} aria-label="Your answer" /> : null}
                {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                <Button type="button" disabled={pending} onClick={submit}>Submit</Button>
            </DialogContent>
        </Dialog>
    )
}

type TeamBox = { name: string; people: OrgRosterPerson[]; leadId: string | null }

/** New assignment (report §16.2): who it goes to, submission, late rule, steps; Publish or Save as draft. */
function AssignmentComposer({ orgId, open, onOpenChange, onCreated }: { orgId: string; open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void }) {
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [dueLocal, setDueLocal] = useState('')
    const [sprintId, setSprintId] = useState('')
    const [submissionType, setSubmissionType] = useState<'none' | 'file' | 'link' | 'text'>('file')
    const [reviewRequired, setReviewRequired] = useState(true)
    const [lateRule, setLateRule] = useState<'none' | 'until' | 'always'>('always')
    const [lateUntilLocal, setLateUntilLocal] = useState('')
    const [mode, setMode] = useState<AssignmentTarget['mode']>('everyone')
    const [people, setPeople] = useState<string[]>([])
    const [teams, setTeams] = useState<TeamBox[]>([])
    const [childIds, setChildIds] = useState<string[]>([])
    const [teamSize, setTeamSize] = useState(3)
    const [steps, setSteps] = useState<string[]>([])
    // Also share in #general (report §25.5): off by default.
    const [shareToGeneral, setShareToGeneral] = useState(false)
    // Also post an announcement (report §17.2): off by default; the text is filled in from the assignment.
    const [announce, setAnnounce] = useState(false)
    const [announcement, setAnnouncement] = useState<string | null>(null)
    const [stepDraft, setStepDraft] = useState('')
    const [roster, setRoster] = useState<OrgRosterPerson[]>([])
    const [options, setOptions] = useState<{ children: Array<{ id: string; title: string }>; sprints: Array<{ id: string; name: string; status: string }>; teamAssignments?: Array<{ id: string; title: string }> }>({ children: [], sprints: [] })
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()

    useEffect(() => {
        if (!open) return
        void listOrgRosterAction(orgId, '').then(setRoster)
        void readAssignmentComposerOptionsAction(orgId).then((r) => {
            if (!r.success) return
            setOptions({ children: r.children, sprints: r.sprints, teamAssignments: r.teamAssignments })
            // A new assignment starts from the org's Work defaults (report §21.2 #5).
            setReviewRequired(r.defaults.reviewRequired)
            setLateRule(r.defaults.lateRule)
        })
    }, [open, orgId])

    const placed = new Set(teams.flatMap((t) => t.people.map((p) => p.userId)))
    const individuals = people.filter((id) => !placed.has(id))
    const preview = mode === 'everyone' ? 'One copy per member'
        : mode === 'role' ? 'One copy per admin'
            : mode === 'people' ? `Creates ${people.length} ${people.length === 1 ? 'copy' : 'copies'}`
                : mode === 'teams' ? `Creates ${teams.length + individuals.length} copies: ${teams.length} team ${teams.length === 1 ? 'copy' : 'copies'} (${placed.size} people) + ${individuals.length} individual`
                    : mode === 'each_child' ? `Creates ${options.children.length} assignments · one per workspace`
                        : `Creates ${childIds.length} assignments · one per workspace`

    const target = (): AssignmentTarget => mode === 'everyone' ? { mode }
        : mode === 'role' ? { mode, role: 'admin' }
            : mode === 'people' ? { mode, userIds: people }
                : mode === 'teams' ? { mode, teams: teams.map((t) => ({ name: t.name, userIds: t.people.map((p) => p.userId), leadId: t.leadId })), individuals }
                    : mode === 'each_child' ? { mode } : { mode: 'children', projectIds: childIds }

    const defaultAnnouncement = `${title.trim() || 'A new assignment'} is out${dueLocal ? ` · due ${new Date(dueLocal).toLocaleString('en', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}.`
    const save = (publish: boolean) => startTransition(async () => {
        if (!dueLocal) return setError('Pick a due date and time.')
        // Report §16.9: a past due date is allowed, after a check.
        if (publish && new Date(dueLocal).getTime() < Date.now() && !window.confirm('The due date has passed. Publish as already late?')) return
        const result = await createAssignmentAction({
            projectId: orgId, title, description, dueDate: new Date(dueLocal).toISOString(), sprintId: sprintId || null, publish,
            submissionType, reviewRequired, lateRule, lateUntil: lateRule === 'until' && lateUntilLocal ? new Date(lateUntilLocal).toISOString() : null,
            target: target(), steps, shareToGeneral,
            ...(publish && announce ? { announcement: (announcement ?? defaultAnnouncement).trim() } : {}),
        })
        if (!result.success) return setError(result.error)
        setError(null)
        onOpenChange(false)
        onCreated()
    })

    // Copy teams from an earlier assignment (report §16.11): same boxes, people still in the org only.
    const copyTeamsFrom = async (masterId: string) => {
        const r = await readAssignmentTeamsAction(masterId)
        if (!r.success) return setError(r.error)
        const boxes = r.teams.map((t) => ({ name: t.name, people: t.userIds.map((id) => roster.find((p) => p.userId === id)).filter((p): p is OrgRosterPerson => Boolean(p)), leadId: t.leadId }))
            .filter((t) => t.people.length > 0).map((t) => ({ ...t, leadId: t.people.some((p) => p.userId === t.leadId) ? t.leadId : t.people[0]!.userId }))
        setTeams(boxes)
        setPeople((cur) => [...new Set([...cur, ...boxes.flatMap((t) => t.people.map((p) => p.userId))])])
    }
    const moveBetweenTeams = (userId: string, from: number, to: number | null) => setTeams((cur) => {
        const person = cur[from]?.people.find((p) => p.userId === userId)
        if (!person) return cur
        return cur.map((t, i) => {
            if (i === from) { const rest = t.people.filter((p) => p.userId !== userId); return { ...t, people: rest, leadId: t.leadId === userId ? rest[0]?.userId ?? null : t.leadId } }
            if (i === to) return { ...t, people: [...t.people, person], leadId: t.leadId ?? person.userId }
            return t
        })
    })

    const autoMake = () => {
        const pool = roster.filter((p) => people.includes(p.userId))
        setTeams(splitIntoTeams(pool, teamSize).map((group, i) => ({ name: `Team ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`, people: group, leadId: group[0]?.userId ?? null })))
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>New assignment</DialogTitle>
                    <DialogDescription>Each person (or team, or project) gets their own copy to hand in.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <label className="block text-sm font-medium">Title<Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="mt-1" placeholder="Lab 1" /></label>
                    <label className="block text-sm font-medium">Brief<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={10000} className={`${area} mt-1`} /></label>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block text-sm font-medium">Due<Input type="datetime-local" value={dueLocal} onChange={(e) => setDueLocal(e.target.value)} className="mt-1" /></label>
                        <label className="block text-sm font-medium">Sprint
                            <select value={sprintId} onChange={(e) => setSprintId(e.target.value)} className={`${select} mt-1 w-full`}>
                                <option value="">No sprint</option>
                                {options.sprints.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === 'active' ? ' (running)' : ''}</option>)}
                            </select>
                        </label>
                    </div>

                    <fieldset className="space-y-2">
                        <legend className="text-sm font-medium">Assign to</legend>
                        <select value={mode} onChange={(e) => setMode(e.target.value as AssignmentTarget['mode'])} className={select} aria-label="Assign to">
                            <option value="everyone">Everyone (members)</option>
                            <option value="role">Admins</option>
                            <option value="people">Selected people</option>
                            <option value="teams">Teams</option>
                            <option value="each_child">Each project in the organization</option>
                            <option value="children">Selected projects</option>
                        </select>
                        {mode === 'people' || mode === 'teams' ? (
                            <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border" aria-label="People">
                                {roster.filter((p) => p.role !== 'viewer').map((p) => (
                                    <li key={p.userId}><label className="flex items-center gap-2 px-3 py-1.5 text-sm">
                                        <input type="checkbox" checked={people.includes(p.userId)} onChange={(e) => setPeople((cur) => e.target.checked ? [...cur, p.userId] : cur.filter((id) => id !== p.userId))} />
                                        {p.name}{p.title ? <span className="text-muted-foreground"> · {p.title}</span> : null}
                                    </label></li>
                                ))}
                            </ul>
                        ) : null}
                        {mode === 'teams' ? (
                            <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2 text-sm">
                                    <Button type="button" size="sm" variant="outline" onClick={() => setTeams((cur) => [...cur, { name: `Team ${String.fromCharCode(65 + cur.length)}`, people: [], leadId: null }])}><Plus className="size-3.5" aria-hidden="true" />Add team</Button>
                                    <span className="text-muted-foreground">or</span>
                                    <label className="flex items-center gap-1">Auto-make teams of <Input type="number" min={1} max={100} value={teamSize} onChange={(e) => setTeamSize(Number(e.target.value))} className="w-16" /></label>
                                    <Button type="button" size="sm" variant="outline" onClick={autoMake} disabled={people.length === 0}><Shuffle className="size-3.5" aria-hidden="true" />Make</Button>
                                    {options.teamAssignments?.length ? (
                                        <select value="" aria-label="Copy teams from" className={`${select} h-8 text-xs`} onChange={(e) => { if (e.target.value) void copyTeamsFrom(e.target.value) }}>
                                            <option value="">Copy teams from…</option>
                                            {options.teamAssignments.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
                                        </select>
                                    ) : null}
                                </div>
                                {teams.map((team, ti) => (
                                    <div key={ti} className="rounded-md border border-border p-2">
                                        <div className="flex items-center gap-2">
                                            <Input value={team.name} onChange={(e) => setTeams((cur) => cur.map((t, i) => (i === ti ? { ...t, name: e.target.value } : t)))} maxLength={60} className="h-8 w-40" aria-label="Team name" />
                                            <span className="text-xs text-muted-foreground">{team.people.length} people</span>
                                            <button type="button" aria-label={`Remove ${team.name}`} className="nb-icon-button ml-auto size-7" onClick={() => setTeams((cur) => cur.filter((_, i) => i !== ti))}><X className="size-3.5" aria-hidden="true" /></button>
                                        </div>
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                            {team.people.map((p) => (
                                                <span key={p.userId} className="inline-flex items-center gap-1 rounded-full border border-border py-0.5 pl-2 pr-1 text-xs">
                                                    <button type="button" title="Make team lead" aria-pressed={team.leadId === p.userId} aria-label={`${p.name}, ${team.leadId === p.userId ? 'team lead' : 'make team lead'}`} onClick={() => setTeams((cur) => cur.map((t, i) => (i === ti ? { ...t, leadId: p.userId } : t)))}>{p.name}{team.leadId === p.userId ? ' ★' : ''}</button>
                                                    <select value="" aria-label={`Move ${p.name} to…`} className="h-5 rounded border border-border bg-background text-[10px]" onChange={(e) => { const v = e.target.value; if (v) moveBetweenTeams(p.userId, ti, v === 'none' ? null : Number(v)) }}>
                                                        <option value="">Move to…</option>
                                                        {teams.map((t, i) => (i === ti ? null : <option key={i} value={String(i)}>{t.name}</option>))}
                                                        <option value="none">Not in a team</option>
                                                    </select>
                                                </span>
                                            ))}
                                            <select value="" aria-label={`Add to ${team.name}`} className={`${select} h-7 text-xs`} onChange={(e) => {
                                                const person = roster.find((p) => p.userId === e.target.value)
                                                if (person) setTeams((cur) => cur.map((t, i) => (i === ti ? { ...t, people: [...t.people, person], leadId: t.leadId ?? person.userId } : t)))
                                            }}>
                                                <option value="">+ Add person</option>
                                                {roster.filter((p) => people.includes(p.userId) && !placed.has(p.userId)).map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                ))}
                                {individuals.length > 0 ? <p className="text-xs text-muted-foreground">Not in a team (own copy): {roster.filter((p) => individuals.includes(p.userId)).map((p) => p.name).join(', ')}</p> : null}
                            </div>
                        ) : null}
                        {mode === 'children' ? (
                            <ul className="max-h-40 overflow-y-auto rounded-md border border-border" aria-label="Projects">
                                {options.children.map((c) => (
                                    <li key={c.id}><label className="flex items-center gap-2 px-3 py-1.5 text-sm">
                                        <input type="checkbox" checked={childIds.includes(c.id)} onChange={(e) => setChildIds((cur) => e.target.checked ? [...cur, c.id] : cur.filter((id) => id !== c.id))} />{c.title}
                                    </label></li>
                                ))}
                            </ul>
                        ) : null}
                    </fieldset>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block text-sm font-medium">Submission
                            <select value={submissionType} onChange={(e) => setSubmissionType(e.target.value as typeof submissionType)} className={`${select} mt-1 w-full`}>
                                <option value="file">A file</option><option value="link">A link</option><option value="text">Text</option><option value="none">No submission</option>
                            </select>
                        </label>
                        <label className="block text-sm font-medium">Late submissions
                            <select value={lateRule} onChange={(e) => setLateRule(e.target.value as typeof lateRule)} className={`${select} mt-1 w-full`}>
                                <option value="always">Always allowed</option><option value="until">Allowed until a date</option><option value="none">Not allowed</option>
                            </select>
                        </label>
                    </div>
                    {lateRule === 'until' ? <label className="block text-sm font-medium">Late work accepted until<Input type="datetime-local" value={lateUntilLocal} onChange={(e) => setLateUntilLocal(e.target.value)} className="mt-1" /></label> : null}
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={reviewRequired} onChange={(e) => setReviewRequired(e.target.checked)} />Review required (Approve or Return each submission)</label>

                    <div className="space-y-2">
                        <p className="text-sm font-medium">Steps <span className="font-normal text-muted-foreground">(copied into every copy)</span></p>
                        <ol className="list-decimal space-y-1 pl-5 text-sm">
                            {steps.map((step, i) => <li key={i}>{step} <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setSteps((cur) => cur.filter((_, j) => j !== i))}>remove</button></li>)}
                        </ol>
                        <div className="flex gap-2">
                            <Input value={stepDraft} onChange={(e) => setStepDraft(e.target.value)} placeholder="Write tests" maxLength={200} aria-label="New step" />
                            <Button type="button" variant="outline" onClick={() => { if (stepDraft.trim()) { setSteps((cur) => [...cur, stepDraft.trim()]); setStepDraft('') } }}>Add</Button>
                        </div>
                    </div>

                    <p className="text-sm text-muted-foreground" role="status">{preview}</p>
                    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <span className="mr-auto flex flex-wrap items-center gap-3 text-sm">
                            <label className="flex items-center gap-1.5"><input type="checkbox" checked={shareToGeneral} onChange={(e) => setShareToGeneral(e.target.checked)} /> Also share in #general</label>
                            <label className="flex items-center gap-1.5"><input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} /> Also post an announcement</label>
                        </span>
                        {announce ? <textarea value={announcement ?? defaultAnnouncement} onChange={(e) => setAnnouncement(e.target.value)} rows={2} maxLength={5000} aria-label="Announcement" className={`${area} basis-full`} /> : null}
                        <Button type="button" variant="outline" disabled={pending} onClick={() => save(false)}>Save as draft</Button>
                        <Button type="button" disabled={pending || !title.trim()} onClick={() => save(true)}>Publish</Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

/** One assignment's roster: per person or team, with Approve / Return / Extend / Excuse (report §16.5). */
export function RosterDialog({ row, orgId, open, onOpenChange, onChanged }: { row: AssignmentRow; orgId?: string; open: boolean; onOpenChange: (open: boolean) => void; onChanged: () => void }) {
    const [rows, setRows] = useState<RosterRow[]>([])
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const load = useCallback(() => void readAssignmentRosterAction(row.masterId).then((r) => { if (r.success) setRows(r.rows) }), [row.masterId])
    useEffect(() => { if (open) load() }, [open, load])
    const run = (action: () => Promise<{ success: boolean; error?: string }>) => startTransition(async () => {
        const result = await action()
        setError(result.success ? null : result.error ?? 'Something went wrong.')
        load()
        onChanged()
    })
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{row.title}</DialogTitle>
                    <DialogDescription>{due(row.dueDate)} · {countsLine(row)}</DialogDescription>
                </DialogHeader>
                <div className="flex flex-wrap gap-2">
                    {row.counts.submitted > 0 ? <Button type="button" size="sm" disabled={pending} onClick={() => run(() => approveAllSubmittedAction(row.masterId))}>Approve all submitted</Button> : null}
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(async () => { const r = await remindCopiesAction(row.masterId); return r.success ? { success: true } : r })}>Remind everyone not done</Button>
                    {/* Brief and shared Q&A live on the master task (report §16.4 Conversation, §16.5 Brief / Discussion). */}
                    {/* Download all (report §23.5): one folder per person or team, latest handed-in files. */}
                    {orgId && row.submissionType === 'file' && row.counts.submitted + row.counts.done > 0 ? <Button asChild size="sm" variant="outline"><a href={`/api/v1/projects/${orgId}/tasks/${row.masterId}/submissions`} download>Download all</a></Button> : null}
                    <a href={`?tab=tasks&drawerType=task&drawerId=${row.masterId}`} className="self-center text-sm text-primary underline-offset-4 hover:underline">Brief and Q&amp;A</a>
                </div>
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const input = e.currentTarget.elements.namedItem('step') as HTMLInputElement; const value = input.value.trim(); if (value) run(async () => { const r = await addAssignmentStepAction(row.masterId, value); if (r.success) input.value = ''; return r }) }}>
                    <Input name="step" placeholder="Add a step to every copy" maxLength={200} aria-label="Add a step to every copy" className="h-8" />
                    <Button type="submit" size="sm" variant="outline" disabled={pending}>Add step</Button>
                </form>
                <ul className="divide-y divide-border" aria-label="Roster">
                    {rows.map((r) => {
                        const submission = r.submission as { link?: string | null; text?: string | null } | null
                        return (
                            <li key={r.copyId} className="space-y-1 py-2 text-sm">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-medium">{r.label}</span>
                                    {r.people?.length ? <span className="text-muted-foreground">· {r.people.map((p) => `${p.name}${p.lead ? ' ★' : ''}`).join(' · ')}</span>
                                        : r.members.length ? <span className="text-muted-foreground">· {r.members.join(' · ')}</span> : null}
                                    {r.submittedBy ? <span className="text-muted-foreground">· Submitted by {r.submittedBy}</span> : null}
                                    <Status text={STATE_LABEL[r.state] + (r.late ? ' · Late' : '')} tone={r.state === 'done' ? 'completed' : r.state === 'missing' ? 'archived' : r.state === 'submitted' ? 'active' : 'draft'} />
                                </div>
                                {submission?.link ? <a href={submission.link} target="_blank" rel="noreferrer noopener" className="break-all text-primary underline">{submission.link}</a> : null}
                                {submission?.text ? <p className="whitespace-pre-line rounded-md bg-muted px-2 py-1">{submission.text}</p> : null}
                                {r.excusedReason ? <p className="text-muted-foreground">Excused: {r.excusedReason}</p> : null}
                                <div className="flex flex-wrap gap-2">
                                    {r.state === 'submitted' ? (
                                        <>
                                            <Button type="button" size="sm" disabled={pending} onClick={() => run(() => reviewAssignmentCopyAction(r.copyId, 'approve'))}>Approve</Button>
                                            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => {
                                                const reason = window.prompt('What should they change?')
                                                if (reason) run(() => reviewAssignmentCopyAction(r.copyId, 'return', reason))
                                            }}>Return</Button>
                                        </>
                                    ) : null}
                                    <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => {
                                        const value = window.prompt('New due date (YYYY-MM-DD HH:MM)', r.dueDate ? r.dueDate.slice(0, 16).replace('T', ' ') : '')
                                        if (value) run(() => extendCopyAction(r.copyId, new Date(value.replace(' ', 'T')).toISOString()))
                                    }}>Extend</Button>
                                    <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => {
                                        if (r.state === 'excused') return run(() => excuseCopyAction(r.copyId, null))
                                        const reason = window.prompt('Why is this person excused?')
                                        if (reason) run(() => excuseCopyAction(r.copyId, reason))
                                    }}>{r.state === 'excused' ? 'Un-excuse' : 'Excuse'}</Button>
                                    {r.state !== 'done' && r.state !== 'excused' && r.state !== 'submitted' ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(async () => { const res = await remindCopiesAction(row.masterId, [r.copyId]); return res.success ? { success: true } : res })}>Remind</Button> : null}
                                </div>
                                {r.people?.length && r.state !== 'submitted' && r.state !== 'done' ? (
                                    <div className="flex flex-wrap gap-2 text-xs">
                                        {r.people.map((p) => (
                                            <span key={p.id} className="inline-flex items-center gap-1">
                                                <select value="" aria-label={`Move ${p.name} to…`} className="h-7 rounded border border-border bg-background px-1 text-xs" disabled={pending}
                                                    onChange={(e) => { const v = e.target.value; if (!v) return; if (v === 'excuse') { const reason = window.prompt(`Why is ${p.name} excused?`); if (reason) run(() => excuseTeamMemberAction(r.copyId, p.id, reason)); return } run(() => moveTeamMemberAction(row.masterId, p.id, v === 'own' ? null : v)) }}>
                                                    <option value="">{p.name}…</option>
                                                    {rows.filter((o) => o.copyId !== r.copyId && o.people && o.state !== 'submitted' && o.state !== 'done').map((o) => <option key={o.copyId} value={o.copyId}>Move to {o.label}</option>)}
                                                    <option value="own">Own copy</option>
                                                    <option value="excuse">Excuse {p.name}</option>
                                                </select>
                                            </span>
                                        ))}
                                    </div>
                                ) : null}
                            </li>
                        )
                    })}
                </ul>
                {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            </DialogContent>
        </Dialog>
    )
}

/** The org Tasks tab's Assignments view: admins manage, members hand in, guests see counts. */
export function AssignmentsPanel({ orgId, onBoardChanged, startComposing = false, onComposingStarted }: { orgId: string; onBoardChanged?: () => void; startComposing?: boolean; onComposingStarted?: () => void }) {
    const [data, setData] = useState<{ isAdmin: boolean; rows: AssignmentRow[]; timeZone?: string | null } | null>(null)
    const [composing, setComposing] = useState(false)
    const [roster, setRoster] = useState<AssignmentRow | null>(null)
    const [submitting, setSubmitting] = useState<AssignmentRow | null>(null)
    const [reviewing, setReviewing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const load = useCallback(() => void listAssignmentsAction(orgId).then((r) => setData(r.success ? { isAdmin: r.isAdmin, rows: r.rows, timeZone: r.timeZone } : null)), [orgId])
    useEffect(() => { load() }, [load])
    // + New → Assignment from the org header (report §18.2).
    useEffect(() => {
        if (!startComposing || !data) return
        if (data.isAdmin) setComposing(true)
        onComposingStarted?.()
    }, [startComposing, data, onComposingStarted])
    const refresh = useCallback(() => { load(); onBoardChanged?.() }, [load, onBoardChanged])
    const run = (action: () => Promise<{ success: boolean; error?: string }>) => startTransition(async () => {
        const result = await action()
        setError(result.success ? null : result.error ?? 'Something went wrong.')
        refresh()
    })
    const rows = useMemo(() => data?.rows ?? [], [data])
    if (!data || (!data.isAdmin && rows.length === 0)) return null

    return (
        <section aria-labelledby="org-assignments-heading" className="mb-5 rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="org-assignments-heading" className="nb-card-title flex items-center gap-2"><ClipboardList className="size-4" aria-hidden="true" />{data.isAdmin ? 'Assignments' : 'My assignments'}</h2>
                {data.isAdmin ? (
                    <span className="flex gap-2">
                        <Button type="button" size="sm" variant={reviewing ? 'default' : 'outline'} aria-pressed={reviewing} onClick={() => setReviewing(!reviewing)}>Review</Button>
                        <Button type="button" size="sm" onClick={() => setComposing(true)}><Plus className="size-3.5" aria-hidden="true" />New assignment</Button>
                    </span>
                ) : null}
            </div>
            {reviewing ? <ReviewQueue orgId={orgId} onChanged={refresh} /> : null}
            {rows.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No assignments yet. Give everyone (or teams, or each project) their own copy to hand in.</p> : null}
            <ul className="mt-3 divide-y divide-border">
                {rows.map((row) => (
                    <li key={row.masterId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                        <span className="font-medium">{row.title}</span>
                        <span className="text-muted-foreground" title={orgTime(row.dueDate, data.timeZone)}>{due(row.dueDate)}{row.teams ? ' · Teams' : ''}</span>
                        {row.status !== 'open' ? <Status text={row.status === 'draft' ? 'Draft' : 'Closed'} tone={row.status === 'draft' ? 'draft' : 'archived'} /> : null}
                        {row.mine ? (
                            <>
                                <Status text={STATE_LABEL[row.mine.state] + (row.mine.late ? ' · Late' : '')} tone={row.mine.state === 'done' ? 'completed' : row.mine.state === 'missing' ? 'archived' : 'active'} />
                                {row.mine.teamName ? <span className="text-muted-foreground">{row.mine.teamName}</span> : null}
                                {row.mine.returnedReason ? <span className="basis-full text-[13px] text-muted-foreground">Returned: {row.mine.returnedReason}</span> : null}
                                {['not_started', 'in_progress', 'returned', 'missing', 'submitted'].includes(row.mine.state) && row.status === 'open' ? (
                                    <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => setSubmitting(row)}>{row.mine.state === 'submitted' ? 'Resubmit' : 'Submit'}</Button>
                                ) : null}
                            </>
                        ) : (
                            <span className="text-muted-foreground">{countsLine(row)}{row.people ? ` · ${row.people.done} of ${row.people.total} people` : ''}</span>
                        )}
                        {data.isAdmin ? (
                            <span className="ml-auto flex flex-wrap gap-1">
                                {row.status === 'draft' ? <Button type="button" size="sm" disabled={pending} onClick={() => run(() => publishAssignmentAction(row.masterId))}>Publish</Button> : null}
                                {row.status !== 'draft' ? <Button type="button" size="sm" variant="outline" onClick={() => setRoster(row)}>Roster</Button> : null}
                                {row.status === 'open' ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => closeAssignmentAction(row.masterId))}>Close</Button> : null}
                                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { if (window.confirm(`Delete ${row.title}?`)) run(() => deleteAssignmentAction(row.masterId)) }}>Delete</Button>
                            </span>
                        ) : null}
                    </li>
                ))}
            </ul>
            {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
            {data.isAdmin ? <AssignmentComposer orgId={orgId} open={composing} onOpenChange={setComposing} onCreated={refresh} /> : null}
            {roster ? <RosterDialog row={roster} orgId={orgId} open onOpenChange={(open) => { if (!open) setRoster(null) }} onChanged={load} /> : null}
            {submitting?.mine ? <SubmitDialog copyId={submitting.mine.copyId} submissionType={submitting.submissionType} title={submitting.title} open onOpenChange={(open) => { if (!open) setSubmitting(null) }} onDone={refresh} /> : null}
        </section>
    )
}

/** In a child project: the org's group assignment copies, "From CSE-3A", with Submit for whoever holds them (report §16.6). */
export function GroupCopiesPanel({ projectId, onBoardChanged }: { projectId: string; onBoardChanged?: () => void }) {
    const [rows, setRows] = useState<GroupCopyRow[]>([])
    const [submitting, setSubmitting] = useState<GroupCopyRow | null>(null)
    const load = useCallback(() => void listProjectGroupCopiesAction(projectId).then((r) => setRows(r.success ? r.rows : [])), [projectId])
    useEffect(() => { load() }, [load])
    if (rows.length === 0) return null
    return (
        <section aria-label="From the organization" className="mb-5 rounded-lg border border-border bg-card p-4">
            <ul className="divide-y divide-border">
                {rows.map((row) => (
                    <li key={row.copyId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                        <Status text={`From ${row.orgTitle}`} tone="active" />
                        <span className="font-medium">{row.title}</span>
                        <span className="text-muted-foreground">{due(row.dueDate)} · Reviewed by {row.orgTitle}</span>
                        <Status text={STATE_LABEL[row.state] + (row.late ? ' · Late' : '')} tone={row.state === 'done' ? 'completed' : 'draft'} />
                        {row.canSubmit && ['not_started', 'in_progress', 'returned', 'missing', 'submitted'].includes(row.state) ? (
                            <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => setSubmitting(row)}>{row.state === 'submitted' ? 'Resubmit' : 'Submit for the project'}</Button>
                        ) : null}
                    </li>
                ))}
            </ul>
            {submitting ? <SubmitDialog copyId={submitting.copyId} submissionType={submitting.submissionType} title={submitting.title} open onOpenChange={(open) => { if (!open) setSubmitting(null) }} onDone={() => { load(); onBoardChanged?.() }} docsProjectId={projectId} /> : null}
        </section>
    )
}

/** Org time on hover (report §15.8): everyone reads their own time; the org's zone is one hover away. */
function orgTime(iso: string | null, timeZone?: string | null) {
    if (!iso || !timeZone) return undefined
    try { return `${new Intl.DateTimeFormat('en', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso))} (organization time)` } catch { return undefined }
}

/** The marking inbox (report §16.4–16.5): oldest first; Approve or Return, then Next. */
function ReviewQueue({ orgId, onChanged }: { orgId: string; onChanged: () => void }) {
    const [rows, setRows] = useState<ReviewQueueRow[] | null>(null)
    const [index, setIndex] = useState(0)
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)
    const load = useCallback(() => void readReviewQueueAction(orgId).then((r) => { setRows(r.success ? r.rows : []); if (!r.success) setError(r.error) }), [orgId])
    useEffect(() => { load() }, [load])
    if (!rows) return <p className="mt-3 text-sm text-muted-foreground">Loading submissions…</p>
    if (rows.length === 0) return <p className="mt-3 text-sm text-muted-foreground">Nothing waiting for review.</p>
    const current = rows[Math.min(index, rows.length - 1)]!
    const decide = (decision: 'approve' | 'return') => {
        const reason = decision === 'return' ? window.prompt('What should they change?') : undefined
        if (decision === 'return' && !reason) return
        startTransition(async () => {
            const r = await reviewAssignmentCopyAction(current.copyId, decision, reason ?? undefined)
            setError(r.success ? null : r.error)
            if (r.success) { setRows(rows.filter((x) => x.copyId !== current.copyId)); onChanged() }
        })
    }
    return (
        <section aria-label="To review" className="mt-3 space-y-2 rounded-md border border-border p-3 text-sm">
            <p className="text-xs text-muted-foreground">{Math.min(index, rows.length - 1) + 1} of {rows.length} waiting</p>
            <p><span className="font-medium">{current.who}</span> · {current.title} · {formatDistanceToNow(new Date(current.submittedAt), { addSuffix: true })}{current.late ? ' · Late' : ''}{current.submittedBy ? ` · submitted by ${current.submittedBy}` : ''}</p>
            <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={pending} onClick={() => decide('approve')}>Approve</Button>
                <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => decide('return')}>Return</Button>
                <a href={`?tab=tasks&drawerType=task&drawerId=${current.copyId}`} className="self-center text-primary underline-offset-4 hover:underline">Open</a>
                <Button type="button" size="sm" variant="ghost" className="ml-auto" disabled={rows.length < 2} onClick={() => setIndex((index + 1) % rows.length)}>Next</Button>
            </div>
            {error ? <p role="alert" className="text-destructive">{error}</p> : null}
        </section>
    )
}
