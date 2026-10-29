'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition, type ReactNode } from 'react'

import {
    leaveOrgAction,
    previewVisibilityCapAction,
    regenerateJoinCodeAction,
    renameOrgHandleAction,
    updateMyOrgMembershipAction,
    updateOrgSettingsAction,
} from '@/app/actions/organizations'
import { SettingsCard } from '@/components/projects/settings/SettingsFormFields'
import { SettingsSwitch } from '@/components/settings/ui/SettingsSwitch'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/input'
import { ORG_TYPES, orgTypeLabel } from '@/lib/organizations/config'
import { orgChatSettings } from '@/lib/organizations/chat-rules'
import { updateOrgChatSettingsAction } from '@/app/actions/org-chat'
import { requestOrgVerificationAction } from '@/app/actions/trust'
import type { OrgDetail } from '@/lib/organizations/detail'
import { orgGrant, type OrgAction, type OrgRole } from '@/lib/organizations/permissions'
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

export function OrgLeaveSection({ orgId, role, title }: SectionProps & { title: string }) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [error, setError] = useState<string | null>(null)
    return (
        <Section id="you-leave">
            <SettingsCard title="Leave organization" headingLevel={2} description="Stop being a member. You can join again later with the code." danger>
                {role === 'owner' ? (
                    <p className="text-sm text-muted-foreground">Transfer ownership first, in Organization management below.</p>
                ) : (
                    <div className="space-y-2">
                        <Button variant="destructive" onClick={() => setOpen(true)}>Leave {title}</Button>
                        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                    </div>
                )}
            </SettingsCard>
            <ConfirmDialog
                open={open}
                onOpenChange={setOpen}
                title={`Leave ${title}?`}
                description="You lose access to its private content. Your tasks are unassigned."
                confirmLabel="Leave"
                variant="destructive"
                onConfirm={async () => {
                    const result = await leaveOrgAction(orgId)
                    if (!result.success) return setError(result.error)
                    router.push('/discover')
                }}
            />
        </Section>
    )
}

export function OrgProfileSection({ orgId, organization, role, handle }: SectionProps & { handle: string | null }) {
    const router = useRouter()
    const [type, setType] = useState(organization.type ?? 'community')
    const [termStart, setTermStart] = useState(organization.termStart ?? '')
    const [termEnd, setTermEnd] = useState(organization.termEnd ?? '')
    const [timeZone, setTimeZone] = useState(organization.timeZone ?? '')
    const [welcome, setWelcome] = useState(organization.welcomeNote ?? '')
    const [typeLabel, setTypeLabel] = useState(organization.type === 'other' ? organization.typeLabel ?? '' : '')
    const [partOf, setPartOf] = useState(organization.partOf ?? '')
    const [location, setLocation] = useState(organization.location ?? '')
    const [newHandle, setNewHandle] = useState(handle ?? '')
    const { pending, save, status } = useSave()
    const rename = useSave()
    const isOwner = role === 'owner'
    return (
        <Section id="org-profile">
            <SettingsCard title="Organization profile" headingLevel={2} description="What people see on About, and how the organization keeps time." footer={<LastChanged organization={organization} section="profile" />}>
                <div className="space-y-6">
                    <div>
                        <label htmlFor="org-handle" className={labelClass}>Handle</label>
                        <p className={helpClass}>{isOwner ? `The address, networkbase.in/org/${handle}. Change it at most once every 7 days; the old one keeps redirecting for 90 days.` : OWNER_ONLY}</p>
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
                    <div>
                        <label htmlFor="org-type" className={labelClass}>Type</label>
                        <p className={helpClass}>Sets the role names for new organizations; changing it later keeps your role names.</p>
                        <select id="org-type" value={type} onChange={(e) => setType(e.target.value as typeof type)} className="mt-2 h-[var(--ui-control-height)] rounded-md border border-input bg-background px-2 text-sm">
                            {ORG_TYPES.map((t) => <option key={t} value={t}>{orgTypeLabel(t)}</option>)}
                        </select>
                        {type === 'other' ? (
                            <label className="mt-3 block max-w-sm text-xs text-muted-foreground">What do you call it?
                                <Input value={typeLabel} onChange={(e) => setTypeLabel(e.target.value)} placeholder="Nonprofit" maxLength={30} className="mt-1" />
                            </label>
                        ) : null}
                    </div>
                    <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
                        <label className="block">
                            <span className={labelClass}>Part of</span>
                            <span className={`block ${helpClass}`}>The bigger body it belongs to, for example RV College of Engineering.</span>
                            <Input value={partOf} onChange={(e) => setPartOf(e.target.value)} maxLength={100} className="mt-2" />
                        </label>
                        <label className="block">
                            <span className={labelClass}>Where</span>
                            <span className={`block ${helpClass}`}>A city, or Online.</span>
                            <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={100} className="mt-2" />
                        </label>
                    </div>
                    <fieldset>
                        <legend className={labelClass}>Term or period</legend>
                        <p className={helpClass}>Optional, for example Aug–Dec 2026. Shown on About.</p>
                        <div className="mt-2 grid max-w-md gap-3 sm:grid-cols-2">
                            <label className="text-xs text-muted-foreground">Starts<Input type="date" value={termStart} onChange={(e) => setTermStart(e.target.value)} className="mt-1" /></label>
                            <label className="text-xs text-muted-foreground">Ends<Input type="date" value={termEnd} onChange={(e) => setTermEnd(e.target.value)} className="mt-1" /></label>
                        </div>
                    </fieldset>
                    <div>
                        <label htmlFor="org-tz" className={labelClass}>Time zone</label>
                        <p className={helpClass}>Due dates and reminders use it, for example Asia/Kolkata. Empty uses each person’s own.</p>
                        <Input id="org-tz" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} placeholder="Asia/Kolkata" maxLength={64} className="mt-2 max-w-sm" />
                    </div>
                    <div>
                        <label htmlFor="org-welcome" className={labelClass}>Welcome note</label>
                        <p className={helpClass}>Shown to members on About, for example &quot;Read the syllabus first&quot;.</p>
                        <textarea id="org-welcome" value={welcome} onChange={(e) => setWelcome(e.target.value)} rows={4} maxLength={2000} className="mt-2 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                    </div>
                    <div className="flex items-center gap-3">
                        <Button disabled={pending || (type === 'other' && !typeLabel.trim())} onClick={() => save(() => updateOrgSettingsAction(orgId, 'profile', {
                            org_type: type, type_label: type === 'other' ? typeLabel.trim() : null, part_of: partOf.trim() || null, location: location.trim() || null,
                            term_start: termStart || null, term_end: termEnd || null, time_zone: timeZone.trim() || null, welcome_note: welcome.trim() || null,
                        }))}>Save</Button>
                        {status}
                    </div>
                </div>
            </SettingsCard>
        </Section>
    )
}

export function OrgAccessSection({ orgId, organization, maxMembers }: SectionProps & { maxMembers: string | null }) {
    const [joinMode, setJoinMode] = useState(organization.joinMode)
    const [codeOn, setCodeOn] = useState(organization.joinCodeEnabled)
    const [max, setMax] = useState(maxMembers ?? '')
    const [code, setCode] = useState(organization.joinCode)
    const [confirming, setConfirming] = useState(false)
    const { pending, save, status } = useSave()
    const regen = useSave()
    return (
        <Section id="org-access">
            <SettingsCard title="Access and joining" headingLevel={2} description="Who can join and how. Public or private is set in Access and Visibility." footer={<LastChanged organization={organization} section="access" />}>
                <div className="space-y-6">
                    <div>
                        <p className={labelClass}>Join code</p>
                        <p className={helpClass}>People enter it at /join. Regenerating stops the old code at once.</p>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                            <span className="select-all font-mono text-2xl font-semibold tracking-[0.2em]">{code}</span>
                            <Button variant="outline" size="sm" onClick={() => code && navigator.clipboard.writeText(code)}>Copy</Button>
                            <Button variant="ghost" size="sm" disabled={regen.pending} onClick={() => setConfirming(true)}>Regenerate</Button>
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
                            <p className={helpClass}>Turn off to stop new joins by code without changing it.</p>
                        </div>
                        <SettingsSwitch checked={codeOn} onCheckedChange={setCodeOn} aria-label="Join code works" />
                    </div>
                    <fieldset>
                        <legend className={labelClass}>Join mode</legend>
                        <div className="mt-2 space-y-2 text-sm">
                            <label className="flex items-center gap-2"><input type="radio" name="org-join-mode" checked={joinMode === 'instant'} onChange={() => setJoinMode('instant')} /> Instant: anyone with the code becomes a member</label>
                            <label className="flex items-center gap-2"><input type="radio" name="org-join-mode" checked={joinMode === 'approval'} onChange={() => setJoinMode('approval')} /> Approval: the code sends a request an admin approves</label>
                        </div>
                    </fieldset>
                    <div>
                        <label htmlFor="org-max" className={labelClass}>Max members</label>
                        <p className={helpClass}>Off when empty. When full, the code says &quot;This organization is full&quot;.</p>
                        <Input id="org-max" type="number" min={1} max={2000} value={max} onChange={(e) => setMax(e.target.value)} className="mt-2 w-32" />
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

// The plain-language table of what each role can do: a few rows from the permissions matrix.
const PEOPLE_ROWS: Array<[OrgAction, string]> = [
    ['open_dashboard', 'Open the dashboard'],
    ['post_discussion', 'Post discussions'],
    ['submit_own', 'Submit their own work'],
    ['create_child_project', 'Create projects'],
    ['create_assignments', 'Create tasks and assignments'],
    ['remove_members_guests', 'Remove members and guests'],
    ['manage_admins', 'Manage admins'],
    ['org_lifecycle', 'Archive, transfer or delete'],
]
const TABLE_ROLES: Array<[OrgRole, 'owner' | 'admin' | 'member' | 'viewer']> = [['owner', 'owner'], ['admin', 'admin'], ['member', 'member'], ['guest', 'viewer']]
const GRANT_TEXT: Record<string, string> = { yes: 'Yes', no: '—', setting: 'If allowed', own: 'Own', read: 'Read', counts: 'Counts' }

export function OrgPeopleSection({ orgId, organization, role }: SectionProps) {
    const [names, setNames] = useState(organization.roleNames)
    const { pending, save, status } = useSave()
    const isOwner = role === 'owner'
    return (
        <Section id="org-people">
            <SettingsCard title="People and roles" headingLevel={2} description="Role names and what each role can do. Only the owner manages admins." footer={<LastChanged organization={organization} section="people" />}>
                <div className="space-y-6">
                    <div>
                        <p className={labelClass}>Role names</p>
                        <p className={helpClass}>{isOwner ? 'For example Teacher / TA / Student / Viewer. Permissions always come from the role.' : OWNER_ONLY}</p>
                        <div className="mt-2 grid max-w-md gap-2 sm:grid-cols-2">
                            {TABLE_ROLES.map(([, key]) => (
                                <label key={key} className="text-xs capitalize text-muted-foreground">{key === 'viewer' ? 'guest' : key}
                                    <Input value={names[key]} onChange={(e) => setNames({ ...names, [key]: e.target.value })} disabled={!isOwner} maxLength={30} className="mt-1" />
                                </label>
                            ))}
                        </div>
                        {isOwner ? (
                            <div className="mt-3 flex items-center gap-3">
                                <Button disabled={pending} onClick={() => save(() => updateOrgSettingsAction(orgId, 'people', { role_names: names }))}>Save</Button>
                                {status}
                            </div>
                        ) : null}
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[28rem] text-left text-sm">
                            <caption className="sr-only">What each role can do</caption>
                            <thead>
                                <tr className="border-b border-border text-xs text-muted-foreground">
                                    <th scope="col" className="py-2 pr-3 font-medium">Can…</th>
                                    {TABLE_ROLES.map(([, key]) => <th key={key} scope="col" className="py-2 pr-3 font-medium">{organization.roleNames[key]}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {PEOPLE_ROWS.map(([action, label]) => (
                                    <tr key={action} className="border-b border-border/60 last:border-b-0">
                                        <th scope="row" className="py-2 pr-3 font-normal text-foreground">{label}</th>
                                        {TABLE_ROLES.map(([grantRole, key]) => <td key={key} className="py-2 pr-3 text-muted-foreground">{GRANT_TEXT[orgGrant(grantRole, action)] ?? '—'}</td>)}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </SettingsCard>
        </Section>
    )
}

const CAP_OPTIONS = [
    { value: 'public', label: 'Public allowed', hint: 'Projects choose Public, Org only or Private.' },
    { value: 'org', label: 'Org only at most', hint: 'Nothing leaves the organization.' },
    { value: 'private', label: 'Private only', hint: 'Each project is seen by its team and admins only.' },
] as const

export function OrgProjectsSection({ orgId, organization }: SectionProps) {
    const [childCreation, setChildCreation] = useState(organization.childCreation)
    const [outside, setOutside] = useState(organization.outsidePeople)
    const [childShare, setChildShare] = useState(organization.childShare)
    const [cap, setCap] = useState(organization.visibilityCap)
    const [defaultUnits, setDefaultUnits] = useState(organization.defaultUnits.join('\n'))
    const [followSprints, setFollowSprints] = useState(organization.followSprintsDefault)
    // Impact preview (report §21.1 principle 4): how many projects a tighter cap would lower.
    const [affected, setAffected] = useState<number | null>(null)
    const { pending, save, status } = useSave()
    const chooseCap = async (next: typeof cap) => {
        setCap(next)
        setAffected(null)
        const preview = await previewVisibilityCapAction(orgId, next)
        if (preview.success) setAffected(preview.affected)
    }
    return (
        <Section id="org-projects">
            <SettingsCard title="Projects" headingLevel={2} description="Who creates projects inside the organization, and who can be added to them." footer={<LastChanged organization={organization} section="projects" />}>
                <div className="space-y-6">
                    <fieldset>
                        <legend className={labelClass}>Who can create projects</legend>
                        <p className={helpClass}>Owners and admins always can. Changing this affects new projects only.</p>
                        <div className="mt-2 space-y-2 text-sm">
                            <label className="flex items-center gap-2"><input type="radio" name="org-child-creation" checked={childCreation === 'members'} onChange={() => setChildCreation('members')} /> All members</label>
                            <label className="flex items-center gap-2"><input type="radio" name="org-child-creation" checked={childCreation === 'admins'} onChange={() => setChildCreation('admins')} /> Admins only</label>
                        </div>
                    </fieldset>
                    <fieldset>
                        <legend className={labelClass}>Visibility cap</legend>
                        <p className={helpClass}>The most open a project here can be. Tightening it lowers projects above it.</p>
                        <div className="mt-2 space-y-2 text-sm">
                            {CAP_OPTIONS.map((option) => (
                                <label key={option.value} className="flex items-start gap-2">
                                    <input type="radio" name="org-visibility-cap" checked={cap === option.value} onChange={() => void chooseCap(option.value)} className="mt-1" />
                                    <span>{option.label}<span className="block text-xs text-muted-foreground">{option.hint}</span></span>
                                </label>
                            ))}
                        </div>
                        {affected ? <p role="status" className="mt-2 text-sm text-foreground">This will change {affected} {affected === 1 ? 'project' : 'projects'} to {cap === 'private' ? 'Private' : 'Organization'}.</p> : null}
                    </fieldset>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className={labelClass}>People outside the organization can be added to its projects</p>
                            <p className={helpClass}>Off by default. They see only that project, never the organization’s content.</p>
                        </div>
                        <SettingsSwitch checked={outside} onCheckedChange={setOutside} aria-label="People outside the organization can be added to its projects" />
                    </div>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className={labelClass}>Projects can share updates to the organization</p>
                            <p className={helpClass}>Shared posts show in the organization’s Updates under From projects. Private projects never share.</p>
                        </div>
                        <SettingsSwitch checked={childShare} onCheckedChange={setChildShare} aria-label="Projects can share updates to the organization" />
                    </div>
                    <div>
                        <label htmlFor="org-default-units" className={labelClass}>Default units</label>
                        <p className={helpClass}>Pre-fill the team of every new project, one per line, for example Frontend, Backend, Testing. Still editable per project.</p>
                        <textarea id="org-default-units" value={defaultUnits} onChange={(e) => setDefaultUnits(e.target.value)} rows={3} className="mt-2 w-full rounded-md border border-border bg-background p-2 text-sm" />
                    </div>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className={labelClass}>New projects follow org sprints</p>
                            <p className={helpClass}>On by default. A new project’s sprints link to the organization’s sprint holding their dates; the lead can turn it off.</p>
                        </div>
                        <SettingsSwitch checked={followSprints} onCheckedChange={setFollowSprints} aria-label="New projects follow org sprints" />
                    </div>
                    <div className="flex items-center gap-3">
                        <Button disabled={pending} onClick={() => save(() => updateOrgSettingsAction(orgId, 'projects', { follow_sprints: followSprints, child_creation: childCreation, outside_people: outside, child_share: childShare, default_units: defaultUnits.split('\n').map((u) => u.trim()).filter(Boolean).slice(0, 20), ...(cap !== organization.visibilityCap ? { visibility_cap: cap } : {}) }))}>Save</Button>
                        {status}
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
            <SettingsCard title="Work" headingLevel={2} description="Defaults for new assignments and sprints. Each assignment or sprint can still change them." footer={<LastChanged organization={organization} section="work" />}>
                <div className="space-y-6">
                    <p className="nb-ui-label text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">Assignments</p>
                    {toggle('reviewRequired', 'Review required', 'Admins approve or return each submission, for example a lab report. On for Education, off for other types.')}
                    <div>
                        <label htmlFor="org-late-rule" className={labelClass}>Late submissions</label>
                        <p className={helpClass}>What happens after the due date. Education accepts late work until a date you set per assignment.</p>
                        <select id="org-late-rule" className={select} value={work.lateRule} onChange={(e) => set('lateRule', e.target.value as typeof work.lateRule)}>
                            <option value="always">Always allowed</option><option value="until">Allowed until a date</option><option value="none">Not allowed</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="org-reminders" className={labelClass}>Reminders</label>
                        <p className={helpClass}>Sent at 9:00 in each person’s time zone to people who haven’t handed in yet.</p>
                        <select id="org-reminders" className={select} value={work.reminders} onChange={(e) => set('reminders', e.target.value as typeof work.reminders)}>
                            <option value="both">24 hours before and on the due day</option><option value="day_before">24 hours before</option><option value="due_day">On the due day</option><option value="off">Off</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="org-story-points" className={labelClass}>Story points</label>
                        <p className={helpClass}>Hidden for Education, where work is counted by assignment, shown for other types.</p>
                        <select id="org-story-points" className={select} value={work.storyPoints} onChange={(e) => set('storyPoints', e.target.value as typeof work.storyPoints)}>
                            <option value="shown">Shown</option><option value="hidden">Hidden</option>
                        </select>
                    </div>
                    <p className="nb-ui-label text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">Sprints</p>
                    {toggle('sprintAutoStart', 'Start automatically', 'A sprint starts on its start date, for example CO1 on Aug 5.')}
                    {toggle('sprintNotifyOnStart', 'Notify on start', 'Members hear when a sprint starts.')}
                    {toggle('sprintShowInChildren', 'Show in every workspace in the organization', 'Projects see the running org sprint and can link theirs to it.')}
                    {toggle('sprintCreateMatching', 'Create matching sprints', 'Off by default. Each project following org sprints gets its own sprint with the same dates.')}
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
    const defaults = orgChatSettings(organization.chat ?? {}, organization.type)
    const [adminsOnly, setAdminsOnly] = useState(defaults.generalAdminsOnly)
    const [membersCreate, setMembersCreate] = useState(defaults.membersCreateChannels)
    const [generalNotify, setGeneralNotify] = useState(defaults.generalNotify)
    const { pending, save, status } = useSave()
    return (
        <SettingsCard title="Messages" headingLevel={2} description="How the organization’s chat works for everyone in it.">
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
                        <p className={helpClass}>Project teams always create channels in their own projects.</p>
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
    )
}

/** Settings → Notifications (report §26.8): admins get one daily summary email, or only tray notices. */
export function OrgNotificationsSection({ orgId, organization }: { orgId: string; organization: OrgDetail }) {
    const [digest, setDigest] = useState(organization.adminDigest)
    const [announce, setAnnounce] = useState(organization.announcementNotify)
    const [replies, setReplies] = useState(organization.replyRule)
    const { pending, save, status } = useSave()
    return (
        <SettingsCard title="Admin batching" headingLevel={2} description="How owners and admins hear about submissions and join requests." footer={<LastChanged organization={organization} section="notifications" />}>
            <div className="space-y-4">
                <fieldset className="space-y-2 text-sm">
                    <legend className="sr-only">Admin batching</legend>
                    <label className="flex items-start gap-2">
                        <input type="radio" name="org-admin-digest" checked={digest === 'daily'} onChange={() => setDigest('daily')} className="mt-1" />
                        <span>Daily summary email<span className="block text-xs text-muted-foreground">At 8:00 in the organization’s time zone. Skipped when there’s nothing to report.</span></span>
                    </label>
                    <label className="flex items-start gap-2">
                        <input type="radio" name="org-admin-digest" checked={digest === 'instant'} onChange={() => setDigest('instant')} className="mt-1" />
                        <span>Instant<span className="block text-xs text-muted-foreground">Notifications only, as things happen. No summary email.</span></span>
                    </label>
                </fieldset>
                {/* Org Settings → Updates (report §17.10): the starting choices in the announcement composer. */}
                <label className="block text-sm">
                    <span className="font-medium text-foreground">Announcements notify</span>
                    <select value={announce} onChange={(e) => setAnnounce(e.target.value as typeof announce)} className="mt-1 block h-9 rounded-md border border-border bg-background px-2 text-sm">
                        <option value="in_app">In-app</option><option value="email">In-app and email</option>
                    </select>
                </label>
                <label className="block text-sm">
                    <span className="font-medium text-foreground">Who can reply to posts</span>
                    <select value={replies} onChange={(e) => setReplies(e.target.value as typeof replies)} className="mt-1 block h-9 rounded-md border border-border bg-background px-2 text-sm">
                        <option value="members">Organization members</option><option value="logged_in">Anyone signed in</option>
                    </select>
                </label>
                <div className="flex items-center gap-3">
                    <Button disabled={pending} onClick={() => save(() => updateOrgSettingsAction(orgId, 'notifications', { admin_digest: digest, announcement_notify: announce, reply_rule: replies }))}>Save</Button>
                    {status}
                </div>
            </div>
        </SettingsCard>
    )
}

/**
 * Settings → General, Verified badge (report §30.3): automatic when your verified email domain matches the
 * organization's website; otherwise the NetworkBase team reviews the request.
 */
export function OrgVerificationSection({ orgId, organization }: { orgId: string; organization: OrgDetail }) {
    const { pending, save, status } = useSave()
    return (
        <SettingsCard title="Verified badge" headingLevel={2} description="A ✓ next to the name on the header, cards and Discover.">
            {organization.verified ? <p className="text-sm text-foreground">This organization is verified.</p>
                : organization.verificationRequested ? <p className="text-sm text-muted-foreground">Requested. The NetworkBase team will review it.</p>
                : (
                    <div className="space-y-3">
                        <p className={helpClass}>Verified at once when your email address is on the same domain as the website in Links (not Gmail, Outlook and the like). Otherwise our team reviews it.</p>
                        <div className="flex items-center gap-3">
                            <Button disabled={pending} onClick={() => save(async () => {
                                const result = await requestOrgVerificationAction(orgId)
                                return result.success ? { success: true } : result
                            })}>Request verification</Button>
                            {status}
                        </div>
                    </div>
                )}
        </SettingsCard>
    )
}
