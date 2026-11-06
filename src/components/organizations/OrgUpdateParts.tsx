'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Hash, Mail, MoreHorizontal, Pin, Users } from 'lucide-react'

import { countAnnouncementAudienceAction, readOrgPinnedLineAction, readUnseenPeopleAction, remindUnseenAction, setOrgUpdateAudienceAction } from '@/app/actions/org-updates'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
    DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
    DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/lib/feedback'
import type { OrgFeedFilter } from '@/lib/organizations/org-updates'
import { rolePlural } from '@/lib/organizations/role-words'
import { audienceLabel, type UpdateAudience } from '@/lib/organizations/update-rules'
import { cn } from '@/lib/utils'
import { NotYetDialog } from '@/components/organizations/org-ui'

// Org Updates (report §7.5, §16.3, §18.4, §28.3, §37.3): the options inside the composer, the feed filters, the
// pinned org line, and the card's audience and seen parts.

export type OrgFeedInfo = {
    kind: 'org' | 'child'
    title: string
    isAdmin: boolean
    shareBlockedReason: string | null
    notifyDefault?: 'in_app' | 'email'
    replyDefault?: 'members' | 'logged_in'
    roleNames?: Record<'owner' | 'admin' | 'member' | 'viewer', string>
    memberPostsOn?: boolean
    childIsPublic?: boolean
    emailsLeft?: number
    pins?: Array<{ id: string; excerpt: string }>
    workspaces?: Array<{ id: string; title: string }>
}

export type OrgPostOptions = {
    updateType?: 'announcement' | 'discussion'
    audience?: UpdateAudience
    isPublic?: boolean
    notifyLevel?: 'in_app' | 'email'
    pin?: boolean
    pinnedUntil?: string | null
    replyPolicy?: 'members' | 'logged_in' | 'closed'
    shareToGeneral?: boolean
    /** A workspace inside an organization: Who sees this (report §18.4). */
    childAudience?: 'team' | 'org' | 'public'
}

/** What the composer shows for an organization, and what it posts with (see WorkspaceUpdateComposer's orgControls). */
export type OrgComposerControls = {
    top: ReactNode
    toolbar: ReactNode
    postLabel: string
    blockedReason: string | null
    visibility: 'members' | 'public'
    placeholder: string
}

const EMAIL_LIMIT = 5
const chip = 'inline-flex min-h-8 items-center gap-1.5 rounded-[5px] border border-border px-2.5 text-[12px] text-foreground'
const tool = 'size-7 rounded-[5px] flex items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-border disabled:opacity-50'
const DEFAULT_ROLES = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' }

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`

/** The child workspace's starting choice (report §18.4): public starts on Everyone in the organization; Public is never the default. */
export function childAudienceDefault(org: OrgFeedInfo): 'team' | 'org' {
    return org.childIsPublic && !org.shareBlockedReason ? 'org' : 'team'
}

/**
 * The organization's options inside the one composer (report §7.5, §16.3, decision 8): type and audience on top;
 * Pin, Also email, #general and Comments in the toolbar; the button names the real reach.
 */
export function useOrgComposer(org: OrgFeedInfo | null, orgId: string, value: OrgPostOptions, onChange: (next: OrgPostOptions) => void, canCreate: boolean): OrgComposerControls | null {
    const [reach, setReach] = useState<number | null>(null)
    const isOrgAdmin = org?.kind === 'org' && org.isAdmin
    const audienceKey = JSON.stringify(value.audience ?? {})
    useEffect(() => {
        if (!isOrgAdmin || !canCreate) return
        let cancelled = false
        const timer = setTimeout(() => void countAnnouncementAudienceAction(orgId, JSON.parse(audienceKey)).then((n) => { if (!cancelled) setReach(n) }), 300)
        return () => { cancelled = true; clearTimeout(timer) }
    }, [audienceKey, canCreate, isOrgAdmin, orgId])
    if (!org || !canCreate) return null
    const roleNames = org.roleNames ?? DEFAULT_ROLES
    const replyPolicy = value.replyPolicy ?? org.replyDefault ?? 'members'
    const comments = (
        <DropdownMenu>
            <DropdownMenuTrigger asChild><button type="button" className={tool} aria-label="Post settings" title="Post settings"><MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuLabel>Comments</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={replyPolicy} onValueChange={(next) => onChange({ ...value, replyPolicy: next as OrgPostOptions['replyPolicy'] })}>
                    <DropdownMenuRadioItem value="members">Members</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="logged_in">Anyone signed in</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="closed">Off</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    )

    if (org.kind === 'child') {
        const choice = value.childAudience ?? childAudienceDefault(org)
        const options: Array<{ value: 'team' | 'org' | 'public'; label: string; reason: string | null }> = [
            { value: 'team', label: 'Team', reason: null },
            { value: 'org', label: `Everyone in ${org.title}`, reason: org.shareBlockedReason },
            ...(org.childIsPublic ? [{ value: 'public' as const, label: 'Public', reason: org.shareBlockedReason }] : []),
        ]
        return {
            top: (
                <div className="mb-2 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Who sees this">
                    <span className="text-[12px] text-muted-foreground">Who sees this</span>
                    {options.map((o) => (
                        <button key={o.value} type="button" role="radio" aria-checked={choice === o.value} disabled={Boolean(o.reason)} title={o.reason ?? undefined}
                            onClick={() => onChange({ ...value, childAudience: o.value })}
                            className={cn(chip, choice === o.value && 'border-foreground font-medium', o.reason && 'opacity-60')}>
                            {o.label}{o.value === 'public' ? <span className="text-muted-foreground">· Also on Discover</span> : null}
                        </button>
                    ))}
                    {org.shareBlockedReason ? <span className="text-[12px] text-muted-foreground">{org.shareBlockedReason}</span> : null}
                </div>
            ),
            toolbar: null,
            postLabel: choice === 'team' ? 'Post to your team' : choice === 'org' ? `Post to ${org.title}` : 'Post publicly',
            blockedReason: null,
            visibility: choice === 'public' ? 'public' : 'members',
            placeholder: 'Share something with your team…',
        }
    }

    if (!org.isAdmin) {
        // Members only start discussions (decision 155); the server sets the type too.
        return {
            top: <div className="mb-2"><span className={chip}><Users className="h-3.5 w-3.5" aria-hidden="true" />Discussion · Members</span></div>,
            toolbar: comments,
            postLabel: 'Post',
            blockedReason: null,
            visibility: 'members',
            placeholder: `Start a discussion in ${org.title}…`,
        }
    }

    const type = value.updateType ?? 'announcement'
    const emailsLeft = org.emailsLeft ?? EMAIL_LIMIT
    const emailOn = emailsLeft > 0 && (value.notifyLevel ?? org.notifyDefault) === 'email'
    const pins = org.pins ?? []
    const pinFull = pins.length >= 3 && !value.pin
    const label = audienceLabel({ audience: value.audience, visibility: value.isPublic ? 'public' : 'members' }, roleNames, new Map((org.workspaces ?? []).map((w) => [w.id, w.title])))
    const reachLine = value.isPublic ? 'Anyone · also on Discover' : reach === null ? null : `Goes to ${people(reach)}`
    const blockedReason = !value.isPublic && reach === 0 ? 'Nobody is in this audience yet. Pick another before posting.' : null
    return {
        top: (
            <div className="mb-2 space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                    <div className="inline-flex rounded-[5px] border border-border p-0.5" role="radiogroup" aria-label="Post type">
                        {(['announcement', 'discussion'] as const).map((t) => (
                            <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => onChange({ ...value, updateType: t })}
                                className={cn('rounded-[3px] px-2 py-0.5 text-[12px]', type === t ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground')}>
                                {t === 'announcement' ? 'Announcement' : 'Discussion'}
                            </button>
                        ))}
                    </div>
                    <AudienceMenu org={org} value={{ audience: value.audience ?? {}, isPublic: Boolean(value.isPublic) }} label={label}
                        onChange={(next) => onChange({ ...value, audience: next.audience, isPublic: next.isPublic })} />
                    {reachLine ? <span role="status" className={cn('text-[12px]', blockedReason ? 'text-destructive' : 'text-muted-foreground')}>{blockedReason ?? reachLine}</span> : null}
                </div>
                {value.pin ? (
                    <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                        Pinned · unpin on
                        <input type="date" className="rounded border border-border bg-transparent px-1" value={value.pinnedUntil?.slice(0, 10) ?? ''}
                            onChange={(e) => onChange({ ...value, pinnedUntil: e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : null })} />
                    </label>
                ) : null}
                {type === 'announcement' ? (
                    <p className="text-[12px] text-muted-foreground" role="status">
                        {emailsLeft === 0 ? `${EMAIL_LIMIT} emails sent today. Resets tomorrow.` : emailOn ? `Also email · ${emailsLeft} of ${EMAIL_LIMIT} left today` : null}
                    </p>
                ) : null}
            </div>
        ),
        toolbar: (
            <>
                {pinFull ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild><button type="button" className={tool} aria-label="Pin: unpin one first" title="Unpin one first"><Pin className="h-4 w-4" /></button></DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="max-w-72">
                            <DropdownMenuLabel>Unpin one first</DropdownMenuLabel>
                            {pins.map((p) => <DropdownMenuItem key={p.id} disabled className="truncate">{p.excerpt || 'Pinned post'}</DropdownMenuItem>)}
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : (
                    <button type="button" className={tool} aria-pressed={Boolean(value.pin)} aria-label="Pin" title="Pin" onClick={() => onChange({ ...value, pin: !value.pin })}><Pin className="h-4 w-4" /></button>
                )}
                {type === 'announcement' ? (
                    <>
                        <button type="button" className={tool} aria-pressed={emailOn} disabled={emailsLeft === 0}
                            aria-label={emailsLeft === 0 ? `${EMAIL_LIMIT} emails sent today. Resets tomorrow.` : `Also email · ${emailsLeft} of ${EMAIL_LIMIT} left today`}
                            title={emailsLeft === 0 ? `${EMAIL_LIMIT} emails sent today. Resets tomorrow.` : `Also email · ${emailsLeft} of ${EMAIL_LIMIT} left today`}
                            onClick={() => onChange({ ...value, notifyLevel: emailOn ? 'in_app' : 'email' })}><Mail className="h-4 w-4" /></button>
                        <button type="button" className={tool} aria-pressed={Boolean(value.shareToGeneral)} aria-label="Also share in #general" title="Also share in #general"
                            onClick={() => onChange({ ...value, shareToGeneral: !value.shareToGeneral })}><Hash className="h-4 w-4" /></button>
                    </>
                ) : null}
                {comments}
            </>
        ),
        postLabel: value.isPublic ? 'Post publicly' : reach === null ? 'Post' : `Post to ${people(reach)}`,
        blockedReason,
        visibility: value.isPublic ? 'public' : 'members',
        placeholder: `Share something with ${org.title}…`,
    }
}

/** Everyone, Admins, the org's roles, its workspaces, or Public, which says "Also on Discover" (report §7.5, §37.3). */
export function AudienceMenu({ org, value, label, onChange }: {
    org: OrgFeedInfo
    value: { audience: UpdateAudience; isPublic: boolean }
    label: string
    onChange: (next: { audience: UpdateAudience; isPublic: boolean }) => void
}) {
    const roleNames = org.roleNames ?? DEFAULT_ROLES
    const roles = value.audience.roles ?? []
    const projectIds = value.audience.projectIds ?? []
    const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item])
    const set = (audience: UpdateAudience) => onChange({ audience: { ...(audience.roles?.length ? { roles: audience.roles } : {}), ...(audience.projectIds?.length ? { projectIds: audience.projectIds } : {}) }, isPublic: false })
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild><button type="button" className={chip} aria-label={`Audience: ${label}`}><Users className="h-3.5 w-3.5" aria-hidden="true" />{label}</button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
                <DropdownMenuCheckboxItem checked={!value.isPublic && roles.length === 0 && projectIds.length === 0} onSelect={(e) => { e.preventDefault(); set({}) }}>Everyone in {org.title}</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={roles.includes('admin')} onSelect={(e) => { e.preventDefault(); set({ roles: toggle(roles, 'admin'), projectIds }) }}>Admins</DropdownMenuCheckboxItem>
                {(['member', 'viewer'] as const).map((r) => (
                    <DropdownMenuCheckboxItem key={r} checked={roles.includes(r)} onSelect={(e) => { e.preventDefault(); set({ roles: toggle(roles, r), projectIds }) }}>{rolePlural(roleNames[r])}</DropdownMenuCheckboxItem>
                ))}
                {(org.workspaces ?? []).length ? <DropdownMenuSeparator /> : null}
                {(org.workspaces ?? []).map((w) => (
                    <DropdownMenuCheckboxItem key={w.id} checked={projectIds.includes(w.id)} onSelect={(e) => { e.preventDefault(); set({ roles, projectIds: toggle(projectIds, w.id) }) }}>{w.title}</DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={value.isPublic} onSelect={(e) => { e.preventDefault(); onChange({ audience: {}, isPublic: !value.isPublic }) }}>Public · Also on Discover</DropdownMenuCheckboxItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

/** "Seen by 32 of 40" on an announcement, for admins (report §28.3, decision 58): the shared NotYetDialog. */
export function SeenCount({ orgId, updateId, seen }: { orgId: string; updateId: string; seen: { seen: number; total: number } }) {
    return <NotYetDialog verb="Seen" done={seen.seen} total={seen.total} queryKey={['org-update-unseen', updateId]}
        load={() => readUnseenPeopleAction(orgId, updateId)} remind={() => remindUnseenAction(orgId, updateId)}
        title="Not seen yet" description="People this was for who haven’t opened Updates since it was posted." emptyLine="Everyone has seen it." />
}

/** What a post card knows about the organization feed it sits in (report §37.3). */
export type OrgCardView = { org: OrgFeedInfo; workspaceTitles: Map<string, string> }

/** The card's audience label in the organization's words (report §37.3). */
export function cardAudienceLabel(view: OrgCardView, post: { audience: UpdateAudience; visibility: string }) {
    return audienceLabel(post, view.org.roleNames ?? DEFAULT_ROLES, view.workspaceTitles)
}

/** Change who sees a post (report §37.3): widening asks first; narrowing applies at once with a line about memory. */
export function ChangeAudienceDialog({ view, orgId, updateId, current, open, onOpenChange }: {
    view: OrgCardView
    orgId: string
    updateId: string
    current: { audience: UpdateAudience; visibility: 'members' | 'public' }
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const client = useQueryClient()
    const [next, setNext] = useState({ audience: current.audience, isPublic: current.visibility === 'public' })
    const [askWider, setAskWider] = useState(false)
    const [busy, setBusy] = useState(false)
    const save = async (confirmedWider: boolean) => {
        setBusy(true)
        const r = await setOrgUpdateAudienceAction(orgId, updateId, { audience: next.audience, visibility: next.isPublic ? 'public' : 'members' }, confirmedWider).finally(() => setBusy(false))
        if (!r.success && r.error === 'wider') return void setAskWider(true)
        if (!r.success) return void toast.error(r.error)
        toast.success(r.change === 'narrower' ? 'Audience narrowed. People who already saw it may remember it.' : 'Audience changed')
        setAskWider(false)
        onOpenChange(false)
        void client.invalidateQueries({ queryKey: ['project'] })
    }
    const label = audienceLabel({ audience: next.audience, visibility: next.isPublic ? 'public' : 'members' }, view.org.roleNames ?? DEFAULT_ROLES, view.workspaceTitles)
    return (
        <Dialog open={open} onOpenChange={(o) => { setAskWider(false); onOpenChange(o) }}>
            <DialogContent onClick={(e) => e.stopPropagation()}>
                <DialogHeader>
                    <DialogTitle>Who sees this</DialogTitle>
                    <DialogDescription>Narrowing applies at once. Widening asks you first.</DialogDescription>
                </DialogHeader>
                <AudienceMenu org={view.org} value={next} label={label} onChange={(v) => { setAskWider(false); setNext(v) }} />
                {askWider ? <p role="alert" className="text-sm">More people will see this, and they’ll be able to open it now. Change it?</p> : null}
                <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button size="sm" disabled={busy} onClick={() => void save(askWider)}>{askWider ? 'Yes, widen it' : 'Save'}</Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

const FILTERS: Array<{ value: OrgFeedFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'announcement', label: 'Announcements' },
    { value: 'discussion', label: 'Discussions' },
    { value: 'from_projects', label: 'From workspaces' },
]

/** The empty title when a filter has nothing (report §7.5). */
export const FILTER_EMPTY: Record<OrgFeedFilter, string> = {
    all: 'No announcements yet',
    announcement: 'No announcements yet',
    discussion: 'No discussions yet',
    from_projects: 'Nothing shared from workspaces yet',
}

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
