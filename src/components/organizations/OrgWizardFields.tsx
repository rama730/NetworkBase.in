'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFieldArray, useFormContext, useWatch, type UseFormReturn } from 'react-hook-form'
import { typeProfile } from '@/lib/organizations/type-profile'
import { Check, X } from 'lucide-react'

import { checkOrgHandleAction } from '@/app/actions/organizations'
import { PartOfField } from '@/components/organizations/OrgDiscoverySections'
import { findPeople, type FoundPerson } from '@/components/organizations/people-search'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { defaultOrgRoleNames, ORG_LIMITS, ORG_TYPES, type OrgType } from '@/lib/organizations/config'
import { ORG_CREATION_COPY, ORG_TYPE_CARDS, orgTypeDefaults } from '@/lib/organizations/creation'
import { parseInviteEmails } from '@/lib/organizations/member-rules'
import { readOrgWork } from '@/lib/organizations/settings'
import { cn } from '@/lib/utils'
import { fieldError, fieldHint, fieldLabel } from '@/lib/organizations/display'
import { ORG_SETTING_LABELS, joinModeHint } from '@/lib/organizations/settings-labels'
import { generateSlugBase } from '@/lib/utils/slug'
import type { CreateWorkspaceInput } from '@/lib/validations/workspace'

// The organization-only fields of the create wizard (report §34). Each group drops into its phase when the
// starting point is Organization; projects keep the wizard as it is.

const labelClass = fieldLabel
const helpClass = fieldHint
/** Required fields carry the clay mark (spec §10 Field). */
const Required = () => <><span className="text-primary" aria-hidden="true"> *</span><span className="sr-only">(required)</span></>

const useOrgCopy = () => ORG_CREATION_COPY[useWatch<CreateWorkspaceInput, 'organization.org_type'>({ name: 'organization.org_type' }) ?? 'other']

/**
 * The type's defaults for everything the person hasn't touched (report §34.2, decision 185). Defaults are set
 * without marking fields dirty, so a later type change can still replace them; edited fields stay as typed.
 */
export function applyOrgTypeDefaults(type: OrgType, form: Pick<UseFormReturn<CreateWorkspaceInput>, 'setValue' | 'getFieldState'>) {
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
    const { register, setValue, getFieldState } = useFormContext<CreateWorkspaceInput>()
    const organization = useWatch<CreateWorkspaceInput, 'organization'>({ name: 'organization' })
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
                                // Spec §18 source tiles: a visible radio, and the chosen tile on the paper well.
                                'grid cursor-pointer grid-cols-[16px_minmax(0,1fr)] gap-x-2.5 rounded-lg border p-3 transition-colors',
                                organization?.org_type === type ? 'border-primary bg-muted' : 'border-border bg-card hover:border-input',
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
                                className="nb-radio mt-0.5"
                            />
                            <span className="nb-card-title text-foreground">{ORG_TYPE_CARDS[type].label}</span>
                            <span className="nb-compact col-start-2 text-muted-foreground">{ORG_TYPE_CARDS[type].hint}</span>
                            <span className="nb-meta col-start-2 mt-1.5">{Object.values(defaultOrgRoleNames(type)).join(' · ')}</span>
                        </label>
                    ))}
                </div>
                {organization?.org_type === 'other' ? (
                    <div className="mt-4 max-w-sm">
                        <label htmlFor="create-org-type-label" className={labelClass}>What do you call it?<Required /></label>
                        <Input id="create-org-type-label" {...register('organization.type_label')} maxLength={30} placeholder="Nonprofit, Hackathon, Hostel committee" className="mt-1.5" autoFocus />
                        <p className="nb-compact mt-1 text-muted-foreground">Shown wherever the type appears.</p>
                    </div>
                ) : null}
            </fieldset>
            <p className="nb-compact mt-5 text-muted-foreground">
                Have a code? <Link href="/join" className="nb-link">Join an organization</Link>
            </p>
        </section>
        )
}

/** Phase 2 Identity: Subject / Department / Area by type, stored as the category (decision 180). */
export function OrgSubjectField() {
    const { register } = useFormContext<CreateWorkspaceInput>()
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
    const { register, setValue, getValues } = useFormContext<CreateWorkspaceInput>()
    const title = useWatch<CreateWorkspaceInput, 'title'>({ name: 'title' }) || ''
    const handle = useWatch<CreateWorkspaceInput, 'organization.handle'>({ name: 'organization.handle' }) || ''
    const [status, setStatus] = useState<{ available: boolean; message: string } | null>(null)
    const partOf = useWatch<CreateWorkspaceInput, 'organization.part_of'>({ name: 'organization.part_of' }) || ''
    const [partOfLinked, setPartOfLinked] = useState<{ id: string; title: string; verified: boolean } | null>(null)
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
                {/* G1 (2026-11-05 findings §3): one name, the whole link while typing, no "@" (it isn't a mention). */}
                <label htmlFor="create-org-handle" className={labelClass}>Web address<Required /></label>
                {/* The fixed part is the input's leading affix (spec §10 Input). */}
                <div className="mt-1.5 flex h-[var(--ui-control-height)] min-w-0 items-stretch overflow-hidden rounded-md border border-input bg-card">
                    <span className="nb-meta flex shrink-0 items-center border-r border-border bg-muted px-2" aria-hidden="true">networkbase.in/org/</span>
                    <input
                        id="create-org-handle"
                        {...register('organization.handle', { onChange: () => { edited.current = true } })}
                        maxLength={40}
                        autoComplete="off"
                        spellCheck={false}
                        aria-describedby="create-org-handle-help create-org-handle-status"
                        className="min-w-0 flex-1 bg-transparent px-2 text-[15px] outline-none"
                    />
                </div>
                <p id="create-org-handle-status" role="status" aria-live="polite" className={cn('flex items-center gap-1', status && !status.available ? fieldError : 'mt-1 text-[13px] text-[var(--status-success)]')}>
                    {status ? (status.available ? <><Check className="size-4" aria-hidden="true" />{status.message}</> : status.message) : null}
                </p>
                <p id="create-org-handle-help" className={helpClass}>The link you share with people. Letters, numbers and dashes. You can change it later.</p>
            </div>
            <div>
                <label htmlFor="create-org-part-of" className={labelClass}>Part of</label>
                {/* G8: pick it from the list when it's on NetworkBase, so it can later confirm you for the ✓. */}
                <PartOfField orgId={null} inputId="create-org-part-of" placeholder="RV College of Engineering" value={partOf} linked={partOfLinked}
                    onChange={(next) => {
                        setValue('organization.part_of', next.text, { shouldDirty: true })
                        setValue('organization.part_of_org_id', next.linked?.id ?? null, { shouldDirty: true })
                        setPartOfLinked(next.linked)
                    }} />
                <p className={helpClass}>Optional. The bigger body it belongs to, shown under the name.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label htmlFor="create-org-location" className={labelClass}>Where</label>
                    <Input id="create-org-location" {...register('organization.location')} maxLength={100} className="mt-1.5" placeholder="Bengaluru, or Online" />
                </div>
                <div>
                    <label htmlFor="create-org-time-zone" className={labelClass}>Time zone</label>
                    <select id="create-org-time-zone" {...register('organization.time_zone')} className="nb-select mt-1.5 w-full">
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
    const { register } = useFormContext<CreateWorkspaceInput>()
    const copy = useOrgCopy()
    return (
        <div className="border-t border-border pt-5">
            <label htmlFor="create-org-welcome" className={labelClass}>Welcome note</label>
            <textarea id="create-org-welcome" {...register('organization.welcome_note')} rows={3} maxLength={500} className="nb-textarea mt-1.5" data-size="lg" placeholder={copy.welcome} />
            <p className={helpClass}>Optional. People see it right after they join.</p>
        </div>
    )
}

/** Phase 4 Calendar: term dates and "Plan your first sprints" together (decision 183). */
export function OrgCalendarFields() {
    const { register } = useFormContext<CreateWorkspaceInput>()
    const copy = useOrgCopy()
    // Report §21.2: term dates are an Education thing; other types plan sprints only.
    const termDates = typeProfile(useWatch<CreateWorkspaceInput, 'organization.org_type'>({ name: 'organization.org_type' })).termDates
    return (
        <div className="space-y-5">
            {termDates ? <fieldset>
                <legend className={labelClass}>{copy.termLabel} (optional)</legend>
                <div className="mt-1.5 grid gap-3 sm:grid-cols-2">
                    <label><span className={labelClass}>Starts</span>
                        <Input type="date" {...register('organization.term_start')} className="mt-1.5" />
                    </label>
                    <label><span className={labelClass}>Ends</span>
                        <Input type="date" {...register('organization.term_end')} className="mt-1.5" />
                    </label>
                </div>
            </fieldset> : null}
            <PlanFirstSprints />
        </div>
    )
}

/** "Plan your first sprints" (report §15.2): optional; CO1–CO5 weekly from the term start, as planned sprints. */
function PlanFirstSprints() {
    const { setValue } = useFormContext<CreateWorkspaceInput>()
    const type = useWatch<CreateWorkspaceInput, 'organization.org_type'>({ name: 'organization.org_type' })
    const termStart = useWatch<CreateWorkspaceInput, 'organization.term_start'>({ name: 'organization.term_start' })
    const plan = useWatch<CreateWorkspaceInput, 'organization.plan_sprints'>({ name: 'organization.plan_sprints' })
    const today = new Date().toISOString().slice(0, 10)
    const set = (next: NonNullable<typeof plan> | undefined) => setValue('organization.plan_sprints', next, { shouldDirty: true })
    return (
        <fieldset>
            <legend className={labelClass}>Plan your first sprints (optional)</legend>
            <label className="mt-2 flex items-center gap-2.5 text-[13px] text-foreground">
                <input type="checkbox" className="nb-check" checked={Boolean(plan)} onChange={(e) => set(e.target.checked ? { prefix: orgTypeDefaults(type ?? 'other').sprintPrefix, count: 5, length_days: 7, start_date: termStart || today } : undefined)} />
                Plan a series of sprints now
            </label>
            {plan ? (
                <div className="mt-2 grid gap-3 sm:grid-cols-4">
                    <label><span className={labelClass}>Name</span><Input value={plan.prefix} maxLength={40} onChange={(e) => set({ ...plan, prefix: e.target.value })} className="mt-1.5" /></label>
                    <label><span className={labelClass}>How many</span><Input type="number" min={1} max={20} value={plan.count} onChange={(e) => set({ ...plan, count: Math.min(20, Math.max(1, Number(e.target.value) || 1)) })} className="mt-1.5" /></label>
                    <label><span className={labelClass}>Days each</span><Input type="number" min={1} max={60} value={plan.length_days} onChange={(e) => set({ ...plan, length_days: Math.min(60, Math.max(1, Number(e.target.value) || 1)) })} className="mt-1.5" /></label>
                    <label><span className={labelClass}>First starts</span><Input type="date" value={plan.start_date} onChange={(e) => set({ ...plan, start_date: e.target.value || today })} className="mt-1.5" /></label>
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
    const { register, control, setValue } = useFormContext<CreateWorkspaceInput>()
    const orgType = useWatch<CreateWorkspaceInput, 'organization.org_type'>({ name: 'organization.org_type' }) ?? 'other'
    const defaults = orgTypeDefaults(orgType)
    const roleNames = useWatch<CreateWorkspaceInput, 'organization.role_names'>({ name: 'organization.role_names' }) ?? defaults.roleNames
    const pasted = useWatch<CreateWorkspaceInput, 'organization.invite_emails'>({ name: 'organization.invite_emails' }) ?? ''
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
                    <ul className="mt-2 max-w-xl divide-y divide-border overflow-hidden rounded-lg border border-border bg-card" aria-label="People found">
                        {people.slice(0, 6).map((p) => {
                            const added = coAdmins.fields.some((a) => a.user_id === p.id)
                            return (
                            <li key={p.id}>
                                <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-muted disabled:cursor-not-allowed" disabled={full || added}
                                    onClick={() => { coAdmins.append({ user_id: p.id, label: p.name }); setQuery(''); setPeople([]) }}>
                                    <span>{p.name}{p.username ? <span className="text-muted-foreground"> @{p.username}</span> : null}</span>
                                    {added ? <span className="nb-meta">Added</span> : null}
                                </button>
                            </li>
                            )
                        })}
                    </ul>
                ) : null}
                {coAdmins.fields.length ? (
                    <ul className="mt-3 flex flex-wrap gap-2" aria-label="Co-admins">
                        {coAdmins.fields.map((a, i) => (
                            <li key={a.id} className="inline-flex items-center gap-1 rounded-md border border-border bg-card py-0.5 pl-2.5 pr-0.5 text-[13px]">
                                {a.label}
                                <button type="button" aria-label={`Remove ${a.label}`} onClick={() => coAdmins.remove(i)} className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-3.5" aria-hidden="true" /></button>
                            </li>
                        ))}
                    </ul>
                ) : null}
            </div>

            <fieldset>
                <legend className={labelClass}>{ORG_SETTING_LABELS.joinMode.label}</legend>
                <p className={helpClass}>Everyone can join with the code you get after creating.</p>
                <div className="mt-3 space-y-2.5 text-[13px]">
                    {(['instant', 'approval'] as const).map((mode) => (
                        <label key={mode} className="flex items-start gap-2.5">
                            <input type="radio" value={mode} {...register('organization.join_mode')} className="nb-radio mt-0.5" />
                            <span><span className="block font-medium">{ORG_SETTING_LABELS.joinMode.options[mode]}</span><span className="block text-muted-foreground">{joinModeHint(mode, roleNames.member)}</span></span>
                        </label>
                    ))}
                </div>
                <label className="mt-4 block max-w-xs"><span className={labelClass}>Max members (optional)</span>
                    <Input type="number" min={1} max={ORG_LIMITS.membersPerOrg} placeholder={String(ORG_LIMITS.membersPerOrg)} className="mt-1.5"
                        {...register('organization.max_members', { setValueAs: (v) => (v === '' || v == null ? null : Math.min(ORG_LIMITS.membersPerOrg, Math.max(1, Number(v) || 1))) })} />
                </label>
            </fieldset>

            <div>
                <label htmlFor="create-org-invites" className={labelClass}>Invite people now (optional)</label>
                <p className={helpClass}>Paste email addresses, for example a class roster. They get a {roleNames.member} invite when the organization is created.</p>
                <textarea id="create-org-invites" {...register('organization.invite_emails')} rows={4} className="nb-textarea mt-2" data-size="lg" placeholder="asha@college.edu, ravi@college.edu" aria-describedby="create-org-invites-count" />
                <p id="create-org-invites-count" role="status" aria-live="polite" className={parsed.valid.length > ORG_LIMITS.emailInvitesPerPaste ? fieldError : helpClass}>
                    {pasted.trim()
                        ? `${parsed.valid.length} ${parsed.valid.length === 1 ? 'email' : 'emails'}${parsed.invalid.length ? `, ${parsed.invalid.length} ${parsed.invalid.length === 1 ? 'looks' : 'look'} wrong` : ''}${parsed.valid.length > ORG_LIMITS.emailInvitesPerPaste ? ` · up to ${ORG_LIMITS.emailInvitesPerPaste} here` : ''}`
                        : null}
                </p>
            </div>
        </div>
    )
}

// The same words as Settings → Work (org design plan ST15).
const LATE = ORG_SETTING_LABELS.lateRule.options
const REMINDERS = ORG_SETTING_LABELS.reminders.options

/** Phase 4 Setup for orgs: projects inside, and the Work defaults as one line (report §34.5). */
export function OrgSettingsFields() {
    const { register, setValue } = useFormContext<CreateWorkspaceInput>()
    const orgType = useWatch<CreateWorkspaceInput, 'organization.org_type'>({ name: 'organization.org_type' })
    const chosen = useWatch<CreateWorkspaceInput, 'organization.work'>({ name: 'organization.work' })
    const typeWork = readOrgWork({}, orgType)
    const work = {
        reviewRequired: chosen?.review_required ?? typeWork.reviewRequired,
        lateRule: chosen?.late_rule ?? typeWork.lateRule,
        reminders: chosen?.reminders ?? typeWork.reminders,
        storyPoints: chosen?.story_points ?? typeWork.storyPoints,
    }
    const [open, setOpen] = useState(false)
    const set = (patch: NonNullable<typeof chosen>) => setValue('organization.work', { ...chosen, ...patch }, { shouldDirty: true })
    const L = ORG_SETTING_LABELS
    return (
        <div className="space-y-6">
            <fieldset>
                <legend className={labelClass}>{L.childCreation.label}</legend>
                <div className="mt-3 space-y-2.5 text-[13px]">
                    {(['members', 'admins'] as const).map((v) => (
                        <label key={v} className="flex items-center gap-2.5">
                            <input type="radio" value={v} {...register('organization.child_creation')} className="nb-radio" /> {L.childCreation.options[v]}
                        </label>
                    ))}
                </div>
            </fieldset>
            {/* A checkbox, not a switch: Create organization saves it (spec §10). */}
            <label className="flex items-start gap-2.5 text-[13px]">
                <input type="checkbox" {...register('organization.outside_people')} className="nb-check mt-0.5" />
                <span>
                    <span className="block font-medium">{L.outsidePeople.label}</span>
                    <span className="block text-muted-foreground">Off by default. {L.outsidePeople.help}</span>
                </span>
            </label>
            <div>
                <p className={labelClass}>Work defaults</p>
                <p className={helpClass} data-testid="create-org-work-summary">
                    Review {work.reviewRequired ? 'on' : 'off'} · Late work {LATE[work.lateRule].toLowerCase()} · Reminders {REMINDERS[work.reminders].toLowerCase()} · {L.storyPoints.label} {work.storyPoints}
                    {' · '}<button type="button" className="nb-link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? 'Done' : 'Change'}</button>
                </p>
                {open ? (
                    <div className="mt-3 grid max-w-2xl gap-4 sm:grid-cols-2">
                        <label className="flex items-start gap-2.5 text-[13px] sm:col-span-2"><input type="checkbox" className="nb-check mt-0.5" checked={work.reviewRequired} onChange={(e) => set({ review_required: e.target.checked })} /><span><span className="block font-medium">{L.reviewRequired.label}</span><span className="block text-muted-foreground">{L.reviewRequired.help}</span></span></label>
                        <label><span className={labelClass}>{L.lateRule.label}</span>
                            <select className="nb-select mt-1.5 w-full" value={work.lateRule} onChange={(e) => set({ late_rule: e.target.value as keyof typeof LATE })}>
                                {Object.entries(LATE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                        </label>
                        <label><span className={labelClass}>{L.reminders.label}</span>
                            <select className="nb-select mt-1.5 w-full" value={work.reminders} onChange={(e) => set({ reminders: e.target.value as keyof typeof REMINDERS })}>
                                {Object.entries(REMINDERS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                        </label>
                        <label><span className={labelClass}>{L.storyPoints.label}</span>
                            <select className="nb-select mt-1.5 w-full" value={work.storyPoints} onChange={(e) => set({ story_points: e.target.value as 'shown' | 'hidden' })}>
                                <option value="shown">{L.storyPoints.options.shown}</option>
                                <option value="hidden">{L.storyPoints.options.hidden}</option>
                            </select>
                        </label>
                    </div>
                ) : null}
                <p className={helpClass}>Set by the type; every assignment can still change them. Also in Settings → Work.</p>
            </div>
        </div>
    )
}
