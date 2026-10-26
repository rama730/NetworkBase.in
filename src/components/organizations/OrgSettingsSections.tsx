'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition, type ReactNode } from 'react'

import {
    leaveOrgAction,
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
import { ORG_TYPES } from '@/lib/organizations/config'
import type { OrgDetail } from '@/lib/organizations/detail'
import { orgGrant, type OrgAction, type OrgRole } from '@/lib/organizations/permissions'
import type { OrgMemberRole, OrgSettingsSection } from '@/lib/organizations/settings'

// Org settings sections (report §21.2–21.4), rendered inside the project Settings document. Each saves on its
// own and shows who changed it last.

type SectionProps = { orgId: string; organization: OrgDetail; role: OrgMemberRole }

const DATE = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })
const TYPE_LABEL: Record<string, string> = { education: 'Education', company: 'Company', community: 'Community', research: 'Research', club: 'Club' }
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
            setMessage(result.success ? { kind: 'ok', text: 'Saved.' } : { kind: 'error', text: result.error ?? 'Could not save.' })
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
                    <p className="text-sm text-muted-foreground">Transfer ownership first, in the danger zone below.</p>
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
                            {ORG_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                        </select>
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
                        <p className={helpClass}>Due dates and reminders use it, for example Asia/Kolkata. Empty uses each person&apos;s own.</p>
                        <Input id="org-tz" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} placeholder="Asia/Kolkata" maxLength={64} className="mt-2 max-w-sm" />
                    </div>
                    <div>
                        <label htmlFor="org-welcome" className={labelClass}>Welcome note</label>
                        <p className={helpClass}>Shown to members on About, for example &quot;Read the syllabus first&quot;.</p>
                        <textarea id="org-welcome" value={welcome} onChange={(e) => setWelcome(e.target.value)} rows={4} maxLength={2000} className="mt-2 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                    </div>
                    <div className="flex items-center gap-3">
                        <Button disabled={pending} onClick={() => save(() => updateOrgSettingsAction(orgId, 'profile', { org_type: type, term_start: termStart || null, term_end: termEnd || null, time_zone: timeZone.trim() || null, welcome_note: welcome.trim() || null }))}>Save</Button>
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
            <SettingsCard title="Access & joining" headingLevel={2} description="Who can join and how. Public or private is set in Access & Visibility." footer={<LastChanged organization={organization} section="access" />}>
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
    ['open_dashboard', 'Open the Dashboard'],
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
            <SettingsCard title="People & roles" headingLevel={2} description="Role names and what each role can do. Only the owner manages admins." footer={<LastChanged organization={organization} section="people" />}>
                <div className="space-y-6">
                    <div>
                        <p className={labelClass}>Role names</p>
                        <p className={helpClass}>{isOwner ? 'For example Teacher / TA / Student / Guest. Permissions always come from the role.' : OWNER_ONLY}</p>
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

export function OrgProjectsSection({ orgId, organization }: SectionProps) {
    const [childCreation, setChildCreation] = useState(organization.childCreation)
    const [outside, setOutside] = useState(organization.outsidePeople)
    const { pending, save, status } = useSave()
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
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className={labelClass}>People outside the organization can be added to its projects</p>
                            <p className={helpClass}>Off by default. They see only that project, never the organization&apos;s content.</p>
                        </div>
                        <SettingsSwitch checked={outside} onCheckedChange={setOutside} aria-label="People outside the organization can be added to its projects" />
                    </div>
                    <div className="flex items-center gap-3">
                        <Button disabled={pending} onClick={() => save(() => updateOrgSettingsAction(orgId, 'projects', { child_creation: childCreation, outside_people: outside }))}>Save</Button>
                        {status}
                    </div>
                </div>
            </SettingsCard>
        </Section>
    )
}
