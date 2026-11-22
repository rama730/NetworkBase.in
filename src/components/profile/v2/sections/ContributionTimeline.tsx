'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Eye, EyeOff, MoreHorizontal, Pencil, Pin, PinOff, Plus } from 'lucide-react'
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
    const labels = new Map((c.resolvedReferences ?? []).map((r) => [`${r.kind}:${r.id}`, r.label]))
    return raw
        .replace(/\{%\s*ref\.(\w+)\s+id="([^"]+)"\s*%\}/g, (_m, kind, id) => labels.get(`${kind}:${id}`) ?? '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#>]/g, '')
        .split(/\n\s*\n/)[0]!.trim()
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
}) {
    const [live, setLive] = useState(contributions)
    const [filter, setFilter] = useState<Filter>('all')
    const [limit, setLimit] = useState(PAGE)
    const [draftsOpen, setDraftsOpen] = useState(false)
    const [dismissed, setDismissed] = useState<Set<string>>(new Set())
    useEffect(() => setLive(contributions), [contributions])
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
    const command = async (c: Entry, operation: 'feature' | 'hide' | 'publish') => {
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
        toast.success(operation === 'feature' ? (c.featured ? 'Unpinned.' : 'Pinned. It shows first, with its picture.') : operation === 'hide' ? 'Hidden from your profile. Your words are kept.' : 'Back on your profile.')
        onChanged?.()
    }

    const item = (c: Entry, compact: boolean, nested = false) => {
        const date = contributionDate(c)
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
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void command(c, hidden ? 'publish' : 'hide')}>{hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}{hidden ? 'Show on profile' : 'Hide from profile'}</DropdownMenuItem>
                    {onEdit ? <DropdownMenuItem onSelect={() => onEdit(c.id)}><Pencil className="size-4" />Edit</DropdownMenuItem> : null}
                </DropdownMenuContent>
            </DropdownMenu>
        ) : (
            <ItemMenu label={`More for ${c.projectTitle}`} className="nb-pf-ib" report={{ kind: 'contribution', targetId: c.id, noun: 'contribution story' }} />
        )
        const card = (
            <article className="nb-pf-tl-card">
                <div className="nb-pf-tl-top">
                    <WorkspaceAvatar project={{ title: c.projectTitle, coverImage: c.projectCoverImage ?? null }} size="row" placeholder className={pinned ? 'size-10 rounded-[6px]' : 'size-8 rounded-[6px]'} />
                    <span className="nb-pf-tl-t"><b>{title}</b>{c.title ? <span className="role">{c.title}</span> : null}</span>
                    <span className="nb-pf-tl-tools">
                        {c.featured ? <span className="nb-pf-flag"><Pin className="size-3" aria-hidden="true" />Pinned</span> : null}
                        {hidden ? <span className="nb-pf-flag"><EyeOff className="size-3" aria-hidden="true" />Hidden</span> : null}
                        {menu}
                    </span>
                </div>
                <p className="nb-pf-tl-sub">
                    <span>{KIND_LABEL[kind]}</span>
                    {kind === 'org' && c.orgVerified ? <span className="ok" title={`Verified by ${c.verifiedByName ?? c.projectTitle}`}>✓ Verified</span> : null}
                    {c.parentOrg && !nested ? <span>Workspace of {c.parentOrg.title}</span> : null}
                    {status ? <span>{status}</span> : null}
                    {isOwner && c.verificationRevokedReason ? <span>Verification removed: {c.verificationRevokedReason}</span> : null}
                </p>
                {compact ? (
                    plainSummary(c) ? <p className="nb-pf-tl-story">{plainSummary(c)}</p> : null
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
                            </div>
                        ))}
                    </div>
                ) : null}
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
                {isOwner && onEdit ? <button type="button" className="nb-pf-ed" onClick={() => onEdit()} aria-label="Edit contributions"><Pencil className="size-3.5" /></button> : null}
            </h2>
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
            ) : empty()}
            {isOwner && drafts.length ? (
                draftsOpen ? (
                    <div className="nb-pf-panel nb-pf-drafts" aria-label="Not on your profile yet">
                        <h3 className="nb-pf-label">Not on your profile yet · <b>{drafts.length}</b>
                            <button type="button" className="nb-pf-ib ml-auto" onClick={() => setDraftsOpen(false)} aria-label="Hide drafts">×</button></h3>
                        {drafts.map((c) => {
                            const nudge = (c.projectKind === 'organization' || c.parentOrg) && !c.nudgeDismissed && !dismissed.has(c.id)
                            const href = profileEditHref('experience', 'overview', { contribution: c.id })
                            return (
                                <div key={c.id} className="nb-pf-draft">
                                    <WorkspaceAvatar project={{ title: c.projectTitle, coverImage: c.projectCoverImage ?? null }} size="row" placeholder className="size-6 rounded-[5px]" />
                                    <span className="min-w-0"><b>{c.projectTitle}</b><span className="s">Draft{nudge ? ' · write about your work' : ''}</span></span>
                                    <span className="a">
                                        <a href={href} className="nb-pf-btn-sm">Write about it</a>
                                        {nudge ? <button type="button" className="nb-pf-ib" aria-label={`Dismiss ${c.projectTitle}`} onClick={() => { setDismissed((d) => new Set(d).add(c.id)); void dismissContributionNudgeAction(c.id) }}>×</button> : null}
                                    </span>
                                </div>
                            )
                        })}
                    </div>
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
