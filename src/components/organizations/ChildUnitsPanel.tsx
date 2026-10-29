'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'

import { moveMemberToUnitAction, readChildUnitsAction, updateUnitAction, type ChildUnits } from '@/app/actions/child-units'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/feedback'

// Team grouped by unit (report §14.4 "Settings → Collaborators"): rename units, change seats, pick the unit lead ★,
// and move people, all with native controls so the keyboard reaches everything.

const select = 'h-8 rounded-md border border-border bg-background px-2 text-xs'

export function ChildUnitsPanel({ projectId }: { projectId: string }) {
    const [data, setData] = useState<ChildUnits | null>(null)
    const [pending, startTransition] = useTransition()
    const load = useCallback(() => void readChildUnitsAction(projectId).then((r) => setData(r.success ? r : null)), [projectId])
    useEffect(() => { load() }, [load])
    if (!data || (data.units.length === 0 && data.unplaced.length === 0)) return null

    const run = (work: () => Promise<{ success: boolean; error?: string }>, done?: string) => startTransition(async () => {
        const result = await work()
        if (!result.success) toast.error(result.error ?? 'Something went wrong.')
        else if (done) toast.success(done)
        load()
    })
    const moveTo = (userId: string, current: string | null) => (
        <select aria-label="Move to…" className={select} value="" disabled={pending}
            onChange={(e) => { const to = e.target.value; if (to) run(() => moveMemberToUnitAction(projectId, userId, to === 'none' ? null : to)) }}>
            <option value="">Move to…</option>
            {data.units.filter((u) => u.id !== current).map((u) => <option key={u.id} value={u.id} disabled={u.filled >= u.count}>{u.title}{u.filled >= u.count ? ' (full)' : ''}</option>)}
            {current ? <option value="none">Not in a unit</option> : null}
        </select>
    )

    return (
        <section aria-labelledby="child-units-heading" className="space-y-3 rounded-lg border border-border bg-card p-4">
            <div>
                <h3 id="child-units-heading" className="nb-card-title text-foreground">Units</h3>
                <p className="nb-compact text-muted-foreground">Members by team. The team lead ★ gets the team&apos;s mentions and reminders.</p>
            </div>
            <ul className="space-y-4">
                {data.units.map((unit) => (
                    <li key={unit.id} className="space-y-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <Input defaultValue={unit.title} aria-label={`Name of ${unit.title}`} maxLength={100} className="h-8 w-56 text-sm"
                                onBlur={(e) => { const title = e.target.value.trim(); if (title && title !== unit.title) run(() => updateUnitAction(projectId, unit.id, { title }), 'Unit renamed') }} />
                            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Seats
                                <Input type="number" min={Math.max(1, unit.filled)} max={10} defaultValue={unit.count} className="h-8 w-16 text-sm" aria-label={`Seats in ${unit.title}`}
                                    onBlur={(e) => { const count = Number(e.target.value); if (Number.isFinite(count) && count !== unit.count) run(() => updateUnitAction(projectId, unit.id, { count })) }} />
                            </label>
                            <span className="text-xs text-muted-foreground">{unit.filled} of {unit.count}{unit.count > unit.filled ? ` · ${unit.count - unit.filled} open` : ''}</span>
                            <select aria-label={`Team lead of ${unit.title}`} className={select} value={unit.leadUserId ?? ''} disabled={pending || unit.members.length === 0}
                                onChange={(e) => run(() => updateUnitAction(projectId, unit.id, { leadUserId: e.target.value || null }), 'Team lead saved')}>
                                <option value="">No team lead</option>
                                {unit.members.map((m) => <option key={m.userId} value={m.userId}>★ {m.name}</option>)}
                            </select>
                        </div>
                        {unit.members.length ? (
                            <ul className="flex flex-wrap gap-2">
                                {unit.members.map((m) => (
                                    <li key={m.userId} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-sm">
                                        {m.userId === unit.leadUserId ? <span aria-label="Team lead">★</span> : null}{m.name}{moveTo(m.userId, unit.id)}
                                    </li>
                                ))}
                            </ul>
                        ) : <p className="text-xs text-muted-foreground">No one yet.</p>}
                    </li>
                ))}
            </ul>
            {data.unplaced.length ? (
                <div className="space-y-2 border-t border-border pt-3">
                    <p className="text-sm font-medium text-foreground">Not in a unit</p>
                    <ul className="flex flex-wrap gap-2">
                        {data.unplaced.map((m) => <li key={m.userId} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-sm">{m.name}{moveTo(m.userId, null)}</li>)}
                    </ul>
                </div>
            ) : null}
        </section>
    )
}
