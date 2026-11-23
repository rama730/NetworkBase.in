'use client'

import { useState, useTransition } from 'react'
import { Plus, Star, X } from 'lucide-react'

import { createTeamTasksAction } from '@/app/actions/child-units'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { DateTimeField, duePresets } from '@/components/organizations/DateTimeField'

// A child project's team task (report §16.11): Teams (boxes of project people) or Each unit (its units become the
// teams). One shared task per team; any teammate works and moves it; the lead is the assignee.

type Member = { id: string; fullName?: string | null; username?: string | null }
type Box = { name: string; userIds: string[]; leadId: string | null }

export function TeamTaskDialog({ projectId, members, open, onOpenChange, onCreated, prefill }: { projectId: string; members: Member[]; open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void; prefill?: { title: string; description: string } }) {
    const [title, setTitle] = useState(prefill?.title ?? '')
    const [description, setDescription] = useState(prefill?.description ?? '')
    const [due, setDue] = useState('')
    const [mode, setMode] = useState<'units' | 'teams'>('units')
    const [teams, setTeams] = useState<Box[]>([{ name: 'Team A', userIds: [], leadId: null }])
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const nameOf = (id: string) => { const m = members.find((x) => x.id === id); return m?.fullName || m?.username || 'Member' }
    const placed = new Set(teams.flatMap((t) => t.userIds))
    const select = 'nb-select'

    const create = () => startTransition(async () => {
        const result = await createTeamTasksAction(projectId, { title, description, dueDate: due ? new Date(due).toISOString() : null, mode, teams: mode === 'teams' ? teams : undefined })
        if (!result.success) return setError(result.error)
        setError(null)
        onOpenChange(false)
        onCreated()
    })

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Team task</DialogTitle>
                    <DialogDescription>One shared task per team. Anyone on the team can move it or tick its steps.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <label className="block text-sm font-medium">Title<Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="mt-1" /></label>
                    <label className="block text-sm font-medium">Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="nb-textarea mt-1 w-full" /></label>
                    <div className="space-y-1"><span className="block text-sm font-medium">Due</span>
                        <DateTimeField value={due} onChange={setDue} timeZone={null} presets={duePresets(null)} />
                    </div>
                    <fieldset>
                        <legend className="text-sm font-medium">Assign to</legend>
                        <div className="mt-1 flex gap-4 text-sm">
                            <label className="flex items-center gap-1.5"><input className="nb-radio" type="radio" name="team-task-mode" checked={mode === 'units'} onChange={() => setMode('units')} /> Each team</label>
                            <label className="flex items-center gap-1.5"><input className="nb-radio" type="radio" name="team-task-mode" checked={mode === 'teams'} onChange={() => setMode('teams')} /> Teams</label>
                        </div>
                    </fieldset>
                    {mode === 'units' ? <p className="text-sm text-muted-foreground">Each team with people gets one task, led by its team lead.</p> : (
                        <div className="space-y-2">
                            {teams.map((team, ti) => (
                                <div key={ti} className="space-y-2 rounded-md border border-border p-2">
                                    <div className="flex items-center gap-2">
                                        <Input value={team.name} aria-label="Team name" maxLength={60} className="h-8 w-40" onChange={(e) => setTeams((cur) => cur.map((t, i) => (i === ti ? { ...t, name: e.target.value } : t)))} />
                                        <span className="text-xs text-muted-foreground">{team.userIds.length} people</span>
                                        <button type="button" aria-label={`Remove ${team.name}`} className="nb-icon-button ml-auto size-7" onClick={() => setTeams((cur) => cur.filter((_, i) => i !== ti))}><X className="size-3.5" aria-hidden="true" /></button>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {team.userIds.map((id) => (
                                            <button key={id} type="button" aria-pressed={team.leadId === id} aria-label={`${nameOf(id)}, ${team.leadId === id ? 'team lead' : 'make team lead'}`}
                                                onClick={() => setTeams((cur) => cur.map((t, i) => (i === ti ? { ...t, leadId: id } : t)))} className="nb-tag">
                                                {team.leadId === id ? <Star className="size-3 fill-current" aria-hidden="true" /> : null}{nameOf(id)}
                                            </button>
                                        ))}
                                        <select value="" aria-label={`Add to ${team.name}`} className="nb-select"
                                            onChange={(e) => { const id = e.target.value; if (id) setTeams((cur) => cur.map((t, i) => (i === ti ? { ...t, userIds: [...t.userIds, id], leadId: t.leadId ?? id } : t))) }}>
                                            <option value="">+ Add person</option>
                                            {members.filter((m) => !placed.has(m.id)).map((m) => <option key={m.id} value={m.id}>{m.fullName || m.username}</option>)}
                                        </select>
                                    </div>
                                </div>
                            ))}
                            <Button type="button" size="sm" variant="outline" onClick={() => setTeams((cur) => [...cur, { name: `Team ${String.fromCharCode(65 + cur.length)}`, userIds: [], leadId: null }])}><Plus className="size-3.5" aria-hidden="true" />Add team</Button>
                        </div>
                    )}
                    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                    <div className="flex justify-end"><Button type="button" disabled={pending || !title.trim()} onClick={create}>Create</Button></div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
