'use client'

import { useEffect, useMemo, useState } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import { Star, UserPlus, X } from 'lucide-react'

import { listOrgRosterAction, listOutsidePeopleAction, type OrgRosterPerson } from '@/app/actions/organizations'
import { useCreateLocation } from '@/components/organizations/CreateLocation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { UnderlineTabs } from '@/components/ui/UnderlineTabs'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { rolePlural } from '@/lib/organizations/role-words'
import { orgRoleNames } from '@/lib/organizations/config'
import type { CreateWorkspaceInput } from '@/lib/validations/workspace'

// The child project team in the create wizard (report §14.4): units are the role boxes, filled with people
// from the org roster. Admins add people directly; members invite them. People outside the org are always invited.

type Person = { user_id: string; label?: string; outside?: boolean }
const UNIT_SEATS = 10
const UNASSIGNED = 'unassigned'

/** Everyone already placed (any unit, not in a unit, or the lead), so a person sits in one place at a time. */
function usePlaced() {
    const roles = useWatch<CreateWorkspaceInput, 'roles'>({ name: 'roles' }) ?? []
    const unassigned = useWatch<CreateWorkspaceInput, 'unassigned_people'>({ name: 'unassigned_people' }) ?? []
    const lead = useWatch<CreateWorkspaceInput, 'lead_user_id'>({ name: 'lead_user_id' })
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
    const { getValues, setValue } = useFormContext<CreateWorkspaceInput>()
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

/** The roster dialog: In / Outside tabs, search, filters, ticked rows, "Add 4 to Frontend developers" (create wizard v6 look). */
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

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) setTicked([]); onOpenChange(next) }}>
            <DialogContent className="nb-picker">
                <DialogHeader>
                    <DialogTitle>Add people to {target}</DialogTitle>
                    <DialogDescription>From {org?.title}. Search by name, title or skill, for example &quot;Section B&quot;.</DialogDescription>
                </DialogHeader>
                {org?.outsidePeople ? (
                    <UnderlineTabs label="Who to add" idPrefix="org-people-picker" controls={false} value={tab} onChange={(next) => { setTab(next); setTicked([]) }}
                        tabs={[{ key: 'org' as const, label: `In ${org.title}` }, { key: 'outside' as const, label: `Outside ${org.title}` }]} />
                ) : null}
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === 'outside' ? 'Search by name or @username' : 'Search people'} aria-label="Search people" autoFocus />
                {tab === 'org' ? (
                    <div className="flex flex-wrap items-center gap-2.5">
                        <select aria-label="Role" className="nb-select" data-size="sm" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                            <option value="all">Everyone</option><option value="member">{rolePlural(orgRoleNames(org?.orgType, {}).member)}</option><option value="admin">{rolePlural(orgRoleNames(org?.orgType, {}).admin)}</option>
                        </select>
                        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="nb-check" checked={notInProject} onChange={(e) => setNotInProject(e.target.checked)} /> Not in a workspace yet</label>
                        <Input value={skill} onChange={(e) => setSkill(e.target.value)} placeholder="Skill" aria-label="Filter by skill" className="h-[var(--ui-control-height-sm)] w-28 text-[13px]" />
                    </div>
                ) : <p className="text-[13px] text-muted-foreground">They join only this workspace, by invitation, and never see {org?.title}&apos;s own content.</p>}
                <ul className="nb-picker-list" aria-label={tab === 'outside' ? 'People outside the organization' : 'Organization members'}>
                    {shown.length === 0 ? <li className="px-3 py-4 text-[13px] text-muted-foreground">{tab === 'outside' && query.trim().length < 2 ? 'Type at least two letters.' : 'No one matches.'}</li> : null}
                    {shown.map((person) => {
                        const already = placed.has(person.userId)
                        const checked = already || ticked.some((p) => p.user_id === person.userId)
                        return (
                            <li key={person.userId}>
                                <label className="nb-picker-row" data-placed={already || undefined}>
                                    <input type="checkbox" className="nb-check" checked={checked} disabled={already || (!checked && ticked.length >= limit)} onChange={() => toggle(person)} />
                                    <UserAvatar identity={{ id: person.userId, fullName: person.name }} size={22} roundedClassName="rounded-sm" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-[13.5px] font-medium text-foreground">{person.name}{person.title ? <span className="font-normal text-muted-foreground"> · {person.title}</span> : null}</span>
                                        {person.projectHint || person.skills?.length ? <span className="block truncate text-xs text-muted-foreground">{[person.projectHint, person.skills?.slice(0, 3).join(', ')].filter(Boolean).join(' · ')}</span> : null}
                                    </span>
                                </label>
                            </li>
                        )
                    })}
                </ul>
                <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] text-muted-foreground" aria-live="polite">{limit < 1 ? 'This team is full.' : `${ticked.length} of up to ${limit} picked.`}</p>
                    <div className="flex items-center gap-2">
                        <Button type="button" variant="ghost" onClick={() => { setTicked([]); onOpenChange(false) }}>Cancel</Button>
                        <Button type="button" disabled={ticked.length === 0} onClick={() => { onAdd(ticked); setTicked([]); onOpenChange(false) }}>
                            Add {ticked.length || ''} to {target}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

/** One person's chip: face, unit lead ★ (units only), "will be added/invited", Move to… (keyboard), remove. */
function PeopleChips({ people, from, leadId, onLead, onRemove, isAdmin }: {
    people: Person[]; from: number | typeof UNASSIGNED; leadId?: string; onLead?: (userId: string | undefined) => void; onRemove: (userId: string) => void; isAdmin: boolean
}) {
    const roles = useWatch<CreateWorkspaceInput, 'roles'>({ name: 'roles' }) ?? []
    const move = useMovePerson()
    if (people.length === 0) return null
    return (
        <ul className="nb-pchips" aria-label="People">
            {people.map((person) => {
                const name = person.label ?? 'Member'
                const isLead = leadId === person.user_id
                return (
                    <li key={person.user_id} data-key={`pp-${person.user_id}`} className="nb-pchip nb-enter-chip">
                        <UserAvatar identity={{ id: person.user_id, fullName: name }} size={22} roundedClassName="rounded-sm" />
                        {onLead ? (
                            <button type="button" aria-pressed={isLead} aria-label={isLead ? `${name} is team lead` : `Make ${name} team lead`} title={isLead ? 'Team lead' : 'Make team lead'}
                                onClick={() => onLead(isLead ? undefined : person.user_id)} className="nbs-ib nb-pchip-ib">
                                <Star className={isLead ? 'fill-current' : ''} aria-hidden="true" />
                            </button>
                        ) : null}
                        <b>{name}</b>
                        <span className="nb-pchip-note">{isAdmin && !person.outside ? 'will be added' : 'will be invited'}</span>
                        <select aria-label={`Move ${name} to…`} value="" className="nb-select" data-size="sm"
                            onChange={(e) => { const to = e.target.value; if (to) move(person, from, to === UNASSIGNED ? UNASSIGNED : Number(to)) }}>
                            <option value="">Move to…</option>
                            {roles.map((unit, i) => (i === from || !unit.role.trim() ? null : <option key={i} value={String(i)} disabled={(unit.people?.length ?? 0) >= UNIT_SEATS}>{unit.role}</option>))}
                            {isAdmin && from !== UNASSIGNED ? <option value={UNASSIGNED}>Not in a team</option> : null}
                        </select>
                        <button type="button" onClick={() => onRemove(person.user_id)} aria-label={`Remove ${name}`} className="nbs-ib nb-pchip-ib">
                            <X aria-hidden="true" />
                        </button>
                    </li>
                )
            })}
        </ul>
    )
}

/** Inside a role's editor: "People in this team · 02 of 10 seats", the people, their lead ★, and Add people. Seats grow to fit them. */
export function UnitPeople({ index, unitName }: { index: number; unitName: string }) {
    const { setValue, getValues } = useFormContext<CreateWorkspaceInput>()
    const { org } = useCreateLocation()
    const people = useWatch<CreateWorkspaceInput, `roles.${number}.people`>({ name: `roles.${index}.people` }) ?? []
    const leadId = useWatch<CreateWorkspaceInput, `roles.${number}.lead_user_id`>({ name: `roles.${index}.lead_user_id` })
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
        <>
            <p className="nbs-glabel pt-4">People in this team<span className="r"><span className="font-mono text-[12px] tabular-nums text-muted-foreground">{String(people.length).padStart(2, '0')} of {UNIT_SEATS} seats</span></span></p>
            <div className="nb-fld nb-fld-first">
                {people.length ? (
                    <PeopleChips people={people} from={index} leadId={leadId} isAdmin={org.isAdmin}
                        onLead={(userId) => setValue(`roles.${index}.lead_user_id`, userId, { shouldDirty: true })}
                        onRemove={(userId) => save(people.filter((p) => p.user_id !== userId))} />
                ) : <p className="text-[13px] text-muted-foreground">From {org.title}{org.outsidePeople ? ', or invite someone from outside' : ''}.</p>}
                <div className="mt-2.5 flex flex-wrap items-center gap-3">
                    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} disabled={people.length >= UNIT_SEATS}>
                        <UserPlus className="size-4" aria-hidden="true" />Add people
                    </Button>
                    {people.length > 0 && !leadId ? <span className="text-[13px] text-muted-foreground">Optional: star a team lead to give them the team’s mentions and reminders.</span> : null}
                </div>
            </div>
            <OrgPeoplePicker open={open} onOpenChange={setOpen} target={name} limit={UNIT_SEATS - people.length} onAdd={(added) => save([...people, ...added])} />
        </>
    )
}

/** Admins, inside the Owner frame: who leads this workspace (they own it, decision 11); the creator stays an admin through the org. */
export function WorkspaceLeadRow() {
    const { setValue } = useFormContext<CreateWorkspaceInput>()
    const { org } = useCreateLocation()
    const lead = useWatch<CreateWorkspaceInput, 'lead_user_id'>({ name: 'lead_user_id' })
    const unassigned = useWatch<CreateWorkspaceInput, 'unassigned_people'>({ name: 'unassigned_people' }) ?? []
    const roster = useRoster(org?.isAdmin ? org.id : undefined, '')
    if (!org?.isAdmin) return null
    const leader = lead ? roster.find((p) => p.userId === lead) : undefined
    return (
        <>
            {leader ? (
                <div className="nb-person">
                    <UserAvatar identity={{ id: leader.userId, fullName: leader.name }} size={40} />
                    <span className="min-w-0">
                        <b>{leader.name}</b> <span className="nbs-tag hot">Owner</span>
                        <span className="nb-person-hint">{leader.title ? `${leader.title} · ` : ''}leads it and owns it</span>
                    </span>
                </div>
            ) : null}
            <div className="nbs-row">
                <div><p className="t">Workspace lead</p><p className="d">Pick who leads it; they own it. You stay an admin through {org.title}.</p></div>
                <div className="ctl">
                    <select aria-label="Workspace lead" value={lead ?? ''} onChange={(e) => setValue('lead_user_id', e.target.value || undefined, { shouldDirty: true })} className="nb-select max-w-64">
                        <option value="">Me</option>
                        {roster.filter((p) => !unassigned.some((u) => u.user_id === p.userId)).map((person) => (
                            <option key={person.userId} value={person.userId}>{person.name}{person.title ? ` · ${person.title}` : ''}</option>
                        ))}
                    </select>
                </div>
            </div>
        </>
    )
}

/** Admins: people added without a team (for small workspaces). */
export function NotInTeamFrame() {
    const { setValue } = useFormContext<CreateWorkspaceInput>()
    const { org } = useCreateLocation()
    const unassigned = useWatch<CreateWorkspaceInput, 'unassigned_people'>({ name: 'unassigned_people' }) ?? []
    const [open, setOpen] = useState(false)
    if (!org?.isAdmin) return null
    return (
        <section aria-labelledby="child-unassigned-heading" className="nbs-frame">
            <p id="child-unassigned-heading" className="nbs-glabel pt-[18px]">Not in a team<span className="r"><span className="nbs-tag">Optional</span></span></p>
            <div className="nb-fld nb-fld-first">
                <p className="text-[13px] text-muted-foreground">For small workspaces: people added without a team.</p>
                {unassigned.length ? <div className="mt-2.5"><PeopleChips people={unassigned} from={UNASSIGNED} isAdmin onRemove={(userId) => setValue('unassigned_people', unassigned.filter((p) => p.user_id !== userId), { shouldDirty: true })} /></div> : null}
                <div className="mt-2.5"><Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}><UserPlus className="size-4" aria-hidden="true" />Add people</Button></div>
            </div>
            <OrgPeoplePicker open={open} onOpenChange={setOpen} target="the workspace" limit={100 - unassigned.length} onAdd={(added) => setValue('unassigned_people', [...unassigned, ...added], { shouldDirty: true })} />
        </section>
    )
}

/** Inherited admins (report §14.4 item 4): read-only rows, "Admin · from CSE-3A". */
export function InheritedAdminRows() {
    const { org } = useCreateLocation()
    const admins = useRoster(org?.id, '', 'admins')
    if (!org || admins.length === 0) return null
    return (
        <section aria-labelledby="child-inherited-heading" className="nbs-frame">
            <p id="child-inherited-heading" className="nbs-glabel pt-[18px]">Admins from {org.title}</p>
            <p className="nbs-ghelp">They can see and help with this workspace through {org.title}. Set by the organization.</p>
            <ul>
                {admins.map((admin) => (
                    <li key={admin.userId} className="nbs-li">
                        <UserAvatar identity={{ id: admin.userId, fullName: admin.name }} size={34} roundedClassName="rounded-md" />
                        <span className="nm"><span>{admin.name}{admin.title ? <span className="font-normal text-muted-foreground">, {admin.title}</span> : null}</span></span>
                        <span className="ctl"><span className="nbs-tag">Admin · from {org.title}</span></span>
                    </li>
                ))}
            </ul>
        </section>
    )
}
