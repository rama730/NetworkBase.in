'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { createUnitAction, moveMemberToUnitAction, readChildUnitsAction, readTeamMovePreviewAction, removeUnitAction, updateUnitAction, type ChildUnits } from '@/app/actions/child-units'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/feedback'
import { Star } from 'lucide-react'
import { ErrorNotice } from '@/components/ui/ErrorNotice'
import { SettingsCard } from '@/components/workspaces/settings/SettingsFormFields'
import { fieldLabel } from '@/lib/organizations/display'

// Teams and open seats (report §25.3): add, rename and remove teams, change seats, pick the team lead, and move
// people, all with native controls so the keyboard reaches everything.


export function ChildUnitsPanel({ projectId }: { projectId: string }) {
    const [data, setData] = useState<ChildUnits | null>(null)
    const [failed, setFailed] = useState(false)
    const [pending, startTransition] = useTransition()
    const [removing, setRemoving] = useState<ChildUnits['units'][number] | null>(null)
    const [moving, setMoving] = useState<{ userId: string; unitId: string | null; openTasks: number } | null>(null)
    const [moveTasks, setMoveTasks] = useState(true)
    const client = useQueryClient()
    // Audit N60: a team change here also refreshes the Overview's team list (['child-units']), not only this panel.
    const load = useCallback(() => void readChildUnitsAction(projectId).then((r) => { setFailed(!r.success); setData(r.success ? r : null); void client.invalidateQueries({ queryKey: ['child-units', projectId] }) }), [projectId, client])
    useEffect(() => { load() }, [load])
    if (failed) return <ErrorNotice what="Teams" onRetry={load} />
    if (!data) return <div className="nb-skeleton h-40 rounded-lg" role="status" aria-label="Loading teams" />

    const run = (work: () => Promise<{ success: boolean; error?: string }>, done?: string) => startTransition(async () => {
        const result = await work()
        if (!result.success) toast.error(result.error ?? 'Something went wrong.')
        else if (done) toast.success(done)
        load()
    })
    const moveTo = (userId: string, current: string | null) => (
        <select aria-label="Move to…" className="nb-select" data-size="sm" value="" disabled={pending}
            onChange={(e) => {
                const to = e.target.value === 'none' ? null : e.target.value
                if (!e.target.value) return
                // Problem 17: offer to carry their open team tasks over, when they have some.
                startTransition(async () => {
                    const preview = current ? await readTeamMovePreviewAction(projectId, userId, to) : null
                    if (preview?.success && preview.openTasks > 0) { setMoveTasks(true); setMoving({ userId, unitId: to, openTasks: preview.openTasks }) }
                    else run(() => moveMemberToUnitAction(projectId, userId, to))
                })
            }}>
            <option value="">Move to…</option>
            {data.units.filter((u) => u.id !== current).map((u) => <option key={u.id} value={u.id} disabled={u.filled >= u.count}>{u.title}{u.filled >= u.count ? ' (full)' : ''}</option>)}
            {current ? <option value="none">Not in a team</option> : null}
        </select>
    )

    return (
        <SettingsCard title="Teams and open seats" description="Members by team. The team lead is the team’s first contact. @Team in a comment reaches everyone on it.">
            <div className="space-y-4">
            {data.units.length === 0 ? <p className="text-[13px] text-muted-foreground">No teams yet. A workspace works fine without them.</p> : null}
            <ul className="space-y-4">
                {data.units.map((unit) => (
                    <li key={unit.id} className="space-y-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <Input defaultValue={unit.title} aria-label={`Name of ${unit.title}`} maxLength={100} className="h-[var(--ui-control-height-sm)] w-56 text-[13px]"
                                onBlur={(e) => { const title = e.target.value.trim(); if (title && title !== unit.title) run(() => updateUnitAction(projectId, unit.id, { title }), 'Team renamed') }} />
                            <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">Seats
                                <Input type="number" min={Math.max(1, unit.filled)} max={10} defaultValue={unit.count} className="h-[var(--ui-control-height-sm)] w-16 text-[13px]" aria-label={`Seats in ${unit.title}`}
                                    onBlur={(e) => { const count = Number(e.target.value); if (Number.isFinite(count) && count !== unit.count) run(() => updateUnitAction(projectId, unit.id, { count })) }} />
                            </label>
                            <span className="nb-meta">{unit.filled} of {unit.count}{unit.count > unit.filled ? ` · ${unit.count - unit.filled} open` : ''}</span>
                            <select aria-label={`Team lead of ${unit.title}`} className="nb-select" data-size="sm" value={unit.leadUserId ?? ''} disabled={pending || unit.members.length === 0}
                                onChange={(e) => run(() => updateUnitAction(projectId, unit.id, { leadUserId: e.target.value || null }), 'Team lead saved')}>
                                <option value="">No team lead</option>
                                {unit.members.map((m) => <option key={m.userId} value={m.userId}>Lead: {m.name}</option>)}
                            </select>
                            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setRemoving(unit)}>Remove</Button>
                        </div>
                        {unit.members.length ? (
                            <ul className="flex flex-wrap gap-2">
                                {unit.members.map((m) => (
                                    <li key={m.userId} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card py-0.5 pl-2.5 pr-0.5 text-[13px]">
                                        {m.userId === unit.leadUserId ? <Star className="size-3.5 fill-current text-primary" aria-label="Team lead" /> : null}{m.name}{moveTo(m.userId, unit.id)}
                                    </li>
                                ))}
                            </ul>
                        ) : <p className="text-[13px] text-muted-foreground">No one yet.</p>}
                    </li>
                ))}
            </ul>
            {data.unplaced.length ? (
                <div className="space-y-2 border-t border-border pt-3">
                    <p className={fieldLabel}>Not in a team</p>
                    <ul className="flex flex-wrap gap-2">
                        {data.unplaced.map((m) => <li key={m.userId} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card py-0.5 pl-2.5 pr-0.5 text-[13px]">{m.name}{moveTo(m.userId, null)}</li>)}
                    </ul>
                </div>
            ) : null}
            {data.units.length < 20 ? (
                <form className="flex flex-wrap items-end gap-2 border-t border-border pt-3"
                    onSubmit={(e) => {
                        e.preventDefault()
                        const form = e.currentTarget
                        const fields = new FormData(form)
                        run(async () => {
                            const r = await createUnitAction(projectId, { title: String(fields.get('title') ?? ''), count: Number(fields.get('count')) })
                            if (r.success) form.reset()
                            return r
                        }, 'Team added')
                    }}>
                    <label className="flex flex-col gap-1.5"><span className={fieldLabel}>Team name</span>
                        <Input name="title" required maxLength={100} className="w-56" placeholder="Frontend" />
                    </label>
                    <label className="flex flex-col gap-1.5"><span className={fieldLabel}>Seats</span>
                        <Input name="count" type="number" min={1} max={10} defaultValue={4} required className="w-20" />
                    </label>
                    <Button type="submit" variant="outline" disabled={pending}>Add team</Button>
                </form>
            ) : <p className="text-[13px] text-muted-foreground">A workspace has up to 20 teams.</p>}
            <ConfirmDialog open={Boolean(removing)} onOpenChange={(open) => { if (!open) setRemoving(null) }}
                title={`Remove ${removing?.title ?? 'this team'}?`}
                description={`${removing?.members.length ?? 0} ${removing?.members.length === 1 ? 'person stays' : 'people stay'} in the workspace, not in a team. Waiting applications close, and those people are told.`}
                confirmLabel="Remove" variant="destructive"
                onConfirm={() => { const unit = removing; setRemoving(null); if (unit) run(() => removeUnitAction(projectId, unit.id), 'Team removed') }} />
            <ConfirmDialog open={Boolean(moving)} onOpenChange={(open) => { if (!open) setMoving(null) }}
                title="Move them to another team?" confirmLabel="Move"
                onConfirm={() => { const m = moving; setMoving(null); if (m) run(() => moveMemberToUnitAction(projectId, m.userId, m.unitId, moveTasks), 'Moved. They’re told.') }}>
                <label className="flex items-center gap-2.5 px-6 text-[13px]">
                    <input type="checkbox" className="nb-check" checked={moveTasks} onChange={(e) => setMoveTasks(e.target.checked)} />
                    Also move them on {moving?.openTasks} open team task{moving?.openTasks === 1 ? '' : 's'}
                </label>
                <p className="px-6 text-[13px] text-muted-foreground">Handed-in work stays as it is.</p>
            </ConfirmDialog>
            </div>
        </SettingsCard>
    )
}
