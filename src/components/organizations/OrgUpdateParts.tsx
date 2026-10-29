'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Pin } from 'lucide-react'

import { readAssignmentComposerOptionsAction } from '@/app/actions/assignments'
import { countAnnouncementAudienceAction, readOrgPinnedLineAction } from '@/app/actions/org-updates'
import type { OrgFeedFilter } from '@/lib/organizations/org-updates'
import type { UpdateAudience } from '@/lib/organizations/update-rules'
import { cn } from '@/lib/utils'

// Org Updates (report §17): the composer's org options, the feed filters, and the pinned org line.

export type OrgFeedInfo = { kind: 'org' | 'child'; title: string; isAdmin: boolean; shareBlockedReason: string | null; notifyDefault?: 'in_app' | 'email' }

export type OrgPostOptions = {
    updateType?: 'announcement' | 'discussion'
    audience?: UpdateAudience
    notifyLevel?: 'in_app' | 'email'
    pin?: boolean
    pinnedUntil?: string | null
    commentsOff?: boolean
    shareToOrg?: boolean
    shareToGeneral?: boolean
}

const chip = 'inline-flex min-h-8 items-center gap-1.5 rounded-[5px] border border-border px-2.5 text-[12px] text-foreground'
const ROLE_OPTIONS = [
    { value: 'admin', label: 'Admins' },
    { value: 'member', label: 'Members' },
    { value: 'viewer', label: 'Viewers' },
] as const

/** What the next post carries on top of the composer's own fields. Admins in an org get the full set. */
export function OrgUpdateOptions({ org, orgId, value, onChange }: { org: OrgFeedInfo; orgId: string; value: OrgPostOptions; onChange: (next: OrgPostOptions) => void }) {
    const [children, setChildren] = useState<Array<{ id: string; title: string }>>([])
    const [reach, setReach] = useState<number | null>(null)
    const isOrgAdmin = org.kind === 'org' && org.isAdmin
    const audienceKey = JSON.stringify(value.audience ?? {})
    useEffect(() => {
        if (!isOrgAdmin) return
        let cancelled = false
        const timer = setTimeout(() => void countAnnouncementAudienceAction(orgId, JSON.parse(audienceKey)).then((n) => { if (!cancelled) setReach(n) }), 300)
        return () => { cancelled = true; clearTimeout(timer) }
    }, [audienceKey, isOrgAdmin, orgId])
    useEffect(() => {
        if (isOrgAdmin) void readAssignmentComposerOptionsAction(orgId).then((r) => { if (r.success) setChildren(r.children) })
    }, [isOrgAdmin, orgId])

    if (org.kind === 'child') {
        return (
            <label className={cn(chip, 'mb-2', org.shareBlockedReason && 'opacity-60')} title={org.shareBlockedReason ?? undefined}>
                <input type="checkbox" disabled={Boolean(org.shareBlockedReason)} checked={Boolean(value.shareToOrg)} onChange={(e) => onChange({ ...value, shareToOrg: e.target.checked })} />
                Share to {org.title}
                {org.shareBlockedReason ? <span className="text-muted-foreground">· {org.shareBlockedReason}</span> : null}
            </label>
        )
    }
    if (!isOrgAdmin) return null

    const roles = value.audience?.roles ?? []
    const projectIds = value.audience?.projectIds ?? []
    const setAudience = (next: UpdateAudience) => onChange({ ...value, audience: next })
    const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item])

    return (
        <fieldset className="mb-2 space-y-2 rounded-[5px] border border-border p-2.5 text-[12px]">
            <legend className="sr-only">Post options</legend>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Post type">
                {(['announcement', 'discussion'] as const).map((type) => (
                    <label key={type} className={cn(chip, (value.updateType ?? 'announcement') === type && 'border-foreground')}>
                        <input type="radio" name="org-post-type" checked={(value.updateType ?? 'announcement') === type} onChange={() => onChange({ ...value, updateType: type })} />
                        {type === 'announcement' ? 'Announcement' : 'Discussion'}
                    </label>
                ))}
            </div>
            <details>
                <summary className="cursor-pointer text-muted-foreground">
                    Audience: {roles.length === 0 && projectIds.length === 0 ? 'Everyone' : [...roles.map((r) => ROLE_OPTIONS.find((o) => o.value === r)?.label), ...projectIds.map((id) => children.find((c) => c.id === id)?.title)].filter(Boolean).join(', ')}
                </summary>
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {ROLE_OPTIONS.map((option) => (
                        <label key={option.value} className={chip}>
                            <input type="checkbox" checked={roles.includes(option.value)} onChange={() => setAudience({ ...value.audience, roles: toggle(roles, option.value) })} />
                            {option.label}
                        </label>
                    ))}
                    {children.map((child) => (
                        <label key={child.id} className={chip}>
                            <input type="checkbox" checked={projectIds.includes(child.id)} onChange={() => setAudience({ ...value.audience, projectIds: toggle(projectIds, child.id) })} />
                            {child.title}
                        </label>
                    ))}
                </div>
            </details>
            <div className="flex flex-wrap items-center gap-1.5">
                <label className={chip}>
                    <input type="checkbox" checked={(value.notifyLevel ?? org.notifyDefault) === 'email'} onChange={(e) => onChange({ ...value, notifyLevel: e.target.checked ? 'email' : 'in_app' })} />
                    Also email
                </label>
                <label className={chip}>
                    <input type="checkbox" checked={Boolean(value.pin)} onChange={(e) => onChange({ ...value, pin: e.target.checked })} />
                    Pin
                </label>
                {value.pin ? (
                    <label className={chip}>
                        Unpin on
                        <input type="date" className="bg-transparent" value={value.pinnedUntil?.slice(0, 10) ?? ''} onChange={(e) => onChange({ ...value, pinnedUntil: e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : null })} />
                    </label>
                ) : null}
                <label className={chip}>
                    <input type="checkbox" checked={Boolean(value.commentsOff)} onChange={(e) => onChange({ ...value, commentsOff: e.target.checked })} />
                    Comments off
                </label>
                {(value.updateType ?? 'announcement') === 'announcement' ? (
                    <label className={chip}>
                        <input type="checkbox" checked={Boolean(value.shareToGeneral)} onChange={(e) => onChange({ ...value, shareToGeneral: e.target.checked })} />
                        Also share in #general
                    </label>
                ) : null}
            </div>
            {/* Preview line and the empty-audience warning (report §17.3, §17.11). */}
            {reach !== null ? (
                <p role="status" className={reach === 0 ? 'text-destructive' : 'text-muted-foreground'}>
                    {reach === 0 ? 'Nobody is in this audience yet. Pick another before posting.'
                        : `Visible to ${reach} ${reach === 1 ? 'person' : 'people'} · ${(value.updateType ?? 'announcement') === 'announcement' ? `notifies ${reach} by in-app${(value.notifyLevel ?? org.notifyDefault) === 'email' ? ' and email' : ''}` : 'no notifications'}`}
                </p>
            ) : null}
        </fieldset>
    )
}

const FILTERS: Array<{ value: OrgFeedFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'announcement', label: 'Announcements' },
    { value: 'discussion', label: 'Discussions' },
    { value: 'from_projects', label: 'From projects' },
]

export function OrgFeedFilters({ value, onChange }: { value: OrgFeedFilter; onChange: (next: OrgFeedFilter) => void }) {
    return (
        <div className="flex flex-wrap gap-1.5 px-1 pb-3" role="tablist" aria-label="Filter updates">
            {FILTERS.map((filter) => (
                <button key={filter.value} type="button" role="tab" aria-selected={value === filter.value} onClick={() => onChange(filter.value)}
                    className={cn(chip, value === filter.value ? 'border-foreground font-medium' : 'text-muted-foreground')}>
                    {filter.label}
                </button>
            ))}
        </div>
    )
}

/** "📌 CSE-3A · Midterm moved to Nov 10" at the top of a child project's feed (report §17.7). */
export function OrgPinnedLine({ projectId }: { projectId: string }) {
    const { data: line } = useQuery({ queryKey: ['org-pinned-line', projectId], queryFn: () => readOrgPinnedLineAction(projectId), staleTime: 60_000 })
    if (!line) return null
    return (
        <Link href={`/org/${encodeURIComponent(line.orgSlug ?? '')}?tab=updates&updateId=${encodeURIComponent(line.id)}`}
            className="mb-3 flex min-h-10 items-center gap-2 rounded-[5px] border border-border bg-muted/30 px-3 text-[13px] text-foreground hover:bg-muted">
            <Pin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="shrink-0 font-medium">{line.orgTitle}</span>
            <span className="truncate text-muted-foreground">· {line.content}</span>
        </Link>
    )
}
