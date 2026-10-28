'use client'

import { useEffect, useMemo, useState } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import { UserPlus, X } from 'lucide-react'

import { listOrgRosterAction, type OrgRosterPerson } from '@/app/actions/organizations'
import { useCreateLocation } from '@/components/organizations/CreateLocation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { CreateProjectInput } from '@/lib/validations/project'

// The child project team in the create wizard (report §14.4): units are the role boxes, filled with people
// from the org roster. Admins add people directly; members invite them.

type Person = { user_id: string; label?: string }
const UNIT_SEATS = 10

/** Everyone already placed (any unit, not in a unit, or the lead), so a person sits in one place at a time. */
function usePlaced() {
    const roles = useWatch<CreateProjectInput, 'roles'>({ name: 'roles' }) ?? []
    const unassigned = useWatch<CreateProjectInput, 'unassigned_people'>({ name: 'unassigned_people' }) ?? []
    const lead = useWatch<CreateProjectInput, 'lead_user_id'>({ name: 'lead_user_id' })
    return useMemo(() => new Set([...roles.flatMap((role) => (role.people ?? []).map((p) => p.user_id)), ...unassigned.map((p) => p.user_id), ...(lead ? [lead] : [])]), [roles, unassigned, lead])
}

function useRoster(orgId: string | undefined, query: string) {
    const [people, setPeople] = useState<OrgRosterPerson[]>([])
    useEffect(() => {
        if (!orgId) return
        let cancelled = false
        const timer = setTimeout(() => void listOrgRosterAction(orgId, query).then((rows) => { if (!cancelled) setPeople(rows) }), 250)
        return () => { cancelled = true; clearTimeout(timer) }
    }, [orgId, query])
    return people
}

/** The roster side sheet: search, tick people, "Add 4 to Frontend". */
function OrgPeoplePicker({ open, onOpenChange, target, limit, onAdd }: { open: boolean; onOpenChange: (open: boolean) => void; target: string; limit: number; onAdd: (people: Person[]) => void }) {
    const { org } = useCreateLocation()
    const placed = usePlaced()
    const [query, setQuery] = useState('')
    const [ticked, setTicked] = useState<Person[]>([])
    const roster = useRoster(open ? org?.id : undefined, query)
    const toggle = (person: OrgRosterPerson) => setTicked((current) => current.some((p) => p.user_id === person.userId)
        ? current.filter((p) => p.user_id !== person.userId)
        : current.length < limit ? [...current, { user_id: person.userId, label: person.name }] : current)

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) setTicked([]); onOpenChange(next) }}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Add people to {target}</DialogTitle>
                    <DialogDescription>From {org?.title}. Search by name or title, for example &quot;Section B&quot;.</DialogDescription>
                </DialogHeader>
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people" aria-label="Search people" autoFocus />
                <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border" aria-label="Organization members">
                    {roster.length === 0 ? <li className="px-3 py-4 text-sm text-muted-foreground">No one matches.</li> : null}
                    {roster.map((person) => {
                        const already = placed.has(person.userId)
                        const checked = already || ticked.some((p) => p.user_id === person.userId)
                        return (
                            <li key={person.userId}>
                                <label className={`flex items-center gap-3 px-3 py-2 ${already ? 'opacity-60' : 'cursor-pointer hover:bg-muted/50'}`}>
                                    <input type="checkbox" checked={checked} disabled={already || (!checked && ticked.length >= limit)} onChange={() => toggle(person)} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm text-foreground">{person.name}{person.title ? <span className="text-muted-foreground"> · {person.title}</span> : null}</span>
                                        {person.projectHint ? <span className="block truncate text-xs text-muted-foreground">{person.projectHint}</span> : null}
                                    </span>
                                </label>
                            </li>
                        )
                    })}
                </ul>
                <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground" aria-live="polite">{limit < 1 ? 'This unit is full.' : `${ticked.length} of up to ${limit} picked.`}</p>
                    <Button type="button" disabled={ticked.length === 0} onClick={() => { onAdd(ticked); setTicked([]); onOpenChange(false) }}>
                        Add {ticked.length || ''} to {target}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

function PeopleChips({ people, onRemove, isAdmin }: { people: Person[]; onRemove: (userId: string) => void; isAdmin: boolean }) {
    if (people.length === 0) return null
    return (
        <ul className="flex flex-wrap gap-2" aria-label="People">
            {people.map((person) => (
                <li key={person.user_id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pl-2.5 pr-1 text-sm">
                    {person.label ?? 'Member'}
                    <span className="text-[11px] text-muted-foreground">{isAdmin ? 'Will be added' : 'Will be invited'}</span>
                    <button type="button" onClick={() => onRemove(person.user_id)} aria-label={`Remove ${person.label ?? 'person'}`} className="nb-icon-button size-6 rounded-full">
                        <X className="size-3" aria-hidden="true" />
                    </button>
                </li>
            ))}
        </ul>
    )
}

/** Inside a role box: the people in this unit, "+ Add people", and seats that grow to fit them. */
export function UnitPeople({ index, unitName }: { index: number; unitName: string }) {
    const { setValue, getValues } = useFormContext<CreateProjectInput>()
    const { org } = useCreateLocation()
    const people = useWatch<CreateProjectInput, `roles.${number}.people`>({ name: `roles.${index}.people` }) ?? []
    const [open, setOpen] = useState(false)
    if (!org) return null
    const save = (next: Person[]) => {
        setValue(`roles.${index}.people`, next, { shouldDirty: true })
        const count = getValues(`roles.${index}.count`) ?? 1
        if (next.length > count) setValue(`roles.${index}.count`, Math.min(UNIT_SEATS, next.length), { shouldDirty: true, shouldValidate: true })
    }
    const name = unitName.trim() || 'this unit'
    return (
        <div className="space-y-2 pt-3">
            <PeopleChips people={people} isAdmin={org.isAdmin} onRemove={(userId) => save(people.filter((p) => p.user_id !== userId))} />
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} disabled={people.length >= UNIT_SEATS}>
                <UserPlus className="size-4" aria-hidden="true" />Add people
            </Button>
            <OrgPeoplePicker open={open} onOpenChange={setOpen} target={name} limit={UNIT_SEATS - people.length} onAdd={(added) => save([...people, ...added])} />
        </div>
    )
}

/** Admins: who leads the project (becomes its owner, decision 11), and people outside any unit. */
export function ChildLeadAndUnassigned() {
    const { setValue } = useFormContext<CreateProjectInput>()
    const { org } = useCreateLocation()
    const lead = useWatch<CreateProjectInput, 'lead_user_id'>({ name: 'lead_user_id' })
    const unassigned = useWatch<CreateProjectInput, 'unassigned_people'>({ name: 'unassigned_people' }) ?? []
    const roster = useRoster(org?.isAdmin ? org.id : undefined, '')
    const [open, setOpen] = useState(false)
    if (!org?.isAdmin) return null
    return (
        <section aria-labelledby="child-lead-heading" className="space-y-5 border-t border-border pt-6">
            <div>
                <h3 id="child-lead-heading" className="nb-card-title text-foreground">Project lead</h3>
                <p className="nb-compact mt-1 text-muted-foreground">The lead owns the project. You stay an admin through {org.title}.</p>
                <select
                    aria-label="Project lead"
                    value={lead ?? ''}
                    onChange={(e) => setValue('lead_user_id', e.target.value || undefined, { shouldDirty: true })}
                    className="mt-2 h-[var(--ui-control-height)] min-w-64 rounded-md border border-input bg-background px-2 text-sm"
                >
                    <option value="">Me</option>
                    {roster.filter((p) => !unassigned.some((u) => u.user_id === p.userId)).map((person) => (
                        <option key={person.userId} value={person.userId}>{person.name}{person.title ? ` · ${person.title}` : ''}</option>
                    ))}
                </select>
            </div>
            <div className="space-y-2">
                <h3 className="nb-card-title text-foreground">Not in a unit</h3>
                <p className="nb-compact text-muted-foreground">For small projects: people added without a unit.</p>
                <PeopleChips people={unassigned} isAdmin onRemove={(userId) => setValue('unassigned_people', unassigned.filter((p) => p.user_id !== userId), { shouldDirty: true })} />
                <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}><UserPlus className="size-4" aria-hidden="true" />Add people</Button>
                <OrgPeoplePicker open={open} onOpenChange={setOpen} target="the project" limit={100 - unassigned.length} onAdd={(added) => setValue('unassigned_people', [...unassigned, ...added], { shouldDirty: true })} />
            </div>
        </section>
    )
}
