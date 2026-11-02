'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'

import {
    leaveOrgAction,
    readLeavePreviewAction,
    type LeavePreview,
    previewVisibilityCapAction,
    readOrgSettingsFactsAction,
    regenerateJoinCodeAction,
    renameOrgHandleAction,
    updateMyOrgMembershipAction,
    updateOrgSettingsAction,
} from '@/app/actions/organizations'
import { SettingsCard } from '@/components/workspaces/settings/SettingsFormFields'
import { SettingsSwitch } from '@/components/settings/ui/SettingsSwitch'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/feedback'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ORG_LIMITS, ORG_TYPES, orgRoleNames, orgTypeLabel } from '@/lib/organizations/config'
import { GRANT_WORDS, PERMISSION_AREAS } from '@/lib/organizations/permission-labels'
import { typeProfile } from '@/lib/organizations/type-profile'
import { orgChatSettings } from '@/lib/organizations/chat-rules'
import { updateOrgChatSettingsAction } from '@/app/actions/org-chat'
import { requestOrgVerificationAction } from '@/app/actions/trust'
import type { OrgDetail } from '@/lib/organizations/detail'
import { orgGrant, type OrgRole } from '@/lib/organizations/permissions'
import type { OrgMemberRole, OrgSettingsSection } from '@/lib/organizations/settings'

// Org settings sections (report §21.2–21.4), rendered inside the project Settings document. Each saves on its
// own and shows who changed it last.

type SectionProps = { orgId: string; organization: OrgDetail; role: OrgMemberRole }

const DATE = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })
const labelClass = 'nb-ui-label text-sm font-semibold text-foreground'
const helpClass = 'nb-compact mt-0.5 text-xs text-muted-foreground'
const OWNER_ONLY = 'Only the owner can change this.'

function Section({ id, children }: { id: string; children: ReactNode }) {
    return <section id={`project-settings-${id}`} data-project-settings-section className="space-y-6">{children}</section>
}

function LastChanged({ organization, section }: { organization: OrgDetail; section: OrgSettingsSection }) {
    const change = organization.changes[section]
    if (!change) return null
    return <p className="nb-meta text-muted-foreground">Last changed by {change.byName ?? 'someone'} · {DATE.format(new Date(change.at))}</p>
}

/** One save button and its result line per section. */
function useSave() {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
    const save = (action: () => Promise<{ success: boolean; error?: string }>, done?: () => void) =>
        startTransition(async () => {
            const result = await action()
            setMessage(result.success ? { kind: 'ok', text: 'Saved.' } : { kind: 'error', text: result.error ?? 'Couldn’t save.' })
            if (result.success) {
                done?.()
                router.refresh()
            }
        })
    const status = message ? <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{message.text}</p> : null
    return { pending, save, status }
}

/** The counts beside the fields (report §22.4), read once for the whole page. Admins only. */
function useOrgFacts(orgId: string, enabled = true) {
    const q = useQuery({ queryKey: ['org-settings-facts', orgId], queryFn: () => readOrgSettingsFactsAction(orgId), enabled, staleTime: 30_000 })
    return q.data?.success ? q.data.facts : null
}

const membersHref = (handle: string | null | undefined, orgId: string) => `/org/${encodeURIComponent(handle ?? orgId)}?tab=members`

export function OrgMembershipSection({ orgId, organization, role }: SectionProps) {
    const [title, setTitle] = useState(organization.you?.title ?? '')
    const [showOnProfile, setShowOnProfile] = useState(organization.you?.showOnProfile ?? true)
    const { pending, save, status } = useSave()
    return (
        <Section id="you-membership">
            <SettingsCard title="My membership" headingLevel={2} description="Your role, your title and whether this organization shows on your profile.">
                <div className="space-y-5">
                    <p className="text-sm text-foreground">
                        {organization.roleNames[role]}{role === 'viewer' ? ' · read-only' : ''}
                        {organization.you ? <span className="text-muted-foreground"> · joined {DATE.format(new Date(organization.you.joinedAt))}</span> : null}
                    </p>
                    <div>
                        <label htmlFor="org-my-title" className={labelClass}>Your title</label>
                        <p className={helpClass}>Shown beside your name, for example &quot;Section B&quot; or &quot;TA&quot;.</p>
                        <Input id="org-my-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} className="mt-2 max-w-sm" />
                    </div>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className={labelClass}>Show this organization on my profile</p>
                            <p className={helpClass}>On by default.</p>
                        </div>
                        <SettingsSwitch checked={showOnProfile} onCheckedChange={setShowOnProfile} aria-label="Show this organization on my profile" />
                    </div>
                    <div className="flex items-center gap-3">
                        <Button disabled={pending} onClick={() => save(() => updateMyOrgMembershipAction(orgId, { title: title.trim() || null, show_on_profile: showOnProfile }))}>Save</Button>
                        {status}
                    </div>
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
        router.push(afterLeaveHref)
    })
    const month = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(new Date())
    return (
        <Section id="org-management">
            {children}
            <SettingsCard title="Leave organization" headingLevel={2} description="Stop being a member. To come back you’ll need the current code or a new invite." danger>
                {role === 'owner' ? (
                    <p className="text-sm text-muted-foreground">Transfer ownership first.</p>
                ) : (
                    <div className="space-y-2">
                        <Button variant="destructive" disabled={pending} onClick={ask}>Leave {title}</Button>
                        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                    </div>
                )}
            </SettingsCard>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Leave {title}?</DialogTitle>
                        <DialogDescription>{preview?.led.length ? 'You own these workspaces. Transfer or detach each one first.' : 'Here’s what happens.'}</DialogDescription>
                    </DialogHeader>
                    {preview?.led.length ? (
                        // Report §26.10: a lead sees the workspaces to hand over instead of Leave.
                        <ul className="space-y-1.5 text-sm">
                            {preview.led.map((w) => <li key={w.id}><a className="text-primary hover:underline" href={`/workspaces/${encodeURIComponent(w.slug ?? w.id)}?tab=settings`}>{w.title}</a> · Transfer or Detach in its Settings</li>)}
                        </ul>
                    ) : preview ? (
                        <ul className="list-disc space-y-1 pl-5 text-sm">
                            {preview.teams.length ? <li>You’ll leave {preview.teams.join(' and ')}; your {preview.teams.length === 1 ? 'seat reopens' : 'seats reopen'}</li> : null}
                            {preview.open ? <li>{preview.open} open {preview.open === 1 ? 'assignment is' : 'assignments are'} removed</li> : null}
                            {preview.submitted ? <li>{preview.submitted} submitted {preview.submitted === 1 ? 'assignment stays' : 'assignments stay'} with the {preview.keptBy}</li> : null}
                            <li>Your profile entry stays, as “Left {month}”</li>
                            <li>To come back, you’ll need the current code or a new invite</li>
                        </ul>
                    ) : null}
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        {preview && !preview.led.length ? <Button variant="destructive" disabled={pending} onClick={leave}>Leave</Button> : null}
                    </div>
                </DialogContent>
            </Dialog>
        </Section>
    )
}

/** Every zone the browser knows, for the searchable time zone field (report §22.4). */
const TIME_ZONES: string[] = (() => { try { return Intl.supportedValuesOf('timeZone') } catch { return [] } })()

/** Handle (report §22.4, §27.8): in Details, owner only, once every 7 days; the old address redirects for 90 days. */
export function OrgHandleSection({ orgId, organization, role, handle }: SectionProps & { handle: string | null }) {
    const router = useRouter()
    const [newHandle, setNewHandle] = useState(handle ?? '')
    const rename = useSave()
    const isOwner = role === 'owner'
    return (
        <SettingsCard title="Handle" headingLevel={2} description="The organization’s address. People type it to find you.">
            <div>
                <label htmlFor="org-handle" className={labelClass}>Address</label>
                <p className={helpClass}>{isOwner ? `networkbase.in/org/${handle}. Change it at most once every 7 days; the old one keeps redirecting for 90 days.` : OWNER_ONLY}</p>
                <div className="mt-2 flex max-w-md items-center gap-2">
                    <span aria-hidden="true" className="text-muted-foreground">@</span>
                    <Input id="org-handle" value={newHandle} onChange={(e) => setNewHandle(e.target.value)} disabled={!isOwner || Boolean(organization.handleRenameAvailableAt)} maxLength={40} />
                    {isOwner ? (
                        <Button variant="outline" disabled={rename.pending || newHandle === handle || Boolean(organization.handleRenameAvailableAt)} onClick={() => rename.save(
                            () => renameOrgHandleAction(orgId, newHandle),
                            () => router.replace(`/org/${newHandle.trim().toLowerCase()}?tab=settings`),
                        )}>Change</Button>
                    ) : null}
                </div>
                {organization.handleRenameAvailableAt ? <p className={helpClass}>You can change it again on {DATE.format(new Date(organization.handleRenameAvailableAt))}.</p> : null}
                {rename.status}
            </div>
        </SettingsCard>
    )
}

export function OrgProfileSection({ orgId, organization, role }: SectionProps) {
    const [type, setType] = useState(organization.type ?? 'community')
    const [termStart, setTermStart] = useState(organization.termStart ?? '')
    const [termEnd, setTermEnd] = useState(organization.termEnd ?? '')
    const [timeZone, setTimeZone] = useState(organization.timeZone ?? '')
    const [welcome, setWelcome] = useState(organization.welcomeNote ?? '')
    const [typeLabel, setTypeLabel] = useState(organization.type === 'other' ? organization.typeLabel ?? '' : '')
    const [partOf, setPartOf] = useState(organization.partOf ?? '')
    const [location, setLocation] = useState(organization.location ?? '')
    const [confirmType, setConfirmType] = useState(false)
    const { pending, save, status } = useSave()
    const typeSave = useSave()
    const isOwner = role === 'owner'
    const termWrong = Boolean(termStart && termEnd && termEnd <= termStart)
    // Report §22.1 #2: the confirmation lists what really changes; roles you renamed keep your names.
    const nextNames = orgRoleNames(type, { roleNames: Object.fromEntries(Object.entries(organization.roleNames).filter(([k, v]) => v !== orgRoleNames(organization.type, {})[k as keyof typeof organization.roleNames])) })
    const renamed = (Object.keys(nextNames) as Array<keyof typeof nextNames>).filter((k) => nextNames[k] !== organization.roleNames[k])
    return (
        <Section id="org-profile">
            <SettingsCard title="Organization profile" headingLevel={2} description="What people see on About, and how the organization keeps time." footer={<LastChanged organization={organization} section="profile" />}>
                <div className="space-y-6">
                    <div>
                        <label htmlFor="org-type" className={labelClass}>Type</label>
                        <p className={helpClass}>{isOwner ? 'It sets the words used here, such as Submissions. It has its own save.' : OWNER_ONLY}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <select id="org-type" value={type} disabled={!isOwner} onChange={(e) => setType(e.target.value as typeof type)} className="h-[var(--ui-control-height)] rounded-md border border-input bg-background px-2 text-sm">
                                {ORG_TYPES.map((t) => <option key={t} value={t}>{orgTypeLabel(t)}</option>)}
                            </select>
                            {isOwner ? <Button variant="outline" disabled={typeSave.pending || (type === organization.type && (type !== 'other' || typeLabel === (organization.typeLabel ?? ''))) || (type === 'other' && !typeLabel.trim())} onClick={() => setConfirmType(true)}>Save type</Button> : null}
                        </div>
                        {type === 'other' ? (
                            <label className="mt-3 block max-w-sm text-xs text-muted-foreground">What do you call it?
                                <Input value={typeLabel} onChange={(e) => setTypeLabel(e.target.value)} placeholder="Nonprofit" maxLength={30} disabled={!isOwner} className="mt-1" />
                            </label>
                        ) : null}
                        {typeSave.status}
                        <ConfirmDialog open={confirmType} onOpenChange={setConfirmType} title={`Change the type to ${orgTypeLabel(type)}?`}
                            description={[
                                renamed.length ? `Roles become ${renamed.map((k) => `${organization.roleNames[k]} → ${nextNames[k]}`).join(', ')}.` : 'Role names stay as they are.',
                                'Labels such as Submissions follow the new type. People, folders, work, joining, visibility and rules stay the same.',
                            ].join(' ')}
                            confirmLabel="Change type"
                            onConfirm={() => typeSave.save(() => updateOrgSettingsAction(orgId, 'profile', { org_type: type, type_label: type === 'other' ? typeLabel.trim() : null }))} />
                    </div>
                    <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
                        <label className="block">
                            <span className={labelClass}>Part of</span>
                            <span className={`block ${helpClass}`}>The bigger body it belongs to, for example RV College of Engineering. Shows in the header.</span>
                            <Input value={partOf} onChange={(e) => setPartOf(e.target.value)} maxLength={100} className="mt-2" />
                        </label>
                        <label className="block">
                            <span className={labelClass}>Where</span>
                            <span className={`block ${helpClass}`}>A city, or Online. Shows in the header.</span>
                            <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={100} className="mt-2" />
                        </label>
                    </div>
                    {typeProfile(organization.type).termDates ? <fieldset>
                        <legend className={labelClass}>Term</legend>
                        <p className={helpClass}>Optional, for example Aug–Dec 2026. Shown on About, and it sets the week line.</p>
                        <div className="mt-2 grid max-w-md gap-3 sm:grid-cols-2">
                            <label className="text-xs text-muted-foreground">Starts<Input type="date" value={termStart} onChange={(e) => setTermStart(e.target.value)} className="mt-1" /></label>
                            <label className="text-xs text-muted-foreground">Ends<Input type="date" value={termEnd} min={termStart || undefined} onChange={(e) => setTermEnd(e.target.value)} className="mt-1" /></label>
                        </div>
                        {termWrong ? <p role="alert" className="mt-1 text-xs text-destructive">The term has to end after it starts.</p> : null}
                    </fieldset> : null}
                    <div>
                        <label htmlFor="org-tz" className={labelClass}>Time zone</label>
                        <p className={helpClass}>Due dates and the admin email use it. Empty means each person’s own.</p>
                        <Input id="org-tz" list="org-tz-list" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} placeholder="Search, for example Kolkata" maxLength={64} className="mt-2 max-w-sm" />
                        <datalist id="org-tz-list">{TIME_ZONES.map((z) => <option key={z} value={z} />)}</datalist>
                    </div>
                    <div>
                        <label htmlFor="org-welcome" className={labelClass}>Welcome note</label>
                        <p className={helpClass}>New members see it once when they join, and members see it on About. Up to 500 characters.</p>
                        <textarea id="org-welcome" value={welcome} onChange={(e) => setWelcome(e.target.value)} rows={4} maxLength={500} className="mt-2 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                    </div>
                    <div className="flex items-center gap-3">
                        <Button disabled={pending || termWrong} onClick={() => save(() => updateOrgSettingsAction(orgId, 'profile', {
                            part_of: partOf.trim() || null, location: location.trim() || null,
                            term_start: termStart || null, term_end: termEnd || null, time_zone: timeZone.trim() || null, welcome_note: welcome.trim() || null,
                        }))}>Save</Button>
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
    const [codeOn, setCodeOn] = useState(organization.joinCodeEnabled)
    const [max, setMax] = useState(maxMembers ?? '')
    const [code, setCode] = useState(organization.joinCode)
    const [confirming, setConfirming] = useState(false)
    const { pending, save, status } = useSave()
    const regen = useSave()
    return (
        <Section id="org-access">
            <SettingsCard title="Joining" headingLevel={2} description="How people join. Invites are in the Members tab; Public or Private is in Access and visibility." footer={<LastChanged organization={organization} section="access" />}>
                <div className="space-y-6">
                    <div>
                        <p className={labelClass}>Join code</p>
                        <p className={helpClass}>People enter it at /join. A new code stops the old one at once.</p>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                            <span className="select-all font-mono text-2xl font-semibold tracking-[0.2em]">{code}</span>
                            <Button variant="outline" size="sm" onClick={() => code && navigator.clipboard.writeText(code)}>Copy</Button>
                            <Button variant="ghost" size="sm" disabled={regen.pending} onClick={() => setConfirming(true)}>Make a new code</Button>
                        </div>
                        {regen.status}
                        <ConfirmDialog open={confirming} onOpenChange={setConfirming} title="Make a new join code?" description="The current code stops working at once." confirmLabel="Make a new code"
                            onConfirm={() => regen.save(async () => {
                                const result = await regenerateJoinCodeAction(orgId)
                                if (result.success) setCode(result.joinCode)
                                return result
                            })} />
                    </div>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className={labelClass}>Code works</p>
                            <p className={helpClass}>Off means nobody can join by code. The code itself doesn’t change.</p>
                        </div>
                        <SettingsSwitch checked={codeOn} onCheckedChange={setCodeOn} aria-label="Join code works" />
                    </div>
                    <fieldset>
                        <legend className={labelClass}>Join mode</legend>
                        <div className="mt-2 space-y-2 text-sm">
                            <label className="flex items-center gap-2"><input type="radio" name="org-join-mode" checked={joinMode === 'instant'} onChange={() => setJoinMode('instant')} /> Instant: anyone with the code becomes a member</label>
                            <label className="flex items-center gap-2"><input type="radio" name="org-join-mode" checked={joinMode === 'approval'} onChange={() => setJoinMode('approval')} /> Approval: the code sends a request an admin approves</label>
                        </div>
                        {facts?.waitingRequests ? <p className="mt-2 text-sm">{facts.waitingRequests} {facts.waitingRequests === 1 ? 'request' : 'requests'} waiting · <Link href={membersHref(handle, orgId)} className="text-primary hover:underline">Review</Link></p> : null}
                    </fieldset>
                    <div>
                        <label htmlFor="org-max" className={labelClass}>Max members</label>
                        <p className={helpClass}>Empty means up to {ORG_LIMITS.membersPerOrg.toLocaleString('en')}. When full, the join page says &quot;This organization is full&quot;.{facts ? ` ${facts.members} ${facts.members === 1 ? 'member' : 'members'} now.` : ''}</p>
                        <Input id="org-max" type="number" min={facts?.members ?? 1} max={ORG_LIMITS.membersPerOrg} value={max} onChange={(e) => setMax(e.target.value)} className="mt-2 w-32" />
                        {facts && max && Number(max) < facts.members ? <p role="alert" className="mt-1 text-xs text-destructive">There are {facts.members} members now. Max members can’t be lower.</p> : null}
                    </div>
                    <div className="flex items-center gap-3">
                        <Button disabled={pending} onClick={() => save(() => updateOrgSettingsAction(orgId, 'access', { join_mode: joinMode, join_code_enabled: codeOn, max_members: max ? Number(max) : null }))}>Save</Button>
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
        <div className="space-y-4 overflow-x-auto">
            {PERMISSION_AREAS.map(({ area, rows }) => (
                <table key={area} className="w-full min-w-[30rem] text-left text-sm">
                    <caption className="nb-micro pb-1 text-left text-muted-foreground">{area}</caption>
                    <thead>
                        <tr className="border-b border-border text-xs text-muted-foreground">
                            <th scope="col" className="w-1/2 py-1.5 pr-3 font-medium">Can…</th>
                            {TABLE_ROLES.map(([, key]) => <th key={key} scope="col" className="py-1.5 pr-3 font-medium">{organization.roleNames[key]}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.action} className="border-b border-border/60 last:border-b-0">
                                <th scope="row" className="py-1.5 pr-3 font-normal text-foreground">{row.label}</th>
                                {TABLE_ROLES.map(([grantRole, key]) => {
                                    const grant = orgGrant(grantRole, row.action)
                                    return (
                                        <td key={key} className="py-1.5 pr-3 text-muted-foreground">
                                            {grant === 'setting' && row.setting && onOpenSection
                                                ? <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => onOpenSection(row.setting!)}>{GRANT_WORDS[grant]}</button>
                                                : GRANT_WORDS[grant] ?? '—'}
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
    return (
        <Section id="org-people">
            <SettingsCard title="People and roles" headingLevel={2} description="Role names and what each role can do. Admins are managed in the Members tab." footer={<LastChanged organization={organization} section="people" />}>
                <div className="space-y-6">
                    <div>
                        <p className={labelClass}>Role names</p>
                        <p className={helpClass}>{isOwner ? 'For example Teacher / TA / Student / Viewer. What each role can do always comes from the role.' : OWNER_ONLY}</p>
                        <div className="mt-2 grid max-w-md gap-2 sm:grid-cols-2">
                            {TABLE_ROLES.map(([, key]) => (
                                <label key={key} className="text-xs capitalize text-muted-foreground">{key}
                                    <Input value={names[key]} onChange={(e) => setNames({ ...names, [key]: e.target.value })} disabled={!isOwner} maxLength={30} className="mt-1" />
                                </label>
                            ))}
                        </div>
                        {isOwner ? (
                            <div className="mt-3 flex flex-wrap items-center gap-3">
                                <Button disabled={pending} onClick={() => save(() => updateOrgSettingsAction(orgId, 'people', { role_names: names }))}>Save</Button>
                                <Button variant="ghost" disabled={pending} onClick={() => { setNames(typeNames); save(() => updateOrgSettingsAction(orgId, 'people', { role_names: typeNames })) }}>Reset to {orgTypeLabel(organization.type)}’s names</Button>
                                {status}
                            </div>
                        ) : null}
                    </div>
                    <div>
                        <p className={labelClass}>Admins</p>
                        <p className="mt-1 text-sm">{facts ? `${facts.admins} of ${ORG_LIMITS.adminsPerOrg}` : '…'} · <Link href={membersHref(handle, orgId)} className="text-primary hover:underline">Manage in Members</Link></p>
                    </div>
                    <div>
                        <p className={labelClass}>What each role can do</p>
                        <div className="mt-2"><RolesTable organization={organization} onOpenSection={onOpenSection} /></div>
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

/** Default teams as chips (report §22.4): Enter adds one, × removes it; up to 20. */
function ChipsInput({ value, onChange, label }: { value: string[]; onChange: (next: string[]) => void; label: string }) {
    const [draft, setDraft] = useState('')
    const add = () => {
        const v = draft.trim().slice(0, 100)
        if (v && !value.includes(v) && value.length < 20) onChange([...value, v])
        setDraft('')
    }
    return (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-border p-1.5">
            {value.map((chip) => (
                <span key={chip} className="inline-flex items-center gap-1 rounded-[4px] bg-muted px-2 py-0.5 text-sm">
                    {chip}
                    <button type="button" aria-label={`Remove ${chip}`} onClick={() => onChange(value.filter((c) => c !== chip))}><X className="size-3" aria-hidden="true" /></button>
                </span>
            ))}
            <input aria-label={label} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={value.length >= 20}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() } }} onBlur={add}
                placeholder={value.length >= 20 ? 'Up to 20' : 'Add a team'} className="min-w-28 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none" />
        </div>
    )
}

export function OrgWorkspacesSection({ orgId, organization }: SectionProps) {
    const facts = useOrgFacts(orgId)
    const [confirmCap, setConfirmCap] = useState(false)
    const [childCreation, setChildCreation] = useState(organization.childCreation)
    const [outside, setOutside] = useState(organization.outsidePeople)
    const [childShare, setChildShare] = useState(organization.childShare)
    const [cap, setCap] = useState(organization.visibilityCap)
    const [defaultUnits, setDefaultUnits] = useState<string[]>(organization.defaultUnits)
    const [followSprints, setFollowSprints] = useState(organization.followSprintsDefault)
    // Impact preview (report §21.1 principle 4): how many projects a tighter cap would lower.
    const [affected, setAffected] = useState<number | null>(null)
    const { pending, save, status } = useSave()
    const saveAll = () => save(() => updateOrgSettingsAction(orgId, 'projects', { follow_sprints: followSprints, child_creation: childCreation, outside_people: outside, child_share: childShare, default_units: defaultUnits, ...(cap !== organization.visibilityCap ? { visibility_cap: cap } : {}) }))
    const chooseCap = async (next: typeof cap) => {
        setCap(next)
        setAffected(null)
        const preview = await previewVisibilityCapAction(orgId, next)
        if (preview.success) setAffected(preview.affected)
    }
    return (
        <Section id="org-projects">
            <SettingsCard title="Workspaces" headingLevel={2} description="Who creates workspaces inside the organization, and the rules they follow." footer={<LastChanged organization={organization} section="projects" />}>
                <div className="space-y-6">
                    <p className="text-sm text-muted-foreground">{facts ? `${facts.workspaces} of ${ORG_LIMITS.childProjectsPerOrg} workspaces` : '…'}</p>
                    <fieldset>
                        <legend className={labelClass}>Who can create workspaces</legend>
                        <p className={helpClass}>Owners and admins always can. Changing this affects new workspaces only.</p>
                        <div className="mt-2 space-y-2 text-sm">
                            <label className="flex items-center gap-2"><input type="radio" name="org-child-creation" checked={childCreation === 'members'} onChange={() => setChildCreation('members')} /> All members</label>
                            <label className="flex items-center gap-2"><input type="radio" name="org-child-creation" checked={childCreation === 'admins'} onChange={() => setChildCreation('admins')} /> Admins only</label>
                        </div>
                    </fieldset>
                    <fieldset>
                        <legend className={labelClass}>Highest allowed visibility</legend>
                        <p className={helpClass}>The most open a workspace here can be. Tightening it lowers workspaces above it, after you confirm.</p>
                        <div className="mt-2 space-y-2 text-sm">
                            {CAP_OPTIONS.map((option) => (
                                <label key={option.value} className="flex items-start gap-2">
                                    <input type="radio" name="org-visibility-cap" checked={cap === option.value} onChange={() => void chooseCap(option.value)} className="mt-1" />
                                    <span>{option.label}<span className="block text-xs text-muted-foreground">{option.hint}</span></span>
                                </label>
                            ))}
                        </div>

                    </fieldset>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className={labelClass}>People outside the organization can be added to its workspaces</p>
                            <p className={helpClass}>They see only that workspace, never the organization’s content. Turning it off removes nobody.{facts?.outsidePeople ? ` ${facts.outsidePeople} outside ${facts.outsidePeople === 1 ? 'person is' : 'people are'} in workspaces now.` : ''}</p>
                        </div>
                        <SettingsSwitch checked={outside} onCheckedChange={setOutside} aria-label="People outside the organization can be added to its workspaces" />
                    </div>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className={labelClass}>Workspaces can share updates to the organization</p>
                            <p className={helpClass}>Shared posts show in the organization’s Updates under From workspaces. Private workspaces never share.</p>
                        </div>
                        <SettingsSwitch checked={childShare} onCheckedChange={setChildShare} aria-label="Workspaces can share updates to the organization" />
                    </div>
                    <div>
                        <p className={labelClass}>Default teams</p>
                        <p className={helpClass}>Every new workspace starts with these, for example Frontend, Backend, Testing. Each workspace can still change them.</p>
                        <ChipsInput value={defaultUnits} onChange={setDefaultUnits} label="Add a default team" />
                    </div>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className={labelClass}>New workspaces follow the organization’s sprints</p>
                            <p className={helpClass}>New workspaces only. Each workspace has its own switch.</p>
                        </div>
                        <SettingsSwitch checked={followSprints} onCheckedChange={setFollowSprints} aria-label="New workspaces follow org sprints" />
                    </div>
                    <div className="flex items-center gap-3">
                        <Button disabled={pending} onClick={() => (affected ? setConfirmCap(true) : saveAll())}>Save</Button>
                        {status}
                        <ConfirmDialog open={confirmCap} onOpenChange={setConfirmCap} title="Lower workspaces’ visibility?"
                            description={`${affected} ${affected === 1 ? 'workspace becomes' : 'workspaces become'} ${cap === 'private' ? 'Private' : 'Organization only'}. Their teams are told.`}
                            confirmLabel="Save" onConfirm={() => saveAll()} />
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
    const toggle = (key: 'reviewRequired' | 'sprintAutoStart' | 'sprintNotifyOnStart' | 'sprintShowInChildren' | 'sprintCreateMatching', label: string, help: string) => (
        <div className="flex items-start justify-between gap-4">
            <div><p className={labelClass}>{label}</p><p className={helpClass}>{help}</p></div>
            <SettingsSwitch checked={work[key]} onCheckedChange={(v) => set(key, v)} aria-label={label} />
        </div>
    )
    const select = 'mt-2 h-9 w-full max-w-xs rounded-md border border-border bg-background px-2 text-sm'
    return (
        <Section id="org-work">
            <SettingsCard title="Work" headingLevel={2} description="Defaults for new tasks and sprints. Each one can still change them." footer={<LastChanged organization={organization} section="work" />}>
                <div className="space-y-6">
                    <p className="nb-ui-label text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">Tasks</p>
                    {toggle('reviewRequired', 'Check finished work', 'Admins approve or return finished work before it counts as done. Fills in the task form.')}
                    <div>
                        <label htmlFor="org-late-rule" className={labelClass}>Late work</label>
                        <p className={helpClass}>What happens after the due date. Fills in the task form.</p>
                        <select id="org-late-rule" className={select} value={work.lateRule} onChange={(e) => set('lateRule', e.target.value as typeof work.lateRule)}>
                            <option value="always">Always allowed</option><option value="until">Allowed until a date</option><option value="none">Not allowed</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="org-reminders" className={labelClass}>Reminders</label>
                        <p className={helpClass}>Sent at 9:00 in each person’s time zone to people who haven’t submitted yet.</p>
                        <select id="org-reminders" className={select} value={work.reminders} onChange={(e) => set('reminders', e.target.value as typeof work.reminders)}>
                            <option value="both">24 hours before and on the due day</option><option value="day_before">24 hours before</option><option value="due_day">On the due day</option><option value="off">Off</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="org-story-points" className={labelClass}>Story points</label>
                        <p className={helpClass}>Hidden removes the field everywhere in this organization.</p>
                        <select id="org-story-points" className={select} value={work.storyPoints} onChange={(e) => set('storyPoints', e.target.value as typeof work.storyPoints)}>
                            <option value="shown">Shown</option><option value="hidden">Hidden</option>
                        </select>
                    </div>
                    <p className="nb-ui-label text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">Sprints</p>
                    {toggle('sprintAutoStart', 'Start automatically', 'A sprint starts on its start date, for example CO1 on Aug 5.')}
                    {toggle('sprintNotifyOnStart', 'Notify on start', 'Members hear when a sprint starts.')}
                    {toggle('sprintShowInChildren', 'Show in every workspace in the organization', 'Workspaces see the running org sprint and can link theirs to it.')}
                    {toggle('sprintCreateMatching', 'Create matching sprints', 'Off by default. Each workspace following org sprints gets its own sprint with the same dates.')}
                    <div className="flex items-center gap-3">
                        <Button disabled={pending} onClick={() => save(() => updateOrgSettingsAction(orgId, 'work', {
                            review_required: work.reviewRequired, late_rule: work.lateRule, reminders: work.reminders, story_points: work.storyPoints,
                            sprint_auto_start: work.sprintAutoStart, sprint_notify_on_start: work.sprintNotifyOnStart, sprint_show_in_children: work.sprintShowInChildren, sprint_create_matching: work.sprintCreateMatching,
                        }))}>Save</Button>
                        {status}
                    </div>
                </div>
            </SettingsCard>
        </Section>
    )
}

/** Settings → Updates & messages, chat rows (report §25.4): #general posting and who creates org channels. */
export function OrgChatSection({ orgId, organization }: { orgId: string; organization: OrgDetail }) {
    const facts = useOrgFacts(orgId)
    const defaults = orgChatSettings(organization.chat ?? {}, organization.type)
    const [adminsOnly, setAdminsOnly] = useState(defaults.generalAdminsOnly)
    const [membersCreate, setMembersCreate] = useState(defaults.membersCreateChannels)
    const [generalNotify, setGeneralNotify] = useState(defaults.generalNotify)
    const { pending, save, status } = useSave()
    return (
        <Section id="org-messages">
        <SettingsCard title="Messages" headingLevel={2} description="How the organization’s channels work for everyone in it.">
            <div className="space-y-5">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className={labelClass}>Only admins post in #general</p>
                        <p className={helpClass}>Everyone still reads and replies in threads. Big announcements belong in Updates.</p>
                    </div>
                    <SettingsSwitch checked={adminsOnly} onCheckedChange={setAdminsOnly} aria-label="Only admins post in #general" />
                </div>
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className={labelClass}>Members can create organization channels</p>
                        <p className={helpClass}>Workspace teams always create channels in their own workspaces.{facts ? ` ${facts.channels} of ${ORG_LIMITS.orgChatChannels} channels.` : ''}</p>
                    </div>
                    <SettingsSwitch checked={membersCreate} onCheckedChange={setMembersCreate} aria-label="Members can create organization channels" />
                </div>
                <div>
                    <label htmlFor="org-general-notify" className={labelClass}>Default notifications for #general</label>
                    <p className={helpClass}>For people who join from now on; each person can change theirs. Mentions for Education, All otherwise.</p>
                    <select id="org-general-notify" value={generalNotify} onChange={(e) => setGeneralNotify(e.target.value as typeof generalNotify)} className="mt-2 h-9 w-full max-w-xs rounded-md border border-border bg-background px-2 text-sm">
                        <option value="all">All messages</option><option value="mentions">Mentions only</option>
                    </select>
                </div>
                <div className="flex items-center gap-3">
                    <Button disabled={pending} onClick={() => save(() => updateOrgChatSettingsAction(orgId, { generalAdminsOnly: adminsOnly, membersCreateChannels: membersCreate, generalNotify }))}>Save</Button>
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
        <SettingsCard title="Admin emails" headingLevel={2} description="How owners and admins hear about work to review, join requests and reports." footer={<LastChanged organization={organization} section="notifications" />}>
            <div className="space-y-4">
                <fieldset className="space-y-2 text-sm">
                    <legend className="sr-only">Admin emails</legend>
                    <label className="flex items-start gap-2">
                        <input type="radio" name="org-admin-digest" checked={digest === 'daily'} onChange={() => setDigest('daily')} className="mt-1" />
                        <span>Daily summary<span className="block text-xs text-muted-foreground">At 8:00 in the organization’s time zone. Skipped when there’s nothing to report.</span></span>
                    </label>
                    <label className="flex items-start gap-2">
                        <input type="radio" name="org-admin-digest" checked={digest === 'instant'} onChange={() => setDigest('instant')} className="mt-1" />
                        <span>Instant<span className="block text-xs text-muted-foreground">Notifications only, as things happen. No summary email.</span></span>
                    </label>
                </fieldset>
                <div className="flex items-center gap-3">
                    <Button disabled={pending} onClick={() => save(() => updateOrgSettingsAction(orgId, 'notifications', { admin_digest: digest }))}>Save</Button>
                    {status}
                </div>
            </div>
        </SettingsCard>
    )
}

/** Updates (report §22.4): member discussions, who can reply, how announcements notify. Moved from Admin batching. */
export function OrgUpdatesSection({ orgId, organization, memberPosts }: { orgId: string; organization: OrgDetail; memberPosts: boolean }) {
    const [posts, setPosts] = useState(memberPosts)
    const [announce, setAnnounce] = useState(organization.announcementNotify)
    const [replies, setReplies] = useState(organization.replyRule)
    const { pending, save, status } = useSave()
    return (
        <Section id="org-updates">
            <SettingsCard title="Updates" headingLevel={2} description="Who posts and replies in Updates, and how announcements reach people." footer={<LastChanged organization={organization} section="updates" />}>
                <div className="space-y-5">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className={labelClass}>Members can post discussions</p>
                            <p className={helpClass}>Announcements stay with owners and admins.</p>
                        </div>
                        <SettingsSwitch checked={posts} onCheckedChange={setPosts} aria-label="Members can post discussions" />
                    </div>
                    <label className="block">
                        <span className={labelClass}>Who can reply</span>
                        <span className={`block ${helpClass}`}>Where posts start; each post can change it.</span>
                        <select value={replies} onChange={(e) => setReplies(e.target.value as typeof replies)} className="mt-2 block h-9 rounded-md border border-border bg-background px-2 text-sm">
                            <option value="members">Members</option><option value="logged_in">Anyone signed in</option>
                        </select>
                    </label>
                    <label className="block">
                        <span className={labelClass}>Announcements notify</span>
                        <span className={`block ${helpClass}`}>Where the composer starts. Up to {ORG_LIMITS.emailAnnouncementsPerOrgPerDay} emails a day.</span>
                        <select value={announce} onChange={(e) => setAnnounce(e.target.value as typeof announce)} className="mt-2 block h-9 rounded-md border border-border bg-background px-2 text-sm">
                            <option value="in_app">In-app</option><option value="email">In-app and email</option>
                        </select>
                    </label>
                    <div className="flex items-center gap-3">
                        <Button disabled={pending} onClick={() => save(() => updateOrgSettingsAction(orgId, 'updates', { member_posts: posts, reply_rule: replies, announcement_notify: announce }))}>Save</Button>
                        {status}
                    </div>
                </div>
            </SettingsCard>
        </Section>
    )
}

/** Verified badge (report §22.4, §27.9): each state says what ✓ means and what to do next. Owner only. */
export function OrgVerificationSection({ orgId, organization, onOpenLinks }: { orgId: string; organization: OrgDetail; onOpenLinks?: () => void }) {
    const { pending, save, status } = useSave()
    const outcome = organization.verificationOutcome
    const ask = (label: string) => (
        <div className="flex items-center gap-3">
            <Button disabled={pending} onClick={() => save(async () => {
                const result = await requestOrgVerificationAction(orgId)
                return result.success ? { success: true } : result
            })}>{label}</Button>
            {status}
        </div>
    )
    return (
        <SettingsCard title="Verified badge" headingLevel={2} description="A ✓ next to the name on the header, cards and Discover. It says NetworkBase checked this organization is who it says it is.">
            {organization.verified ? <p className="text-sm text-foreground">This organization is verified.</p>
                : organization.verificationRequested ? <p className="text-sm text-muted-foreground">Requested. The NetworkBase team will review it.</p>
                : !organization.hasWebsite ? (
                    <p className="text-sm">Add your website in Links first.{onOpenLinks ? <> <button type="button" className="text-primary underline underline-offset-4" onClick={onOpenLinks}>Go to Links</button></> : null}</p>
                ) : outcome ? (
                    <div className="space-y-3">
                        <p className="text-sm">{outcome.state === 'declined' ? 'Not verified this time.' : 'The badge was removed.'}{outcome.reason ? ` ${outcome.reason}` : ''}</p>
                        {ask('Ask again')}
                    </div>
                ) : (
                    <div className="space-y-3">
                        <p className={helpClass}>Verified at once when your email address is on the same domain as the website in Links (not Gmail, Outlook and the like). Otherwise our team reviews it.</p>
                        {ask('Request verification')}
                    </div>
                )}
        </SettingsCard>
    )
}
