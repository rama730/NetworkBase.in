'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { ChevronDown, ClipboardList, MoreHorizontal, Plus, Shuffle, Star, Users, X, Zap } from 'lucide-react'
import { fieldError, fieldLabel } from '@/lib/organizations/display'

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
import { defaultFixBy, deleteAssignmentWarning, queueOrder, teamProblems, teamsSummary, webLink, type AssignmentTarget, type CopyState } from '@/lib/organizations/assignment-rules'
import { DownloadLink } from '@/components/ui/download-link'
import { remindSummary } from '@/lib/organizations/member-rules'
import { toast } from '@/lib/feedback'
import { cn } from '@/lib/utils'
import { ASSIGNMENT_STATE_LABELS } from '@/lib/copy/terms'
import { EditAssignmentDialog, ExcuseDialog, ExtendDialog, GiveToDialog, ReturnDialog, ReviewersPicker } from '@/components/organizations/AssignmentDialogs'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AssignmentRoster } from '@/components/organizations/AssignmentRoster'
import { useReloadOnNotice } from '@/components/organizations/ReviewQueueParts'
import { ReasonDialog } from '@/components/organizations/ReasonDialog'
import { ClassQuestions } from '@/components/organizations/ClassQuestions'
import { saveBlob, toCsvBlob } from '@/lib/download'
import { addDaysToDay, dayList, DEFAULT_DUE_TIME, formatInZone, isoToZonedInput, weeklyDays, zonedInputToIso } from '@/lib/organizations/zoned-time'
import { DateTimeField, duePresets, publishPresets } from '@/components/organizations/DateTimeField'
import { Field, FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName, QuickChips, SectionDivider, selectClassName, SelectWrap } from '@/components/workspaces/v2/tasks/form-parts'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { docTitle } from '@/lib/organizations/doc-rules'
import { useAuth } from '@/hooks/use-auth'
import { userTopic } from '@/lib/messaging/constants'
import { subscribeBroadcast } from '@/lib/realtime/private-broadcast'

// Assignments in the org Tasks tab (report §16.2–16.5, §16.11) and group copies in a child project (§16.6).
// The Kanban board below stays as it is: members' own copies appear there through the read rule.

const DUE = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const STATE_LABEL: Record<CopyState, string> = ASSIGNMENT_STATE_LABELS
const due = (iso: string | null) => (iso ? `due ${DUE.format(new Date(iso))}` : 'no due date')
// Textareas use .nb-textarea (spec §10); this only adds layout.
const area = 'w-full'
// Selects use .nb-select (spec §10); this only adds layout.
const select = ''

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
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Hand in {title}</DialogTitle>
                    <DialogDescription>{submissionType === 'file' ? 'Attach your file to this task first: open the card on Tasks, then Files. Then hand it in.' : 'Hand in your work. You can hand it in again until it is reviewed.'}</DialogDescription>
                </DialogHeader>
                {materials.length ? (
                    <div className="text-sm"><p className="font-medium">Materials</p>
                        <ul className="mt-1 space-y-0.5">{materials.map((m) => <li key={m.nodeId}><a href={`?tab=files&fileId=${encodeURIComponent(m.nodeId)}`} className="nb-link">{m.name}</a></li>)}</ul>
                    </div>
                ) : null}
                {submissionType === 'link' ? <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" aria-label="Link to your work" /> : null}
                {submissionType === 'link' && projectDocs.length > 0 ? (
                    <select defaultValue="" aria-label="Or pick a workspace doc" className="nb-select"
                        onChange={(e) => { if (e.target.value) setLink(`${window.location.origin}/workspaces/${encodeURIComponent(docsProjectId!)}?tab=docs&doc=${encodeURIComponent(e.target.value)}`) }}>
                        <option value="">Or pick a workspace doc…</option>
                        {projectDocs.map((doc) => <option key={doc.slug} value={doc.slug}>{docTitle(doc.filename)}</option>)}
                    </select>
                ) : null}
                {submissionType === 'text' ? <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} maxLength={10000} className="nb-textarea" aria-label="Your answer" /> : null}
                <label className="block"><span className={fieldLabel}>Add a note (optional)</span>
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className="nb-textarea mt-1.5" placeholder="I used the second dataset" />
                </label>
                {error ? <p role="alert" className={fieldError}>{error}</p> : null}
                <Button type="button" disabled={pending} onClick={submit}>Hand in</Button>
            </DialogContent>
        </Dialog>
    )
}

type TeamBox = { name: string; people: OrgRosterPerson[]; leadId: string | null }

type ComposerPrefill = { title: string; description: string; mode: AssignmentTarget['mode']; sprintId?: string; dueDate?: string }
/** What New's two tabs carry between them; dueDate is the day ("YYYY-MM-DD"). */
export type ComposerCarry = { title: string; description: string; sprintId: string; dueDate: string }

/** Board/review report §4: on the board, Use again opens New on its Assignment tab, filled in. Elsewhere it falls back to its own dialog. */
export const ReuseAssignmentContext = createContext<((masterId: string) => void) | null>(null)

/** New assignment in its own dialog: Use again where no board is around to open New. */

/** "Approved 12. Each person is told." plus who changed their work since handing in (audit 9.5). */
function approvedLine(r: { approved: number; failed: Array<{ reason: string }> }) {
    const base = `Approved ${r.approved}. Each person is told.`
    return r.failed.length ? `${base} ${r.failed.length} changed since they handed in: ask them to resubmit.` : base
}

export function AssignmentComposer({ orgId, open, onOpenChange, onCreated, reuseFrom = null, timeZone = null }: { orgId: string; open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void; reuseFrom?: string | null; timeZone?: string | null }) {
    // Assignment form redesign (2026-11-09): the same dialog as New, with its header, body and footer.
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS}>
                <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
                    <DialogHeader className="space-y-0.5 text-left">
                        <DialogTitle className="text-base font-semibold text-foreground">New assignment</DialogTitle>
                        <DialogDescription className="text-[13px]">Everyone it goes to gets their own copy to hand in.</DialogDescription>
                    </DialogHeader>
                    <button type="button" onClick={() => onOpenChange(false)} aria-label="Close" className="nb-touch-target flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                        <X className="size-4" aria-hidden="true" />
                    </button>
                </div>
                <AssignmentFields orgId={orgId} onDone={() => onOpenChange(false)} onCreated={onCreated} reuseFrom={reuseFrom} timeZone={timeZone} />
            </DialogContent>
        </Dialog>
    )
}

/**
 * The assignment's fields (report §16.2), laid out like New's Task tab (assignment form redesign, 2026-11-09):
 * Basics, Who gets it, Due and late work, Hand-in and review, Steps and materials, then a fixed footer with when to
 * publish, Cancel and "Publish to 60". Renders its own scrolling body and footer, so the parent is a flex column.
 */
export function AssignmentFields({ orgId, onDone, onCreated, reuseFrom = null, prefill = null, timeZone = null, onDraft }: { orgId: string; onDone: () => void; onCreated: () => void; reuseFrom?: string | null; prefill?: ComposerPrefill | null; timeZone?: string | null
    /** Board/review report §4: New's Assignment tab hears what's typed, so the Task tab keeps it. */
    onDraft?: (carry: ComposerCarry) => void }) {
    // Decision 74: dates are entered in the organization's time zone, and the form says which.
    const at = (local: string) => zonedInputToIso(local, timeZone)
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [dueLocal, setDueLocal] = useState('')
    // Settings → Work → Due time: what a picked date gets until someone changes it.
    const [dueTime, setDueTime] = useState(DEFAULT_DUE_TIME)
    // Repeat weekly until (report §33.5): later weeks are made as drafts to check before publishing.
    const [repeatUntil, setRepeatUntil] = useState('')
    const [sprintId, setSprintId] = useState('')
    const draftRef = useRef(onDraft)
    draftRef.current = onDraft
    useEffect(() => { draftRef.current?.({ title, description, sprintId, dueDate: dueLocal.slice(0, 10) }) }, [title, description, sprintId, dueLocal])
    const [submissionType, setSubmissionType] = useState<'none' | 'file' | 'link' | 'text'>('file')
    const [reviewRequired, setReviewRequired] = useState(true)
    const [admins, setAdmins] = useState<Array<{ id: string; name: string }>>([])
    const [reviewers, setReviewers] = useState<string[]>([])
    const [lateRule, setLateRule] = useState<'none' | 'until' | 'always'>('always')
    // Late work until: a number of days after the due date (it moves with it), or a date of its own (null).
    const [lateOffset, setLateOffset] = useState<number | null>(7)
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
    const [peopleQuery, setPeopleQuery] = useState('')
    const [teams, setTeams] = useState<TeamBox[]>([])
    const [childIds, setChildIds] = useState<string[]>([])
    // Teams picker (2026-11-09): everyone eligible starts in "Not in a team"; Auto-make by team count or team size;
    // a person's ⋯ menu makes them lead or moves them; people left out get their own copy unless that's switched off.
    const [autoBy, setAutoBy] = useState<'teams' | 'size'>('size')
    const [autoN, setAutoN] = useState(3)
    const [includeStaff, setIncludeStaff] = useState(false)
    const [poolPicked, setPoolPicked] = useState<string[]>([])
    const [leftover, setLeftover] = useState<'own' | 'none'>('own')
    const [steps, setSteps] = useState<string[]>([])
    // Also share in #general (report §25.5): off by default.
    const [shareToGeneral, setShareToGeneral] = useState(false)
    // Also post an announcement (report §17.2): off by default; the text is filled in from the assignment.
    const [announce, setAnnounce] = useState(false)
    const [announcement, setAnnouncement] = useState<string | null>(null)
    const [stepDraft, setStepDraft] = useState('')
    const [roster, setRoster] = useState<OrgRosterPerson[]>([])
    const [options, setOptions] = useState<{ children: Array<{ id: string; title: string }>; sprints: Array<{ id: string; name: string; status: string; endDate?: string | null }>; teamAssignments?: Array<{ id: string; title: string }> }>({ children: [], sprints: [] })
    // Errors sit under their field, like the Task tab; a server error sits at the top of the form.
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
    const [error, setError] = useState<string | null>(null)
    const [lateAsk, setLateAsk] = useState(false)
    const [pending, startTransition] = useTransition()
    const bodyRef = useRef<HTMLDivElement>(null)
    const clear = (key: string) => setFieldErrors((cur) => {
        if (!cur[key]) return cur
        const { [key]: _, ...rest } = cur
        return rest
    })
    // A failed Publish moves to the first field that needs something; a server error scrolls to the top.
    const [attempt, setAttempt] = useState(0)
    useEffect(() => { if (attempt) (bodyRef.current?.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus() }, [attempt])
    useEffect(() => { if (error) bodyRef.current?.scrollTo({ top: 0 }) }, [error])

    useEffect(() => {
        void listOrgRosterAction(orgId, '').then(setRoster)
        void readAssignmentComposerOptionsAction(orgId).then((r) => {
            if (!r.success) return
            setOptions({ children: r.children, sprints: r.sprints, teamAssignments: r.teamAssignments })
            setAdmins(r.admins ?? [])
            // A new assignment starts from the org's Work defaults (report §21.2 #5).
            setReviewRequired(r.defaults.reviewRequired)
            setLateRule(r.defaults.lateRule)
            setDueTime(r.defaults.dueTime)
            // New task with many people (decision 10): the text typed there comes along, and its due date.
            if (prefill) {
                setTitle(prefill.title); setDescription(prefill.description); setMode(prefill.mode)
                if (prefill.sprintId) setSprintId(prefill.sprintId)
                if (prefill.dueDate) setDueLocal(`${prefill.dueDate}T${r.defaults.dueTime}`)
            }
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

    const dueDay = dueLocal.slice(0, 10)
    const sprintEnd = options.sprints.find((s) => s.id === sprintId)?.endDate
    const sprintEndDay = sprintEnd ? isoToZonedInput(sprintEnd, timeZone).slice(0, 10) : null
    const lateUntil = lateOffset != null ? (dueLocal ? `${addDaysToDay(dueDay, lateOffset)}T${dueLocal.slice(11, 16)}` : '') : lateUntilLocal
    const repeatDays = repeatUntil && dueDay ? weeklyDays(dueDay, repeatUntil) : []

    const pickable = roster.filter((p) => p.role !== 'viewer')
    const query = peopleQuery.trim().toLowerCase()
    const matches = (p: OrgRosterPerson) => !query || `${p.name} ${p.username ?? ''} ${p.title ?? ''}`.toLowerCase().includes(query)
    const shownPeople = pickable.filter(matches)
    // Teams: students, and staff when "Include TAs and teachers" is on; whoever isn't in a team waits in the pool.
    const eligible = roster.filter((p) => p.role === 'member' || (includeStaff && (p.role === 'admin' || p.role === 'owner')))
    const placed = new Set(teams.flatMap((t) => t.people.map((p) => p.userId)))
    const pool = eligible.filter((p) => !placed.has(p.userId))
    const individuals = leftover === 'own' ? pool.map((p) => p.userId) : []
    const problems = teamProblems(teams.map((t) => ({ name: t.name, size: t.people.length })))
    const problemCount = problems.filter(Boolean).length
    const preview = mode === 'everyone' ? 'One assignment per member'
        : mode === 'role' ? 'One assignment per admin'
            : mode === 'people' ? `Creates ${people.length} ${people.length === 1 ? 'assignment' : 'assignments'}`
                : mode === 'teams' ? teamsSummary(teams.length, placed.size, pool.length, leftover === 'own')
                    : mode === 'each_child' ? `Creates ${options.children.length} assignments · one per workspace`
                        : `Creates ${childIds.length} assignments · one per workspace`

    // Board/review report §4: the button says what happens — "Publish to 60".
    const goesTo = mode === 'everyone' ? roster.filter((p) => p.role === 'member').length : mode === 'people' ? people.length
        : mode === 'teams' ? teams.length + individuals.length : mode === 'each_child' ? options.children.length : mode === 'children' ? childIds.length : 0
    const target = (): AssignmentTarget => mode === 'everyone' ? { mode }
        : mode === 'role' ? { mode, role: 'admin' }
            : mode === 'people' ? { mode, userIds: people }
                : mode === 'teams' ? { mode, teams: teams.map((t) => ({ name: t.name, userIds: t.people.map((p) => p.userId), leadId: t.leadId })), individuals }
                    : mode === 'each_child' ? { mode } : { mode: 'children', projectIds: childIds }

    // The announcement says the due date in the organization's zone, like everything else on the form.
    const defaultAnnouncement = `${title.trim() || 'A new assignment'} is out${dueLocal ? ` · due ${formatInZone(at(dueLocal), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, timeZone)}` : ''}.`
    const save = (late = false) => startTransition(async () => {
        const publish = when === 'now'
        const missing: Record<string, string> = {}
        if (!title.trim()) missing.title = 'Add a title.'
        if (!dueLocal) missing.due = 'Pick a due date.'
        // A late-work date counted from the due date waits for the due date; it isn't missing on its own.
        if (lateRule === 'until' && !lateUntil && (lateOffset == null || dueLocal)) missing.lateUntil = 'Pick the last day late work is accepted.'
        if (when === 'date' && !publishLocal) missing.publishAt = 'Pick when to publish.'
        if (mode === 'teams' && !teams.length) missing.teams = 'Make at least one team.'
        else if (mode === 'teams' && problemCount) missing.teams = `Fix ${problemCount} ${problemCount === 1 ? 'team' : 'teams'} first.`
        setFieldErrors(missing)
        if (Object.keys(missing).length) return setAttempt((n) => n + 1)
        // Report §16.9: a past due date is allowed, after a check.
        if (publish && !late && new Date(at(dueLocal)).getTime() < Date.now()) return setLateAsk(true)
        const result = await createAssignmentAction({
            projectId: orgId, title, description, dueDate: at(dueLocal), sprintId: sprintId || null, publish,
            submissionType, reviewRequired, lateRule, lateUntil: lateRule === 'until' && lateUntil ? at(lateUntil) : null,
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
        const boxes = r.teams.map((t) => ({ name: t.name, people: t.userIds.map((id) => pickable.find((p) => p.userId === id)).filter((p): p is OrgRosterPerson => Boolean(p)), leadId: t.leadId }))
            .filter((t) => t.people.length > 0).map((t) => ({ ...t, leadId: t.people.some((p) => p.userId === t.leadId) ? t.leadId : t.people[0]!.userId }))
        // Staff on the earlier teams come along, so they count as in the picker.
        if (boxes.some((t) => t.people.some((p) => p.role !== 'member'))) setIncludeStaff(true)
        setTeams(boxes)
        setPoolPicked([])
    }
    const nextTeamName = (cur: TeamBox[]) => {
        const taken = new Set(cur.map((t) => t.name.trim().toLowerCase()))
        for (let i = 0; ; i += 1) { const name = `Team ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`; if (!taken.has(name.toLowerCase())) return name }
    }
    /** The picked people from the pool into team `to`, or into a new team. */
    const addPicked = (to: number | 'new') => {
        const chosen = pool.filter((p) => poolPicked.includes(p.userId))
        if (!chosen.length) return
        setTeams((cur) => to === 'new' ? [...cur, { name: nextTeamName(cur), people: chosen, leadId: chosen[0]!.userId }]
            : cur.map((t, i) => (i === to ? { ...t, people: [...t.people, ...chosen], leadId: t.leadId ?? chosen[0]!.userId } : t)))
        setPoolPicked([])
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
    // Make (again) splits everyone eligible, replacing the teams on the form.
    const autoMake = () => void autoMakeGroupsAction(orgId, eligible.map((p) => p.userId), autoN, { ...(autoBy === 'teams' ? { teams: autoN } : {}), includeStaff }).then((r) => {
        if (!r.success) return setError(r.error)
        const byId = new Map(roster.map((p) => [p.userId, p]))
        setTeams(r.groups.map((ids, i) => {
            const group = ids.map((id) => byId.get(id)).filter((p): p is OrgRosterPerson => Boolean(p))
            return { name: `Team ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`, people: group, leadId: group[0]?.userId ?? null }
        }))
        setPoolPicked([])
        clear('teams')
    })

    const pickDue = (local: string) => {
        setDueLocal(local)
        clear('due')
        if (lateOffset != null) clear('lateUntil')
        if (!local) setRepeatUntil('')
    }
    const pickSprint = (id: string) => {
        setSprintId(id)
        // Picking a sprint fills an empty due date with its last day.
        const end = options.sprints.find((s) => s.id === id)?.endDate
        if (end && !dueLocal) pickDue(`${isoToZonedInput(end, timeZone).slice(0, 10)}T${dueTime}`)
        if (!id && when === 'sprint') setWhen('now')
    }
    const small = 'text-[13px]'

    return (
        <>
            <div ref={bodyRef} className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
                {error ? <div role="alert" className="rounded-md border border-border bg-[var(--status-danger-soft)] px-3 py-2 text-xs font-mono text-destructive">{error}</div> : null}

                <div className="space-y-3.5">
                    <SectionDivider title="Basics" />
                    <Field label="Assignment title" htmlFor="assignment-title" required error={fieldErrors.title}>
                        <input id="assignment-title" value={title} onChange={(e) => { setTitle(e.target.value); clear('title') }} maxLength={200} placeholder="e.g., Lab 1: Arrays and linked lists" className={inputClassName(Boolean(fieldErrors.title))} autoFocus />
                    </Field>
                    <Field label="Instructions" htmlFor="assignment-instructions">
                        <textarea id="assignment-instructions" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={10000} placeholder="What to do, what to hand in, how it’s marked…" className={cn('nb-textarea', inputClassName(false), 'min-h-[72px] resize-y py-2')} />
                    </Field>
                </div>

                <div className="space-y-3.5">
                    <SectionDivider title="Who gets it" />
                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                        <Field label="Assign to" htmlFor="assignment-target">
                            <SelectWrap icon={<Users aria-hidden="true" />}>
                                <select id="assignment-target" value={mode} onChange={(e) => setMode(e.target.value as AssignmentTarget['mode'])} className={cn('nb-select', selectClassName(false, true))}>
                                    <option value="everyone">Everyone (members)</option>
                                    <option value="role">Admins</option>
                                    <option value="people">Selected people</option>
                                    <option value="teams">Teams</option>
                                    <option value="each_child">Each workspace in the organization</option>
                                    <option value="children">Selected workspaces</option>
                                </select>
                            </SelectWrap>
                        </Field>
                        <Field label="Sprint" htmlFor="assignment-sprint">
                            <SelectWrap icon={<Zap aria-hidden="true" />}>
                                <select id="assignment-sprint" value={sprintId} onChange={(e) => pickSprint(e.target.value)} className={cn('nb-select', selectClassName(false, true))}>
                                    <option value="">No sprint</option>
                                    {options.sprints.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === 'active' ? ' (running)' : ''}</option>)}
                                </select>
                            </SelectWrap>
                        </Field>
                    </div>
                    {mode === 'people' ? (
                        <div className="space-y-1.5">
                            <input type="search" value={peopleQuery} onChange={(e) => setPeopleQuery(e.target.value)} placeholder="Search people" aria-label="Search people" className={inputClassName(false)} />
                            <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border" aria-label="People">
                                {shownPeople.map((p) => (
                                    <li key={p.userId}><label className="flex items-center gap-2.5 px-3 py-1.5 text-[13px] hover:bg-muted">
                                        <input className="nb-check" type="checkbox" checked={people.includes(p.userId)} onChange={(e) => setPeople((cur) => e.target.checked ? [...cur, p.userId] : cur.filter((id) => id !== p.userId))} />
                                        <UserAvatar identity={{ id: p.userId, fullName: p.name, username: p.username, avatarUrl: p.avatarUrl }} size={24} />
                                        <span className="min-w-0 truncate">{p.name}{p.title ? <span className="text-muted-foreground"> · {p.title}</span> : null}</span>
                                    </label></li>
                                ))}
                                {shownPeople.length === 0 ? <li className="px-3 py-2 text-[13px] text-muted-foreground">{query ? `No one matches “${peopleQuery.trim()}”.` : 'No one to pick yet.'}</li> : null}
                            </ul>
                            {people.length ? <p className="text-xs text-muted-foreground">{people.length} picked</p> : null}
                        </div>
                    ) : null}
                    {mode === 'teams' ? (
                        <div className="space-y-3">
                            {/* One row to make teams: Auto by count or size, Copy teams from, or an empty team. */}
                            <div className={cn('flex flex-wrap items-center gap-2', small)}>
                                <select value={autoBy} onChange={(e) => setAutoBy(e.target.value as typeof autoBy)} aria-label="Auto-make by" className="nb-select" data-size="sm">
                                    <option value="teams">Auto: number of teams</option>
                                    <option value="size">Auto: people per team</option>
                                </select>
                                <input type="number" min={1} max={500} value={autoN} onChange={(e) => setAutoN(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
                                    aria-label={autoBy === 'teams' ? 'Number of teams' : 'People per team'} className={cn(inputClassName(false), 'h-8 w-16 font-mono')} />
                                <Button type="button" size="sm" variant="outline" onClick={autoMake} disabled={eligible.length === 0}><Shuffle className="size-3.5" aria-hidden="true" />{teams.length ? 'Make again' : 'Make'}</Button>
                                <span className="text-muted-foreground">or</span>
                                <select value="" aria-label="Copy teams from" className="nb-select" data-size="sm" disabled={!options.teamAssignments?.length} onChange={(e) => { if (e.target.value) void copyTeamsFrom(e.target.value) }}>
                                    <option value="">{options.teamAssignments?.length ? 'Copy teams from…' : 'No earlier team assignments'}</option>
                                    {(options.teamAssignments ?? []).map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
                                </select>
                                <Button type="button" size="sm" variant="ghost" onClick={() => setTeams((cur) => [...cur, { name: nextTeamName(cur), people: [], leadId: null }])}><Plus className="size-3.5" aria-hidden="true" />Empty team</Button>
                            </div>
                            <label className={cn('flex items-center gap-2', small)}><input className="nb-check" type="checkbox" checked={includeStaff} onChange={(e) => setIncludeStaff(e.target.checked)} />Include TAs and teachers</label>

                            {/* Not in a team: tick a few, then Add to a team, in one step. */}
                            <div className="space-y-2 rounded-md border border-border p-2.5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="nb-micro">Not in a team · {pool.length}</p>
                                    <input type="search" value={peopleQuery} onChange={(e) => setPeopleQuery(e.target.value)} placeholder="Search people" aria-label="Search people" className={cn(inputClassName(false), 'h-8 w-48')} />
                                </div>
                                {pool.length ? (
                                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Not in a team">
                                        {pool.filter(matches).map((p) => (
                                            <button key={p.userId} type="button" className="nb-tag" aria-pressed={poolPicked.includes(p.userId)}
                                                onClick={() => setPoolPicked((cur) => cur.includes(p.userId) ? cur.filter((id) => id !== p.userId) : [...cur, p.userId])}>{p.name}</button>
                                        ))}
                                        {query && !pool.some(matches) ? <span className="text-xs text-muted-foreground">No one here matches “{peopleQuery.trim()}”.</span> : null}
                                    </div>
                                ) : <p className="text-xs text-muted-foreground">{eligible.length ? 'Everyone is in a team.' : 'No students yet.'}</p>}
                                {poolPicked.length ? (
                                    <div className={cn('flex flex-wrap items-center gap-2', small)}>
                                        <span>Add {poolPicked.length} to</span>
                                        <select value="" aria-label="Add the picked people to" className="nb-select" data-size="sm" onChange={(e) => { const v = e.target.value; if (v) addPicked(v === 'new' ? 'new' : Number(v)) }}>
                                            <option value="">Pick a team…</option>
                                            {teams.map((t, i) => <option key={i} value={String(i)}>{t.name || 'Unnamed team'}</option>)}
                                            <option value="new">A new team</option>
                                        </select>
                                        <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setPoolPicked([])}>Clear</button>
                                    </div>
                                ) : null}
                            </div>

                            {/* Team cards: the name, the people with their photos, LEAD on the lead, and a ⋯ menu each. */}
                            {teams.length ? (
                                <div className="grid gap-2 sm:grid-cols-2" aria-label="Teams" role="list">
                                    {teams.map((team, ti) => {
                                        const problem = problems[ti]
                                        const lead = team.leadId ?? team.people[0]?.userId ?? null
                                        return (
                                            <div key={ti} role="listitem" aria-label={team.name || 'Unnamed team'} className={cn('rounded-md border p-2.5', problem ? 'border-destructive' : 'border-border')}>
                                                <div className="flex items-center gap-2">
                                                    <input value={team.name} onChange={(e) => setTeams((cur) => cur.map((t, i) => (i === ti ? { ...t, name: e.target.value } : t)))} maxLength={60}
                                                        aria-label="Team name" aria-invalid={Boolean(problem)} className={cn(inputClassName(Boolean(problem)), 'h-8 min-w-0 flex-1')} />
                                                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{team.people.length}</span>
                                                    <button type="button" aria-label={`Remove ${team.name || 'this team'}`} className="nb-icon-button size-7" onClick={() => setTeams((cur) => cur.filter((_, i) => i !== ti))}><X className="size-3.5" aria-hidden="true" /></button>
                                                </div>
                                                {problem ? <p role="alert" className="mt-1 text-xs text-destructive">{problem}</p> : null}
                                                <ul className="mt-2 space-y-1">
                                                    {team.people.map((p) => (
                                                        <li key={p.userId} className={cn('flex items-center gap-2 text-[13px]', query && (matches(p) ? 'font-semibold text-foreground' : 'text-muted-foreground'))}>
                                                            <UserAvatar identity={{ id: p.userId, fullName: p.name, username: p.username, avatarUrl: p.avatarUrl }} size={20} />
                                                            <span className="min-w-0 flex-1 truncate">{p.name}</span>
                                                            {lead === p.userId ? <span className="nb-status shrink-0" data-status="active">Lead</span> : null}
                                                            <DropdownMenu modal={false}>
                                                                <DropdownMenuTrigger asChild>
                                                                    <button type="button" aria-label={`Options for ${p.name}`} className="nb-icon-button size-6 shrink-0"><MoreHorizontal className="size-3.5" aria-hidden="true" /></button>
                                                                </DropdownMenuTrigger>
                                                                <DropdownMenuContent align="end">
                                                                    {lead !== p.userId ? <DropdownMenuItem onSelect={() => setTeams((cur) => cur.map((t, i) => (i === ti ? { ...t, leadId: p.userId } : t)))}>Make lead</DropdownMenuItem> : null}
                                                                    {teams.length > 1 ? (
                                                                        <DropdownMenuSub>
                                                                            <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
                                                                            <DropdownMenuSubContent>
                                                                                {teams.map((t, i) => (i === ti ? null : <DropdownMenuItem key={i} onSelect={() => moveBetweenTeams(p.userId, ti, i)}>{t.name || 'Unnamed team'}</DropdownMenuItem>))}
                                                                            </DropdownMenuSubContent>
                                                                        </DropdownMenuSub>
                                                                    ) : null}
                                                                    <DropdownMenuItem onSelect={() => moveBetweenTeams(p.userId, ti, null)}>Take out of team</DropdownMenuItem>
                                                                </DropdownMenuContent>
                                                            </DropdownMenu>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )
                                    })}
                                </div>
                            ) : null}
                            {fieldErrors.teams ? <p role="alert" className="text-xs text-destructive">{fieldErrors.teams}</p> : null}

                            {/* People left out: their own copy (the default), or none. */}
                            <fieldset className={cn('flex flex-wrap items-center gap-x-4 gap-y-1', small)}>
                                <legend className="mb-1 font-medium">People not in a team</legend>
                                <label className="flex items-center gap-1.5"><input type="radio" className="nb-radio" name="team-leftover" checked={leftover === 'own'} onChange={() => setLeftover('own')} />Get their own copy</label>
                                <label className="flex items-center gap-1.5"><input type="radio" className="nb-radio" name="team-leftover" checked={leftover === 'none'} onChange={() => setLeftover('none')} />Don’t get it</label>
                            </fieldset>
                        </div>
                    ) : null}
                    {mode === 'children' ? (
                        <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border" aria-label="Workspaces">
                            {options.children.map((c) => (
                                <li key={c.id}><label className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
                                    <input className="nb-check" type="checkbox" checked={childIds.includes(c.id)} onChange={(e) => setChildIds((cur) => e.target.checked ? [...cur, c.id] : cur.filter((id) => id !== c.id))} />{c.title}
                                </label></li>
                            ))}
                        </ul>
                    ) : null}
                    <p className="text-xs text-muted-foreground" role="status">{preview}</p>
                </div>

                <div className="space-y-3.5">
                    <SectionDivider title="Due and late work" />
                    <Field label="Due date" htmlFor="assignment-due" required error={fieldErrors.due}>
                        <DateTimeField id="assignment-due" value={dueLocal} onChange={pickDue} timeZone={timeZone} defaultTime={dueTime} hasError={Boolean(fieldErrors.due)}
                            presets={[...duePresets(timeZone), ...(sprintEndDay ? [{ label: 'End of sprint', day: sprintEndDay }] : [])]} />
                    </Field>
                    <div className="space-y-1.5">
                        <label className={cn('flex items-center gap-2', small)}>
                            <input className="nb-check" type="checkbox" checked={Boolean(repeatUntil)} disabled={!dueLocal} onChange={(e) => setRepeatUntil(e.target.checked ? addDaysToDay(dueDay, 28) : '')} />
                            Repeat weekly until
                            {repeatUntil ? <input type="date" value={repeatUntil} min={dueDay} onChange={(e) => setRepeatUntil(e.target.value)} aria-label="Repeat until" className={cn(inputClassName(false), 'h-8 w-auto font-mono')} /> : null}
                        </label>
                        {!dueLocal ? <p className="text-xs text-muted-foreground">Pick a due date first.</p> : null}
                        {repeatDays.length ? <p className="text-xs text-muted-foreground">{repeatDays.length} {repeatDays.length === 1 ? 'assignment' : 'assignments'}: {dayList(repeatDays)}. Later weeks are saved as drafts to check before publishing.</p> : null}
                    </div>
                    <Field label="Late submissions" htmlFor="assignment-late">
                        <SelectWrap>
                            <select id="assignment-late" value={lateRule} onChange={(e) => { setLateRule(e.target.value as typeof lateRule); clear('lateUntil') }} className={cn('nb-select', selectClassName())}>
                                <option value="always">Always allowed</option><option value="until">Allowed until a date</option><option value="none">Not allowed</option>
                            </select>
                        </SelectWrap>
                    </Field>
                    {lateRule === 'until' ? (
                        <Field label="Late work accepted until" htmlFor="assignment-late-until" error={fieldErrors.lateUntil}>
                            <div className="space-y-1.5">
                                <QuickChips label="After due" items={[1, 3, 7].map((days) => ({ label: days === 7 ? '+1 week' : `+${days} ${days === 1 ? 'day' : 'days'}`, active: lateOffset === days, onClick: () => { setLateOffset(days); clear('lateUntil') } }))} />
                                <DateTimeField id="assignment-late-until" summary="Until" aria-label="Late work until" value={lateUntil} timeZone={timeZone} defaultTime={dueTime} min={dueDay || undefined} hasError={Boolean(fieldErrors.lateUntil)}
                                    onChange={(local) => { setLateOffset(null); setLateUntilLocal(local); clear('lateUntil') }} />
                                {lateOffset != null && dueLocal ? <p className="text-xs text-muted-foreground">Moves with the due date.</p> : null}
                            </div>
                        </Field>
                    ) : null}
                </div>

                <div className="space-y-3.5">
                    <SectionDivider title="Hand-in and review" />
                    <Field label="What they hand in" htmlFor="assignment-submission">
                        <SelectWrap>
                            <select id="assignment-submission" value={submissionType} onChange={(e) => setSubmissionType(e.target.value as typeof submissionType)} className={cn('nb-select', selectClassName())}>
                                <option value="file">A file</option><option value="link">A link</option><option value="text">Text</option><option value="none">No submission</option>
                            </select>
                        </SelectWrap>
                    </Field>
                    <label className={cn('flex items-center gap-2', small)}><input className="nb-check" type="checkbox" checked={reviewRequired} onChange={(e) => setReviewRequired(e.target.checked)} />Review required (Approve or Return each submission)</label>
                </div>

                <div className="space-y-3.5">
                    <SectionDivider title="Steps and materials" />
                    <div className="space-y-2">
                        <p className="text-[13px] font-medium">Steps <span className="font-normal text-muted-foreground">(copied into every copy)</span></p>
                        {steps.length ? (
                            <ol className="list-decimal space-y-1 pl-5 text-[13px]">
                                {steps.map((step, i) => <li key={i}>{step} <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setSteps((cur) => cur.filter((_, j) => j !== i))}>remove</button></li>)}
                            </ol>
                        ) : null}
                        <div className="flex gap-2">
                            <input value={stepDraft} onChange={(e) => setStepDraft(e.target.value)} placeholder="e.g., Write tests" maxLength={200} aria-label="New step" className={inputClassName(false)}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (stepDraft.trim()) { setSteps((cur) => [...cur, stepDraft.trim()]); setStepDraft('') } } }} />
                            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => { if (stepDraft.trim()) { setSteps((cur) => [...cur, stepDraft.trim()]); setStepDraft('') } }}>Add</button>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <p className="text-[13px] font-medium">Materials <span className="font-normal text-muted-foreground">(read only on every copy)</span></p>
                        {materials.length ? (
                            <ul className="flex flex-wrap gap-1.5">
                                {materials.map((m) => (
                                    <li key={m.id} className="inline-flex items-center gap-1 rounded-md border border-border bg-card py-0.5 pl-2 pr-0.5 text-[12px]">
                                        {m.name}{m.adminsOnly ? <span className="text-[var(--status-warning)]"> · Admins only</span> : null}
                                        <button type="button" aria-label={`Remove ${m.name}`} className="nb-icon-button size-5" onClick={() => setMaterials((cur) => cur.filter((x) => x.id !== m.id))}><X className="size-3" aria-hidden="true" /></button>
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                        <input type="search" value={materialQuery} onChange={(e) => setMaterialQuery(e.target.value)} placeholder="Search this organization’s files" aria-label="Search files for materials" className={inputClassName(false)} />
                        {materialResults.length ? (
                            <ul className="max-h-36 divide-y divide-border overflow-y-auto rounded-md border border-border text-[13px]" aria-label="Files">
                                {materialResults.filter((f) => !materials.some((m) => m.id === f.id)).map((f) => (
                                    <li key={f.id}><button type="button" className="w-full px-3 py-1.5 text-left hover:bg-muted" onClick={() => { setMaterials((cur) => [...cur, f]); setMaterialQuery('') }}>
                                        {f.name}
                                        {/* Decision 137: say so before an Admins-only file becomes a material. */}
                                        {f.adminsOnly ? <span className="block text-xs text-[var(--status-warning)]">Admins only. Members won’t be able to open this.</span> : null}
                                    </button></li>
                                ))}
                            </ul>
                        ) : null}
                    </div>
                </div>

                {when === 'date' ? (
                    <div className="space-y-3.5">
                        <SectionDivider title="Publish" />
                        <Field label="Publish on" htmlFor="assignment-publish-at" required error={fieldErrors.publishAt}>
                            <DateTimeField id="assignment-publish-at" summary="Publishes" aria-label="Publish on" value={publishLocal} timeZone={timeZone} defaultTime="08:00" presets={publishPresets(timeZone)} presetsLabel="Quick picks" hasError={Boolean(fieldErrors.publishAt)}
                                onChange={(local) => { setPublishLocal(local); clear('publishAt') }} />
                        </Field>
                    </div>
                ) : null}

                {/* The settings that rarely change wait behind More options. */}
                <details className="group rounded-md border border-border">
                    <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[13px] font-medium [&::-webkit-details-marker]:hidden">
                        More options
                        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    <div className="space-y-3.5 border-t border-border px-3 py-3">
                        {/* Report §45.3, decision 171: members still see the due time; Late counts from due + this. */}
                        <label className={cn('flex flex-wrap items-center gap-2 font-medium', small)}>Late after
                            <input type="number" min={0} max={60} value={lateAfter} onChange={(e) => setLateAfter(Math.max(0, Math.min(60, Number(e.target.value) || 0)))} className={cn(inputClassName(false), 'w-20 font-mono')} aria-label="Late after, in minutes" />
                            <span className="font-normal text-muted-foreground">minutes past the due time</span>
                        </label>
                        {reviewRequired ? <ReviewersPicker admins={admins} value={reviewers} onChange={setReviewers} className={small} /> : null}
                        <label className={cn('flex items-center gap-2', small)}><input className="nb-check" type="checkbox" checked={shareToGeneral} onChange={(e) => setShareToGeneral(e.target.checked)} />Also share in #general</label>
                        <label className={cn('flex items-center gap-2', small)}><input className="nb-check" type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />Also post an announcement</label>
                        {announce ? <textarea value={announcement ?? defaultAnnouncement} onChange={(e) => setAnnouncement(e.target.value)} rows={2} maxLength={5000} aria-label="Announcement" className={cn('nb-textarea', inputClassName(false), 'min-h-[60px] resize-y py-2')} /> : null}
                    </div>
                </details>
            </div>

            <div className={FORM_FOOTER_CLASS}>
                {/* Publish timing (report §42.5, decision 125). */}
                <div className="mr-auto">
                    <SelectWrap>
                        <select value={when} onChange={(e) => setWhen(e.target.value as typeof when)} aria-label="When to publish" className={cn('nb-select', selectClassName(), 'w-auto')}>
                            <option value="now">Publish now</option>
                            {sprintId ? <option value="sprint">When the sprint starts</option> : null}
                            <option value="date">On a date</option>
                            <option value="draft">Save as draft</option>
                        </select>
                    </SelectWrap>
                </div>
                <button type="button" onClick={onDone} disabled={pending} className={FORM_SECONDARY_CLASS}>Cancel</button>
                <button type="button" disabled={pending} onClick={() => save()} className={FORM_PRIMARY_CLASS}>
                    {/* Report §44.3: publishing to many takes a few seconds, so it says so. */}
                    {pending ? (when === 'now' ? 'Publishing…' : 'Saving…') : mode === 'teams' && problemCount ? `Fix ${problemCount} ${problemCount === 1 ? 'team' : 'teams'}` : when === 'now' ? (goesTo ? `Publish to ${goesTo}` : 'Publish') : when === 'draft' ? 'Save as draft' : 'Schedule'}
                </button>
            </div>
            <ConfirmDialog open={lateAsk} onOpenChange={setLateAsk} title="The due date has passed" description="Publish it as already late?"
                confirmLabel="Publish as late" onConfirm={() => save(true)} />
        </>
    )
}

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
                    {row.counts.submitted > 0 ? <Button type="button" size="sm" disabled={pending} onClick={() => run(async () => { const r = await approveAllSubmittedAction(row.masterId); if (r.success) toast.success(approvedLine(r)); return r.success ? { success: true } : r })}>Approve all submitted</Button> : null}
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
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted p-2 text-sm" role="group" aria-label="Selected">
                        <span className="font-medium">{picked.size} selected</span>
                        <Button type="button" size="sm" disabled={pending} onClick={() => run(async () => {
                            // Audit 9.5: one server call; anything that changed since it was handed in is named, not skipped silently.
                            const r = await approveAllSubmittedAction(row.masterId, [...picked])
                            if (r.success) toast.success(approvedLine(r))
                            setPicked(new Set())
                            return r.success ? { success: true } : r
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
                                    <input className="nb-check" type="checkbox" aria-label={`Select ${r.label}`} checked={picked.has(r.copyId)} onChange={(e) => setPicked((cur) => { const next = new Set(cur); if (e.target.checked) next.add(r.copyId); else next.delete(r.copyId); return next })} />
                                    <span className="font-medium">{r.label}</span>
                                    {r.people?.length ? <span className="text-muted-foreground">· {r.people.map((p) => `${p.name}${p.lead ? ' (team lead)' : ''}`).join(' · ')}</span>
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
                                                <select value="" aria-label={`Move ${p.name} to…`} className="nb-select" data-size="sm" disabled={pending}
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
                                    <select value="" aria-label={`Add ${p.name} to a group`} className="nb-select" data-size="sm" disabled={pending}
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
                    onExtend={(due, reopen) => run(async () => { const r = await extendCopiesAction([...picked], due, { reopen }); if (r.success) { setPicked(new Set()); toast.success(r.failed ? `Extended ${r.extended} · ${r.failed} couldn’t be` : `Extended ${r.extended}`) } return r })} />
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

// Review queue redesign (2026-11-04): the queue lives in its own file.
export { ReviewQueue } from '@/components/organizations/ReviewQueue'

/**
 * One board (report §16.1, decisions 6 and 10): an admin manages an assignment from its own card's panel, with the
 * same Roster, Edit for everyone, Use again, Close or Reopen and Export as the list above the board.
 */
export function AssignmentManageSection({ orgId, masterId, onChanged }: { orgId: string; masterId: string; onChanged?: () => void }) {
    const reuseOnBoard = useContext(ReuseAssignmentContext)
    const [data, setData] = useState<{ row: AssignmentRow; timeZone: string | null } | null>(null)
    const [dialog, setDialog] = useState<'edit' | 'reuse' | null>(null)
    const [scheduleLocal, setScheduleLocal] = useState<string | null>(null)
    const [confirm, setConfirm] = useState<{ title: string; description?: string | null; label: string; destructive?: boolean; act: () => Promise<{ success: boolean; error?: string }> } | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const load = useCallback(() => void listAssignmentsAction(orgId, { masterId }).then((r) => {
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
    const exportCsv = () => startTransition(async () => {
        const r = await readAssignmentExportAction(row.masterId)
        if (!r.success) return void setError(r.error)
        saveBlob(toCsvBlob(r.rows), `${row.title.replace(/[^\w-]+/g, '-')}-progress.csv`)
    })
    const askDelete = () => setConfirm({ title: `Delete ${row.title}?`, description: deleteAssignmentWarning(row.counts), label: 'Delete', destructive: true, act: () => deleteAssignmentAction(row.masterId) })
    return (
        <section aria-labelledby="assignment-manage-heading" className="space-y-4 text-sm">
            {/* Review UX 1.1: the tab's header — what it is, when it's due, and the rarer actions in one menu. */}
            <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                    <h3 id="assignment-manage-heading" className="nb-card-title truncate">{row.title}</h3>
                    <p className="nb-meta">{[row.dueDate ? `Due ${new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', ...(data.timeZone ? { timeZone: data.timeZone } : {}) }).format(new Date(row.dueDate))}` : 'No due date', row.status === 'open' ? 'Open' : row.status === 'closed' ? 'Closed' : row.status === 'scheduled' ? 'Scheduled' : 'Draft'].join(' · ')}</p>
                </div>
                {/* Mockup task 1: the rarer actions sit in one menu; the panel itself shows the class. */}
                {live ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button type="button" size="icon-sm" variant="ghost" className="nb-touch-target" aria-label="Manage assignment" disabled={pending}><MoreHorizontal className="size-4" aria-hidden="true" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setDialog('edit')}>Edit for everyone</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => reuseOnBoard ? reuseOnBoard(masterId) : setDialog('reuse')}>Use again</DropdownMenuItem>
                            {row.status === 'open' ? <DropdownMenuItem onSelect={() => run(() => closeAssignmentAction(row.masterId))}>Close</DropdownMenuItem> : null}
                            {row.status === 'closed' ? <DropdownMenuItem onSelect={() => run(() => reopenAssignmentAction(row.masterId))}>Reopen</DropdownMenuItem> : null}
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={askDelete}>Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : null}
            </div>
            {live ? null : <p className="text-muted-foreground">{countsLine(row)}</p>}
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
                {!live ? <>
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setDialog('edit')}>Edit</Button>
                    <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => reuseOnBoard ? reuseOnBoard(masterId) : setDialog('reuse')}>Use again</Button>
                    {/* Delete is destructive wherever it shows (spec §10), and it confirms first. */}
                    <Button type="button" size="sm" variant="outline" className="text-destructive" disabled={pending} onClick={askDelete}>Delete…</Button>
                </> : null}
            </div>
            {live ? <AssignmentRoster row={row} orgId={orgId} timeZone={data.timeZone} onChanged={() => { load(); onChanged?.() }} onExport={exportCsv} /> : null}
            {scheduleLocal !== null ? (
                <div className="flex flex-wrap items-start gap-2">
                    <DateTimeField className="w-full max-w-sm" value={scheduleLocal} onChange={setScheduleLocal} timeZone={data.timeZone} defaultTime="08:00" summary="Publishes" aria-label="Publish on" presets={publishPresets(data.timeZone)} presetsLabel="Quick picks" />
                    <Button type="button" size="sm" disabled={pending || !scheduleLocal} onClick={() => { const at = zonedInputToIso(scheduleLocal, data.timeZone); setScheduleLocal(null); run(() => scheduleAssignmentAction(row.masterId, { at })) }}>Save</Button>
                </div>
            ) : null}
            {/* Review UX 1.10: the class's questions are the tab's last section, not a toggle. */}
            <section aria-labelledby="assignment-questions-heading" className="space-y-2 border-t border-border pt-4">
                <h4 id="assignment-questions-heading" className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">Class questions</h4>
                <div className="-mx-6 max-md:-mx-4"><ClassQuestions copyId={row.masterId} /></div>
            </section>
            {error ? <p role="alert" className="text-destructive">{error}</p> : null}
            {dialog === 'edit' ? <EditAssignmentDialog orgId={orgId} row={row} open timeZone={data.timeZone} onClose={() => setDialog(null)} onSave={(patch) => run(() => updateAssignmentAction(row.masterId, patch))} /> : null}
            <ConfirmDialog open={Boolean(confirm)} onOpenChange={(v) => { if (!v) setConfirm(null) }} title={confirm?.title ?? ''} description={confirm?.description ?? undefined}
                confirmLabel={confirm?.label} variant={confirm?.destructive ? 'destructive' : 'default'} onConfirm={() => { if (confirm) run(confirm.act) }} />
            <AssignmentComposer orgId={orgId} open={dialog === 'reuse'} onOpenChange={(open) => { if (!open) setDialog(null) }} onCreated={() => { load(); onChanged?.() }} reuseFrom={row.masterId} timeZone={data.timeZone} />
        </section>
    )
}
