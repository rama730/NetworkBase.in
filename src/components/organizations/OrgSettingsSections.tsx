'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useRefreshSidebar } from '@/hooks/useRefreshSidebar'
import { useQuery } from '@tanstack/react-query'
import { X } from '@/components/ui/icons'

import {
    leaveOrgAction,
    readLeavePreviewAction,
    type LeavePreview,
    previewVisibilityCapAction,
    readOrgSettingsFactsAction,
    readSprintRenameOfferAction,
    renameOldSprintNamesAction,
    regenerateJoinCodeAction,
    updateMyOrgMembershipAction,
    updateOrgSettingsAction,
} from '@/app/actions/organizations'
import { SettingsCard } from '@/components/workspaces/settings/SettingsFormFields'
import { SettingsSwitch } from '@/components/settings/ui/SettingsSwitch'
import { Button } from '@/components/ui/button'
import { SavedTick } from '@/components/ui/SavedTick'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/feedback'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CopyButton } from '@/components/ui/copy-button'
import { JoinCode } from '@/components/organizations/org-ui'
import { fieldError, fieldHint, fieldLabel, formatOrgDate } from '@/lib/organizations/display'
import { ORG_SETTING_LABELS, joinModeHint } from '@/lib/organizations/settings-labels'
import { ORG_LIMITS, ORG_TYPES, orgRoleNames, orgTypeLabel } from '@/lib/organizations/config'
import { GRANT_WORDS, PERMISSION_AREAS } from '@/lib/organizations/permission-labels'
import { typeProfile } from '@/lib/organizations/type-profile'
import { cleanMainWord, MAIN_WORD_CHOICES } from '@/lib/organizations/sprint-words'
import { Notice } from '@/components/ui/notice'
import { orgChatSettings } from '@/lib/organizations/chat-rules'
import { updateOrgChatSettingsAction } from '@/app/actions/org-chat'
import { PartOfField } from '@/components/organizations/OrgDiscoverySections'
import type { OrgDetail } from '@/lib/organizations/detail'
import { orgGrant, type OrgRole } from '@/lib/organizations/permissions'
import { rolePlural } from '@/lib/organizations/role-words'
import type { OrgMemberRole, OrgSettingsSection } from '@/lib/organizations/settings'
import { timeLabel, TIME_OPTIONS } from '@/lib/organizations/zoned-time'

// Org settings sections (report §21.2–21.4), rendered inside the project Settings document. Switches save at once,
// as they do in workspace Settings (spec §10, decision D1); other fields save with their section's button. Each card
// shows who changed it last.

type SectionProps = { orgId: string; organization: OrgDetail; role: OrgMemberRole }

const labelClass = fieldLabel
const helpClass = fieldHint
const OWNER_ONLY = 'Only the owner can change this.'

function Section({ id, children }: { id: string; children: ReactNode }) {
    return <section id={`project-settings-${id}`} data-project-settings-section className="space-y-6">{children}</section>
}

/** A function, not a component: SettingsCard draws its footer band for any element, even one that renders nothing. */
function lastChanged(organization: OrgDetail, section: OrgSettingsSection) {
    const change = organization.changes[section]
    if (!change) return null
    return <p className="nb-meta">Last changed by {change.byName ?? 'someone'} · {formatOrgDate(change.at, { month: 'short', day: 'numeric', year: 'numeric' }, organization.timeZone)}</p>
}

/** One save button per section: "Saved" pops beside the button when it saved, the error stays there when it didn't (spec §33). */
function useSave() {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)
    const [savedAt, setSavedAt] = useState(0)
    const save = (action: () => Promise<{ success: boolean; error?: string }>, done?: () => void) =>
        startTransition(async () => {
            const result = await action()
            if (!result.success) return setError(result.error ?? 'Couldn’t save.')
            setError(null)
            setSavedAt(Date.now())
            done?.()
            router.refresh()
        })
    const status = error ? <p role="alert" className={fieldError}>{error}</p> : savedAt && !pending ? <SavedTick key={savedAt} /> : null
    return { pending, save, status }
}

/** A switch that saves as soon as it flips (spec §10 Switch), and flips back with the reason when the save fails. */
function InstantSwitch({ label, help, checked, disabled, save }: { label: string; help?: ReactNode; checked: boolean; disabled?: boolean; save: (on: boolean) => Promise<{ success: boolean; error?: string }> }) {
    const router = useRouter()
    const [on, setOn] = useState(checked)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const flip = async (next: boolean) => {
        setOn(next)
        setBusy(true)
        setError(null)
        const result = await save(next).catch(() => ({ success: false, error: 'Couldn’t save.' }))
        setBusy(false)
        if (!result.success) {
            setOn(!next)
            // Toasts show only allowlisted text, so the reason stays beside the switch, as with a Save button.
            setError(`${label} wasn’t changed. ${result.error ?? 'Try again.'}`)
            return void toast.error('Couldn’t save.')
        }
        toast.success(next ? `${label}: on` : `${label}: off`)
        router.refresh()
    }
    return (
        <div className="flex items-start justify-between gap-4">
            <div>
                <p className={labelClass}>{label}</p>
                {help ? <p className={helpClass}>{help}</p> : null}
                {error ? <p role="alert" className={fieldError}>{error}</p> : null}
            </div>
            <SettingsSwitch checked={on} disabled={busy || disabled} onCheckedChange={(next) => void flip(next)} aria-label={label} />
        </div>
    )
}

/** The counts beside the fields (report §22.4), read once for the whole page. Admins only. */
function useOrgFacts(orgId: string, enabled = true) {
    const q = useQuery({ queryKey: ['org-settings-facts', orgId], queryFn: () => readOrgSettingsFactsAction(orgId), enabled, staleTime: 30_000 })
    return q.data?.success ? q.data.facts : null
}

const membersHref = (handle: string | null | undefined, orgId: string) => `/org/${encodeURIComponent(handle ?? orgId)}?tab=members`

export function OrgMembershipSection({ orgId, organization, role }: SectionProps) {
    const [title, setTitle] = useState(organization.you?.title ?? '')
    const { pending, save, status } = useSave()
    return (
        <Section id="you-membership">
            <SettingsCard title="My membership" headingLevel={2} description="Your role, your title and whether this organization shows on your profile.">
                <div className="space-y-6">
                    <p className="text-[13px] text-foreground">
                        {organization.roleNames[role]}{role === 'viewer' ? ' · read-only' : ''}
                        {organization.you ? <span className="text-muted-foreground"> · joined {formatOrgDate(organization.you.joinedAt, { month: 'short', day: 'numeric', year: 'numeric' }, organization.timeZone)}</span> : null}
                    </p>
                    <div>
                        <label htmlFor="org-my-title" className={labelClass}>Your title</label>
                        <p className={helpClass}>Shown beside your name, for example &quot;Section B&quot; or &quot;TA&quot;.</p>
                        <div className="mt-2 flex max-w-md items-center gap-2">
                            <Input id="org-my-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
                            <Button variant="outline" disabled={pending} onClick={() => save(() => updateMyOrgMembershipAction(orgId, { title: title.trim() || null }))}>Save title</Button>
                        </div>
                        {status}
                    </div>
                    <InstantSwitch label="Show this organization on my profile" help="On by default." checked={organization.you?.showOnProfile ?? true}
                        save={(on) => updateMyOrgMembershipAction(orgId, { show_on_profile: on })} />
                </div>
            </SettingsCard>
        </Section>
    )
}

/**
 * Management (report §22.4, decision 28): Leave is everyone's; the owner's transfer, archive, duplicate and delete
 * come in as children.
 */
export function OrgManagementSection({ orgId, role, title, afterLeaveHref = '/discover', children }: SectionProps & { title: string; afterLeaveHref?: string; children?: ReactNode }) {
    const router = useRouter()
    const refreshSidebar = useRefreshSidebar()
    const [open, setOpen] = useState(false)
    const [preview, setPreview] = useState<LeavePreview | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const ask = () => startTransition(async () => {
        const result = await readLeavePreviewAction(orgId)
        if (!result.success) return setError(result.error)
        setPreview(result.preview)
        setOpen(true)
    })
    const leave = () => startTransition(async () => {
        const result = await leaveOrgAction(orgId)
        if (!result.success) return setError(result.error)
        // Report §26.10 and §38.6: back to About if the organization is public, with the write-up nudge.
        toast.success(`You left ${title}. You can still write up your work.`)
        refreshSidebar()
        router.replace(afterLeaveHref)
    })
    const month = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(new Date())
    return (
        <Section id="org-management">
            {children}
            <SettingsCard title="Leave organization" headingLevel={2} description="Stop being a member. To come back you’ll need the current code or a new invite." danger>
                {role === 'owner' ? (
                    <p className="text-[13px] text-muted-foreground">Transfer ownership first, under Organization management above.</p>
                ) : (
                    <div className="space-y-2">
                        <Button variant="destructive" disabled={pending} onClick={ask}>Leave {title}</Button>
                        {error ? <p role="alert" className={fieldError}>{error}</p> : null}
                    </div>
                )}
            </SettingsCard>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Leave {title}?</DialogTitle>
                        <DialogDescription>{preview?.led.length ? 'You own these workspaces. Transfer or detach each one first.' : 'Here’s what happens.'}</DialogDescription>
                    </DialogHeader>
                    {preview?.led.length ? (
                        // Report §26.10: a lead sees the workspaces to hand over instead of Leave.
                        <ul className="space-y-1.5 text-[13px]">
                            {preview.led.map((w) => <li key={w.id}><a className="nb-link" href={`/workspaces/${encodeURIComponent(w.slug ?? w.id)}?tab=settings`}>{w.title}</a> · transfer or detach it in its Settings</li>)}
                        </ul>
                    ) : preview ? (
                        <ul className="list-disc space-y-1 pl-5 text-[13px]">
                            {preview.teams.length ? <li>You’ll leave {preview.teams.join(' and ')}; your {preview.teams.length === 1 ? 'seat reopens' : 'seats reopen'}</li> : null}
                            {preview.open ? <li>{preview.open} open {preview.open === 1 ? 'assignment is' : 'assignments are'} removed</li> : null}
                            {preview.submitted ? <li>{preview.submitted} submitted {preview.submitted === 1 ? 'assignment stays' : 'assignments stay'} with the {preview.keptBy}</li> : null}
                            <li>Your profile entry stays, as “Left {month}”</li>
                            <li>To come back, you’ll need the current code or a new invite</li>
                        </ul>
                    ) : null}
                    <DialogFooter paper>
                        <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        {preview && !preview.led.length ? <Button variant="destructive" disabled={pending} onClick={leave}>Leave {title}</Button> : null}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Section>
    )
}

/** Every zone the browser knows, for the time zone select (report §22.4), the same control as creation (ST12). */
const TIME_ZONES: string[] = (() => { try { return Intl.supportedValuesOf('timeZone') } catch { return [] } })()

export function OrgProfileSection({ orgId, organization, role }: SectionProps) {
    const [type, setType] = useState(organization.type ?? 'community')
    const [termStart, setTermStart] = useState(organization.termStart ?? '')
    const [termEnd, setTermEnd] = useState(organization.termEnd ?? '')
    const [timeZone, setTimeZone] = useState(organization.timeZone ?? '')
    const [welcome, setWelcome] = useState(organization.welcomeNote ?? '')
    const [typeLabel, setTypeLabel] = useState(organization.type === 'other' ? organization.typeLabel ?? '' : '')
    const [partOf, setPartOf] = useState(organization.partOf ?? '')
    const [partOfOrg, setPartOfOrg] = useState(organization.partOfOrg)
    const [location, setLocation] = useState(organization.location ?? '')
    const [confirmType, setConfirmType] = useState(false)
    const { pending, save, status } = useSave()
    const typeSave = useSave()
    const isOwner = role === 'owner'
    const termWrong = Boolean(termStart && termEnd && termEnd <= termStart)
    // Report §22.1 #2: the confirmation lists what really changes; roles you renamed keep your names.
    const nextNames = orgRoleNames(type, { roleNames: Object.fromEntries(Object.entries(organization.roleNames).filter(([k, v]) => v !== orgRoleNames(organization.type, {})[k as keyof typeof organization.roleNames])) })
    const renamed = (Object.keys(nextNames) as Array<keyof typeof nextNames>).filter((k) => nextNames[k] !== organization.roleNames[k])
    const zones = timeZone && !TIME_ZONES.includes(timeZone) ? [timeZone, ...TIME_ZONES] : TIME_ZONES
    return (
        <Section id="org-profile">
            <SettingsCard title="Organization profile" headingLevel={2} description="What people see on About, and how the organization keeps time." footer={lastChanged(organization, 'profile')}>
                <div className="space-y-6">
                    <div>
                        <label htmlFor="org-type" className={labelClass}>Type</label>
                        <p className={helpClass}>{isOwner ? 'It sets the words used here, such as Submissions. It has its own save.' : OWNER_ONLY}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <select id="org-type" value={type} disabled={!isOwner} onChange={(e) => setType(e.target.value as typeof type)} className="nb-select">
                                {ORG_TYPES.map((t) => <option key={t} value={t}>{orgTypeLabel(t)}</option>)}
                            </select>
                            {isOwner ? <Button variant="outline" disabled={typeSave.pending || (type === organization.type && (type !== 'other' || typeLabel === (organization.typeLabel ?? ''))) || (type === 'other' && !typeLabel.trim())} onClick={() => setConfirmType(true)}>Save type</Button> : null}
                        </div>
                        {type === 'other' ? (
                            <label className="mt-3 block max-w-sm"><span className={labelClass}>What do you call it?</span>
                                <Input value={typeLabel} onChange={(e) => setTypeLabel(e.target.value)} placeholder="Nonprofit" maxLength={30} disabled={!isOwner} className="mt-1.5" />
                            </label>
                        ) : null}
                        {typeSave.status}
                        <ConfirmDialog open={confirmType} onOpenChange={setConfirmType} title={`Change the type to ${orgTypeLabel(type)}?`}
                            description={[
                                renamed.length ? `Roles become ${renamed.map((k) => `${organization.roleNames[k]} to ${nextNames[k]}`).join(', ')}.` : 'Role names stay as they are.',
                                'Labels such as Submissions follow the new type. People, folders, work, joining, visibility and rules stay the same.',
                            ].join(' ')}
                            confirmLabel="Change type"
                            onConfirm={() => typeSave.save(() => updateOrgSettingsAction(orgId, 'profile', { org_type: type, type_label: type === 'other' ? typeLabel.trim() : null }))} />
                    </div>
                    <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
                        <div className="flex flex-col">
                            <span className={labelClass}>Part of</span>
                            <span className={`block ${helpClass}`}>The bigger body it belongs to, for example RV College of Engineering. Shows in the header. Pick it from the list when it’s on NetworkBase; a verified one can confirm you for the badge.</span>
                            <div className="mt-auto"><PartOfField orgId={orgId} value={partOf} linked={partOfOrg} onChange={(next) => { setPartOf(next.text); setPartOfOrg(next.linked ? { ...next.linked, slug: null } : null) }} /></div>
                        </div>
                        <label className="flex flex-col">
                            <span className={labelClass}>Where</span>
                            <span className={`block pb-2 ${helpClass}`}>A city, or Online. Shows in the header.</span>
                            <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={100} className="mt-auto" />
                        </label>
                    </div>
                    {typeProfile(organization.type).termDates ? <fieldset>
                        <legend className={labelClass}>Term</legend>
                        <p className={helpClass}>Optional, for example Aug–Dec 2026. Shown on About, and it sets the week line.</p>
                        <div className="mt-2 grid max-w-md gap-3 sm:grid-cols-2">
                            <label><span className={labelClass}>Starts</span><Input type="date" value={termStart} onChange={(e) => setTermStart(e.target.value)} className="mt-1.5" /></label>
                            <label><span className={labelClass}>Ends</span><Input type="date" value={termEnd} min={termStart || undefined} onChange={(e) => setTermEnd(e.target.value)} className="mt-1.5" aria-invalid={termWrong || undefined} /></label>
                        </div>
                        {termWrong ? <p role="alert" className={fieldError}>The term has to end after it starts.</p> : null}
                    </fieldset> : null}
                    <div>
                        <label htmlFor="org-tz" className={labelClass}>Time zone</label>
                        <p className={helpClass}>Due dates and the admin email use it. Empty means each person’s own.</p>
                        <select id="org-tz" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} className="nb-select mt-2 w-full max-w-sm">
                            <option value="">Each person’s own</option>
                            {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="org-welcome" className={labelClass}>Welcome note</label>
                        <p className={helpClass}>New members see it once when they join, and members see it on About. Up to 500 characters.</p>
                        <textarea id="org-welcome" value={welcome} onChange={(e) => setWelcome(e.target.value)} rows={4} maxLength={500} className="nb-textarea mt-2" />
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <Button disabled={pending || termWrong} onClick={() => save(() => updateOrgSettingsAction(orgId, 'profile', {
                            part_of: partOf.trim() || null, part_of_org_id: partOfOrg?.id ?? null, location: location.trim() || null,
                            term_start: termStart || null, term_end: termEnd || null, time_zone: timeZone.trim() || null, welcome_note: welcome.trim() || null,
                        }))}>Save profile</Button>
                        {status}
                    </div>
                </div>
            </SettingsCard>
        </Section>
    )
}

export function OrgAccessSection({ orgId, organization, maxMembers, handle }: SectionProps & { maxMembers: string | null; handle?: string | null }) {
    const facts = useOrgFacts(orgId)
    const [joinMode, setJoinMode] = useState(organization.joinMode)
    const [max, setMax] = useState(maxMembers ?? '')
    const [code, setCode] = useState(organization.joinCode)
    const [confirming, setConfirming] = useState(false)
    const { pending, save, status } = useSave()
    const regen = useSave()
    const memberWord = organization.roleNames.member
    const maxWrong = Boolean(facts && max && Number(max) < facts.members)
    return (
        <Section id="org-access">
            <SettingsCard title="Joining" headingLevel={2} description="How people join. Invites are in the Members tab; Public or Private is in Visibility and discovery." footer={lastChanged(organization, 'access')}>
                <div className="space-y-6">
                    <div>
                        <p className={labelClass}>Join code</p>
                        <p className={helpClass}>People enter it at /join. A new code stops the old one at once.</p>
                        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-md bg-muted p-3">
                            {code ? <JoinCode code={code} /> : null}
                            {code ? <CopyButton text={code} label="Copy code" /> : null}
                            <Button variant="outline" size="sm" disabled={regen.pending} onClick={() => setConfirming(true)}>Make a new code</Button>
                        </div>
                        {regen.status}
                        <ConfirmDialog open={confirming} onOpenChange={setConfirming} title="Make a new join code?" description="The current code stops working at once. People who haven’t joined need the new one." confirmLabel="Make a new code"
                            onConfirm={() => regen.save(async () => {
                                const result = await regenerateJoinCodeAction(orgId)
                                if (result.success) setCode(result.joinCode)
                                return result
                            })} />
                    </div>
                    <InstantSwitch label="Code works" help="Off means nobody can join by code. The code itself doesn’t change." checked={organization.joinCodeEnabled}
                        save={(on) => updateOrgSettingsAction(orgId, 'access', { join_code_enabled: on })} />
                    {/* CLI report A8.8: agent tokens for members, with how many are active now (no names). */}
                    <InstantSwitch label="Allow AI agents" help={`Members can connect Claude Code, Codex or Cursor to this organization’s workspaces. Off stops every agent here at once.${organization.agentTokens != null ? ` ${organization.agentTokens} active now.` : ''}`} checked={organization.allowAgentTokens}
                        save={(on) => updateOrgSettingsAction(orgId, 'access', { allow_agent_tokens: on })} />
                    <fieldset>
                        <legend className={labelClass}>{ORG_SETTING_LABELS.joinMode.label}</legend>
                        <div className="mt-2 space-y-2.5 text-[13px]">
                            {(['instant', 'approval'] as const).map((mode) => (
                                <label key={mode} className="flex items-start gap-2.5">
                                    <input type="radio" className="nb-radio mt-0.5" name="org-join-mode" checked={joinMode === mode} onChange={() => setJoinMode(mode)} />
                                    <span><span className="block font-medium">{ORG_SETTING_LABELS.joinMode.options[mode]}</span><span className="block text-muted-foreground">{joinModeHint(mode, memberWord)}</span></span>
                                </label>
                            ))}
                        </div>
                        {facts?.waitingRequests ? <p className="mt-2 text-[13px]">{facts.waitingRequests} {facts.waitingRequests === 1 ? 'request' : 'requests'} waiting · <Link href={membersHref(handle, orgId)} className="nb-link">Review</Link></p> : null}
                    </fieldset>
                    <div>
                        <label htmlFor="org-max" className={labelClass}>Max members</label>
                        <p className={helpClass}>Empty means up to {ORG_LIMITS.membersPerOrg.toLocaleString('en')}. When full, the join page says &quot;This organization is full&quot;.{facts ? ` ${facts.members} ${facts.members === 1 ? 'member' : 'members'} now.` : ''}</p>
                        <Input id="org-max" type="number" min={facts?.members ?? 1} max={ORG_LIMITS.membersPerOrg} value={max} onChange={(e) => setMax(e.target.value)} className="mt-2 w-32" aria-invalid={maxWrong || undefined} />
                        {maxWrong ? <p role="alert" className={fieldError}>There are {facts!.members} members now. Max members can’t be lower.</p> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <Button disabled={pending || maxWrong} onClick={() => save(() => updateOrgSettingsAction(orgId, 'access', { join_mode: joinMode, max_members: max ? Number(max) : null }))}>Save joining</Button>
                        {status}
                    </div>
                </div>
            </SettingsCard>
        </Section>
    )
}

const TABLE_ROLES: Array<[OrgRole, 'owner' | 'admin' | 'member' | 'viewer']> = [['owner', 'owner'], ['admin', 'admin'], ['member', 'member'], ['guest', 'viewer']]

/** What each role can do (report §22.4): every row of the real permissions, grouped by area, in the org's role names. */
export function RolesTable({ organization, onOpenSection }: { organization: OrgDetail; onOpenSection?: (id: string) => void }) {
    return (
        <div className="space-y-5 overflow-x-auto">
            {PERMISSION_AREAS.map(({ area, rows }) => (
                <table key={area} className="w-full min-w-[30rem] table-fixed text-left text-[13px]">
                    <caption className="nb-micro pb-2 text-left">{area}</caption>
                    <thead>
                        <tr className="border-b border-border text-[12px] text-muted-foreground">
                            <th scope="col" className="w-1/2 py-1.5 pr-3 font-medium">Can</th>
                            {TABLE_ROLES.map(([, key]) => <th key={key} scope="col" className="py-1.5 pr-3 font-medium">{organization.roleNames[key]}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.action} className="border-b border-border last:border-b-0">
                                <th scope="row" className="py-2 pr-3 font-normal text-foreground">{row.label}</th>
                                {TABLE_ROLES.map(([grantRole, key]) => {
                                    const grant = orgGrant(grantRole, row.action)
                                    return (
                                        <td key={key} className="py-2 pr-3 text-muted-foreground">
                                            {grant === 'setting' && row.setting && onOpenSection
                                                ? <button type="button" className="nb-link" onClick={() => onOpenSection(row.setting!)}>{row.words?.[grant] ?? GRANT_WORDS[grant]}</button>
                                                : row.words?.[grant] ?? GRANT_WORDS[grant] ?? '—'}
                                        </td>
                                    )
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            ))}
        </div>
    )
}

export function OrgPeopleSection({ orgId, organization, role, handle, onOpenSection }: SectionProps & { handle?: string | null; onOpenSection?: (id: string) => void }) {
    const [names, setNames] = useState(organization.roleNames)
    const { pending, save, status } = useSave()
    const facts = useOrgFacts(orgId)
    const isOwner = role === 'owner'
    const typeNames = useMemo(() => orgRoleNames(organization.type, {}), [organization.type])
    const BASE = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' } as const
    return (
        <Section id="org-people">
            <SettingsCard title="People and roles" headingLevel={2} description="Role names and what each role can do. Admins are managed in the Members tab." footer={lastChanged(organization, 'people')}>
                <div className="space-y-6">
                    <div>
                        <p className={labelClass}>Role names</p>
                        <p className={helpClass}>{isOwner ? 'For example Teacher / TA / Student / Viewer. What each role can do always comes from the role.' : OWNER_ONLY}</p>
                        <div className="mt-2 grid max-w-md gap-3 sm:grid-cols-2">
                            {TABLE_ROLES.map(([, key]) => (
                                <label key={key}><span className={labelClass}>{BASE[key]}</span>
                                    <Input value={names[key]} onChange={(e) => setNames({ ...names, [key]: e.target.value })} disabled={!isOwner} maxLength={30} className="mt-1.5" />
                                </label>
                            ))}
                        </div>
                        {isOwner ? (
                            <div className="mt-3 flex flex-wrap items-center gap-3">
                                <Button disabled={pending} onClick={() => save(() => updateOrgSettingsAction(orgId, 'people', { role_names: names }))}>Save role names</Button>
                                <Button variant="ghost" disabled={pending} onClick={() => { setNames(typeNames); save(() => updateOrgSettingsAction(orgId, 'people', { role_names: typeNames })) }}>Reset to {orgTypeLabel(organization.type)}’s names</Button>
                                {status}
                            </div>
                        ) : null}
                    </div>
                    <div>
                        <p className={labelClass}>Admins</p>
                        <p className="mt-1 text-[13px]">{facts ? <span className="tabular-nums">{facts.admins} of {ORG_LIMITS.adminsPerOrg} · </span> : null}<Link href={membersHref(handle, orgId)} className="nb-link">Manage in Members</Link></p>
                    </div>
                    <div>
                        <p className={labelClass}>What each role can do</p>
                        <div className="mt-3"><RolesTable organization={organization} onOpenSection={onOpenSection} /></div>
                    </div>
                </div>
            </SettingsCard>
        </Section>
    )
}

/** What's allowed (report §22.4): the same table, read only, for members and viewers. */
export function OrgAllowedSection({ organization }: { organization: OrgDetail }) {
    return (
        <Section id="org-allowed">
            <SettingsCard title="What’s allowed" headingLevel={2} description="What each role can do in this organization. Admins set some of these in Settings.">
                <RolesTable organization={organization} />
            </SettingsCard>
        </Section>
    )
}

const CAP_OPTIONS = [
    { value: 'public', label: 'Public', hint: 'Workspaces choose Public, Organization only or Private.' },
    { value: 'org', label: 'Organization only', hint: 'Nothing leaves the organization.' },
    { value: 'private', label: 'Private', hint: 'Each workspace is seen by its team and admins only.' },
] as const

/** Default teams as tags (report §22.4): Enter adds one, × removes it; up to 20. */
function ChipsInput({ value, onChange, label }: { value: string[]; onChange: (next: string[]) => void; label: string }) {
    const [draft, setDraft] = useState('')
    const add = () => {
        const v = draft.trim().slice(0, 100)
        if (v && !value.includes(v) && value.length < 20) onChange([...value, v])
        setDraft('')
    }
    return (
        <div className="mt-2 flex min-h-[var(--ui-control-height)] flex-wrap items-center gap-1.5 rounded-md border border-input bg-card p-1.5">
            {value.map((chip) => (
                <span key={chip} className="nb-tag pr-1">
                    {chip}
                    <button type="button" aria-label={`Remove ${chip}`} className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => onChange(value.filter((c) => c !== chip))}><X className="size-3.5" aria-hidden="true" /></button>
                </span>
            ))}
            <input aria-label={label} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={value.length >= 20}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() } }} onBlur={add}
                placeholder={value.length >= 20 ? 'Up to 20' : 'Add a team'} className="min-w-28 flex-1 bg-transparent px-1 py-0.5 text-[13px] outline-none" />
        </div>
    )
}

export function OrgWorkspacesSection({ orgId, organization }: SectionProps) {
    const facts = useOrgFacts(orgId)
    const [confirmCap, setConfirmCap] = useState(false)
    const [childCreation, setChildCreation] = useState(organization.childCreation)
    const [cap, setCap] = useState(organization.visibilityCap)
    const [defaultUnits, setDefaultUnits] = useState<string[]>(organization.defaultUnits)
    // Impact preview (report §21.1 principle 4): how many projects a tighter cap would lower.
    const [affected, setAffected] = useState<number | null>(null)
    const { pending, save, status } = useSave()
    const saveAll = () => save(() => updateOrgSettingsAction(orgId, 'projects', { child_creation: childCreation, default_units: defaultUnits, ...(cap !== organization.visibilityCap ? { visibility_cap: cap } : {}) }))
    const chooseCap = async (next: typeof cap) => {
        setCap(next)
        setAffected(null)
        const preview = await previewVisibilityCapAction(orgId, next)
        if (preview.success) setAffected(preview.affected)
    }
    const projects = (patch: Record<string, boolean>) => updateOrgSettingsAction(orgId, 'projects', patch)
    return (
        <Section id="org-projects">
            <SettingsCard title="Workspaces" headingLevel={2} description="Who creates workspaces inside the organization, and the rules they follow." footer={lastChanged(organization, 'projects')}>
                <div className="space-y-6">
                    {facts ? <p className="nb-meta">{facts.workspaces} of {ORG_LIMITS.childProjectsPerOrg} workspaces</p> : null}
                    <fieldset>
                        <legend className={labelClass}>{ORG_SETTING_LABELS.childCreation.label}</legend>
                        <p className={helpClass}>Owners and admins always can. Changing this affects new workspaces only.</p>
                        <div className="mt-2 space-y-2.5 text-[13px]">
                            {(['members', 'admins'] as const).map((v) => (
                                <label key={v} className="flex items-center gap-2.5"><input type="radio" className="nb-radio" name="org-child-creation" checked={childCreation === v} onChange={() => setChildCreation(v)} />{ORG_SETTING_LABELS.childCreation.options[v]}</label>
                            ))}
                        </div>
                    </fieldset>
                    <fieldset>
                        <legend className={labelClass}>Highest allowed visibility</legend>
                        <p className={helpClass}>The most open a workspace here can be. Tightening it lowers workspaces above it, after you confirm.</p>
                        <div className="mt-2 space-y-2.5 text-[13px]">
                            {CAP_OPTIONS.map((option) => (
                                <label key={option.value} className="flex items-start gap-2.5">
                                    <input type="radio" className="nb-radio mt-0.5" name="org-visibility-cap" checked={cap === option.value} onChange={() => void chooseCap(option.value)} />
                                    <span><span className="block font-medium">{option.label}</span><span className="block text-muted-foreground">{option.hint}</span></span>
                                </label>
                            ))}
                        </div>
                        {affected ? <p className="mt-2 text-[13px] text-[var(--status-warning)]">{affected} {affected === 1 ? 'workspace becomes' : 'workspaces become'} {cap === 'private' ? 'Private' : 'Organization only'} when you save.</p> : null}
                    </fieldset>
                    <div>
                        <p className={labelClass}>Default teams</p>
                        <p className={helpClass}>Every new workspace starts with these, for example Frontend, Backend, Testing. Each workspace can still change them.</p>
                        <ChipsInput value={defaultUnits} onChange={setDefaultUnits} label="Add a default team" />
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <Button disabled={pending} onClick={() => (affected ? setConfirmCap(true) : saveAll())}>Save workspace rules</Button>
                        {status}
                        <ConfirmDialog open={confirmCap} onOpenChange={setConfirmCap} title="Lower workspaces’ visibility?"
                            description={`${affected} ${affected === 1 ? 'workspace becomes' : 'workspaces become'} ${cap === 'private' ? 'Private' : 'Organization only'}. Their teams are told.`}
                            confirmLabel="Lower and save" onConfirm={() => saveAll()} />
                    </div>
                    <div className="space-y-5 border-t border-border pt-5">
                        <InstantSwitch label={ORG_SETTING_LABELS.outsidePeople.label} checked={organization.outsidePeople}
                            help={<>{ORG_SETTING_LABELS.outsidePeople.help} Turning it off removes nobody.{facts?.outsidePeople ? ` ${facts.outsidePeople} outside ${facts.outsidePeople === 1 ? 'person is' : 'people are'} in workspaces now.` : ''}</>}
                            save={(on) => projects({ outside_people: on })} />
                        <InstantSwitch label="Workspaces can share updates to the organization" help="Shared posts show in the organization’s Updates under From workspaces. Private workspaces never share."
                            checked={organization.childShare} save={(on) => projects({ child_share: on })} />
                        <InstantSwitch label="New workspaces follow the organization’s sprints" help="New workspaces only. Each workspace has its own switch."
                            checked={organization.followSprintsDefault} save={(on) => projects({ follow_sprints: on })} />
                    </div>
                </div>
            </SettingsCard>
        </Section>
    )
}

/** Settings → Work (report §21.2 #5): defaults for new assignments and sprints, reminders and story points. */
export function OrgWorkSection({ orgId, organization }: SectionProps) {
    const [work, setWork] = useState(organization.work)
    const { pending, save, status } = useSave()
    const set = <K extends keyof typeof work>(key: K, value: (typeof work)[K]) => setWork((cur) => ({ ...cur, [key]: value }))
    const instant = (key: 'review_required' | 'sprint_auto_start' | 'sprint_notify_on_start' | 'sprint_show_in_children' | 'sprint_create_matching') => (on: boolean) => updateOrgSettingsAction(orgId, 'work', { [key]: on })
    const L = ORG_SETTING_LABELS
    return (
        <Section id="org-work">
            <SettingsCard title="Work" headingLevel={2} description="Defaults for new tasks and sprints. Each one can still change them." footer={lastChanged(organization, 'work')}>
                <div className="space-y-6">
                    <h3 className="nb-micro">Tasks</h3>
                    <InstantSwitch label={L.reviewRequired.label} help={`${L.reviewRequired.help} Fills in the task form.`} checked={organization.work.reviewRequired} save={instant('review_required')} />
                    <div className="grid gap-5 sm:grid-cols-2">
                        <label className="flex flex-col"><span className={labelClass}>{L.lateRule.label}</span><span className={`block pb-2 ${helpClass}`}>{L.lateRule.help}</span>
                            <select className="nb-select mt-auto w-full" value={work.lateRule} onChange={(e) => set('lateRule', e.target.value as typeof work.lateRule)}>
                                {(['always', 'until', 'none'] as const).map((v) => <option key={v} value={v}>{L.lateRule.options[v]}</option>)}
                            </select>
                        </label>
                        <label className="flex flex-col"><span className={labelClass}>{L.reminders.label}</span><span className={`block pb-2 ${helpClass}`}>{L.reminders.help}</span>
                            <select className="nb-select mt-auto w-full" value={work.reminders} onChange={(e) => set('reminders', e.target.value as typeof work.reminders)}>
                                {(['both', 'day_before', 'due_day', 'off'] as const).map((v) => <option key={v} value={v}>{L.reminders.options[v]}</option>)}
                            </select>
                        </label>
                        <label className="flex flex-col"><span className={labelClass}>AI agents on assignments</span><span className={`block pb-2 ${helpClass}`}>New assignments start with this. It applies to agents connected to NetworkBase; it can’t detect other tools.</span>
                            <select className="nb-select mt-auto w-full" value={work.aiPolicy} onChange={(e) => set('aiPolicy', e.target.value as typeof work.aiPolicy)}>
                                <option value="labelled">Allowed, labelled for reviewers</option><option value="allowed">Allowed</option><option value="not_allowed">Not allowed</option>
                            </select>
                        </label>
                        <label className="flex flex-col"><span className={labelClass}>{L.storyPoints.label}</span><span className={`block pb-2 ${helpClass}`}>{L.storyPoints.help}</span>
                            <select className="nb-select mt-auto w-full" value={work.storyPoints} onChange={(e) => set('storyPoints', e.target.value as typeof work.storyPoints)}>
                                {(['shown', 'hidden'] as const).map((v) => <option key={v} value={v}>{L.storyPoints.options[v]}</option>)}
                            </select>
                        </label>
                        <label className="flex flex-col"><span className={labelClass}>{L.dueTime.label}</span><span className={`block pb-2 ${helpClass}`}>{L.dueTime.help}</span>
                            <select className="nb-select mt-auto w-full" value={work.dueTime} onChange={(e) => set('dueTime', e.target.value)}>
                                {(TIME_OPTIONS.includes(work.dueTime) ? TIME_OPTIONS : [...TIME_OPTIONS, work.dueTime].sort()).map((t) => <option key={t} value={t}>{timeLabel(t)}</option>)}
                            </select>
                        </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <Button disabled={pending} onClick={() => save(() => updateOrgSettingsAction(orgId, 'work', { late_rule: work.lateRule, reminders: work.reminders, story_points: work.storyPoints, due_time: work.dueTime, ai_policy: work.aiPolicy }))}>Save task defaults</Button>
                        {status}
                    </div>
                    <h3 className="nb-micro border-t border-border pt-5">Sprints</h3>
                    <SprintWordSetting orgId={orgId} type={organization.type} saved={organization.work.mainSprintWord} />
                    <InstantSwitch label="Start automatically" help={`A sprint starts on its start date, for example ${typeProfile(organization.type).sprintPrefix}1 on Aug 5.`} checked={organization.work.sprintAutoStart} save={instant('sprint_auto_start')} />
                    <InstantSwitch label="Notify on start" help="Members hear when a sprint starts." checked={organization.work.sprintNotifyOnStart} save={instant('sprint_notify_on_start')} />
                    <InstantSwitch label="Show in every workspace in the organization" help="Workspaces see the running organization sprint and can link theirs to it." checked={organization.work.sprintShowInChildren} save={instant('sprint_show_in_children')} />
                    <InstantSwitch label="Create matching sprints" help="Off by default. Each workspace following organization sprints gets its own sprint with the same dates." checked={organization.work.sprintCreateMatching} save={instant('sprint_create_matching')} />
                </div>
            </SettingsCard>
        </Section>
    )
}

/**
 * Sprint redesign (2026-11-09): what a main sprint is called — the type's word (Unit, Phase), one of the common ones,
 * or the organization's own — and a one-time offer to rename old names like CO1 to it.
 */
function SprintWordSetting({ orgId, type, saved }: { orgId: string; type: string | null; saved: string | null }) {
    const typeWord = typeProfile(type).mainSprintWord
    const current = saved ?? typeWord
    const known = (MAIN_WORD_CHOICES as readonly string[]).includes(current)
    const [choice, setChoice] = useState(known ? current : 'other')
    const [own, setOwn] = useState(known ? '' : current)
    const { pending, save, status } = useSave()
    const offer = useQuery({ queryKey: ['sprint-rename-offer', orgId, current], queryFn: () => readSprintRenameOfferAction(orgId) })
    const changes = offer.data?.success ? offer.data.changes : []
    const [renaming, startRename] = useTransition()
    const router = useRouter()
    const word = choice === 'other' ? own : choice
    const L = ORG_SETTING_LABELS.mainSprintWord
    return (
        <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col"><span className={labelClass}>{L.label}</span><span className={`block pb-2 ${helpClass}`}>{L.help(current, typeProfile(type).innerSprintWord)}</span>
                    <select className="nb-select mt-auto w-full" value={choice} onChange={(e) => setChoice(e.target.value)}>
                        {MAIN_WORD_CHOICES.map((w) => <option key={w} value={w}>{w}{w === typeWord ? ' (default)' : ''}</option>)}
                        <option value="other">Your own word…</option>
                    </select>
                </label>
                {choice === 'other' ? (
                    <label className="flex flex-col"><span className={labelClass}>Your word</span><span className={`block pb-2 ${helpClass}`}>One short word, like Block or Quarter.</span>
                        <Input value={own} maxLength={20} onChange={(e) => setOwn(e.target.value)} className="mt-auto" aria-invalid={Boolean(own.trim()) && !cleanMainWord(own)} />
                    </label>
                ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" disabled={pending || !cleanMainWord(word) || cleanMainWord(word) === current}
                    onClick={() => save(() => updateOrgSettingsAction(orgId, 'work', { main_sprint_word: cleanMainWord(word) === typeWord ? null : cleanMainWord(word) }))}>Save the word</Button>
                {status}
            </div>
            {changes.length ? (
                <Notice action={<Button size="sm" variant="outline" disabled={renaming} onClick={() => startRename(async () => {
                    const r = await renameOldSprintNamesAction(orgId)
                    if (!r.success) return void toast.error(r.error)
                    toast.success(`Renamed ${r.renamed} ${r.renamed === 1 ? 'sprint' : 'sprints'}.`)
                    void offer.refetch()
                    router.refresh()
                })}>{renaming ? 'Renaming…' : 'Rename them'}</Button>}>
                    {changes.length === 1 ? 'One sprint still has an old name' : `${changes.length} sprints still have old names`}: {changes.slice(0, 3).map((c) => `${c.from} becomes ${c.to}`).join(', ')}{changes.length > 3 ? ` and ${changes.length - 3} more` : ''}. Rename them? Nothing else changes.
                </Notice>
            ) : null}
        </div>
    )
}

/** Settings → Updates & messages, chat rows (report §25.4): #general posting and who creates org channels. */
export function OrgChatSection({ orgId, organization }: { orgId: string; organization: OrgDetail }) {
    const facts = useOrgFacts(orgId)
    const defaults = orgChatSettings(organization.chat ?? {}, organization.type)
    const [generalNotify, setGeneralNotify] = useState(defaults.generalNotify)
    const { pending, save, status } = useSave()
    return (
        <Section id="org-messages">
            <SettingsCard title="Messages" headingLevel={2} description="How the organization’s channels work for everyone in it.">
                <div className="space-y-6">
                    <InstantSwitch label="Only admins post in #general" help="Everyone still reads and replies in threads. Big announcements belong in Updates."
                        checked={defaults.generalAdminsOnly} save={(on) => updateOrgChatSettingsAction(orgId, { generalAdminsOnly: on })} />
                    <InstantSwitch label="Members can create organization channels" help={`Workspace teams always create channels in their own workspaces.${facts ? ` ${facts.channels} of ${ORG_LIMITS.orgChatChannels} channels.` : ''}`}
                        checked={defaults.membersCreateChannels} save={(on) => updateOrgChatSettingsAction(orgId, { membersCreateChannels: on })} />
                    <div>
                        <label htmlFor="org-general-notify" className={labelClass}>Default notifications for #general</label>
                        <p className={helpClass}>For people who join from now on; each person can change theirs. Mentions for Education, All otherwise.</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <select id="org-general-notify" value={generalNotify} onChange={(e) => setGeneralNotify(e.target.value as typeof generalNotify)} className="nb-select w-full max-w-xs">
                                <option value="all">All messages</option><option value="mentions">Mentions only</option>
                            </select>
                            <Button variant="outline" disabled={pending} onClick={() => save(() => updateOrgChatSettingsAction(orgId, { generalNotify }))}>Save</Button>
                        </div>
                        {status}
                    </div>
                </div>
            </SettingsCard>
        </Section>
    )
}

/** Notifications → Admin emails (report §22.4, §30.6; was "Admin batching"). */
export function OrgNotificationsSection({ orgId, organization }: { orgId: string; organization: OrgDetail }) {
    const [digest, setDigest] = useState(organization.adminDigest)
    const { pending, save, status } = useSave()
    return (
        // Inside the Notifications section by design: its own section wrapper would split the section index.
            <SettingsCard title="Admin emails" headingLevel={2} description="How owners and admins hear about work to review, join requests and reports." footer={lastChanged(organization, 'notifications')}>
                <div className="space-y-5">
                    <fieldset className="space-y-2.5 text-[13px]">
                        <legend className="sr-only">Admin emails</legend>
                        <label className="flex items-start gap-2.5">
                            <input type="radio" className="nb-radio mt-0.5" name="org-admin-digest" checked={digest === 'daily'} onChange={() => setDigest('daily')} />
                            <span><span className="block font-medium">Daily summary</span><span className="block text-muted-foreground">At 8:00 in the organization’s time zone. Skipped when there’s nothing to report.</span></span>
                        </label>
                        <label className="flex items-start gap-2.5">
                            <input type="radio" className="nb-radio mt-0.5" name="org-admin-digest" checked={digest === 'instant'} onChange={() => setDigest('instant')} />
                            <span><span className="block font-medium">Instant</span><span className="block text-muted-foreground">Notifications only, as things happen. No summary email.</span></span>
                        </label>
                    </fieldset>
                    <div className="flex flex-wrap items-center gap-3">
                        <Button disabled={pending} onClick={() => save(() => updateOrgSettingsAction(orgId, 'notifications', { admin_digest: digest }))}>Save admin emails</Button>
                        {status}
                    </div>
                </div>
            </SettingsCard>
    )
}

/** Updates (report §22.4): member discussions, who can reply, how announcements notify. Moved from Admin batching. */
export function OrgUpdatesSection({ orgId, organization, memberPosts }: { orgId: string; organization: OrgDetail; memberPosts: boolean }) {
    const [announce, setAnnounce] = useState(organization.announcementNotify)
    const [replies, setReplies] = useState(organization.replyRule)
    const { pending, save, status } = useSave()
    const members = rolePlural(organization.roleNames.member)
    return (
        <Section id="org-updates">
            <SettingsCard title="Updates" headingLevel={2} description="Who posts and replies in Updates, and how announcements reach people." footer={lastChanged(organization, 'updates')}>
                <div className="space-y-6">
                    <InstantSwitch label={`${members} can post discussions`} help="Announcements stay with owners and admins." checked={memberPosts}
                        save={(on) => updateOrgSettingsAction(orgId, 'updates', { member_posts: on })} />
                    <div className="grid gap-5 sm:grid-cols-2">
                        <label className="flex flex-col">
                            <span className={labelClass}>Who can reply</span>
                            <span className={`block pb-2 ${helpClass}`}>Where posts start; each post can change it.</span>
                            <select value={replies} onChange={(e) => setReplies(e.target.value as typeof replies)} className="nb-select mt-auto w-full">
                                <option value="members">People in the organization</option><option value="logged_in">Anyone signed in</option>
                            </select>
                        </label>
                        <label className="flex flex-col">
                            <span className={labelClass}>Announcements notify</span>
                            <span className={`block pb-2 ${helpClass}`}>Where the composer starts. Up to {ORG_LIMITS.emailAnnouncementsPerOrgPerDay} emails a day.</span>
                            <select value={announce} onChange={(e) => setAnnounce(e.target.value as typeof announce)} className="nb-select mt-auto w-full">
                                <option value="in_app">In-app</option><option value="email">In-app and email</option>
                            </select>
                        </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <Button disabled={pending} onClick={() => save(() => updateOrgSettingsAction(orgId, 'updates', { reply_rule: replies, announcement_notify: announce }))}>Save update rules</Button>
                        {status}
                    </div>
                </div>
            </SettingsCard>
        </Section>
    )
}
