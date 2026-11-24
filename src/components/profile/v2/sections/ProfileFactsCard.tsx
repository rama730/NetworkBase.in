'use client'

import Link from 'next/link'
import { Fragment, useId, useState } from 'react'
import { AlertTriangle, ArrowRight, Check, ExternalLink, Link2, Pencil, Plus } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { WorkspaceAvatar } from '@/components/workspaces/WorkspaceAvatar'
import { useMutualPreview } from '../useMutualPreview'
import { SocialPresenceIcon } from '@/components/profile/SocialPresenceIcon'
import { normalizeProfile } from '@/lib/utils/normalize-profile'
import { normalizeSocialLinks } from '@/lib/profile/normalization'
import { completionField, completionItemSection, type ProfileEditSection } from '@/lib/profile/edit-route'
import { currentOrganizations, sinceMonth } from '@/lib/organizations/profile-rules'
import { experienceLevelLabel, getRolePreferences, rolePreferenceLabel, WEEKLY_CAPACITY_OPTIONS } from '@/lib/profile/role-preferences'
import type { ProfileDetailsRow } from '@/lib/profile/details'
import type { ProfileCollaborationContribution } from '@/lib/profile/collaboration'
import { FactList, type Fact } from './FactList'
import { ManageOrganizationsDialog } from './ProfileOrganizationsSection'

export { completionField } from '@/lib/profile/edit-route'

function Section({ title, count, onEdit, editLabel, extra, children, id }: { title: string; count?: number; onEdit?: () => void; editLabel?: string; extra?: React.ReactNode; children: React.ReactNode; id?: string }) {
    const hid = useId()
    return (
        <section className="nb-pf-fsec" id={id} aria-labelledby={`${hid}-h`}>
            <div className="nb-pf-label">
                <h2 id={`${hid}-h`} className="nb-pf-h">{title}</h2>
                {count != null ? <span>· <b>{count}</b></span> : null}
                {extra}
                {onEdit ? <button type="button" className="nb-pf-ed ml-auto" onClick={onEdit} aria-label={editLabel ?? `Edit ${title.toLowerCase()}`}><Pencil className="size-3.5" /></button> : null}
            </div>
            {children}
        </section>
    )
}

/**
 * The profile's right column as one card with hairline sections, ordered by who is looking (spec: Right card):
 * the owner starts with what's missing; a visitor starts with how to work with this person.
 */
export function ProfileFactsCard({
    profile,
    isOwner,
    isAuthenticated,
    contributions,
    detailsRows,
    mutualCount = 0,
    onEditSection,
    onInvite,
    onInviteIntent,
    onApply,
    hasOpenRoles = false,
    onSeeConnections,
}: {
    profile: any
    isOwner: boolean
    isAuthenticated: boolean
    contributions: ProfileCollaborationContribution[]
    detailsRows: ProfileDetailsRow[]
    mutualCount?: number
    onEditSection?: (section: ProfileEditSection, extra?: Record<string, string>) => void
    onInvite?: () => void
    onInviteIntent?: () => void
    onApply?: () => void
    hasOpenRoles?: boolean
    onSeeConnections?: () => void
}) {
    const [managing, setManaging] = useState(false)
    const vm = normalizeProfile(profile)
    const first = (profile?.fullName || profile?.username || 'them').split(/\s+/)[0]
    const visitor = !isOwner
    const mutuals = useMutualPreview(profile?.id, Boolean(visitor && isAuthenticated && mutualCount > 0))
    if (!vm) return null
    const edit = (section: ProfileEditSection, extra?: Record<string, string>) => onEditSection ? () => onEditSection(section, extra) : undefined

    // Profile completeness (owner, under 100%): ten squares and the next three missing things, each opening its field.
    const score = Math.max(0, Math.min(100, Number(vm.profileStrength || 0)))
    const missing: string[] = Array.isArray(profile?.completionMissing) ? profile.completionMissing : []
    const completeness = isOwner && score < 100 ? (
        <Section title="Profile completeness" extra={<span className="nb-pf-pct">{score}%</span>}>
            <div className="nb-pf-cmp" role="progressbar" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100} aria-label={`Profile completeness: ${score}%`}>
                {Array.from({ length: 10 }, (_, i) => <i key={i} className={i < Math.round(score / 10) ? 'on' : undefined} />)}
            </div>
            {missing.length ? (
                <ul className="nb-pf-todo">
                    {missing.slice(0, 3).map((item) => (
                        <li key={item}><button type="button" onClick={edit(completionItemSection(item), { field: completionField(item) })}>
                            <span className="box" aria-hidden="true" />{item}<ArrowRight className="go size-3" aria-hidden="true" />
                        </button></li>
                    ))}
                </ul>
            ) : null}
        </Section>
    ) : null

    // Collaboration: what they're open to; visitors get Invite (primary) and the open roles.
    const open = vm.openToCollaborate === true
    const roles = getRolePreferences(vm.openTo)
    const experience = experienceLevelLabel(vm.experienceLevel)
    const capacity = WEEKLY_CAPACITY_OPTIONS.find((o) => o.value === vm.hoursPerWeek)
    const preferences: Fact[] = [
        { label: 'Role types', values: roles.map((r) => rolePreferenceLabel(r) || r) },
        { label: 'Preferred roles', values: vm.openToCustomRoles ?? [] },
        { label: 'Categories', values: vm.preferredCategories ?? [] },
        { label: 'Experience', values: experience ? [experience] : [] },
        { label: 'Weekly availability', values: capacity ? [capacity.compactLabel] : [], description: capacity?.label },
    ].filter((f) => f.values.length > 0)
    const collaboration = !isOwner && !open ? null : (
        <Section id="profile-open-to-roles" title="Collaboration" onEdit={isOwner ? edit('opportunity') : undefined} editLabel="Edit role preferences">
            {isOwner && !open ? <p className="nb-pf-fnote">You’re not open to collaboration, so visitors don’t see this. Turn it on in your header.</p> : null}
            {preferences.length ? <FactList facts={preferences} />
                : <p className="nb-pf-fnote">{isOwner ? 'Add the role types, roles, and categories that interest you.' : 'Open to collaboration. Specific roles not added yet.'}</p>}
            {visitor && (onInvite || (hasOpenRoles && onApply)) ? (
                <div className="nb-pf-cta">
                    {onInvite ? <Button onClick={onInvite} onMouseEnter={onInviteIntent} onFocus={onInviteIntent}><Plus className="size-4" />Invite to a workspace</Button> : null}
                    {hasOpenRoles && onApply ? <Button variant="ghost" onClick={onApply}>See {first}’s open roles</Button> : null}
                </div>
            ) : null}
        </Section>
    )

    // People you both know: up to three, then everyone in the connections sheet.
    const people = mutuals.data?.people ?? []
    const mutual = visitor && isAuthenticated && mutualCount > 0 && people.length ? (
        <Section title="People you both know" count={mutuals.data?.total ?? mutualCount}>
            {people.slice(0, 3).map((p) => (
                <Link key={p.id} href={p.username ? `/u/${p.username}` : '#'} className="nb-pf-mrow">
                    <UserAvatar identity={p} className="size-7" roundedClassName="rounded-[5px]" sizes="28px" />
                    <span><b>{p.fullName || `@${p.username}`}</b><span>{p.headline || (p.username ? `@${p.username}` : '')}</span></span>
                </Link>
            ))}
            {onSeeConnections ? <button type="button" className="nb-pf-link justify-self-start" onClick={onSeeConnections}>See all connections →</button> : null}
        </Section>
    ) : null

    // Organizations: current ones, linked, with the verified tick; the owner manages order and Show.
    const orgs = currentOrganizations(contributions, isOwner)
    const organizations = !isOwner && orgs.length === 0 ? null : (
        <Section title="Organizations" count={orgs.length} onEdit={isOwner ? () => setManaging(true) : undefined} editLabel="Manage organizations">
            {orgs.length ? orgs.map((c) => {
                const inner = (
                    <>
                        <WorkspaceAvatar project={{ title: c.projectTitle, coverImage: c.projectCoverImage }} size="row" kind="organization" />
                        <span className="min-w-0">
                            <b>{c.projectTitle}{c.orgVerified ? <span className="nb-pf-vok" title={`Verified by ${c.projectTitle}`} role="img" aria-label="Verified"><Check className="size-2.5" strokeWidth={3} aria-hidden="true" /></span> : null}</b>
                            <span>{[c.title, c.startDate ? `Since ${sinceMonth(c.startDate)}` : null, isOwner && c.showOnProfile === false ? 'Hidden' : null].filter(Boolean).join(' · ')}</span>
                        </span>
                        {c.projectHref ? <ExternalLink className="go size-3" aria-hidden="true" /> : null}
                    </>
                )
                return c.projectHref ? <Link key={c.id} href={c.projectHref} className="nb-pf-org">{inner}</Link> : <div key={c.id} className="nb-pf-org">{inner}</div>
            }) : <p className="nb-pf-fnote">Organizations you’re part of show here.</p>}
            {isOwner ? <Link href="/join" className="nb-pf-link inline-flex items-center gap-1.5"><Plus className="size-3.5" />Join with code</Link> : null}
            {isOwner && managing ? <ManageOrganizationsDialog open onOpenChange={setManaging} /> : null}
        </Section>
    )

    // Details: interests (six, then +N more), their local time, when they joined.
    const facts: Fact[] = detailsRows.map((row) => ({
        label: row.label,
        values: row.value === null ? [] : Array.isArray(row.value) ? row.value : [row.value],
        description: row.description,
        limit: row.key === 'interests' ? 6 : undefined,
        empty: row.addHref ? <Link href={row.addHref} className="font-normal text-primary hover:underline">{row.addLabel}</Link> : null,
    }))
    const details = facts.length ? (
        <Section title="Details" onEdit={isOwner ? edit('skills') : undefined} editLabel="Edit details"><FactList facts={facts} /></Section>
    ) : null

    // Links: name keeps its width, the address shortens; only the owner sees one that didn't open last time.
    const links = normalizeSocialLinks({ ...profile, socialLinks: vm.socialLinks }, profile?.socialLinks || [])
    const health = isOwner && profile?.socialLinkMetadata && typeof profile.socialLinkMetadata === 'object' ? profile.socialLinkMetadata as Record<string, { health?: string }> : {}
    const linkSection = links.length ? (
        <Section title="Links" count={links.length} onEdit={isOwner ? edit('social') : undefined} editLabel="Edit links">
            <div className="nb-pf-links">
                {links.map((l) => {
                    const icon = l.iconKey ? <SocialPresenceIcon iconKey={l.iconKey} /> : <Link2 className="size-4" aria-hidden="true" />
                    const label = l.customLabel || l.accountLabel
                    return l.id && health[l.id]?.health === 'unavailable' ? (
                        <div key={l.id} className="nb-pf-link-row is-bad">
                            {icon}<span><span>{l.platformLabel}</span><span className="lw"><AlertTriangle className="size-3" aria-hidden="true" />Didn’t open last time</span></span>
                            <Button size="sm" variant="outline" onClick={edit('social', { link: l.id })} aria-label={`Fix ${l.platformLabel}`}>Fix</Button>
                        </div>
                    ) : (
                        <a key={l.id || l.canonicalKey} className="nb-pf-link-row" href={`/go/profile/${encodeURIComponent(vm.id)}/${encodeURIComponent(l.id || l.canonicalKey)}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${l.platformLabel}: ${label}`}>
                            {icon}<span>{l.platformLabel}</span><span className="h" title={label}>{label}<ExternalLink className="size-3" aria-hidden="true" /></span>
                        </a>
                    )
                })}
            </div>
        </Section>
    ) : isOwner ? (
        <Section title="Links" count={0} onEdit={edit('social')} editLabel="Edit links"><p className="nb-pf-fnote">Add your GitHub, LinkedIn or site.</p></Section>
    ) : null

    const order = isOwner ? [completeness, collaboration, organizations, details, linkSection] : [collaboration, mutual, organizations, details, linkSection]
    return <div className="nb-pf-panel nb-pf-facts">{order.map((node, i) => <Fragment key={i}>{node}</Fragment>)}</div>
}
