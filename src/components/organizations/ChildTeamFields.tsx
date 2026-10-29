'use client'

import { useEffect, useMemo, useState } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import { Star, UserPlus, X } from 'lucide-react'

import { listOrgRosterAction, listOutsidePeopleAction, type OrgRosterPerson } from '@/app/actions/organizations'
import { useCreateLocation } from '@/components/organizations/CreateLocation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { CreateProjectInput } from '@/lib/validations/workspace'

// The child project team in the create wizard (report §14.4): units are the role boxes, filled with people
// from the org roster. Admins add people directly; members invite them. People outside the org are always invited.

type Person = { user_id: string; label?: string; outside?: boolean }
const UNIT_SEATS = 10
const UNASSIGNED = 'unassigned'

/** Everyone already placed (any unit, not in a unit, or the lead), so a person sits in one place at a time. */
function usePlaced() {
    const roles = useWatch<CreateProjectInput, 'roles'>({ name: 'roles' }) ?? []
    const unassigned = useWatch<CreateProjectInput, 'unassigned_people'>({ name: 'unassigned_people' }) ?? []
    const lead = useWatch<CreateProjectInput, 'lead_user_id'>({ name: 'lead_user_id' })
    return useMemo(() => new Set([...roles.flatMap((role) => (role.people ?? []).map((p) => p.user_id)), ...unassigned.map((p) => p.user_id), ...(lead ? [lead] : [])]), [roles, unassigned, lead])
}

function useRoster(orgId: string | undefined, query: string, source: 'org' | 'outside' | 'admins' = 'org') {
    const [people, setPeople] = useState<OrgRosterPerson[]>([])
    useEffect(() => {
        if (!orgId) return
        let cancelled = false
        const read = source === 'outside' ? listOutsidePeopleAction(orgId, query) : listOrgRosterAction(orgId, query, source === 'admins')
        const timer = setTimeout(() => void read.then((rows) => { if (!cancelled) setPeople(rows) }), 250)
        return () => { cancelled = true; clearTimeout(timer) }
    }, [orgId, query, source])
    return people
}

/** Moving a person between units, or out of every unit (admins only); a moved unit lead stops being lead. */
function useMovePerson() {
    const { getValues, setValue } = useFormContext<CreateProjectInput>()
    return (person: Person, from: number | typeof UNASSIGNED, to: number | typeof UNASSIGNED) => {
        if (from === to) return
        const roles = getValues('roles') ?? []
        const without = (list: Person[] | undefined) => (list ?? []).filter((p) => p.user_id !== person.user_id)
        if (from === UNASSIGNED) setValue('unassigned_people', without(getValues('unassigned_people')), { shouldDirty: true })
        else {
            setValue(`roles.${from}.people`, without(roles[from]?.people), { shouldDirty: true })
            if (roles[from]?.lead_user_id === person.user_id) setValue(`roles.${from}.lead_user_id`, undefined, { shouldDirty: true })
        }
        if (to === UNASSIGNED) setValue('unassigned_people', [...(getValues('unassigned_people') ?? []), person], { shouldDirty: true })
        else {
            const next = [...(roles[to]?.people ?? []), person]
            setValue(`roles.${to}.people`, next, { shouldDirty: true })
            if (next.length > (roles[to]?.count ?? 1)) setValue(`roles.${to}.count`, Math.min(UNIT_SEATS, next.length), { shouldDirty: true, shouldValidate: true })
        }
    }
}

/** The roster side sheet: search, filter, tick people, "Add 4 to Frontend developers"; Outside when the org allows it. */
function OrgPeoplePicker({ open, onOpenChange, target, limit, onAdd }: { open: boolean; onOpenChange: (open: boolean) => void; target: string; limit: number; onAdd: (people: Person[]) => void }) {
    const { org } = useCreateLocation()
    const placed = usePlaced()
    const [query, setQuery] = useState('')
    const [tab, setTab] = useState<'org' | 'outside'>('org')
    const [role, setRole] = useState<'all' | 'member' | 'admin'>('all')
    const [notInProject, setNotInProject] = useState(false)
    const [skill, setSkill] = useState('')
    const [ticked, setTicked] = useState<Person[]>([])
    const roster = useRoster(open ? org?.id : undefined, query, tab)
    const shown = roster.filter((person) => tab === 'outside' || (
        (role === 'all' || (role === 'admin' ? person.role === 'admin' || person.role === 'owner' : person.role === 'member'))
        && (!notInProject || !person.projectHint)
        && (!skill.trim() || (person.skills ?? []).some((s) => s.toLowerCase().includes(skill.trim().toLowerCase())))))
    const toggle = (person: OrgRosterPerson) => setTicked((current) => current.some((p) => p.user_id === person.userId)
        ? current.filter((p) => p.user_id !== person.userId)
        : current.length < limit ? [...current, { user_id: person.userId, label: person.name, ...(tab === 'outside' ? { outside: true } : {}) }] : current)
    const select = 'h-8 rounded-md border border-border bg-background px-2 text-xs'

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) setTicked([]); onOpenChange(next) }}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Add people to {target}</DialogTitle>
                    <DialogDescription>From {org?.title}. Search by name, title or skill, for example &quot;Section B&quot;.</DialogDescription>
                </DialogHeader>
                {org?.outsidePeople ? (
                    <div role="tablist" aria-label="Who to add" className="flex gap-1 text-sm">
                        <button type="button" role="tab" aria-selected={tab === 'org'} onClick={() => setTab('org')} className={tab === 'org' ? 'rounded-md bg-muted px-2 py-1 font-medium' : 'px-2 py-1 text-muted-foreground'}>In {org.title}</button>
                        <button type="button" role="tab" aria-selected={tab === 'outside'} onClick={() => setTab('outside')} className={tab === 'outside' ? 'rounded-md bg-muted px-2 py-1 font-medium' : 'px-2 py-1 text-muted-foreground'}>Outside {org.title}</button>
                    </div>
                ) : null}
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === 'outside' ? 'Search by name or @username' : 'Search people'} aria-label="Search people" autoFocus />
                {tab === 'org' ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <select aria-label="Role" className={select} value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                            <option value="all">Everyone</option><option value="member">Members</option><option value="admin">Admins</option>
                        </select>
                        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={notInProject} onChange={(e) => setNotInProject(e.target.checked)} /> Not in a workspace yet</label>
                        <Input value={skill} onChange={(e) => setSkill(e.target.value)} placeholder="Skill" aria-label="Filter by skill" className="h-8 w-28 text-xs" />
                    </div>
                ) : <p className="text-xs text-muted-foreground">They join only this workspace, by invitation, and never see {org?.title}&apos;s own content.</p>}
                <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border" aria-label={tab === 'outside' ? 'People outside the organization' : 'Organization members'}>
                    {shown.length === 0 ? <li className="px-3 py-4 text-sm text-muted-foreground">{tab === 'outside' && query.trim().length < 2 ? 'Type at least two letters.' : 'No one matches.'}</li> : null}
                    {shown.map((person) => {
                        const already = placed.has(person.userId)
                        const checked = already || ticked.some((p) => p.user_id === person.userId)
                        return (
                            <li key={person.userId}>
                                <label className={`flex items-center gap-3 px-3 py-2 ${already ? 'opacity-60' : 'cursor-pointer hover:bg-muted/50'}`}>
                                    <input type="checkbox" checked={checked} disabled={already || (!checked && ticked.length >= limit)} onChange={() => toggle(person)} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm text-foreground">{person.name}{person.title ? <span className="text-muted-foreground"> · {person.title}</span> : null}</span>
                                        {person.projectHint || person.skills?.length ? <span className="block truncate text-xs text-muted-foreground">{[person.projectHint, person.skills?.slice(0, 3).join(', ')].filter(Boolean).join(' · ')}</span> : null}
                                    </span>
                                </label>
                            </li>
                        )
                    })}
                </ul>
                <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground" aria-live="polite">{limit < 1 ? 'This team is full.' : `${ticked.length} of up to ${limit} picked.`}</p>
                    <Button type="button" disabled={ticked.length === 0} onClick={() => { onAdd(ticked); setTicked([]); onOpenChange(false) }}>
                        Add {ticked.length || ''} to {target}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

/** One person's chip: unit lead ★ (units only), Move to… (keyboard), remove. */
function PeopleChips({ people, from, leadId, onLead, onRemove, isAdmin }: {
    people: Person[]; from: number | typeof UNASSIGNED; leadId?: string; onLead?: (userId: string | undefined) => void; onRemove: (userId: string) => void; isAdmin: boolean
}) {
    const roles = useWatch<CreateProjectInput, 'roles'>({ name: 'roles' }) ?? []
    const move = useMovePerson()
    if (people.length === 0) return null
    return (
        <ul className="flex flex-wrap gap-2" aria-label="People">
            {people.map((person) => {
                const name = person.label ?? 'Member'
                const isLead = leadId === person.user_id
                return (
                    <li key={person.user_id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pl-2.5 pr-1 text-sm">
                        {onLead ? (
                            <button type="button" aria-pressed={isLead} aria-label={isLead ? `${name} is team lead` : `Make ${name} team lead`} title={isLead ? 'Team lead' : 'Make team lead'}
                                onClick={() => onLead(isLead ? undefined : person.user_id)} className="nb-icon-button size-6 rounded-full">
                                <Star className={`size-3 ${isLead ? 'fill-current text-primary' : ''}`} aria-hidden="true" />
                            </button>
                        ) : null}
                        {name}
                        <span className="text-[11px] text-muted-foreground">{isAdmin && !person.outside ? 'Will be added' : 'Will be invited'}</span>
                        <select aria-label={`Move ${name} to…`} value="" className="h-6 rounded border border-border bg-background px-1 text-[11px]"
                            onChange={(e) => { const to = e.target.value; if (to) move(person, from, to === UNASSIGNED ? UNASSIGNED : Number(to)) }}>
                            <option value="">Move to…</option>
                            {roles.map((unit, i) => (i === from || !unit.role.trim() ? null : <option key={i} value={String(i)} disabled={(unit.people?.length ?? 0) >= UNIT_SEATS}>{unit.role}</option>))}
                            {isAdmin && from !== UNASSIGNED ? <option value={UNASSIGNED}>Not in a team</option> : null}
                        </select>
                        <button type="button" onClick={() => onRemove(person.user_id)} aria-label={`Remove ${name}`} className="nb-icon-button size-6 rounded-full">
                            <X className="size-3" aria-hidden="true" />
                        </button>
                    </li>
                )
            })}
        </ul>
    )
}

/** Inside a role box: the people in this unit, its lead ★, "+ Add people", and seats that grow to fit them. */
export function UnitPeople({ index, unitName }: { index: number; unitName: string }) {
    const { setValue, getValues } = useFormContext<CreateProjectInput>()
    const { org } = useCreateLocation()
    const people = useWatch<CreateProjectInput, `roles.${number}.people`>({ name: `roles.${index}.people` }) ?? []
    const leadId = useWatch<CreateProjectInput, `roles.${number}.lead_user_id`>({ name: `roles.${index}.lead_user_id` })
    const [open, setOpen] = useState(false)
    if (!org) return null
    const save = (next: Person[]) => {
        setValue(`roles.${index}.people`, next, { shouldDirty: true })
        if (leadId && !next.some((p) => p.user_id === leadId)) setValue(`roles.${index}.lead_user_id`, undefined, { shouldDirty: true })
        const count = getValues(`roles.${index}.count`) ?? 1
        if (next.length > count) setValue(`roles.${index}.count`, Math.min(UNIT_SEATS, next.length), { shouldDirty: true, shouldValidate: true })
    }
    const name = unitName.trim() || 'this team'
    return (
        <div className="space-y-2 pt-3">
            <PeopleChips people={people} from={index} leadId={leadId} isAdmin={org.isAdmin}
                onLead={(userId) => setValue(`roles.${index}.lead_user_id`, userId, { shouldDirty: true })}
                onRemove={(userId) => save(people.filter((p) => p.user_id !== userId))} />
            <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} disabled={people.length >= UNIT_SEATS}>
                    <UserPlus className="size-4" aria-hidden="true" />Add people
                </Button>
                {people.length > 0 && !leadId ? <span className="text-xs text-muted-foreground">Optional: pick a team lead ★ to get the team’s mentions and reminders.</span> : null}
            </div>
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
                <h3 id="child-lead-heading" className="nb-card-title text-foreground">Owner</h3>
                <p className="nb-compact mt-1 text-muted-foreground">Pick who owns this workspace. You stay an admin through {org.title}.</p>
                <select
                    aria-label="Owner"
                    value={lead ?? ''}
                    onChange={(e) => setValue('lead_user_id', e.target.value || undefined, { shouldDirty: true })}
                    className="mt-2 h-[var(--ui-control-height)] w-full max-w-64 rounded-md border border-input bg-background px-2 text-sm"
                >
                    <option value="">Me</option>
                    {roster.filter((p) => !unassigned.some((u) => u.user_id === p.userId)).map((person) => (
                        <option key={person.userId} value={person.userId}>{person.name}{person.title ? ` · ${person.title}` : ''}</option>
                    ))}
                </select>
            </div>
            <div className="space-y-2">
                <h3 className="nb-card-title text-foreground">Not in a team</h3>
                <p className="nb-compact text-muted-foreground">For small workspaces: people added without a team.</p>
                <PeopleChips people={unassigned} from={UNASSIGNED} isAdmin onRemove={(userId) => setValue('unassigned_people', unassigned.filter((p) => p.user_id !== userId), { shouldDirty: true })} />
                <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}><UserPlus className="size-4" aria-hidden="true" />Add people</Button>
                <OrgPeoplePicker open={open} onOpenChange={setOpen} target="the project" limit={100 - unassigned.length} onAdd={(added) => setValue('unassigned_people', [...unassigned, ...added], { shouldDirty: true })} />
            </div>
        </section>
    )
}

/** Inherited admins (report §14.4 item 4): read-only rows, e.g. "Ms. Rao, Teacher · Set by CSE-3A". */
export function InheritedAdminRows() {
    const { org } = useCreateLocation()
    const admins = useRoster(org?.id, '', 'admins')
    if (!org || admins.length === 0) return null
    return (
        <section aria-labelledby="child-inherited-heading" className="space-y-2 border-t border-border pt-6">
            <h3 id="child-inherited-heading" className="nb-card-title text-foreground">Admins from the organization</h3>
            <p className="nb-compact text-muted-foreground">They can see and help with this workspace through {org.title}.</p>
            <ul className="space-y-1 text-sm">
                {admins.map((admin) => (
                    <li key={admin.userId} className="text-foreground">{admin.name}{admin.title ? `, ${admin.title}` : ''} <span className="text-muted-foreground">· Admin · from {org.title}</span></li>
                ))}
            </ul>
        </section>
    )
}
