'use client'

import { useEffect, useState } from 'react'

import { readAssignmentComposerOptionsAction, readAssignmentForReuseAction, type AssignmentRow, type updateAssignmentAction } from '@/app/actions/assignments'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/input'
import { isoToZonedInput, todayInZone, zonedInputToIso } from '@/lib/organizations/zoned-time'
import { afterPresets, DateTimeField, duePresets } from '@/components/organizations/DateTimeField'

// Roster dialogs (report §34.6): every browser pop-up becomes a dialog that says what happens.

const DAY = 86_400_000
// Textareas use .nb-textarea (spec §10); this only adds layout.
const area = 'w-full'

/** Return, or Change decision on approved work (decisions 40, 126): a reason they'll see, and Fix by, 3 days out. */
export function ReturnDialog({ label, change = false, open, onClose, onReturn, timeZone = null }: { label: string; change?: boolean; open: boolean; onClose: () => void; onReturn: (reason: string, fixBy: string) => void; timeZone?: string | null }) {
    const [reason, setReason] = useState('')
    const [fixBy, setFixBy] = useState('')
    // Live loop 33: end of the day three days on, in the organization's zone.
    useEffect(() => { if (open) { setReason(''); setFixBy(`${isoToZonedInput(new Date(Date.now() + 3 * DAY).toISOString(), timeZone).slice(0, 10)}T23:59`) } }, [open, timeZone])
    return (
        <ConfirmDialog open={open} onOpenChange={(v) => { if (!v) onClose() }} title={change ? `Return ${label}’s approved work?` : `Return ${label}’s work?`}
            confirmLabel="Return" onConfirm={() => { if (reason.trim() && fixBy) onReturn(reason.trim(), zonedInputToIso(fixBy, timeZone)); onClose() }}>
            <div className="space-y-3 text-sm">
                <label className="block space-y-1"><span className="font-medium">What should they change?</span>
                    <textarea required value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} className="nb-textarea" aria-label="What should they change?" />
                    <span className="block text-[12px] text-muted-foreground">They’ll see this.</span>
                </label>
                <div className="space-y-1"><span className="block font-medium">Fix by</span>
                    <DateTimeField value={fixBy} onChange={setFixBy} timeZone={timeZone} summary="Fix by" presets={afterPresets(todayInZone(timeZone), '23:59')} presetsLabel="From today" />
                    <span className="block text-[12px] text-muted-foreground">They can hand it in again until then, even past the due date.</span>
                </div>
            </div>
        </ConfirmDialog>
    )
}

/** Extend (report §34.6): a date with shortcuts; on a closed assignment it asks to reopen it for them (smaller bug 18). */
export function ExtendDialog({ label, currentDue, closed, open, onClose, onExtend, timeZone = null }: { label: string; currentDue: string | null; closed: boolean; open: boolean; onClose: () => void; onExtend: (dueIso: string, reopen: boolean) => void; timeZone?: string | null }) {
    const [value, setValue] = useState('')
    const [reopen, setReopen] = useState(false)
    const base = currentDue && new Date(currentDue).getTime() > Date.now() ? new Date(currentDue) : new Date()
    // Report §32.5: dates are entered in the organization's zone, and the form says so.
    const inZone = (d: Date) => isoToZonedInput(d.toISOString(), timeZone)
    useEffect(() => { if (open) { setValue(inZone(new Date(base.getTime() + DAY))); setReopen(false) } }, [open])
    const ready = Boolean(value) && (!closed || reopen)
    return (
        <ConfirmDialog open={open} onOpenChange={(v) => { if (!v) onClose() }} title={`Extend for ${label}`} confirmLabel="Extend"
            onConfirm={() => { if (ready) onExtend(zonedInputToIso(value, timeZone), reopen); onClose() }}>
            <div className="space-y-3 text-sm">
                <div className="space-y-1"><span className="block font-medium">New due date</span>
                    {/* The shortcuts count from the current due date (or now, once it has passed) and keep its time. */}
                    <DateTimeField value={value} onChange={setValue} timeZone={timeZone} defaultTime={inZone(base).slice(11, 16)} presets={afterPresets(inZone(base).slice(0, 10), inZone(base).slice(11, 16))} presetsLabel={currentDue && new Date(currentDue).getTime() > Date.now() ? 'From due' : 'From now'} />
                </div>
                {closed ? (
                    <label className="flex items-start gap-2">
                        <input type="checkbox" className="nb-check mt-1" checked={reopen} onChange={(e) => setReopen(e.target.checked)} />
                        <span>This assignment is closed. Reopen it for {label}?<span className="block text-[12px] text-muted-foreground">Only they can hand it in again, until the new date.</span></span>
                    </label>
                ) : null}
                <p className="text-[12px] text-muted-foreground">They’re told.</p>
            </div>
        </ConfirmDialog>
    )
}

/** Excuse (report §34.6): a reason they'll see; their work stays and they leave the counts. */
export function ExcuseDialog({ label, open, onClose, onExcuse }: { label: string; open: boolean; onClose: () => void; onExcuse: (reason: string) => void }) {
    const [reason, setReason] = useState('')
    useEffect(() => { if (open) setReason('') }, [open])
    return (
        <ConfirmDialog open={open} onOpenChange={(v) => { if (!v) onClose() }} title={`Excuse ${label}?`} confirmLabel="Excuse"
            onConfirm={() => { if (reason.trim()) onExcuse(reason.trim()); onClose() }}>
            <label className="block space-y-1 text-sm"><span className="font-medium">Reason</span>
                <textarea required value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} className="nb-textarea" aria-label="Reason" />
                <span className="block text-[12px] text-muted-foreground">They’ll see this. Their work stays, and they leave the counts.</span>
            </label>
        </ConfirmDialog>
    )
}

/** Give to (decision 88): a copy for someone without one, with their own due date. */
export function GiveToDialog({ people, open, onClose, onGive, timeZone = null }: { people: Array<{ userId: string; name: string }>; open: boolean; onClose: () => void; onGive: (userId: string, dueIso: string) => void; timeZone?: string | null }) {
    const [userId, setUserId] = useState('')
    const [due, setDue] = useState('')
    useEffect(() => { if (open) { setUserId(people[0]?.userId ?? ''); setDue(isoToZonedInput(new Date(Date.now() + 7 * DAY).toISOString(), timeZone)) } }, [open, people, timeZone])
    return (
        <ConfirmDialog open={open} onOpenChange={(v) => { if (!v) onClose() }} title="Give this to someone" confirmLabel="Give"
            onConfirm={() => { if (userId && due) onGive(userId, zonedInputToIso(due, timeZone)); onClose() }}>
            <div className="space-y-3 text-sm">
                <label className="block space-y-1"><span className="font-medium">Person</span>
                    <select value={userId} onChange={(e) => setUserId(e.target.value)} className="nb-select w-full">
                        {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                    </select>
                </label>
                <div className="space-y-1"><span className="block font-medium">Due</span>
                    <DateTimeField value={due} onChange={setDue} timeZone={timeZone} presets={duePresets(timeZone)} />
                </div>
                <p className="text-[12px] text-muted-foreground">They get their own copy and are told.</p>
            </div>
        </ConfirmDialog>
    )
}

type EditPatch = Parameters<typeof updateAssignmentAction>[1]

/**
 * Edit for everyone (report §23.3, decision 39): the same fields as the form, sent only when changed. The hand-in
 * type locks once someone has handed in; a closed one keeps its instructions and due date until reopened.
 */
export function EditAssignmentDialog({ orgId, row, open, onClose, onSave, timeZone = null }: { orgId: string; row: AssignmentRow; open: boolean; onClose: () => void; onSave: (patch: EditPatch) => void; timeZone?: string | null }) {
    const [loaded, setLoaded] = useState<{ description: string; lateRule: string; lateAfterMinutes: number; aiPolicy: string; aiNote: string } | null>(null)
    const [aiPolicy, setAiPolicy] = useState('')
    const [aiNote, setAiNote] = useState('')
    const [sprints, setSprints] = useState<Array<{ id: string; name: string }>>([])
    const [title, setTitle] = useState(row.title)
    const [description, setDescription] = useState('')
    const [tell, setTell] = useState(false)
    // Decision 74: the due date in the organization's time zone.
    const [due, setDue] = useState(row.dueDate ? isoToZonedInput(row.dueDate, timeZone) : '')
    const [lateRule, setLateRule] = useState('none')
    const [lateAfter, setLateAfter] = useState(15)
    const [submissionType, setSubmissionType] = useState(row.submissionType)
    const [review, setReview] = useState(row.reviewRequired)
    const [sprintId, setSprintId] = useState('')
    const [admins, setAdmins] = useState<Array<{ id: string; name: string }>>([])
    const [reviewers, setReviewers] = useState<string[] | null>(null)
    const [savedReviewers, setSavedReviewers] = useState<string[]>([])
    useEffect(() => {
        if (!open) return
        void readAssignmentForReuseAction(row.masterId).then((r) => {
            if (!r.success) return
            setLoaded({ description: r.form.description, lateRule: r.form.lateRule, lateAfterMinutes: r.form.lateAfterMinutes, aiPolicy: r.form.aiPolicy ?? '', aiNote: r.form.aiNote ?? '' })
            setAiPolicy(r.form.aiPolicy ?? ''); setAiNote(r.form.aiNote ?? '')
            setDescription(r.form.description); setLateRule(r.form.lateRule); setLateAfter(r.form.lateAfterMinutes)
            setReviewers(r.form.reviewers ?? []); setSavedReviewers(r.form.reviewers ?? [])
        })
        void readAssignmentComposerOptionsAction(orgId).then((r) => { setSprints(r.success ? r.sprints : []); setAdmins(r.success ? r.admins ?? [] : []) })
    }, [open, orgId, row.masterId])
    const published = row.status === 'open' || row.status === 'closed'
    const handedIn = row.counts.submitted + row.counts.done > 0
    const closed = row.status === 'closed'
    const reach = row.counts.total + row.counts.excused
    const patch = (): EditPatch => ({
        ...(title.trim() && title.trim() !== row.title ? { title: title.trim() } : {}),
        ...(loaded && description !== loaded.description ? { description, tellEveryone: tell } : {}),
        ...(due && (!row.dueDate || zonedInputToIso(due, timeZone) !== new Date(row.dueDate).toISOString()) ? { dueDate: zonedInputToIso(due, timeZone) } : {}),
        ...(loaded && lateRule !== loaded.lateRule ? { lateRule: lateRule as 'none' | 'always' } : {}),
        ...(loaded && lateAfter !== loaded.lateAfterMinutes ? { lateAfterMinutes: lateAfter } : {}),
        ...(submissionType !== row.submissionType ? { submissionType: submissionType as 'none' | 'file' | 'link' | 'text' } : {}),
        ...(review !== row.reviewRequired ? { reviewRequired: review } : {}),
        ...(sprintId ? { sprintId } : {}),
        ...(reviewers && [...reviewers].sort().join() !== [...savedReviewers].sort().join() ? { reviewers } : {}),
        ...(loaded && aiPolicy && aiPolicy !== loaded.aiPolicy ? { aiPolicy: aiPolicy as 'allowed' | 'labelled' | 'not_allowed' } : {}),
        ...(loaded && aiNote !== loaded.aiNote ? { aiNote: aiNote.trim() || null } : {}),
    })
    return (
        <ConfirmDialog open={open} onOpenChange={(v) => { if (!v) onClose() }} size="wide" title={published ? `Edit ${row.title} for everyone` : `Edit ${row.title}`}
            description={published ? `Changes reach ${reach} ${reach === 1 ? 'person' : 'people'}.` : undefined}
            confirmLabel={published ? `Save for ${reach} ${reach === 1 ? 'person' : 'people'}` : 'Save'}
            onConfirm={() => { const p = patch(); if (Object.keys(p).length) onSave(p); onClose() }}>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
                <label className="block space-y-1 sm:col-span-2"><span className="font-medium">Title</span><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></label>
                <label className="block space-y-1 sm:col-span-2"><span className="font-medium">Instructions</span>
                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={10000} disabled={closed} className="nb-textarea" />
                    {closed ? <span className="block text-[12px] text-muted-foreground">Reopen it to change the instructions or due date.</span> : null}
                </label>
                {published && loaded && description !== loaded.description ? (
                    <label className="flex items-center gap-2 sm:col-span-2"><input className="nb-check" type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} /> Tell everyone</label>
                ) : null}
                <div className="space-y-1 sm:col-span-2"><span className="block font-medium">Due</span>
                    <DateTimeField value={due} disabled={closed} onChange={setDue} timeZone={timeZone} presets={duePresets(timeZone)} />
                </div>
                <label className="block space-y-1"><span className="font-medium">Sprint</span>
                    <select value={sprintId} onChange={(e) => setSprintId(e.target.value)} className="nb-select w-full">
                        <option value="">Keep as is</option>
                        {sprints.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
                    </select>
                </label>
                <label className="block space-y-1"><span className="font-medium">Hand-in</span>
                    <select value={submissionType} disabled={handedIn} onChange={(e) => setSubmissionType(e.target.value)} className="nb-select w-full">
                        <option value="file">A file</option><option value="link">A link</option><option value="text">Text</option><option value="none">No submission</option>
                    </select>
                    {handedIn ? <span className="block text-[12px] text-muted-foreground">Locked: someone has handed this in.</span> : null}
                </label>
                <label className="block space-y-1"><span className="font-medium">Late work</span>
                    <select value={lateRule} onChange={(e) => setLateRule(e.target.value)} className="nb-select w-full">
                        <option value="always">Always allowed</option><option value="none">Not allowed</option>
                        {lateRule === 'until' ? <option value="until">Allowed until a date</option> : null}
                    </select>
                    {handedIn ? <span className="block text-[12px] text-muted-foreground">Applies from now on; past submissions keep their marks.</span> : null}
                </label>
                <label className="flex items-center gap-2">Late after
                    <Input type="number" min={0} max={60} value={lateAfter} onChange={(e) => setLateAfter(Math.max(0, Math.min(60, Number(e.target.value) || 0)))} className="w-20" aria-label="Late after, in minutes" /> minutes
                </label>
                <label className="flex items-center gap-2"><input className="nb-check" type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> Review each submission</label>
                {review && reviewers ? <ReviewersPicker admins={admins} value={reviewers} onChange={setReviewers} className="sm:col-span-2" /> : null}
                {/* CLI report A8.2: AI agents on this assignment; empty follows the organization's default. */}
                <label className="block space-y-1"><span className="font-medium">AI agents</span>
                    <select value={aiPolicy} onChange={(e) => setAiPolicy(e.target.value)} className="nb-select w-full">
                        {!loaded?.aiPolicy ? <option value="">Organization default</option> : null}
                        <option value="labelled">Allowed, labelled</option><option value="allowed">Allowed</option><option value="not_allowed">Not allowed</option>
                    </select>
                </label>
                <label className="block space-y-1"><span className="font-medium">Note about AI</span>
                    <Input value={aiNote} onChange={(e) => setAiNote(e.target.value)} maxLength={300} placeholder="Optional" />
                </label>
                {published ? <p className="text-[12px] text-muted-foreground sm:col-span-2">Steps can only be added after publishing, from the roster’s Add step. Turning review off approves nothing already waiting.</p> : null}
            </div>
        </ConfirmDialog>
    )
}

/** B3.3a (report 32.4 call 3): an optional second step — an admin who approves after the first Approve. */
export function ThenApprovedByPicker({ admins, value, onChange, className }: { admins: Array<{ id: string; name: string }>; value: string | null; onChange: (id: string | null) => void; className?: string }) {
    if (admins.length < 2) return null
    return (
        <label className={`block space-y-1 ${className ?? ''}`}><span className="font-medium">Then approved by <span className="font-normal text-muted-foreground">(optional second step)</span></span>
            <select className="nb-select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
                <option value="">No second step</option>
                {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
        </label>
    )
}

/** Reviewers (report §33.5): pick who reviews; nobody picked means every admin's queue has it. Only with 2+ admins. */
export function ReviewersPicker({ admins, value, onChange, className }: { admins: Array<{ id: string; name: string }>; value: string[]; onChange: (ids: string[]) => void; className?: string }) {
    if (admins.length < 2) return null
    return (
        <fieldset className={`space-y-1 ${className ?? ''}`}><legend className="font-medium">Reviewers <span className="font-normal text-muted-foreground">(none picked: everyone)</span></legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
                {admins.map((a) => (
                    <label key={a.id} className="flex items-center gap-1.5"><input className="nb-check" type="checkbox" checked={value.includes(a.id)}
                        onChange={(e) => onChange(e.target.checked ? [...value, a.id] : value.filter((id) => id !== a.id))} />{a.name}</label>
                ))}
            </div>
        </fieldset>
    )
}
