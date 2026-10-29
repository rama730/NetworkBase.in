'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFieldArray, useFormContext, useWatch, type UseFormReturn } from 'react-hook-form'
import { X } from 'lucide-react'

import { checkOrgHandleAction } from '@/app/actions/organizations'
import { findPeople, type FoundPerson } from '@/components/organizations/people-search'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { defaultOrgRoleNames, ORG_LIMITS, ORG_TYPES, type OrgType } from '@/lib/organizations/config'
import { ORG_CREATION_COPY, ORG_TYPE_CARDS, orgTypeDefaults } from '@/lib/organizations/creation'
import { parseInviteEmails } from '@/lib/organizations/member-rules'
import { readOrgWork } from '@/lib/organizations/settings'
import { cn } from '@/lib/utils'
import { generateSlugBase } from '@/lib/utils/slug'
import type { CreateProjectInput } from '@/lib/validations/project'

// The organization-only fields of the create wizard (report §34). Each group drops into its phase when the
// starting point is Organization; projects keep the wizard as it is.

const labelClass = 'text-sm font-medium text-foreground'
const helpClass = 'mt-1.5 text-[13px] leading-[1.5] text-muted-foreground'
const textAreaClass = 'w-full resize-y rounded-md border border-input bg-card px-3 py-2 text-[15px] leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30'

const useOrgCopy = () => ORG_CREATION_COPY[useWatch<CreateProjectInput, 'organization.org_type'>({ name: 'organization.org_type' }) ?? 'other']

/**
 * The type's defaults for everything the person hasn't touched (report §34.2, decision 185). Defaults are set
 * without marking fields dirty, so a later type change can still replace them; edited fields stay as typed.
 */
export function applyOrgTypeDefaults(type: OrgType, form: Pick<UseFormReturn<CreateProjectInput>, 'setValue' | 'getFieldState'>) {
    const d = orgTypeDefaults(type)
    const untouched = (name: Parameters<typeof form.getFieldState>[0]) => !form.getFieldState(name).isDirty
    if (untouched('organization.role_names')) form.setValue('organization.role_names', d.roleNames)
    if (untouched('organization.creator_title')) form.setValue('organization.creator_title', d.creatorTitle)
    if (untouched('organization.join_mode')) form.setValue('organization.join_mode', d.joinMode)
    if (untouched('visibility')) form.setValue('visibility', d.visibility)
    if (untouched('member_updates_enabled')) form.setValue('member_updates_enabled', d.memberUpdates)
}

/** Phase 1: what kind of organization (report §34.2). Nothing is picked for you; Other names itself. */
export function OrgTypePicker() {
    const { register, setValue, getFieldState } = useFormContext<CreateProjectInput>()
    const organization = useWatch<CreateProjectInput, 'organization'>({ name: 'organization' })
    return (
        <section className="border-t border-border pt-6" data-testid="create-project-source-view-organization" aria-labelledby="org-type-heading">
            <fieldset>
                <legend id="org-type-heading" className="nb-section-title text-foreground">What kind of organization?</legend>
                <p className="nb-compact mt-1 text-muted-foreground">Sets role names and defaults. You can change everything later in Settings.</p>
                {!organization?.org_type ? <p className="nb-compact mt-1 text-foreground" data-testid="create-org-type-required">Choose one to continue.</p> : null}
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {ORG_TYPES.map((type) => (
                        <label
                            key={type}
                            className={cn(
                                'flex cursor-pointer flex-col rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                                organization?.org_type === type ? 'border-primary bg-secondary' : 'border-border bg-card hover:bg-muted/60',
                            )}
                        >
                            <input
                                type="radio"
                                name="create-org-type"
                                value={type}
                                checked={organization?.org_type === type}
                                onChange={() => {
                                    setValue('organization.org_type', type, { shouldDirty: true });
                                    applyOrgTypeDefaults(type, { setValue, getFieldState });
                                }}
                                className="sr-only"
                            />
                            <span className="nb-card-title text-foreground">{ORG_TYPE_CARDS[type].label}</span>
                            <span className="nb-compact text-muted-foreground">{ORG_TYPE_CARDS[type].hint}</span>
                            <span className="nb-meta mt-1.5 text-muted-foreground">{Object.values(defaultOrgRoleNames(type)).join(' · ')}</span>
                        </label>
                    ))}
                </div>
                {organization?.org_type === 'other' ? (
                    <div className="mt-4 max-w-sm">
                        <label htmlFor="create-org-type-label" className="text-sm font-medium text-foreground">What do you call it? <span aria-hidden="true">*</span><span className="sr-only">(required)</span></label>
                        <Input id="create-org-type-label" {...register('organization.type_label')} maxLength={30} placeholder="Nonprofit, Hackathon, Hostel committee" className="mt-1.5" autoFocus />
                        <p className="nb-compact mt-1 text-muted-foreground">Shown wherever the type appears.</p>
                    </div>
                ) : null}
            </fieldset>
            <p className="nb-compact mt-5 text-muted-foreground">
                Have a code? <Link href="/join" className="font-medium text-foreground underline underline-offset-4">Join an organization</Link>
            </p>
        </section>
        )
}

/** Phase 2 Identity: Subject / Department / Area by type, stored as the category (decision 180). */
export function OrgSubjectField() {
    const { register } = useFormContext<CreateProjectInput>()
    const copy = useOrgCopy()
    return (
        <div>
            <label htmlFor="create-org-subject" className={labelClass}>{copy.subjectLabel}</label>
            <Input id="create-org-subject" {...register('custom_project_type')} list="create-org-subjects" maxLength={50} className="mt-1.5" placeholder={copy.subjects[0]} />
            <datalist id="create-org-subjects">{copy.subjects.map((s) => <option key={s} value={s} />)}</datalist>
            <p className={helpClass}>Optional. Shown as the category on About and cards.</p>
        </div>
    )
}

/** Phase 2 Identity: @handle with a live check, Part of, and Where with the time zone (report §34.3). */
export function OrgIdentityFields() {
    const { register, setValue, getValues } = useFormContext<CreateProjectInput>()
    const title = useWatch<CreateProjectInput, 'title'>({ name: 'title' }) || ''
    const handle = useWatch<CreateProjectInput, 'organization.handle'>({ name: 'organization.handle' }) || ''
    const [status, setStatus] = useState<{ available: boolean; message: string } | null>(null)
    const edited = useRef(Boolean(getValues('organization.handle')))
    const zones = useMemo(() => (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []), [])

    // Suggested from the name ("CSE-3A 2026" -> cse-3a-2026) until the person types their own.
    useEffect(() => {
        if (!edited.current) setValue('organization.handle', generateSlugBase(title).slice(0, 40), { shouldDirty: true })
    }, [setValue, title])
    // The browser's zone until the person picks one: due times and reminders use it (report §26).
    useEffect(() => {
        if (!getValues('organization.time_zone')) setValue('organization.time_zone', Intl.DateTimeFormat().resolvedOptions().timeZone)
    }, [getValues, setValue])

    useEffect(() => {
        if (handle.trim().length < 3) return setStatus(null)
        let cancelled = false
        const timer = setTimeout(() => {
            void checkOrgHandleAction(handle).then((result) => {
                if (!cancelled) setStatus(result)
            })
        }, 350)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [handle])

    return (
        <div className="space-y-5">
            <div>
                <label htmlFor="create-org-handle" className={labelClass}>Handle <span aria-hidden="true">*</span><span className="sr-only">(required)</span></label>
                <div className="mt-1.5 flex items-center gap-1">
                    <span className="text-muted-foreground" aria-hidden="true">@</span>
                    <Input
                        id="create-org-handle"
                        {...register('organization.handle', { onChange: () => { edited.current = true } })}
                        maxLength={40}
                        autoComplete="off"
                        spellCheck={false}
                        aria-describedby="create-org-handle-help create-org-handle-status"
                    />
                </div>
                <p id="create-org-handle-help" className={helpClass}>Your organization’s address. Letters, numbers and dashes.</p>
                <p id="create-org-handle-status" role="status" aria-live="polite" className={status && !status.available ? 'mt-1 text-[13px] text-destructive' : 'mt-1 text-[13px] text-muted-foreground'}>
                    {status?.message}
                </p>
            </div>
            <div>
                <label htmlFor="create-org-part-of" className={labelClass}>Part of</label>
                <Input id="create-org-part-of" {...register('organization.part_of')} maxLength={100} className="mt-1.5" placeholder="RV College of Engineering" />
                <p className={helpClass}>Optional. The bigger body it belongs to, shown under the name.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label htmlFor="create-org-location" className={labelClass}>Where</label>
                    <Input id="create-org-location" {...register('organization.location')} maxLength={100} className="mt-1.5" placeholder="Bengaluru, or Online" />
                </div>
                <div>
                    <label htmlFor="create-org-time-zone" className={labelClass}>Time zone</label>
                    <select id="create-org-time-zone" {...register('organization.time_zone')} className="mt-1.5 h-[var(--ui-control-height)] w-full rounded-md border border-input bg-card px-2 text-sm">
                        {zones.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>)}
                    </select>
                    <p className={helpClass}>Due times and reminders use it.</p>
                </div>
            </div>
        </div>
    )
}

/** Phase 2 About: shown to people right after they join, and in the welcome email (decision 181). */
export function OrgWelcomeField() {
    const { register } = useFormContext<CreateProjectInput>()
    const copy = useOrgCopy()
    return (
        <div className="border-t border-border pt-5">
            <label htmlFor="create-org-welcome" className={labelClass}>Welcome note</label>
            <textarea id="create-org-welcome" {...register('organization.welcome_note')} rows={3} maxLength={500} className={`${textAreaClass} mt-1.5`} placeholder={copy.welcome} />
            <p className={helpClass}>Optional. People see it right after they join.</p>
        </div>
    )
}

/** Phase 4 Calendar: term dates and "Plan your first sprints" together (decision 183). */
export function OrgCalendarFields() {
    const { register } = useFormContext<CreateProjectInput>()
    const copy = useOrgCopy()
    return (
        <div className="space-y-5">
            <fieldset>
                <legend className={labelClass}>{copy.termLabel} (optional)</legend>
                <div className="mt-1.5 grid gap-3 sm:grid-cols-2">
                    <label className="text-[13px] text-muted-foreground">
                        Starts
                        <Input type="date" {...register('organization.term_start')} className="mt-1" />
                    </label>
                    <label className="text-[13px] text-muted-foreground">
                        Ends
                        <Input type="date" {...register('organization.term_end')} className="mt-1" />
                    </label>
                </div>
            </fieldset>
            <PlanFirstSprints />
        </div>
    )
}

/** "Plan your first sprints" (report §15.2): optional; CO1–CO5 weekly from the term start, as planned sprints. */
function PlanFirstSprints() {
    const { setValue } = useFormContext<CreateProjectInput>()
    const type = useWatch<CreateProjectInput, 'organization.org_type'>({ name: 'organization.org_type' })
    const termStart = useWatch<CreateProjectInput, 'organization.term_start'>({ name: 'organization.term_start' })
    const plan = useWatch<CreateProjectInput, 'organization.plan_sprints'>({ name: 'organization.plan_sprints' })
    const today = new Date().toISOString().slice(0, 10)
    const set = (next: NonNullable<typeof plan> | undefined) => setValue('organization.plan_sprints', next, { shouldDirty: true })
    return (
        <fieldset>
            <legend className={labelClass}>Plan your first sprints (optional)</legend>
            <label className="mt-1.5 flex items-center gap-2 text-[13px] text-foreground">
                <input type="checkbox" checked={Boolean(plan)} onChange={(e) => set(e.target.checked ? { prefix: orgTypeDefaults(type ?? 'other').sprintPrefix, count: 5, length_days: 7, start_date: termStart || today } : undefined)} />
                Plan a series of sprints now
            </label>
            {plan ? (
                <div className="mt-2 grid gap-3 sm:grid-cols-4">
                    <label className="text-[13px] text-muted-foreground">Name<Input value={plan.prefix} maxLength={40} onChange={(e) => set({ ...plan, prefix: e.target.value })} className="mt-1" /></label>
                    <label className="text-[13px] text-muted-foreground">How many<Input type="number" min={1} max={20} value={plan.count} onChange={(e) => set({ ...plan, count: Math.min(20, Math.max(1, Number(e.target.value) || 1)) })} className="mt-1" /></label>
                    <label className="text-[13px] text-muted-foreground">Days each<Input type="number" min={1} max={60} value={plan.length_days} onChange={(e) => set({ ...plan, length_days: Math.min(60, Math.max(1, Number(e.target.value) || 1)) })} className="mt-1" /></label>
                    <label className="text-[13px] text-muted-foreground">First starts<Input type="date" value={plan.start_date} onChange={(e) => set({ ...plan, start_date: e.target.value || today })} className="mt-1" /></label>
                </div>
            ) : null}
            <p className={helpClass}>Named {plan ? `${plan.prefix.trim()}1–${plan.prefix.trim()}${plan.count}` : 'CO1, CO2…'}; you can rename, move or add more on the Sprints tab. The Journey on About is built from them.</p>
        </fieldset>
    )
}

const ROLE_MEANING = {
    owner: 'Runs the organization, can archive or delete it.',
    admin: 'Manages people, work and settings.',
    member: 'Works on workspaces and hands in work.',
    viewer: 'Reads only.',
} as const

/** Phase 3 People (report §34.4): you, role names, co-admins, how people join and who to invite now. */
export function OrgPeopleFields() {
    const { register, control, setValue } = useFormContext<CreateProjectInput>()
    const orgType = useWatch<CreateProjectInput, 'organization.org_type'>({ name: 'organization.org_type' }) ?? 'other'
    const defaults = orgTypeDefaults(orgType)
    const roleNames = useWatch<CreateProjectInput, 'organization.role_names'>({ name: 'organization.role_names' }) ?? defaults.roleNames
    const pasted = useWatch<CreateProjectInput, 'organization.invite_emails'>({ name: 'organization.invite_emails' }) ?? ''
    const parsed = useMemo(() => parseInviteEmails(pasted), [pasted])
    const coAdmins = useFieldArray({ control, name: 'organization.co_admins' })
    const [query, setQuery] = useState('')
    const [people, setPeople] = useState<FoundPerson[]>([])

    useEffect(() => {
        const q = query.trim()
        if (q.length < 2 || q.includes('@')) return setPeople([])
        let cancelled = false
        const timer = setTimeout(() => void findPeople(q).then((found) => { if (!cancelled) setPeople(found) }), 250)
        return () => { cancelled = true; clearTimeout(timer) }
    }, [query])

    const full = coAdmins.fields.length >= 10
    const addEmail = () => {
        const { valid } = parseInviteEmails(query)
        const email = valid[0]
        if (!email || full || coAdmins.fields.some((a) => a.email === email)) return
        coAdmins.append({ email, label: email })
        setQuery('')
    }

    return (
        <div className="space-y-8">
            <div>
                <label htmlFor="create-org-title" className={labelClass}>Your title</label>
                <Input id="create-org-title" {...register('organization.creator_title')} className="mt-1.5 max-w-sm" maxLength={60} placeholder={roleNames.owner} />
                <p className={helpClass}>Shown beside your name in the organization.</p>
            </div>

            <fieldset>
                <legend className={labelClass}>Role names</legend>
                <p className={helpClass}>What each role is called here. What a role can do never changes with its name.</p>
                <div className="mt-3 space-y-3">
                    {(['owner', 'admin', 'member', 'viewer'] as const).map((role) => (
                        <div key={role} className="grid items-center gap-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
                            <Input aria-label={`Name for the ${role === 'viewer' ? 'guest' : role} role`} value={roleNames[role]} maxLength={30}
                                onChange={(e) => setValue('organization.role_names', { ...roleNames, [role]: e.target.value }, { shouldDirty: true })} />
                            <span className="text-[13px] text-muted-foreground">{ROLE_MEANING[role]}</span>
                        </div>
                    ))}
                </div>
            </fieldset>

            <div>
                <label htmlFor="create-org-co-admin" className={labelClass}>Co-admins (optional)</label>
                <p className={helpClass}>Invited as {roleNames.admin} when the organization is created. Up to 10 here; more later from Members.</p>
                <div className="mt-2 flex max-w-xl gap-2">
                    <Input id="create-org-co-admin" value={query} onChange={(e) => setQuery(e.target.value)} disabled={full} placeholder="Search people or type an email"
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEmail() } }} autoComplete="off" />
                    {query.includes('@') ? <Button type="button" variant="outline" onClick={addEmail} disabled={full}>Add</Button> : null}
                </div>
                {people.length ? (
                    <ul className="mt-2 max-w-xl divide-y divide-border rounded-md border border-border" aria-label="People found">
                        {people.slice(0, 6).map((p) => (
                            <li key={p.id}>
                                <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50" disabled={full || coAdmins.fields.some((a) => a.user_id === p.id)}
                                    onClick={() => { coAdmins.append({ user_id: p.id, label: p.name }); setQuery(''); setPeople([]) }}>
                                    {p.name}{p.username ? <span className="text-muted-foreground"> @{p.username}</span> : null}
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : null}
                {coAdmins.fields.length ? (
                    <ul className="mt-3 flex flex-wrap gap-2" aria-label="Co-admins">
                        {coAdmins.fields.map((a, i) => (
                            <li key={a.id} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm">
                                {a.label}
                                <button type="button" aria-label={`Remove ${a.label}`} onClick={() => coAdmins.remove(i)} className="text-muted-foreground hover:text-foreground"><X className="size-3.5" aria-hidden="true" /></button>
                            </li>
                        ))}
                    </ul>
                ) : null}
            </div>

            <fieldset>
                <legend className={labelClass}>How people join</legend>
                <p className={helpClass}>Everyone can join with the code you get after creating.</p>
                <div className="mt-3 space-y-2">
                    <label className="flex items-start gap-3">
                        <input type="radio" value="instant" {...register('organization.join_mode')} className="mt-1" />
                        <span><span className="block text-sm font-medium">Instant</span><span className="block text-[13px] text-muted-foreground">Anyone with the code becomes a {roleNames.member}.</span></span>
                    </label>
                    <label className="flex items-start gap-3">
                        <input type="radio" value="approval" {...register('organization.join_mode')} className="mt-1" />
                        <span><span className="block text-sm font-medium">Approval required</span><span className="block text-[13px] text-muted-foreground">The code sends a request; an admin approves it.</span></span>
                    </label>
                </div>
                <label className="mt-4 block max-w-xs text-[13px] text-muted-foreground">
                    Max members (optional)
                    <Input type="number" min={1} max={ORG_LIMITS.membersPerOrg} placeholder={String(ORG_LIMITS.membersPerOrg)} className="mt-1"
                        {...register('organization.max_members', { setValueAs: (v) => (v === '' || v == null ? null : Math.min(ORG_LIMITS.membersPerOrg, Math.max(1, Number(v) || 1))) })} />
                </label>
            </fieldset>

            <div>
                <label htmlFor="create-org-invites" className={labelClass}>Invite people now (optional)</label>
                <p className={helpClass}>Paste email addresses, for example a class roster. They get a {roleNames.member} invite when the organization is created.</p>
                <textarea id="create-org-invites" {...register('organization.invite_emails')} rows={4} className={`${textAreaClass} mt-2`} placeholder="asha@college.edu, ravi@college.edu" aria-describedby="create-org-invites-count" />
                <p id="create-org-invites-count" role="status" aria-live="polite" className={parsed.valid.length > ORG_LIMITS.emailInvitesPerPaste ? 'mt-1 text-[13px] text-destructive' : helpClass}>
                    {pasted.trim()
                        ? `${parsed.valid.length} ${parsed.valid.length === 1 ? 'email' : 'emails'}${parsed.invalid.length ? `, ${parsed.invalid.length} ${parsed.invalid.length === 1 ? 'looks' : 'look'} wrong` : ''}${parsed.valid.length > ORG_LIMITS.emailInvitesPerPaste ? ` · up to ${ORG_LIMITS.emailInvitesPerPaste} here` : ''}`
                        : null}
                </p>
            </div>
        </div>
    )
}

const LATE = { none: 'Not accepted', until: 'Accepted until a date', always: 'Always accepted' } as const
const REMINDERS = { both: '24 hours before and on the due day', day_before: '24 hours before', due_day: 'On the due day', off: 'Off' } as const

/** Phase 4 Setup for orgs: projects inside, and the Work defaults as one line (report §34.5). */
export function OrgSettingsFields() {
    const { register, setValue } = useFormContext<CreateProjectInput>()
    const orgType = useWatch<CreateProjectInput, 'organization.org_type'>({ name: 'organization.org_type' })
    const chosen = useWatch<CreateProjectInput, 'organization.work'>({ name: 'organization.work' })
    const typeWork = readOrgWork({}, orgType)
    const work = {
        reviewRequired: chosen?.review_required ?? typeWork.reviewRequired,
        lateRule: chosen?.late_rule ?? typeWork.lateRule,
        reminders: chosen?.reminders ?? typeWork.reminders,
        storyPoints: chosen?.story_points ?? typeWork.storyPoints,
    }
    const [open, setOpen] = useState(false)
    const set = (patch: NonNullable<typeof chosen>) => setValue('organization.work', { ...chosen, ...patch }, { shouldDirty: true })
    const selectClass = 'mt-1 h-[var(--ui-control-height)] w-full rounded-md border border-input bg-card px-2 text-sm'
    return (
        <div className="space-y-6">
            <fieldset>
                <legend className={labelClass}>Who can create workspaces inside the organization</legend>
                <div className="mt-3 space-y-2">
                    <label className="flex items-center gap-3 text-sm">
                        <input type="radio" value="members" {...register('organization.child_creation')} /> All members
                    </label>
                    <label className="flex items-center gap-3 text-sm">
                        <input type="radio" value="admins" {...register('organization.child_creation')} /> Admins only
                    </label>
                </div>
            </fieldset>
            <label className="flex items-start gap-3">
                <input type="checkbox" {...register('organization.outside_people')} className="mt-1" />
                <span>
                    <span className="block text-sm font-medium">People outside the organization can be added to its workspaces</span>
                    <span className="block text-[13px] text-muted-foreground">Off by default. They see only that workspace, never the organization’s content.</span>
                </span>
            </label>
            <div>
                <p className={labelClass}>Work defaults</p>
                <p className={helpClass} data-testid="create-org-work-summary">
                    Review {work.reviewRequired ? 'on' : 'off'} · Late work {LATE[work.lateRule].toLowerCase()} · Reminders {REMINDERS[work.reminders].toLowerCase()} · Estimate {work.storyPoints}
                    {' · '}<button type="button" className="font-medium text-foreground underline underline-offset-4" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? 'Done' : 'Change'}</button>
                </p>
                {open ? (
                    <div className="mt-3 grid max-w-2xl gap-4 sm:grid-cols-2">
                        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={work.reviewRequired} onChange={(e) => set({ review_required: e.target.checked })} /> Review submissions before they count as done</label>
                        <label className="text-[13px] text-muted-foreground">Late work
                            <select className={selectClass} value={work.lateRule} onChange={(e) => set({ late_rule: e.target.value as keyof typeof LATE })}>
                                {Object.entries(LATE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                        </label>
                        <label className="text-[13px] text-muted-foreground">Reminders
                            <select className={selectClass} value={work.reminders} onChange={(e) => set({ reminders: e.target.value as keyof typeof REMINDERS })}>
                                {Object.entries(REMINDERS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                        </label>
                        <label className="text-[13px] text-muted-foreground">Estimate
                            <select className={selectClass} value={work.storyPoints} onChange={(e) => set({ story_points: e.target.value as 'shown' | 'hidden' })}>
                                <option value="shown">Shown</option>
                                <option value="hidden">Hidden</option>
                            </select>
                        </label>
                    </div>
                ) : null}
                <p className={helpClass}>Set by the type; every assignment can still change them. Also in Settings → Work.</p>
            </div>
        </div>
    )
}
