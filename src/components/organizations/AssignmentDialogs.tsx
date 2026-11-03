'use client'

import { useEffect, useState } from 'react'

import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/input'

// Roster dialogs (report §34.6): every browser pop-up becomes a dialog that says what happens.

const DAY = 86_400_000
/** A date as a datetime-local value in the viewer's own zone. */
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
const area = 'w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** Return, or Change decision on approved work (decisions 40, 126): a reason they'll see, and Fix by, 3 days out. */
export function ReturnDialog({ label, change = false, open, onClose, onReturn }: { label: string; change?: boolean; open: boolean; onClose: () => void; onReturn: (reason: string, fixBy: string) => void }) {
    const [reason, setReason] = useState('')
    const [fixBy, setFixBy] = useState('')
    useEffect(() => { if (open) { setReason(''); setFixBy(toLocalInput(new Date(Date.now() + 3 * DAY))) } }, [open])
    return (
        <ConfirmDialog open={open} onOpenChange={(v) => { if (!v) onClose() }} title={change ? `Return ${label}’s approved work?` : `Return ${label}’s work?`}
            confirmLabel="Return" onConfirm={() => { if (reason.trim() && fixBy) onReturn(reason.trim(), new Date(fixBy).toISOString()); onClose() }}>
            <div className="space-y-3 text-sm">
                <label className="block space-y-1"><span className="font-medium">What should they change?</span>
                    <textarea required value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} className={area} />
                    <span className="block text-[12px] text-muted-foreground">They’ll see this.</span>
                </label>
                <label className="block space-y-1"><span className="font-medium">Fix by</span>
                    <Input type="datetime-local" required value={fixBy} onChange={(e) => setFixBy(e.target.value)} />
                    <span className="block text-[12px] text-muted-foreground">They can hand it in again until then, even past the due date.</span>
                </label>
            </div>
        </ConfirmDialog>
    )
}

/** Extend (report §34.6): a date with shortcuts; on a closed assignment it asks to reopen it for them (smaller bug 18). */
export function ExtendDialog({ label, currentDue, closed, open, onClose, onExtend }: { label: string; currentDue: string | null; closed: boolean; open: boolean; onClose: () => void; onExtend: (dueIso: string, reopen: boolean) => void }) {
    const [value, setValue] = useState('')
    const [reopen, setReopen] = useState(false)
    const base = currentDue && new Date(currentDue).getTime() > Date.now() ? new Date(currentDue) : new Date()
    useEffect(() => { if (open) { setValue(toLocalInput(new Date(base.getTime() + DAY))); setReopen(false) } }, [open])
    const ready = Boolean(value) && (!closed || reopen)
    return (
        <ConfirmDialog open={open} onOpenChange={(v) => { if (!v) onClose() }} title={`Extend for ${label}`} confirmLabel="Extend"
            onConfirm={() => { if (ready) onExtend(new Date(value).toISOString(), reopen); onClose() }}>
            <div className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-1.5">
                    {[['+1 day', 1], ['+3 days', 3], ['+1 week', 7]].map(([text, days]) => (
                        <button key={text} type="button" className="rounded-[3px] border border-border px-2 py-0.5 text-xs hover:bg-muted" onClick={() => setValue(toLocalInput(new Date(base.getTime() + Number(days) * DAY)))}>{text}</button>
                    ))}
                </div>
                <label className="block space-y-1"><span className="font-medium">New due date</span>
                    <Input type="datetime-local" required value={value} onChange={(e) => setValue(e.target.value)} />
                </label>
                {closed ? (
                    <label className="flex items-start gap-2">
                        <input type="checkbox" className="mt-1" checked={reopen} onChange={(e) => setReopen(e.target.checked)} />
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
                <textarea required value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} className={area} />
                <span className="block text-[12px] text-muted-foreground">They’ll see this. Their work stays, and they leave the counts.</span>
            </label>
        </ConfirmDialog>
    )
}

/** Give to (decision 88): a copy for someone without one, with their own due date. */
export function GiveToDialog({ people, open, onClose, onGive }: { people: Array<{ userId: string; name: string }>; open: boolean; onClose: () => void; onGive: (userId: string, dueIso: string) => void }) {
    const [userId, setUserId] = useState('')
    const [due, setDue] = useState('')
    useEffect(() => { if (open) { setUserId(people[0]?.userId ?? ''); setDue(toLocalInput(new Date(Date.now() + 7 * DAY))) } }, [open, people])
    return (
        <ConfirmDialog open={open} onOpenChange={(v) => { if (!v) onClose() }} title="Give this to someone" confirmLabel="Give"
            onConfirm={() => { if (userId && due) onGive(userId, new Date(due).toISOString()); onClose() }}>
            <div className="space-y-3 text-sm">
                <label className="block space-y-1"><span className="font-medium">Person</span>
                    <select value={userId} onChange={(e) => setUserId(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2">
                        {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                    </select>
                </label>
                <label className="block space-y-1"><span className="font-medium">Due</span>
                    <Input type="datetime-local" required value={due} onChange={(e) => setDue(e.target.value)} />
                </label>
                <p className="text-[12px] text-muted-foreground">They get their own copy and are told.</p>
            </div>
        </ConfirmDialog>
    )
}
