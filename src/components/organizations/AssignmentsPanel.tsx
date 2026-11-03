'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { ClipboardList, Plus, Shuffle, X } from 'lucide-react'

import {
    addAssignmentStepAction,
    approveAllSubmittedAction,
    autoMakeGroupsAction,
    closeAssignmentAction,
    createAssignmentAction,
    deleteAssignmentAction,
    excuseCopyAction,
    excuseTeamMemberAction,
    extendCopiesAction,
    extendCopyAction,
    giveCopyAction,
    listAssignmentsAction,
    listWorkspaceGroupCopiesAction,
    moveTeamMemberAction,
    publishAssignmentAction,
    readAssignmentComposerOptionsAction,
    readAssignmentExportAction,
    readAssignmentForReuseAction,
    readAssignmentMaterialsAction,
    readAssignmentRosterAction,
    readAssignmentTeamsAction,
    readReviewQueueAction,
    remindCopiesAction,
    removeCopyAction,
    reopenAssignmentAction,
    returnCopiesAction,
    reviewAssignmentCopyAction,
    scheduleAssignmentAction,
    searchAssignmentMaterialsAction,
    submitAssignmentAction,
    updateAssignmentAction,
    type AssignmentRow,
    type GroupCopyRow,
    type ReviewQueueRow,
    type RosterRow,
} from '@/app/actions/assignments'
import { listOrgRosterAction, type OrgRosterPerson } from '@/app/actions/organizations'
import { listWorkspaceDocsAction } from '@/app/actions/workspace/doc'
import { createTaskCommentAction } from '@/app/actions/task-comment'
import { approveTaskReviewAction, requestTaskChangesAction } from '@/app/actions/task'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatDistanceToNow } from '@/lib/utils/date'
import { defaultFixBy, deleteAssignmentWarning, webLink, type AssignmentTarget, type CopyState } from '@/lib/organizations/assignment-rules'
import { DownloadLink } from '@/components/ui/download-link'
import { remindSummary } from '@/lib/organizations/member-rules'
import { toast } from '@/lib/feedback'
import { cn } from '@/lib/utils'
import { ASSIGNMENT_STATE_LABELS } from '@/lib/copy/terms'
import { EditAssignmentDialog, ExcuseDialog, ExtendDialog, GiveToDialog, ReturnDialog, ReviewersPicker } from '@/components/organizations/AssignmentDialogs'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ReasonDialog } from '@/components/organizations/ReasonDialog'
import { ClassQuestions } from '@/components/organizations/ClassQuestions'
import { saveBlob, toCsvBlob } from '@/lib/download'
import { zonedInputToIso, zoneName } from '@/lib/organizations/zoned-time'
import { docTitle } from '@/lib/organizations/doc-rules'
import { useAuth } from '@/hooks/use-auth'
import { userTopic } from '@/lib/messaging/constants'
import { subscribeBroadcast } from '@/lib/realtime/private-broadcast'

// Assignments in the org Tasks tab (report §16.2–16.5, §16.11) and group copies in a child project (§16.6).
// The Kanban board below stays as it is: members' own copies appear there through the read rule.

const DUE = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const STATE_LABEL: Record<CopyState, string> = ASSIGNMENT_STATE_LABELS
const due = (iso: string | null) => (iso ? `due ${DUE.format(new Date(iso))}` : 'no due date')
const area = 'w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
const select = 'h-[var(--ui-control-height)] rounded-md border border-input bg-background px-2 text-sm'

function Status({ text, tone = 'draft' }: { text: string; tone?: string }) {
    return <span className="nb-status" data-status={tone}>{text}</span>
}

function countsLine(row: AssignmentRow) {
    const c = row.counts
    // Parity wording 17: with nobody to give it to, say why instead of "0 of 0 done".
    if (c.total === 0 && row.status !== 'draft') return 'Nobody has it yet. People get it when they join.'
    const parts = [`${c.done} of ${c.total} done`]
    if (c.submitted) parts.push(`${c.submitted} submitted`)
    if (c.missing) parts.push(`${c.missing} missing`)
    if (c.excused) parts.push(`${c.excused} excused`)
    return parts.join(' · ')
}

/** Submit dialog: a link or text, or a reminder to attach the file to the task (report §16.4). */
/** A date as a datetime-local value in the viewer's own zone. */
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)

function SubmitDialog({ copyId, submissionType, title, open, onOpenChange, onDone, docsProjectId }: { copyId: string; submissionType: string; title: string; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void; docsProjectId?: string }) {
    const [link, setLink] = useState('')
    // Submit with a doc (report §19.7): a child project's doc becomes the submitted link.
    const [projectDocs, setProjectDocs] = useState<Array<{ slug: string; filename: string }>>([])
    useEffect(() => {
        if (!docsProjectId || submissionType !== 'link') return
        void listWorkspaceDocsAction(docsProjectId).then((r) => setProjectDocs(r.success ? r.docs : []))
    }, [docsProjectId, submissionType])
    const [text, setText] = useState('')
    const [note, setNote] = useState('')
    // Decision 128: the main assignment's materials, read only.
    const [materials, setMaterials] = useState<Array<{ nodeId: string; name: string }>>([])
    useEffect(() => { if (open) void readAssignmentMaterialsAction(copyId).then((r) => setMaterials(r.success ? r.materials : [])) }, [copyId, open])
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const submit = () => startTransition(async () => {
        // Decision 85: an optional note goes with any hand-in.
        const withNote = note.trim() ? { note: note.trim() } : {}
        const result = await submitAssignmentAction(copyId, submissionType === 'link' ? { link, ...withNote } : submissionType === 'text' ? { text, ...withNote } : withNote)
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
                    <DialogDescription>{submissionType === 'file' ? 'Attach your file to this task first (Tasks → open the card → Files), then submit.' : 'Submit your work. You can resubmit until it is reviewed.'}</DialogDescription>
                </DialogHeader>
                {materials.length ? (
                    <div className="text-sm"><p className="font-medium">Materials</p>
                        <ul className="mt-1 space-y-0.5">{materials.map((m) => <li key={m.nodeId}><a href={`?tab=files&fileId=${encodeURIComponent(m.nodeId)}`} className="text-primary underline-offset-4 hover:underline">{m.name}</a></li>)}</ul>
                    </div>
                ) : null}
                {submissionType === 'link' ? <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" aria-label="Link to your work" /> : null}
                {submissionType === 'link' && projectDocs.length > 0 ? (
                    <select defaultValue="" aria-label="Or pick a workspace doc" className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                        onChange={(e) => { if (e.target.value) setLink(`${window.location.origin}/workspaces/${encodeURIComponent(docsProjectId!)}?tab=docs&doc=${encodeURIComponent(e.target.value)}`) }}>
                        <option value="">Or pick a workspace doc…</option>
                        {projectDocs.map((doc) => <option key={doc.slug} value={doc.slug}>{docTitle(doc.filename)}</option>)}
                    </select>
                ) : null}
                {submissionType === 'text' ? <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} maxLength={10000} className={area} aria-label="Your answer" /> : null}
                <label className="block space-y-1 text-sm"><span className="font-medium">Add a note (optional)</span>
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className={area} placeholder="I used the second dataset" />
                </label>
                {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                <Button type="button" disabled={pending} onClick={submit}>Submit</Button>
            </DialogContent>
        </Dialog>
    )
}

/**
 * Live roster and queue (report §32.4, decision 76): a new submission reaches admins as a notice, so a notice on their
 * own topic reloads the list, combined over 2 seconds.
 */
function useReloadOnNotice(reload: () => void) {
    const viewerId = useAuth().user?.id
    const latest = useRef(reload)
    latest.current = reload
    useEffect(() => {
        if (!viewerId) return
        let timer: ReturnType<typeof setTimeout> | null = null
        const live = subscribeBroadcast(userTopic(viewerId), (event) => {
            if (event === 'notification.changed' && !timer) timer = setTimeout(() => { timer = null; latest.current() }, 2_000)
        })
        return () => { live.unsubscribe(); if (timer) clearTimeout(timer) }
    }, [viewerId])
}

type TeamBox = { name: string; people: OrgRosterPerson[]; leadId: string | null }

type ComposerPrefill = { title: string; description: string; mode: AssignmentTarget['mode'] }

/** New assignment in its own dialog: Use again, and the card's panel. */
export function AssignmentComposer({ orgId, open, onOpenChange, onCreated, reuseFrom = null, timeZone = null }: { orgId: string; open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void; reuseFrom?: string | null; timeZone?: string | null }) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>New assignment</DialogTitle>
                    <DialogDescription>Each person (or team, or workspace) gets their own assignment to submit.</DialogDescription>
                </DialogHeader>
                <AssignmentFields orgId={orgId} onDone={() => onOpenChange(false)} onCreated={onCreated} reuseFrom={reuseFrom} timeZone={timeZone} />
            </DialogContent>
        </Dialog>
    )
}

/**
 * The assignment's fields (report §16.2): who it goes to, hand-in, late rule, steps; Publish or Save as draft.
 * New task shows them in place when "Assign to" is many people (problem 5), with "One person · a task" to go back.
 */
export function AssignmentFields({ orgId, onDone, onCreated, reuseFrom = null, prefill = null, timeZone = null, onBackToTask }: { orgId: string; onDone: () => void; onCreated: () => void; reuseFrom?: string | null; prefill?: ComposerPrefill | null; timeZone?: string | null; onBackToTask?: (carry: { title: string; description: string }) => void }) {
    // Decision 74: dates are entered in the organization's time zone, and the form says which.
    const at = (local: string) => zonedInputToIso(local, timeZone)
    const zone = zoneName(timeZone)
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [dueLocal, setDueLocal] = useState('')
    // Repeat weekly until (report §33.5): later weeks are made as drafts to check before publishing.
    const [repeatUntil, setRepeatUntil] = useState('')
    const [sprintId, setSprintId] = useState('')
    const [submissionType, setSubmissionType] = useState<'none' | 'file' | 'link' | 'text'>('file')
    const [reviewRequired, setReviewRequired] = useState(true)
    const [admins, setAdmins] = useState<Array<{ id: string; name: string }>>([])
    const [reviewers, setReviewers] = useState<string[]>([])
    const [lateRule, setLateRule] = useState<'none' | 'until' | 'always'>('always')
    const [lateUntilLocal, setLateUntilLocal] = useState('')
    const [lateAfter, setLateAfter] = useState(15)
    // Publish timing (decision 125) and Materials (decision 128).
    const [when, setWhen] = useState<'now' | 'sprint' | 'date' | 'draft'>('now')
    const [publishLocal, setPublishLocal] = useState('')
    const [materials, setMaterials] = useState<Array<{ id: string; name: string; adminsOnly: boolean }>>([])
    const [materialQuery, setMaterialQuery] = useState('')
    const [materialResults, setMaterialResults] = useState<Array<{ id: string; name: string; adminsOnly: boolean }>>([])
    useEffect(() => {
        if (!materialQuery.trim()) return setMaterialResults([])
        const timer = setTimeout(() => void searchAssignmentMaterialsAction(orgId, materialQuery).then((r) => setMaterialResults(r.success ? r.files : [])), 250)
        return () => clearTimeout(timer)
    }, [orgId, materialQuery])
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
    const [lateAsk, setLateAsk] = useState(false)
    const [pending, startTransition] = useTransition()

    useEffect(() => {
        void listOrgRosterAction(orgId, '').then(setRoster)
        void readAssignmentComposerOptionsAction(orgId).then((r) => {
            if (!r.success) return
            setOptions({ children: r.children, sprints: r.sprints, teamAssignments: r.teamAssignments })
            setAdmins(r.admins ?? [])
            // A new assignment starts from the org's Work defaults (report §21.2 #5).
            setReviewRequired(r.defaults.reviewRequired)
            setLateRule(r.defaults.lateRule)
            // New task with many people (decision 10): the text typed there comes along.
            if (prefill) { setTitle(prefill.title); setDescription(prefill.description); setMode(prefill.mode) }
            // Use again (report §33.5): the form filled in from an earlier assignment, with new dates to choose.
            if (reuseFrom) void readAssignmentForReuseAction(reuseFrom).then((again) => {
                if (!again.success) return
                const f = again.form
                setTitle(f.title); setDescription(f.description); setSubmissionType(f.submissionType as typeof submissionType); setReviewRequired(f.reviewRequired)
                setLateRule(f.lateRule as typeof lateRule); setLateAfter(f.lateAfterMinutes); setSteps(f.steps); setDueLocal('')
                setMaterials(f.materials.map((m) => ({ ...m, adminsOnly: false })))
                if (f.target.mode === 'people') { setMode('people'); setPeople(f.target.userIds) } else if (f.target.mode === 'everyone' || f.target.mode === 'each_child') setMode(f.target.mode)
            })
        })
    }, [orgId, reuseFrom])

    const placed = new Set(teams.flatMap((t) => t.people.map((p) => p.userId)))
    const individuals = people.filter((id) => !placed.has(id))
    const preview = mode === 'everyone' ? 'One assignment per member'
        : mode === 'role' ? 'One assignment per admin'
            : mode === 'people' ? `Creates ${people.length} ${people.length === 1 ? 'assignment' : 'assignments'}`
                : mode === 'teams' ? `Creates ${teams.length + individuals.length} assignments: ${teams.length} team ${teams.length === 1 ? 'assignment' : 'assignments'} (${placed.size} people) + ${individuals.length} individual`
                    : mode === 'each_child' ? `Creates ${options.children.length} assignments · one per workspace`
                        : `Creates ${childIds.length} assignments · one per workspace`

    const target = (): AssignmentTarget => mode === 'everyone' ? { mode }
        : mode === 'role' ? { mode, role: 'admin' }
            : mode === 'people' ? { mode, userIds: people }
                : mode === 'teams' ? { mode, teams: teams.map((t) => ({ name: t.name, userIds: t.people.map((p) => p.userId), leadId: t.leadId })), individuals }
                    : mode === 'each_child' ? { mode } : { mode: 'children', projectIds: childIds }

    const defaultAnnouncement = `${title.trim() || 'A new assignment'} is out${dueLocal ? ` · due ${new Date(dueLocal).toLocaleString('en', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}.`
    const save = (late = false) => startTransition(async () => {
        const publish = when === 'now'
        if (!dueLocal) return setError('Pick a due date and time.')
        if (lateRule === 'until' && !lateUntilLocal) return setError('Pick the last day late work is accepted.')
        if (when === 'date' && !publishLocal) return setError('Pick when to publish.')
        // Report §16.9: a past due date is allowed, after a check.
        if (publish && !late && new Date(at(dueLocal)).getTime() < Date.now()) return setLateAsk(true)
        const result = await createAssignmentAction({
            projectId: orgId, title, description, dueDate: at(dueLocal), sprintId: sprintId || null, publish,
            submissionType, reviewRequired, lateRule, lateUntil: lateRule === 'until' && lateUntilLocal ? at(lateUntilLocal) : null,
            target: target(), steps, shareToGeneral, lateAfterMinutes: lateAfter, materials: materials.map((m) => m.id),
            ...(reviewRequired && reviewers.length ? { reviewers } : {}),
            schedule: when === 'date' ? { at: at(publishLocal) } : when === 'sprint' ? { sprintStart: true } : null,
            ...(publish && announce ? { announcement: (announcement ?? defaultAnnouncement).trim() } : {}),
            ...(repeatUntil ? { repeatWeeklyUntil: at(`${repeatUntil}T23:59`) } : {}),
        })
        if (!result.success) return setError(result.error)
        // Student check 17: say it worked, and to how many.
        // Student check 24: a team assignment with nobody in the teams reaches no one, and says so.
        if (publish && result.copies === 0) toast.warning(`Published ${title.trim()}, but nobody got a copy: no one is in what you picked yet.`)
        else toast.success(publish ? `Published ${title.trim()}: ${result.copies} ${result.copies === 1 ? 'copy' : 'copies'} handed out.` : `Saved ${title.trim()}.`)
        if (result.drafts) toast.success(`${result.drafts} more ${result.drafts === 1 ? 'week is' : 'weeks are'} saved as drafts to check before publishing.`)
        setError(null)
        setRepeatUntil('')
        onDone()
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

    // Decision 64: made on the server, which quietly keeps blocked pairs apart.
    const autoMake = () => void autoMakeGroupsAction(orgId, people, teamSize).then((r) => {
        if (!r.success) return setError(r.error)
        const byId = new Map(roster.map((p) => [p.userId, p]))
        setTeams(r.groups.map((ids, i) => {
            const group = ids.map((id) => byId.get(id)).filter((p): p is OrgRosterPerson => Boolean(p))
            return { name: `Team ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`, people: group, leadId: group[0]?.userId ?? null }
        }))
    })

    return (
            <>
                <div className="space-y-4">
                    <label className="block text-sm font-medium">Title<Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="mt-1" placeholder="Lab 1" /></label>
                    <label className="block text-sm font-medium">Instructions<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={10000} className={`${area} mt-1`} /></label>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                            <label className="block text-sm font-medium">Due <span className="font-normal text-muted-foreground">({zone})</span><Input type="datetime-local" value={dueLocal} onChange={(e) => setDueLocal(e.target.value)} className="mt-1" /></label>
                            <label className="flex flex-wrap items-center gap-2 text-[13px]">
                                <input type="checkbox" checked={Boolean(repeatUntil)} disabled={!dueLocal} onChange={(e) => setRepeatUntil(e.target.checked ? new Date(new Date(dueLocal).getTime() + 28 * 86_400_000).toISOString().slice(0, 10) : '')} />
                                Repeat weekly until
                                {repeatUntil ? <Input type="date" value={repeatUntil} min={dueLocal.slice(0, 10)} onChange={(e) => setRepeatUntil(e.target.value)} className="h-8 w-auto" aria-label="Repeat until" /> : null}
                            </label>
                        </div>
                        <label className="block text-sm font-medium">Sprint
                            <select value={sprintId} onChange={(e) => setSprintId(e.target.value)} className={`${select} mt-1 w-full`}>
                                <option value="">No sprint</option>
                                {options.sprints.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === 'active' ? ' (running)' : ''}</option>)}
                            </select>
                        </label>
                    </div>

                    <fieldset className="space-y-2">
                        <legend className="text-sm font-medium">Assign to</legend>
                        <select value={mode} onChange={(e) => e.target.value === 'task' ? onBackToTask?.({ title, description }) : setMode(e.target.value as AssignmentTarget['mode'])} className={select} aria-label="Assign to">
                            {onBackToTask ? <option value="task">One person · a task</option> : null}
                            <option value="everyone">Everyone (members)</option>
                            <option value="role">Admins</option>
                            <option value="people">Selected people</option>
                            <option value="teams">Teams</option>
                            <option value="each_child">Each workspace in the organization</option>
                            <option value="children">Selected workspaces</option>
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
                                {individuals.length > 0 ? <p className="text-xs text-muted-foreground">Not in a team (own assignment): {roster.filter((p) => individuals.includes(p.userId)).map((p) => p.name).join(', ')}</p> : null}
                            </div>
                        ) : null}
                        {mode === 'children' ? (
                            <ul className="max-h-40 overflow-y-auto rounded-md border border-border" aria-label="Workspaces">
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
                            <select value={lateRule} onChange={(e) => {
                                const next = e.target.value as typeof lateRule
                                setLateRule(next)
                                // Starts 7 days after the due date (report §42.10 problem 13); still required.
                                if (next === 'until' && !lateUntilLocal && dueLocal) setLateUntilLocal(toLocalInput(new Date(new Date(dueLocal).getTime() + 7 * 86_400_000)))
                            }} className={`${select} mt-1 w-full`}>
                                <option value="always">Always allowed</option><option value="until">Allowed until a date</option><option value="none">Not allowed</option>
                            </select>
                        </label>
                    </div>
                    {lateRule === 'until' ? <label className="block text-sm font-medium">Late work accepted until<Input type="datetime-local" required value={lateUntilLocal} onChange={(e) => setLateUntilLocal(e.target.value)} className="mt-1" /></label> : null}
                    {/* Report §45.3, decision 171: members still see the due time; Late counts from due + this. */}
                    <label className="flex items-center gap-2 text-sm font-medium">Late after
                        <Input type="number" min={0} max={60} value={lateAfter} onChange={(e) => setLateAfter(Math.max(0, Math.min(60, Number(e.target.value) || 0)))} className="w-20" aria-label="Late after, in minutes" />
                        <span className="font-normal text-muted-foreground">minutes past the due time</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={reviewRequired} onChange={(e) => setReviewRequired(e.target.checked)} />Review required (Approve or Return each submission)</label>
                    {reviewRequired ? <ReviewersPicker admins={admins} value={reviewers} onChange={setReviewers} className="text-sm" /> : null}

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

                    <div className="space-y-2">
                        <p className="text-sm font-medium">Materials <span className="font-normal text-muted-foreground">(read only on every copy)</span></p>
                        {materials.length ? (
                            <ul className="flex flex-wrap gap-1.5">
                                {materials.map((m) => (
                                    <li key={m.id} className="inline-flex items-center gap-1 rounded-full border border-border py-0.5 pl-2 pr-1 text-xs">
                                        {m.name}{m.adminsOnly ? <span className="text-amber-700 dark:text-amber-400"> · Admins only</span> : null}
                                        <button type="button" aria-label={`Remove ${m.name}`} className="nb-icon-button size-5" onClick={() => setMaterials((cur) => cur.filter((x) => x.id !== m.id))}><X className="size-3" aria-hidden="true" /></button>
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                        <Input value={materialQuery} onChange={(e) => setMaterialQuery(e.target.value)} placeholder="Search this organization’s files" aria-label="Search files for materials" className="h-8" />
                        {materialResults.length ? (
                            <ul className="max-h-36 divide-y divide-border overflow-y-auto rounded-md border border-border text-sm" aria-label="Files">
                                {materialResults.filter((f) => !materials.some((m) => m.id === f.id)).map((f) => (
                                    <li key={f.id}><button type="button" className="w-full px-3 py-1.5 text-left hover:bg-muted/50" onClick={() => { setMaterials((cur) => [...cur, f]); setMaterialQuery('') }}>
                                        {f.name}
                                        {/* Decision 137: say so before an Admins-only file becomes a material. */}
                                        {f.adminsOnly ? <span className="block text-xs text-amber-700 dark:text-amber-400">Admins only. Members won’t be able to open this.</span> : null}
                                    </button></li>
                                ))}
                            </ul>
                        ) : null}
                    </div>

                    <p className="text-sm text-muted-foreground" role="status">{preview}</p>
                    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <span className="mr-auto flex flex-wrap items-center gap-3 text-sm">
                            <label className="flex items-center gap-1.5"><input type="checkbox" checked={shareToGeneral} onChange={(e) => setShareToGeneral(e.target.checked)} /> Also share in #general</label>
                            <label className="flex items-center gap-1.5"><input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} /> Also post an announcement</label>
                        </span>
                        {announce ? <textarea value={announcement ?? defaultAnnouncement} onChange={(e) => setAnnouncement(e.target.value)} rows={2} maxLength={5000} aria-label="Announcement" className={`${area} basis-full`} /> : null}
                        {/* Publish timing (report §42.5, decision 125). */}
                        <select value={when} onChange={(e) => setWhen(e.target.value as typeof when)} aria-label="When to publish" className={select}>
                            <option value="now">Publish now</option>
                            {sprintId ? <option value="sprint">When the sprint starts</option> : null}
                            <option value="date">On a date</option>
                            <option value="draft">Save as draft</option>
                        </select>
                        {when === 'date' ? <Input type="datetime-local" required value={publishLocal} onChange={(e) => setPublishLocal(e.target.value)} aria-label="Publish on" className="w-auto" /> : null}
                        <Button type="button" disabled={pending || !title.trim()} onClick={() => save()}>
                            {/* Report §44.3: publishing to many takes a few seconds, so it says so. */}
                            {pending ? (when === 'now' ? 'Publishing…' : 'Saving…') : when === 'now' ? 'Publish' : when === 'draft' ? 'Save as draft' : 'Schedule'}
                        </Button>
                    </div>
                </div>
                <ConfirmDialog open={lateAsk} onOpenChange={setLateAsk} title="The due date has passed" description="Publish it as already late?"
                    confirmLabel="Publish as late" onConfirm={() => save(true)} />
            </>
    )
}

/** One assignment's roster: per person or team, with Approve / Return / Extend / Excuse (report §16.5). */
export function RosterDialog({ row, orgId, open, onOpenChange, onChanged, timeZone = null }: { row: AssignmentRow; orgId?: string; open: boolean; onOpenChange: (open: boolean) => void; onChanged: () => void; timeZone?: string | null }) {
    const [rows, setRows] = useState<RosterRow[]>([])
    const [withoutCopy, setWithoutCopy] = useState<Array<{ userId: string; name: string }>>([])
    const [closed, setClosed] = useState(false)
    const [ask, setAsk] = useState<{ kind: 'return' | 'change' | 'extend' | 'excuse' | 'remove'; row: RosterRow } | { kind: 'give' | 'bulk-return' | 'bulk-extend' } | null>(null)
    const [teamExcuse, setTeamExcuse] = useState<{ copyId: string; userId: string; name: string } | null>(null)
    const [picked, setPicked] = useState<Set<string>>(new Set())
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const load = useCallback(() => void readAssignmentRosterAction(row.masterId).then((r) => { if (r.success) { setRows(r.rows); setWithoutCopy(r.withoutCopy); setClosed(r.closed) } }), [row.masterId])
    useEffect(() => { if (open) load() }, [open, load])
    useReloadOnNotice(() => { if (open) load() })
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
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(async () => { const r = await remindCopiesAction(row.masterId); if (r.success) toast.success(remindSummary(r)); return r.success ? { success: true } : r })}>Remind everyone not done</Button>
                    {/* Brief and shared Q&A live on the master task (report §16.4 Conversation, §16.5 Brief / Discussion). */}
                    {/* Download all (report §23.5): one folder per person or team, latest handed-in files. */}
                    {orgId && row.submissionType === 'file' && row.counts.submitted + row.counts.done > 0 ? <Button asChild size="sm" variant="outline"><DownloadLink href={`/api/v1/workspaces/${orgId}/tasks/${row.masterId}/submissions`}>Download all</DownloadLink></Button> : null}
                    {withoutCopy.length ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setAsk({ kind: 'give' })}>Give to…</Button> : null}
                    {/* Report §33.5, decision 83: statuses and dates only. */}
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => startTransition(async () => {
                        const r = await readAssignmentExportAction(row.masterId)
                        if (!r.success) return setError(r.error)
                        saveBlob(toCsvBlob(r.rows), `${row.title.replace(/[^\w-]+/g, '-').slice(0, 60)}-progress.csv`)
                    })}>Export CSV</Button>
                    <a href={`?tab=tasks&drawerType=task&drawerId=${row.masterId}`} className="self-center text-sm text-primary underline-offset-4 hover:underline">Brief and Q&amp;A</a>
                </div>
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const input = e.currentTarget.elements.namedItem('step') as HTMLInputElement; const value = input.value.trim(); if (value) run(async () => { const r = await addAssignmentStepAction(row.masterId, value); if (r.success) input.value = ''; return r }) }}>
                    <Input name="step" placeholder="Add a step to every assignment" maxLength={200} aria-label="Add a step to every assignment" className="h-8" />
                    <Button type="submit" size="sm" variant="outline" disabled={pending}>Add step</Button>
                </form>
                {picked.size ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 p-2 text-sm" role="group" aria-label="Selected">
                        <span className="font-medium">{picked.size} selected</span>
                        <Button type="button" size="sm" disabled={pending} onClick={() => run(async () => {
                            let approved = 0
                            for (const id of picked) if ((await reviewAssignmentCopyAction(id, 'approve')).success) approved += 1
                            toast.success(`Approved ${approved}. Each person is told.`)
                            setPicked(new Set())
                            return { success: true }
                        })}>Approve selected</Button>
                        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setAsk({ kind: 'bulk-return' })}>Return selected</Button>
                        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setAsk({ kind: 'bulk-extend' })}>Extend for {picked.size}</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
                    </div>
                ) : null}
                <ul className="divide-y divide-border" aria-label="Roster">
                    {rows.map((r) => {
                        const submission = r.submission as { link?: string | null; text?: string | null } | null
                        return (
                            <li key={r.copyId} className="space-y-1 py-2 text-sm">
                                <div className="flex flex-wrap items-center gap-2">
                                    <input type="checkbox" aria-label={`Select ${r.label}`} checked={picked.has(r.copyId)} onChange={(e) => setPicked((cur) => { const next = new Set(cur); if (e.target.checked) next.add(r.copyId); else next.delete(r.copyId); return next })} />
                                    <span className="font-medium">{r.label}</span>
                                    {r.people?.length ? <span className="text-muted-foreground">· {r.people.map((p) => `${p.name}${p.lead ? ' ★' : ''}`).join(' · ')}</span>
                                        : r.members.length ? <span className="text-muted-foreground">· {r.members.join(' · ')}</span> : null}
                                    {r.submittedBy ? <span className="text-muted-foreground">· Submitted by {r.submittedBy}</span> : null}
                                    <Status text={STATE_LABEL[r.state] + (r.late ? ' · Late' : '')} tone={r.state === 'done' ? 'completed' : r.state === 'missing' ? 'archived' : r.state === 'submitted' ? 'active' : 'draft'} />
                                </div>
                                {webLink(submission?.link) ? <a href={webLink(submission?.link)!} target="_blank" rel="noreferrer noopener" className="break-all text-primary underline">{submission!.link}</a> : submission?.link ? <span className="break-all">{submission.link}</span> : null}
                                {submission?.text ? <p className="whitespace-pre-line rounded-md bg-muted px-2 py-1">{submission.text}</p> : null}
                                {r.excusedReason ? <p className="text-muted-foreground">Excused: {r.excusedReason}</p> : null}
                                <div className="flex flex-wrap gap-2">
                                    {r.state === 'submitted' ? (
                                        <>
                                            <Button type="button" size="sm" disabled={pending} onClick={() => run(() => reviewAssignmentCopyAction(r.copyId, 'approve'))}>Approve</Button>
                                            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setAsk({ kind: 'return', row: r })}>Return</Button>
                                        </>
                                    ) : null}
                                    {/* Decision 40: approved work can be returned while the assignment is open. */}
                                    {r.approved && !closed ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setAsk({ kind: 'change', row: r })}>Change decision</Button> : null}
                                    <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setAsk({ kind: 'extend', row: r })}>Extend</Button>
                                    <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => {
                                        if (r.state === 'excused') return run(() => excuseCopyAction(r.copyId, null))
                                        setAsk({ kind: 'excuse', row: r })
                                    }}>{r.state === 'excused' ? 'Un-excuse' : 'Excuse'}</Button>
                                    {r.state !== 'done' && r.state !== 'excused' && r.state !== 'submitted' ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(async () => { const res = await remindCopiesAction(row.masterId, [r.copyId]); if (res.success) toast.success(remindSummary(res)); return res.success ? { success: true } : res })}>Remind</Button> : null}
                                    {/* Report §34.6: Remove only for a copy nobody has started. */}
                                    {r.state === 'not_started' && !r.submission ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setAsk({ kind: 'remove', row: r })}>Remove</Button> : null}
                                </div>
                                {r.people?.length && r.state !== 'submitted' && r.state !== 'done' ? (
                                    <div className="flex flex-wrap gap-2 text-xs">
                                        {r.people.map((p) => (
                                            <span key={p.id} className="inline-flex items-center gap-1">
                                                <select value="" aria-label={`Move ${p.name} to…`} className="h-7 rounded border border-border bg-background px-1 text-xs" disabled={pending}
                                                    onChange={(e) => { const v = e.target.value; if (!v) return; if (v === 'excuse') { setTeamExcuse({ copyId: r.copyId, userId: p.id, name: p.name }); return } run(() => moveTeamMemberAction(row.masterId, p.id, v === 'own' ? null : v)) }}>
                                                    <option value="">{p.name}…</option>
                                                    {rows.filter((o) => o.copyId !== r.copyId && o.people && o.state !== 'submitted' && o.state !== 'done').map((o) => <option key={o.copyId} value={o.copyId}>Move to {o.label}</option>)}
                                                    <option value="own">Own assignment</option>
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
                {/* Report §25.7, decision 47: late joiners on group work, with Add to group or Own copy. */}
                {row.teams && withoutCopy.length ? (
                    <section aria-label="Not in a group" className="space-y-1 border-t border-border pt-2 text-sm">
                        <p className="font-medium">Not in a group · {withoutCopy.length}</p>
                        <ul className="space-y-1">
                            {withoutCopy.map((p) => (
                                <li key={p.userId} className="flex flex-wrap items-center gap-2">
                                    {p.name}
                                    <select value="" aria-label={`Add ${p.name} to a group`} className="h-7 rounded border border-border bg-background px-1 text-xs" disabled={pending}
                                        onChange={(e) => { const v = e.target.value; if (v) run(() => moveTeamMemberAction(row.masterId, p.userId, v === 'own' ? null : v)) }}>
                                        <option value="">Add to group…</option>
                                        {rows.filter((o) => o.people && o.state !== 'submitted' && o.state !== 'done').map((o) => <option key={o.copyId} value={o.copyId}>{o.label}</option>)}
                                        <option value="own">Own copy</option>
                                    </select>
                                </li>
                            ))}
                        </ul>
                    </section>
                ) : null}
                {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                <ReturnDialog timeZone={timeZone} label={ask && 'row' in ask ? ask.row.label : ''} change={ask?.kind === 'change'} open={ask?.kind === 'return' || ask?.kind === 'change'} onClose={() => setAsk(null)}
                    onReturn={(reason, fixBy) => { if (ask && 'row' in ask) { const copyId = ask.row.copyId; const change = ask.kind === 'change'; run(() => reviewAssignmentCopyAction(copyId, 'return', reason, undefined, { fixBy, change })) } }} />
                <ExtendDialog timeZone={timeZone} label={ask && 'row' in ask ? ask.row.label : ''} currentDue={ask && 'row' in ask ? ask.row.dueDate : null} closed={closed} open={ask?.kind === 'extend'} onClose={() => setAsk(null)}
                    onExtend={(due, reopen) => { if (ask && 'row' in ask) { const copyId = ask.row.copyId; run(() => extendCopyAction(copyId, due, { reopen })) } }} />
                <ExcuseDialog label={ask && 'row' in ask ? ask.row.label : ''} open={ask?.kind === 'excuse'} onClose={() => setAsk(null)}
                    onExcuse={(reason) => { if (ask && 'row' in ask) { const copyId = ask.row.copyId; run(() => excuseCopyAction(copyId, reason)) } }} />
                <GiveToDialog timeZone={timeZone} people={withoutCopy} open={ask?.kind === 'give'} onClose={() => setAsk(null)} onGive={(userId, due) => run(() => giveCopyAction(row.masterId, userId, due))} />
                <ReturnDialog timeZone={timeZone} label={`${picked.size} people`} open={ask?.kind === 'bulk-return'} onClose={() => setAsk(null)}
                    onReturn={(reason, fixBy) => run(async () => { const r = await returnCopiesAction([...picked], reason, fixBy); if (r.success) { toast.success(`Returned ${r.returned}${r.skipped ? `. ${r.skipped} weren’t waiting for review.` : '.'}`); setPicked(new Set()) } return r })} />
                <ExtendDialog timeZone={timeZone} label={`${picked.size} people`} currentDue={row.dueDate} closed={closed} open={ask?.kind === 'bulk-extend'} onClose={() => setAsk(null)}
                    onExtend={(due, reopen) => run(async () => { const r = await extendCopiesAction([...picked], due, { reopen }); if (r.success) setPicked(new Set()); return r })} />
                <ConfirmDialog open={ask?.kind === 'remove'} onOpenChange={(v) => { if (!v) setAsk(null) }} variant="destructive"
                    title={`Remove ${ask && 'row' in ask ? ask.row.label : ''}’s copy?`} description="They haven’t started it. It leaves their list, and they’re told."
                    confirmLabel="Remove" onConfirm={() => { if (ask && 'row' in ask) { const copyId = ask.row.copyId; run(() => removeCopyAction(copyId)) } setAsk(null) }} />
                <ReasonDialog open={Boolean(teamExcuse)} onOpenChange={(v) => { if (!v) setTeamExcuse(null) }} title={`Excuse ${teamExcuse?.name ?? ''}?`}
                    label={`Why is ${teamExcuse?.name ?? 'this person'} excused?`} confirmLabel="Excuse" required
                    onConfirm={(reason) => { if (teamExcuse) run(() => excuseTeamMemberAction(teamExcuse.copyId, teamExcuse.userId, reason)) }} />
            </DialogContent>
        </Dialog>
    )
}

/** In a child project: the org's group assignment copies, "From CSE-3A", with Submit for whoever holds them (report §16.6). */
export function GroupCopiesPanel({ projectId, onBoardChanged }: { projectId: string; onBoardChanged?: () => void }) {
    const [rows, setRows] = useState<GroupCopyRow[]>([])
    const [submitting, setSubmitting] = useState<GroupCopyRow | null>(null)
    const load = useCallback(() => void listWorkspaceGroupCopiesAction(projectId).then((r) => setRows(r.success ? r.rows : [])), [projectId])
    useEffect(() => { load() }, [load])
    if (rows.length === 0) return null
    return (
        <section aria-label={`From ${rows[0]!.orgTitle}`} className="mb-5 rounded-lg border border-border bg-card p-4">
            <ul className="divide-y divide-border">
                {rows.map((row) => (
                    <li key={row.copyId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                        <Status text={`From ${row.orgTitle}`} tone="active" />
                        <span className="font-medium">{row.title}</span>
                        <span className="text-muted-foreground">{due(row.dueDate)} · Reviewed by {row.orgTitle}</span>
                        <Status text={STATE_LABEL[row.state] + (row.late ? ' · Late' : '')} tone={row.state === 'done' ? 'completed' : 'draft'} />
                        {row.canSubmit && ['not_started', 'in_progress', 'returned', 'missing', 'submitted'].includes(row.state) ? (
                            <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => setSubmitting(row)}>{row.state === 'submitted' ? 'Resubmit' : 'Submit for the workspace'}</Button>
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
/**
 * The review queue (report §23.2): one submission at a time, oldest first, with what was handed in. Approve opens the
 * next; Return asks for a reason and Fix by right here. Keys A, R, J, K and Esc, never while typing.
 */
export function ReviewQueue({ orgId, onChanged, onClose }: { orgId: string; onChanged: () => void; onClose?: () => void }) {
    const [rows, setRows] = useState<ReviewQueueRow[] | null>(null)
    const [total, setTotal] = useState(0)
    const [index, setIndex] = useState(0)
    const [assignment, setAssignment] = useState('all')
    const [lateOnly, setLateOnly] = useState(false)
    // Reviewers (report §33.5): Mine is the work you review, plus anything nobody was picked for.
    const [mineOnly, setMineOnly] = useState(false)
    const [returning, setReturning] = useState(false)
    const [reason, setReason] = useState('')
    const [fixBy, setFixBy] = useState('')
    const [note, setNote] = useState('')
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)
    const load = useCallback(() => void readReviewQueueAction(orgId).then((r) => { setRows(r.success ? r.rows : []); setTotal(r.success ? r.total : 0); if (!r.success) setError(r.error) }), [orgId])
    useEffect(() => { load() }, [load])
    useReloadOnNotice(load)
    const shown = useMemo(() => (rows ?? []).filter((r) => (assignment === 'all' || r.masterId === assignment) && (!lateOnly || r.late) && (!mineOnly || r.mine)), [rows, assignment, lateOnly, mineOnly])
    const current = shown[Math.min(index, Math.max(0, shown.length - 1))] ?? null
    const step = (by: number) => { setReturning(false); setIndex((i) => (shown.length ? (i + by + shown.length) % shown.length : 0)) }
    const decide = (decision: 'approve' | 'return') => {
        if (!current) return
        if (decision === 'return' && !returning) { setReturning(true); setReason(''); setFixBy(toLocalInput(defaultFixBy())); return }
        if (decision === 'return' && !reason.trim()) return setError('Say what to change.')
        startTransition(async () => {
            // An ordinary board task uses the task's own review (problem 33); a copy uses the assignment's.
            const r: { success: true } | { success: false; error: string } = current.kind === 'task'
                ? await (decision === 'approve' ? approveTaskReviewAction(current.copyId, current.projectId, current.updatedAt) : requestTaskChangesAction(current.copyId, current.projectId, reason.trim(), current.updatedAt))
                    .then((x) => (x.success ? { success: true as const } : { success: false as const, error: ('error' in x && x.error) || 'Couldn’t save that. Try again.' }))
                : await reviewAssignmentCopyAction(current.copyId, decision, decision === 'return' ? reason.trim() : undefined,
                    { projectId: current.projectId, updatedAt: current.updatedAt }, decision === 'return' && fixBy ? { fixBy: new Date(fixBy).toISOString() } : {})
            if (!r.success) {
                // "Already reviewed by Priya" moves on; a new version reloads to show it (23.2 awkward cases).
                setError(r.error.startsWith('This changed') ? `${current.who} sent a new version. Showing it now.` : r.error)
                if (r.error.startsWith('Already reviewed')) { setRows((cur) => (cur ?? []).filter((x) => x.copyId !== current.copyId)); setTotal((t) => Math.max(0, t - 1)) }
                else load()
                return
            }
            if (decision === 'approve' && note.trim()) await createTaskCommentAction(current.copyId, current.projectId, note.trim()).catch(() => undefined)
            setError(null); setNote(''); setReturning(false)
            // Live loop 31, 32: the count follows the queue, and each decision says it happened.
            setRows((cur) => (cur ?? []).filter((x) => x.copyId !== current.copyId))
            setTotal((t) => Math.max(0, t - 1))
            toast.success(decision === 'approve' ? `Approved ${current.who}’s ${current.title}.` : `Returned ${current.title} to ${current.who}.`)
            onChanged()
        })
    }
    const keys = useRef({ decide, step, onClose })
    keys.current = { decide, step, onClose }
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null
            if (event.metaKey || event.ctrlKey || event.altKey || (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)))) return
            const k = event.key.toLowerCase()
            if (k === 'a') keys.current.decide('approve')
            else if (k === 'r') { event.preventDefault(); keys.current.decide('return') }
            else if (k === 'j') keys.current.step(1)
            else if (k === 'k') keys.current.step(-1)
            else if (k === 'escape') keys.current.onClose?.()
            else return
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])
    if (!rows) return <p className="mt-3 text-sm text-muted-foreground">Loading submissions…</p>
    const titles = [...new Map(rows.map((r) => [r.masterId, r.kind === 'task' ? 'Other tasks' : r.title])).entries()]
    return (
        <section aria-label="To review" className="mt-3 space-y-2 rounded-md border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
                <select aria-label="Assignment" value={assignment} onChange={(e) => { setAssignment(e.target.value); setIndex(0) }} className={`${select} h-8 text-xs`}>
                    <option value="all">All assignments</option>
                    {titles.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
                </select>
                <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={lateOnly} onChange={(e) => { setLateOnly(e.target.checked); setIndex(0) }} /> Late only</label>
                {rows.some((r) => !r.mine) ? (
                    <span className="flex gap-1 text-xs" role="group" aria-label="Whose reviews">
                        <button type="button" aria-pressed={mineOnly} className={cn('rounded-[3px] border px-1.5', mineOnly ? 'border-foreground font-medium' : 'border-border')} onClick={() => { setMineOnly(true); setIndex(0) }}>Mine</button>
                        <button type="button" aria-pressed={!mineOnly} className={cn('rounded-[3px] border px-1.5', !mineOnly ? 'border-foreground font-medium' : 'border-border')} onClick={() => { setMineOnly(false); setIndex(0) }}>All</button>
                    </span>
                ) : null}
                <span className="ml-auto text-xs text-muted-foreground">{shown.length ? `${Math.min(index, shown.length - 1) + 1} of ${shown.length} waiting` : ''}{total > rows.length ? ` · ${rows.length} of ${total} loaded` : ''}</span>
                <Button type="button" size="sm" variant="ghost" disabled={shown.length < 2} onClick={() => step(-1)} aria-label="Previous">‹</Button>
                <Button type="button" size="sm" variant="ghost" disabled={shown.length < 2} onClick={() => step(1)}>Next</Button>
            </div>
            {!current ? (
                <p>All caught up. {onClose ? <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={onClose}>Back to board</button> : null}</p>
            ) : (
                <>
                    <p><span className="font-medium">{current.who}</span> · {current.title} · {formatDistanceToNow(new Date(current.submittedAt), { addSuffix: true })}{current.late ? ' · Late' : ''}{current.version ? ` · Version ${current.version}` : ''}{current.submittedBy ? ` · submitted by ${current.submittedBy}` : ''}{current.left ? ' · Left the organization' : ''}</p>
                    <div className="space-y-1 rounded-md bg-muted/40 px-3 py-2">
                        {webLink(current.link) ? <a href={webLink(current.link)!} target="_blank" rel="noreferrer noopener" className="break-all text-primary underline">{current.link}</a> : current.link ? <span className="break-all">{current.link}</span> : null}
                        {current.text ? <p className="whitespace-pre-line">{current.text}</p> : null}
                        {current.files.length ? <p>{current.files.join(', ')}</p> : null}
                        {current.note ? <p className="text-muted-foreground">Note: {current.note}</p> : null}
                        {!current.link && !current.text && !current.files.length ? <p className="text-muted-foreground">Marked as done, nothing attached.</p> : null}
                        <p className="text-xs text-muted-foreground">Steps {current.steps.done} of {current.steps.total} ticked · Private conversation ({current.comments}) · <a href={current.href} className="text-primary underline-offset-4 hover:underline">Open</a></p>
                    </div>
                    {returning ? (
                        <div className="space-y-2">
                            <label className="block space-y-1"><span className="font-medium">What should they change?</span>
                                <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} className={area} aria-label="What should they change?" /></label>
                            {current.kind === 'copy' ? <label className="flex flex-wrap items-center gap-2">Fix by <Input type="datetime-local" value={fixBy} onChange={(e) => setFixBy(e.target.value)} className="w-auto" aria-label="Fix by" /></label> : null}
                            <div className="flex gap-2">
                                <Button type="button" size="sm" disabled={pending} onClick={() => decide('return')}>Return</Button>
                                <Button type="button" size="sm" variant="ghost" onClick={() => setReturning(false)}>Cancel</Button>
                            </div>
                        </div>
                    ) : (
                        // Report §32.7: on phones Approve and Return stay at the bottom; no swipe, so nothing decides by accident.
                        <div className="flex flex-wrap items-center gap-2 max-md:sticky max-md:bottom-0 max-md:bg-card max-md:py-2">
                            <Button type="button" size="sm" disabled={pending} onClick={() => decide('approve')}>Approve</Button>
                            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => decide('return')}>Return</Button>
                            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add note (optional)" aria-label="Add note" maxLength={2000} className="h-8 w-48" />
                            <span className="ml-auto text-[11px] text-muted-foreground">A approve · R return · J next · K previous · Esc close</span>
                        </div>
                    )}
                </>
            )}
            {error ? <p role="alert" className="text-destructive">{error}</p> : null}
        </section>
    )
}

/**
 * One board (report §16.1, decisions 6 and 10): an admin manages an assignment from its own card's panel, with the
 * same Roster, Edit for everyone, Use again, Close or Reopen and Export as the list above the board.
 */
export function AssignmentManageSection({ orgId, masterId, onChanged }: { orgId: string; masterId: string; onChanged?: () => void }) {
    const [data, setData] = useState<{ row: AssignmentRow; timeZone: string | null } | null>(null)
    const [dialog, setDialog] = useState<'roster' | 'edit' | 'reuse' | null>(null)
    const [questions, setQuestions] = useState(false)
    const [scheduleLocal, setScheduleLocal] = useState<string | null>(null)
    const [confirm, setConfirm] = useState<{ title: string; description?: string | null; label: string; destructive?: boolean; act: () => Promise<{ success: boolean; error?: string }> } | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const load = useCallback(() => void listAssignmentsAction(orgId).then((r) => {
        const row = r.success && r.isAdmin ? r.rows.find((x) => x.masterId === masterId) : undefined
        setData(row && r.success ? { row, timeZone: r.timeZone } : null)
    }), [masterId, orgId])
    useEffect(() => { load() }, [load])
    if (!data) return null
    const { row } = data
    const run = (action: () => Promise<{ success: boolean; error?: string }>) => startTransition(async () => {
        const result = await action()
        setError(result.success ? null : result.error ?? 'Something went wrong.')
        load()
        onChanged?.()
    })
    const live = row.status === 'open' || row.status === 'closed'
    return (
        <section aria-labelledby="assignment-manage-heading" className="space-y-2 rounded-[6px] border border-border p-4 text-sm">
            <h3 id="assignment-manage-heading" className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">Assignment</h3>
            <p className="text-muted-foreground">{countsLine(row)}</p>
            {!live && row.note ? <p className="text-[13px] text-muted-foreground">{row.note}</p> : null}
            <div className="flex flex-wrap gap-1.5">
                {/* Drafts and scheduled ones are managed here too, now the list above the board is gone (problem 3). */}
                {!live ? <Button type="button" size="sm" disabled={pending} onClick={() => run(async () => {
                    const first = await publishAssignmentAction(row.masterId)
                    // "2 people have left. Publish to the other 38?" (report §42.10 problem 15)
                    if (!first.success && 'left' in first && first.left) {
                        setConfirm({ title: first.error, label: 'Publish', act: () => publishAssignmentAction(row.masterId, { dropMissing: true }) })
                        return { success: true }
                    }
                    return first
                })}>{row.status === 'scheduled' ? 'Publish now' : 'Publish'}</Button> : null}
                {row.status === 'scheduled' ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => scheduleAssignmentAction(row.masterId, null))}>Back to draft</Button> : null}
                {row.status === 'draft' ? <Button type="button" size="sm" variant="ghost" disabled={pending} aria-expanded={scheduleLocal !== null} onClick={() => setScheduleLocal(scheduleLocal === null ? '' : null)}>Schedule</Button> : null}
                {live ? <Button type="button" size="sm" variant="outline" onClick={() => setDialog('roster')}>Roster</Button> : null}
                <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setDialog('edit')}>{live ? 'Edit for everyone' : 'Edit'}</Button>
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setDialog('reuse')}>Use again</Button>
                {row.status === 'open' ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => closeAssignmentAction(row.masterId))}>Close</Button> : null}
                {row.status === 'closed' ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => reopenAssignmentAction(row.masterId))}>Reopen</Button> : null}
                {live ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => startTransition(async () => {
                    const r = await readAssignmentExportAction(row.masterId)
                    if (!r.success) return void setError(r.error)
                    saveBlob(toCsvBlob(r.rows), `${row.title.replace(/[^\w-]+/g, '-')}-progress.csv`)
                })}>Export</Button> : null}
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm({ title: `Delete ${row.title}?`, description: deleteAssignmentWarning(row.counts), label: 'Delete', destructive: true, act: () => deleteAssignmentAction(row.masterId) })}>Delete</Button>
            </div>
            {scheduleLocal !== null ? (
                <div className="flex flex-wrap items-center gap-2">
                    <Input type="datetime-local" value={scheduleLocal} onChange={(e) => setScheduleLocal(e.target.value)} aria-label={`Publish on (${zoneName(data.timeZone)})`} className="h-8 w-auto" />
                    <Button type="button" size="sm" disabled={pending || !scheduleLocal} onClick={() => { const at = zonedInputToIso(scheduleLocal, data.timeZone); setScheduleLocal(null); run(() => scheduleAssignmentAction(row.masterId, { at })) }}>Save</Button>
                </div>
            ) : null}
            <button type="button" className="text-[13px] underline underline-offset-4" aria-expanded={questions} onClick={() => setQuestions(!questions)}>{questions ? 'Hide class questions' : 'Class questions'}</button>
            {questions ? <div className="-mx-6 max-md:-mx-4"><ClassQuestions copyId={row.masterId} /></div> : null}
            {error ? <p role="alert" className="text-destructive">{error}</p> : null}
            {dialog === 'roster' ? <RosterDialog row={row} orgId={orgId} timeZone={data.timeZone} open onOpenChange={(open) => { if (!open) setDialog(null) }} onChanged={load} /> : null}
            {dialog === 'edit' ? <EditAssignmentDialog orgId={orgId} row={row} open timeZone={data.timeZone} onClose={() => setDialog(null)} onSave={(patch) => run(() => updateAssignmentAction(row.masterId, patch))} /> : null}
            <ConfirmDialog open={Boolean(confirm)} onOpenChange={(v) => { if (!v) setConfirm(null) }} title={confirm?.title ?? ''} description={confirm?.description ?? undefined}
                confirmLabel={confirm?.label} variant={confirm?.destructive ? 'destructive' : 'default'} onConfirm={() => { if (confirm) run(confirm.act) }} />
            <AssignmentComposer orgId={orgId} open={dialog === 'reuse'} onOpenChange={(open) => { if (!open) setDialog(null) }} onCreated={() => { load(); onChanged?.() }} reuseFrom={row.masterId} timeZone={data.timeZone} />
        </section>
    )
}
