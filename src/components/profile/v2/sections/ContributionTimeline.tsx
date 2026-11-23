'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, Eye, EyeOff, Globe, MoreHorizontal, Pencil, Pin, PinOff, Plus } from 'lucide-react'
import { setContributionTimelineOrderAction } from '@/app/actions/profile-mix'
import { SettingsSwitch } from '@/components/settings/ui/SettingsSwitch'
import { previewText } from '@/lib/profile/contribution-editor-text'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ItemMenu } from '@/components/reports/ItemMenu'
import { WorkspaceAvatar } from '@/components/workspaces/WorkspaceAvatar'
import { ContributionStoryView } from '@/components/profile/ContributionStoryView'
import { toast } from '@/lib/feedback'
import { cn } from '@/lib/utils'
import { dismissContributionNudgeAction } from '@/app/actions/org-profile'
import { entryStatus, groupProfileContributions } from '@/lib/organizations/profile-rules'
import { contributionDate, contributionKind, filterCounts, orderContributions, type ContributionKind } from '@/lib/profile/mix'
import { profileEditHref } from '@/lib/profile/edit-route'
import type { ProfileCollaborationContribution } from '@/lib/profile/collaboration'
import { runContributionCommand } from '../contribution-actions'

type Entry = ProfileCollaborationContribution & { children?: ProfileCollaborationContribution[] }
type Filter = 'all' | ContributionKind
const PAGE = 10
const KIND_LABEL: Record<ContributionKind, string> = { org: 'Organization', workspace: 'Workspace', outside: 'Outside project' }

/** The story's first lines as plain text, for the compact Recent work cards. */
function plainSummary(c: ProfileCollaborationContribution) {
    const raw = c.presentation?.summary ?? c.description ?? ''
    return previewText(raw.split(/\n\s*\n/)[0] ?? '', c.resolvedReferences ?? []).trim()
}

/**
 * Contributions as a timeline (spec: Contributions): a date column, the org tree's thread, one card per entry. The
 * pinned entry comes first and larger; organizations carry their workspaces; the owner gets Pin, Hide and Edit in ⋯,
 * visitors get Report. `recent` is Overview's "Recent work": the pinned entry and the newest, compact.
 */
export function ContributionTimeline({
    contributions,
    isOwner,
    profileId,
    variant = 'full',
    onSeeAll,
    onEdit,
    onChanged,
    onProjectIntent,
    mode = 'profile',
    onAddOutside,
}: {
    contributions: Entry[]
    isOwner: boolean
    profileId?: string
    variant?: 'full' | 'recent'
    onSeeAll?: () => void
    /** Opens Edit profile → Contributions, with this entry's panel open when an id is given. */
    onEdit?: (contributionId?: string) => void
    onChanged?: () => void
    onProjectIntent?: (href: string) => void
    /** Edit profile › Contributions: each card shows its status and its own Show on profile, Pin and Edit. */
    mode?: 'profile' | 'edit'
    onAddOutside?: () => void
}) {
    const editing = mode === 'edit'
    const [live, setLive] = useState(contributions)
    const [filter, setFilter] = useState<Filter>('all')
    const [limit, setLimit] = useState(PAGE)
    const [draftsOpen, setDraftsOpen] = useState(mode === 'edit')
    const [dismissed, setDismissed] = useState<Set<string>>(new Set())
    useEffect(() => setLive(contributions), [contributions])
    const latest = useRef(live)
    latest.current = live
    // Come back to the tab after editing: the profile shows the latest published entries.
    useEffect(() => {
        if (!profileId) return
        let cancelled = false
        const refresh = async () => {
            try {
                const response = await fetch(`/api/v1/profiles/${encodeURIComponent(profileId)}/contributions?limit=50&stageLimit=20`, { cache: 'no-store' })
                if (!response.ok) return
                const body = await response.json()
                if (!cancelled && body.data?.contributions) setLive(body.data.contributions)
            } catch { /* keep what is shown */ }
        }
        const focus = () => { void refresh() }
        window.addEventListener('focus', focus)
        return () => { cancelled = true; window.removeEventListener('focus', focus) }
    }, [profileId])

    const visible = useMemo(() => live.filter((c) => isOwner || c.visibility === 'public'), [live, isOwner])
    const groups = useMemo(() => groupProfileContributions(visible, isOwner), [visible, isOwner])
    const ordered = useMemo(() => orderContributions([...groups.organizations, ...groups.workspaces]) as Entry[], [groups])
    const counts = filterCounts(ordered)

    const patch = (id: string, change: Partial<ProfileCollaborationContribution>) => setLive((list) => list.map((c) => c.id === id ? { ...c, ...change } : c))
    const command = async (c: Entry, operation: 'feature' | 'hide' | 'publish', fromUndo = false): Promise<void> => {
        const before = { featured: c.featured, visibility: c.visibility }
        if (operation === 'feature') patch(c.id, { featured: !c.featured })
        else patch(c.id, { visibility: operation === 'hide' ? 'private' : 'public' })
        const result = await runContributionCommand(c, operation)
        if (!result.success) {
            patch(c.id, before)
            toast.error(result.error || 'Couldn’t update this contribution', operation === 'publish' && onEdit ? { action: { label: 'Open the editor', onClick: () => onEdit(c.id) } } : undefined)
            return
        }
        patch(c.id, { version: result.version })
        const message = operation === 'feature' ? (c.featured ? 'Unpinned.' : 'Pinned. It shows first, with its picture.') : operation === 'hide' ? 'Hidden from your profile. Your words are kept.' : 'Back on your profile.'
        // In the editor these save at once, so each one can be undone from its toast.
        const undo = editing && !fromUndo ? { action: { label: 'Undo', onClick: () => {
            const now = latest.current.find((x) => x.id === c.id)
            if (now) void command(now, operation === 'feature' ? 'feature' : operation === 'hide' ? 'publish' : 'hide', true)
        } } } : undefined
        toast.success(message, undo)
        onChanged?.()
    }

    // Move up / Move down among the entries that aren't pinned (pinned ones always come first).
    const movable = ordered.filter((c) => !c.featured)
    const move = async (c: Entry, by: -1 | 1) => {
        const from = movable.findIndex((x) => x.id === c.id), to = from + by
        if (from < 0 || to < 0 || to >= movable.length) return
        const next = [...movable]
        next.splice(to, 0, next.splice(from, 1)[0]!)
        const before = new Map(live.map((x) => [x.id, x.timelineOrder]))
        setLive((list) => list.map((x) => { const i = next.findIndex((n) => n.id === x.id); return i < 0 ? x : { ...x, timelineOrder: i } }))
        const result = await setContributionTimelineOrderAction(next.map((x) => x.id))
        if (!result.success) {
            setLive((list) => list.map((x) => ({ ...x, timelineOrder: before.get(x.id) ?? null })))
            toast.error(result.error)
            return
        }
        onChanged?.()
    }

    const item = (c: Entry, compact: boolean, nested = false) => {
        // Member settings §3: after a reopen or rejoin the date shows the current period; earlier ones list below.
        const date = contributionDate({ ...c, startDate: c.currentSince ?? c.startDate })
        const kind = contributionKind(c)
        const pinned = Boolean(c.featured) && !compact
        const hidden = isOwner && c.visibility === 'private'
        const people = (c.resolvedReferences ?? []).filter((r) => r.kind === 'person' && r.available)
        const status = entryStatus(c)
        const title = c.projectHref && c.projectHref.startsWith('/')
            ? <Link href={c.projectHref} onMouseEnter={() => onProjectIntent?.(c.projectHref!)} className="hover:underline">{c.projectTitle}</Link>
            : <span>{c.projectTitle}</span>
        const menu = isOwner ? (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button type="button" className="nb-pf-ib" aria-label={`More for ${c.projectTitle}`}><MoreHorizontal className="size-4" /></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onSelect={() => void command(c, 'feature')}>{c.featured ? <PinOff className="size-4" /> : <Pin className="size-4" />}{c.featured ? 'Unpin' : 'Pin to the top'}</DropdownMenuItem>
                    {!c.featured && !nested && movable[0]?.id !== c.id ? <DropdownMenuItem onSelect={() => void move(c, -1)}><ArrowUp className="size-4" />Move up</DropdownMenuItem> : null}
                    {!c.featured && !nested && movable.at(-1)?.id !== c.id ? <DropdownMenuItem onSelect={() => void move(c, 1)}><ArrowDown className="size-4" />Move down</DropdownMenuItem> : null}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void command(c, hidden ? 'publish' : 'hide')}>{hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}{hidden ? 'Show on profile' : 'Hide from profile'}</DropdownMenuItem>
                    {onEdit ? <DropdownMenuItem onSelect={() => onEdit(c.id)}><Pencil className="size-4" />Edit</DropdownMenuItem> : null}
                </DropdownMenuContent>
            </DropdownMenu>
        ) : (
            <ItemMenu label={`More for ${c.projectTitle}`} className="nb-pf-ib" report={{ kind: 'contribution', targetId: c.id, noun: 'contribution story' }} />
        )
        const state = hidden ? 'Hidden' : c.draftStory && JSON.stringify(c.draftStory) !== JSON.stringify(c.presentation ?? null) ? 'Draft changes' : 'Published'
        const chip = <span className={cn('nb-pf-st', state === 'Published' ? 'is-pub' : state === 'Hidden' ? 'is-hid' : 'is-drf')}>{state}</span>
        const bar = (
            <div className="nb-pf-cbar">
                <label className="nb-pf-switchrow">
                    <SettingsSwitch aria-label={`Show ${c.projectTitle} on profile`} checked={!hidden} onCheckedChange={(on) => void command(c, on ? 'publish' : 'hide')} />
                    Show on profile
                </label>
                <button type="button" className="nb-pf-btn-sm is-ghost" aria-pressed={Boolean(c.featured)} onClick={() => void command(c, 'feature')}><Pin className="size-3.5" aria-hidden="true" />{c.featured ? 'Pinned' : 'Pin'}</button>
                {onEdit ? <button type="button" className="nb-pf-btn-sm" onClick={() => onEdit(c.id)} aria-label={`Edit ${c.projectTitle}`}><Pencil className="size-3.5" aria-hidden="true" />Edit</button> : null}
            </div>
        )
        const card = (
            <article className={cn('nb-pf-tl-card', editing && 'is-edit')}>
                <div className="nb-pf-tl-top">
                    <WorkspaceAvatar project={{ title: c.projectTitle, coverImage: c.projectCoverImage ?? null }} size="row" placeholder className={pinned ? 'size-10 rounded-[6px]' : 'size-8 rounded-[6px]'} />
                    <span className="nb-pf-tl-t"><b>{title}</b>{c.title ? <span className="role">{c.title}</span> : null}</span>
                    <span className="nb-pf-tl-tools">
                        {editing ? chip : <>
                            {c.featured ? <span className="nb-pf-flag"><Pin className="size-3" aria-hidden="true" />Pinned</span> : null}
                            {hidden ? <span className="nb-pf-flag"><EyeOff className="size-3" aria-hidden="true" />Hidden</span> : null}
                            {menu}
                        </>}
                    </span>
                </div>
                <p className="nb-pf-tl-sub">
                    <span>{KIND_LABEL[kind]}</span>
                    {kind === 'org' && c.orgVerified ? <span className="ok" title={`Verified by ${c.verifiedByName ?? c.projectTitle}`}>✓ Verified</span> : null}
                    {c.parentOrg && !nested ? <span>Workspace of {c.parentOrg.title}</span> : null}
                    {status ? <span>{status}</span> : null}
                    {isOwner && c.verificationRevokedReason ? <span>Verification removed: {c.verificationRevokedReason}</span> : null}
                </p>
                {c.endNote || c.endedByName || c.confirmedByName ? (
                    <p className="nb-pf-tl-sub" data-testid="completion-line">
                        {c.endNote ? <span>&ldquo;{c.endNote}&rdquo;</span> : null}
                        {c.endedByName ? <span>Marked completed by {c.endedByName}</span> : null}
                        {c.confirmedByName ? <span>Confirmed by {c.confirmedByName}</span> : null}
                    </p>
                ) : null}
                {!compact && c.earlierPeriods?.length ? (
                    <p className="nb-pf-tl-sub" data-testid="earlier-periods">
                        {c.earlierPeriods.map((p) => (
                            <span key={`${p.startDate}-${p.endDate}`}>{contributionDate({ startDate: p.startDate, endDate: p.endDate }).sub || p.endDate} · {p.reason === 'left' ? 'Left' : p.reason === 'removed' ? 'Removed' : 'Completed'}</span>
                        ))}
                    </p>
                ) : null}
                {compact || editing ? (
                    plainSummary(c) ? <p className={cn('nb-pf-tl-story', editing && 'clamp2')}>{plainSummary(c)}</p> : null
                ) : (
                    <ContributionStoryView contribution={{ ...c, draftStory: null }} onProjectIntent={onProjectIntent} bare />
                )}
                {!compact && people.length ? (
                    <p className="nb-pf-with">with
                        <span className="faces" aria-hidden="true">{people.slice(0, 3).map((p) => <UserAvatar key={p.id} identity={{ fullName: p.label }} className="size-5" roundedClassName="rounded-[4px]" sizes="20px" />)}</span>
                        {people.map((p, i) => <span key={p.id}>{i ? (i === people.length - 1 ? ' and ' : ', ') : ' '}{p.href ? <Link href={p.href}>{p.label}</Link> : p.label}</span>)}
                    </p>
                ) : null}
                {!compact && c.children?.length ? (
                    <div className="nb-pf-kids" aria-label={`Workspaces in ${c.projectTitle}`}>
                        {c.children.map((k) => (
                            <div key={k.id} className="nb-pf-kid">
                                <WorkspaceAvatar project={{ title: k.projectTitle, coverImage: k.projectCoverImage ?? null }} size="row" placeholder className="size-6 rounded-[5px]" />
                                {k.projectHref ? <Link href={k.projectHref} className="hover:underline"><b>{k.projectTitle}</b></Link> : <b>{k.projectTitle}</b>}
                                <span className="r">{k.title}</span>
                                {editing && onEdit ? <button type="button" className="nb-pf-link" onClick={() => onEdit(k.id)} aria-label={`Edit ${k.projectTitle}`}>Edit</button> : null}
                            </div>
                        ))}
                    </div>
                ) : null}
                {editing ? bar : null}
                {!compact && c.workRecord ? <p className="nb-pf-tl-sub" data-testid="work-record">Work record: {c.workRecord.done} of {c.workRecord.total} assignments · {c.workRecord.sprints} {c.workRecord.sprints === 1 ? 'sprint' : 'sprints'}</p> : null}
            </article>
        )
        return (
            <li key={c.id} className={cn('nb-pf-tli', pinned && 'is-pinned', hidden && 'is-hidden')}>
                <div className="nb-pf-tl-date">
                    {date.now ? <span className="now">Now</span> : <span className="yr">{date.top}</span>}
                    {date.sub ? <span>{date.now ? <><span className="since">Since </span>{date.sub.replace(/^Since /, '')}</> : date.sub}</span> : null}
                </div>
                <div className="nb-pf-tl-node" aria-hidden="true"><i className={date.now ? 'on' : undefined} /></div>
                {card}
            </li>
        )
    }

    if (variant === 'recent') {
        const top = ordered.filter((c) => c.visibility !== 'private').slice(0, 2)
        return (
            <section className="nb-pf-sec" aria-labelledby="pf-recent-h">
                <h2 id="pf-recent-h" className="nb-pf-label has-rule">Recent work{ordered.length ? <> · <b>{top.length} of {ordered.length}</b></> : null}</h2>
                {top.length ? (
                    <>
                        <ol className="nb-pf-tl">{top.map((c) => item(c, true))}</ol>
                        <button type="button" className="nb-pf-link justify-self-start" onClick={onSeeAll}>See all {ordered.length} contributions →</button>
                    </>
                ) : empty()}
            </section>
        )
    }

    function empty() {
        if (editing) return (
            <div className="nb-pf-empty">
                <b>No contributions yet</b>
                <span>They appear when you join a workspace. You can also add an outside project you worked on.</span>
            </div>
        )
        return isOwner ? (
            <div className="nb-pf-empty">
                <b>Show what you worked on</b>
                <span>Write about your role in a workspace or an outside project. It shows here, newest first.</span>
                {onEdit ? <Button size="sm" onClick={() => onEdit()}><Plus className="size-3.5" />Add a contribution</Button> : null}
                <span className="nb-pf-only">Only you can see this until you add one</span>
            </div>
        ) : (
            <div className="nb-pf-empty"><b>No contributions yet</b><span>Nothing has been published here yet.</span></div>
        )
    }

    const shown = ordered.filter((c) => filter === 'all' || contributionKind(c) === filter)
    const drafts = groups.drafts.flatMap((d) => [d, ...d.children])
    return (
        <section className="nb-pf-sec" aria-labelledby="pf-contrib-h">
            <h2 id="pf-contrib-h" className="nb-pf-label has-rule">
                Contributions · <b>{ordered.length}</b>
                {isOwner && onEdit && !editing ? <button type="button" className="nb-pf-ed" onClick={() => onEdit()} aria-label="Edit contributions"><Pencil className="size-3.5" /></button> : null}
            </h2>
            {editing ? (
                <div className="nb-pf-enote">
                    <Globe className="size-3.5" aria-hidden="true" />
                    <span><b>Show on profile</b> and <b>Pin</b> save right away, with Undo. Your writing saves on its own: a private draft first, then <b>Publish updates</b>. Visitors see your last published version.</span>
                    {onAddOutside ? <button type="button" className="nb-pf-btn-sm" onClick={onAddOutside}><Plus className="size-3.5" aria-hidden="true" />Add outside project</button> : null}
                </div>
            ) : null}
            {ordered.length ? (
                <>
                    <div className="nb-pf-filters" role="group" aria-label="Show contributions">
                        {([['all', 'All', counts.all], ['org', 'Organizations', counts.org], ['workspace', 'Workspaces', counts.workspace], ['outside', 'Outside projects', counts.outside]] as const).map(([key, label, n]) => (
                            <button key={key} type="button" className="nb-pf-fchip" aria-pressed={filter === key} onClick={() => { setFilter(key); setLimit(PAGE) }}>{label}<span className="n">{n}</span></button>
                        ))}
                    </div>
                    {shown.length ? <ol className="nb-pf-tl">{shown.slice(0, limit).map((c) => item(c, false))}</ol> : <p className="nb-compact text-muted-foreground">Nothing here yet.</p>}
                    {shown.length > limit ? (
                        <button type="button" className="nb-pf-showmore" onClick={() => setLimit((n) => n + PAGE)}>
                            Show {Math.min(PAGE, shown.length - limit)} more <span>{limit} of {shown.length}</span>
                        </button>
                    ) : null}
                </>
            ) : editing && drafts.length ? null : empty()}
            {isOwner && drafts.length ? (
                draftsOpen ? (
                    <section className="nb-pf-panel nb-pf-drafts" aria-label="Not on your profile yet">
                        <h3 className="nb-pf-label">Not on your profile yet · <b>{drafts.length}</b>
                            <button type="button" className="nb-pf-ib ml-auto" onClick={() => setDraftsOpen(false)} aria-label="Hide drafts">×</button></h3>
                        {drafts.map((c) => {
                            const nudge = (c.projectKind === 'organization' || c.parentOrg) && !c.nudgeDismissed && !dismissed.has(c.id)
                            const href = profileEditHref('experience', 'overview', { contribution: c.id })
                            return (
                                <div key={c.id} className="nb-pf-draft">
                                    <WorkspaceAvatar project={{ title: c.projectTitle, coverImage: c.projectCoverImage ?? null }} size="row" placeholder className="size-6 rounded-[5px]" />
                                    <span className="min-w-0"><b>{c.projectTitle}</b><span className="s">Draft{nudge ? ' · write about your work' : ''}</span>{editing && plainSummary(c) ? <span className="s clamp2">{plainSummary(c)}</span> : null}</span>
                                    <span className="a">
                                        {editing && onEdit ? <button type="button" className="nb-pf-btn-sm" onClick={() => onEdit(c.id)} aria-label={`Write about ${c.projectTitle}`}>Write about it</button> : <a href={href} className="nb-pf-btn-sm">Write about it</a>}
                                        {nudge ? <button type="button" className="nb-pf-ib" aria-label={`Dismiss ${c.projectTitle}`} onClick={() => { setDismissed((d) => new Set(d).add(c.id)); void dismissContributionNudgeAction(c.id) }}>×</button> : null}
                                    </span>
                                </div>
                            )
                        })}
                    </section>
                ) : (
                    <button type="button" className="nb-pf-drafts-row" onClick={() => setDraftsOpen(true)}>
                        <EyeOff className="size-4" aria-hidden="true" /><span><span className="c">{drafts.length}</span> {drafts.length === 1 ? 'workspace isn’t' : 'workspaces aren’t'} on your profile yet</span><span className="go">Review<ChevronDown className="size-3.5" /></span>
                    </button>
                )
            ) : null}
            {groups.privateToYou.length ? (
                <div className="nb-pf-panel nb-pf-drafts" aria-label="Private to you">
                    <h3 className="nb-pf-label">Private to you</h3>
                    {groups.privateToYou.map((c) => (
                        <div key={c.id} className="nb-pf-draft">
                            <EyeOff className="size-4 text-muted-foreground" aria-hidden="true" />
                            <span className="min-w-0"><b>{c.projectTitle}</b><span className="s">Removed{c.endDate ? ` ${c.endDate}` : ''} · only you can see this; your words are kept</span></span>
                        </div>
                    ))}
                </div>
            ) : null}
        </section>
    )
}
