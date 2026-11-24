'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { BadgeCheck, ChevronRight, Pencil, Pin, X } from 'lucide-react'

import { acceptOrgInviteAction, declineOrgInviteAction } from '@/app/actions/org-members'
import { Button } from '@/components/ui/button'
import { useRefreshSidebar } from '@/hooks/useRefreshSidebar'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { toast } from '@/lib/feedback'
import { orgStatusTone } from '@/lib/organizations/display'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from '@/lib/utils/date'
import WorkspaceAvatar from '@/components/workspaces/WorkspaceAvatar'

// The organization's shared parts (org design plan, Task 2): one look for each thing that used to be drawn several ways.

/** A system status (spec §10 Badge): 11px mono, 3px corners, the tone of what the state means. */
export function StatusBadge({ state, children, className }: { state: string; children: ReactNode; className?: string }) {
    return <span className={cn('nb-status shrink-0', className)} data-tone={orgStatusTone(state)}>{children}</span>
}

/** The one verified mark: Lucide BadgeCheck in clay, named for screen readers, with its label visible on request. */
export function VerifiedMark({ label, size = 16, className }: { label?: string | null; size?: 14 | 16 | 18; className?: string }) {
    const name = label ?? 'Verified organization'
    return (
        <span className={cn('inline-flex shrink-0 items-center align-middle text-primary', className)} title={name}>
            <BadgeCheck style={{ width: size, height: size }} aria-hidden="true" />
            <span className="sr-only">{name}</span>
        </span>
    )
}

/** The join code wherever it shows: 24px mono, spaced, selectable, read letter by letter. */
export function JoinCode({ code, className }: { code: string; className?: string }) {
    return <span className={cn('select-all font-mono text-2xl font-semibold tracking-[0.2em] text-foreground', className)} aria-label={`Join code ${code.split('').join(' ')}`}>{code}</span>
}

type People = { success: true; people: Array<{ id: string; name: string; avatarUrl?: string | null }> } | { success: false; error: string }
type Reminded = { success: true; reminded: number; skipped?: number } | { success: false; error: string }

/**
 * "Seen by 32 of 40" on an announcement and "Read by 32 of 40" on a document (decision 58): one dialog listing who
 * hasn't, with Remind. `verb` is the word on the trigger.
 */
export function NotYetDialog({ verb, done, total, queryKey, load, remind, title, description, emptyLine }: {
    verb: 'Seen' | 'Read'
    done: number
    total: number
    queryKey: readonly unknown[]
    load: () => Promise<People>
    remind: () => Promise<Reminded>
    title: string
    description: string
    emptyLine: string
}) {
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    const query = useQuery({ queryKey, queryFn: load, enabled: open })
    const list = query.data?.success ? query.data.people : []
    const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`
    const send = async () => {
        setBusy(true)
        const r = await remind().finally(() => setBusy(false))
        if (!r.success) return void toast.error(r.error)
        toast.success([`Reminded ${people(r.reminded)}`, r.skipped ? `${r.skipped} reminded in the last 12 hours` : null].filter(Boolean).join(' · '))
        setOpen(false)
    }
    return (
        <>
            <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true) }} className="nb-meta tabular-nums underline-offset-4 hover:text-foreground hover:underline">
                {verb} by {done} of {total}
            </button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent onClick={(e) => e.stopPropagation()}>
                    <DialogHeader>
                        <DialogTitle>{title}</DialogTitle>
                        <DialogDescription>{description}</DialogDescription>
                    </DialogHeader>
                    {query.isPending ? (
                        <div role="status" aria-label="Loading people" className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="nb-skeleton h-7 rounded-md" />)}</div>
                    ) : query.data && !query.data.success ? (
                        <p role="alert" className="text-[13px] text-destructive">{query.data.error}</p>
                    ) : list.length === 0 ? <p className="text-[13px] text-muted-foreground">{emptyLine}</p> : (
                        <ul className="max-h-72 space-y-1.5 overflow-y-auto text-[13px]">
                            {list.map((p) => (
                                <li key={p.id} className="flex items-center gap-2">
                                    <UserAvatar identity={{ id: p.id, fullName: p.name, avatarUrl: p.avatarUrl ?? null }} size={26} />
                                    <span className="truncate">{p.name}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    <DialogFooter paper>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
                        {list.length ? <Button type="button" disabled={busy} onClick={() => void send()}>Remind {people(list.length)}</Button> : null}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}

/**
 * Answering an organization invite, the same way in the header, on a private organization's page and in My work or
 * Network: Accept says "You joined X"; Decline hides it at once with Undo for 5 seconds, then sends.
 */
export function useInviteAnswer(onDone?: () => void) {
    const router = useRouter()
    const refreshSidebar = useRefreshSidebar()
    const [pending, start] = useTransition()
    const [hidden, setHidden] = useState<Set<string>>(new Set())
    const show = (id: string, on: boolean) => setHidden((cur) => { const next = new Set(cur); if (on) next.delete(id); else next.add(id); return next })
    const accept = (invite: { id: string; orgTitle: string }) => start(async () => {
        const r = await acceptOrgInviteAction(invite.id).catch(() => ({ success: false as const, error: 'Couldn’t do that. Try again.' }))
        if (!r.success) return void toast.error(r.error)
        toast.success(`You joined ${invite.orgTitle}`)
        refreshSidebar()
        onDone?.()
        router.refresh()
    })
    // Audit 2.9: declining happens at once (closing the tab can't lose it). The invite is deleted, so there's no Undo:
    // the toast says how to get it back.
    const decline = (invite: { id: string; orgTitle: string }) => start(async () => {
        show(invite.id, false)
        const r = await declineOrgInviteAction(invite.id).catch(() => ({ success: false as const, error: 'Couldn’t do that. Try again.' }))
        if (!r.success) { show(invite.id, true); return void toast.error(r.error ?? 'Couldn’t decline it.') }
        toast.info(`Declined ${invite.orgTitle}. Ask them to invite you again if you change your mind.`)
        onDone?.()
    })
    return { accept, decline, hidden, pending }
}

/** A main-column card with its own header (spec §19: main content cards keep their header hierarchy; 20px inset). */
export function OrgCard({ title, action, children, className, bodyClassName, testId }: { title: string; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; testId?: string }) {
    const id = `org-card-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    return (
        <section aria-labelledby={id} className={cn('min-w-0 rounded-lg border border-border bg-card', className)} data-testid={testId}>
            <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-5 py-2.5">
                <h2 id={id} className="nb-card-title min-w-0 truncate text-foreground" title={title}>{title}</h2>
                {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
            </header>
            <div className={cn('p-5', bodyClassName)}>{children}</div>
        </section>
    )
}

/** Up to 4 square faces, then "+N" (spec §10 AvatarStack: 26px, −6px overlap). */
export function AvatarStack({ people, total, max = 4, size = 26 }: { people: Array<{ id: string; name: string; avatarUrl?: string | null }>; total?: number; max?: number; size?: 20 | 26 }) {
    const shown = people.slice(0, max)
    const more = (total ?? people.length) - shown.length
    return (
        <span className="flex items-center -space-x-1.5">
            {shown.map((p) => <UserAvatar key={p.id} identity={{ id: p.id, fullName: p.name, avatarUrl: p.avatarUrl ?? null }} size={size} className="ring-2 ring-card" title={p.name} />)}
            {more > 0 ? <span className="nb-meta relative inline-flex items-center justify-center rounded-md bg-muted px-1 ring-2 ring-card" style={{ height: size, minWidth: size }}>+{more}</span> : null}
        </span>
    )
}

/** The one list row for workspaces (org spec §5.2): the whole row is the link, 26px mark, title, one quiet line, right side. */
export function WorkspaceRow({ href, title, coverImage, meta, end }: { href: string; title: string; coverImage?: string | null; meta?: ReactNode; end?: ReactNode }) {
    return (
        <Link href={href} className="-mx-2 flex min-h-11 min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted">
            <WorkspaceAvatar project={{ title, coverImage: coverImage ?? null }} size="row" placeholder />
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-foreground">{title}</span>
                {meta ? <span className="block truncate text-[12px] text-muted-foreground">{meta}</span> : null}
            </span>
            {end ?? <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        </Link>
    )
}

/** The welcome note, the same on Overview and About: a card with the note, and × or Edit for whoever may. */
export function WelcomeNote({ note, onClose, editHref, children, testId }: { note?: string | null; onClose?: () => void; editHref?: string; children?: ReactNode; testId?: string }) {
    return (
        <section aria-label="Welcome note" className="rounded-lg border border-border bg-card p-5" data-testid={testId}>
            <div className="flex items-start justify-between gap-3">
                <h2 className="nb-card-title text-foreground">Welcome</h2>
                {onClose ? <Button type="button" variant="ghost" size="icon-sm" className="nb-touch-target -mr-1.5 -mt-1 text-muted-foreground" aria-label="Hide welcome note" onClick={onClose}><X className="size-4" aria-hidden="true" /></Button> : null}
                {editHref ? <Button asChild variant="ghost" size="icon-sm" className="nb-touch-target -mr-1.5 -mt-1 text-muted-foreground"><Link href={editHref} aria-label="Edit welcome note"><Pencil className="size-4" aria-hidden="true" /></Link></Button> : null}
            </div>
            {note ? <p className="nb-body mt-1.5 max-w-[64ch] whitespace-pre-line text-foreground">{note}</p> : null}
            {children}
        </section>
    )
}

/** A pinned announcement, the same on the org's Overview and a child workspace's Updates. */
export function PinnedLine({ href, orgTitle, author, content, at, unread, end, testId }: { href: string; orgTitle?: string; author?: { name: string; avatarUrl: string | null }; content: string; at?: string | null; unread?: boolean; end?: ReactNode; testId?: string }) {
    return (
        <div className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-md border border-border bg-muted px-3" data-testid={testId}>
            <Pin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {author ? <UserAvatar identity={{ fullName: author.name, avatarUrl: author.avatarUrl }} size={20} title={author.name} /> : null}
            <Link href={href} className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-foreground hover:underline">
                {orgTitle ? <span className="shrink-0 font-medium">{orgTitle}</span> : null}
                <span className="min-w-0 truncate">{content}</span>
            </Link>
            {unread ? <StatusBadge state="new">New</StatusBadge> : null}
            {at ? <time dateTime={at} className="nb-meta shrink-0 max-sm:hidden">{formatDistanceToNow(new Date(at), { addSuffix: true })}</time> : null}
            {end}
        </div>
    )
}

/** A folder trail (spec §10 Breadcrumbs): 13px labels, a mono slash between, the current place strong. */
export function Crumbs({ label, items, onGo }: { label: string; items: Array<{ key: string; name: string }>; onGo: (index: number) => void }) {
    return (
        <nav aria-label={label}>
            <ol className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
                {items.map((item, index) => {
                    const last = index === items.length - 1
                    return (
                        <li key={item.key} className="flex min-w-0 items-center gap-x-1.5">
                            {index > 0 ? <span aria-hidden="true" className="font-mono">/</span> : null}
                            {last ? <span aria-current="location" className="truncate font-medium text-foreground">{item.name}</span>
                                : <button type="button" onClick={() => onGo(index)} className="truncate hover:text-foreground hover:underline">{item.name}</button>}
                        </li>
                    )
                })}
            </ol>
        </nav>
    )
}
