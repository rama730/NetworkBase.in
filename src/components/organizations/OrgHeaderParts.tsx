'use client'

import { typeProfile } from '@/lib/organizations/type-profile'
import Link from 'next/link'
import { useRefreshSidebar } from '@/hooks/useRefreshSidebar'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { ChevronDown, ClipboardList, FolderKanban, IterationCcw, ListTodo, Megaphone, Plus } from '@/components/ui/icons'

import { cancelJoinRequestAction, joinPublicOrgAction, regenerateJoinCodeAction } from '@/app/actions/organizations'
import { JoinRequestNote } from '@/components/organizations/JoinOrgButton'
import { restoreOrgAction } from '@/app/actions/org-lifecycle'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { OrgInvitePanel } from '@/components/organizations/OrgInvitePanel'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { OrgDetail, ParentOrgLink } from '@/lib/organizations/detail'
import { formatInZone } from '@/lib/organizations/zoned-time'
import { Notice } from '@/components/ui/notice'
import { StatusBadge } from '@/components/organizations/org-ui'
import WorkspaceAvatar from '@/components/workspaces/WorkspaceAvatar'
import { toast } from '@/lib/feedback'

// The organization parts of the project header (report §18.1–18.2, §18.6). WorkspaceLayout keeps its layout;
// these fill the details, the archived line and the visitor's actions.

const MONTH = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' })
const month = (iso: string | null) => (iso ? MONTH.format(new Date(`${iso}T00:00:00`)) : null)

/** Under the header's buttons: `Part of Northgate · Bengaluru · Education · Term Aug 2026 – Dec 2026`. Nothing to say, no line. */
export function OrgHeaderDetails({ organization }: { organization: OrgDetail }) {
    const term = typeProfile(organization.type).termDates && (organization.termStart || organization.termEnd) ? `Term ${month(organization.termStart) ?? '…'} – ${month(organization.termEnd) ?? '…'}` : null
    const parts = [organization.partOf ? `Part of ${organization.partOf}` : null, organization.location, organization.typeLabel, term].filter(Boolean)
    if (parts.length === 0) return null
    return <p className="max-w-[280px] text-right text-[13px] leading-5 text-muted-foreground xl:max-w-[420px] max-md:max-w-none max-md:text-left" data-testid="org-header-details">{parts.join(' · ')}</p>
}

/** The archived line (report §18.6): the one notice for a lifecycle state. */
export function OrgArchivedNotice() {
    return <Notice className="mt-2">This organization is archived. Everything is read-only.</Notice>
}

/** Visitors on a public org: Join, Request to join, or Request pending with Cancel (report §18.2). */
export function OrgVisitorActions({ orgId, href, joinMode, requestPending, loggedIn }: {
    orgId: string
    href: string
    joinMode: 'instant' | 'approval'
    requestPending: boolean
    loggedIn: boolean
}) {
    const router = useRouter()
    const refreshSidebar = useRefreshSidebar()
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)

    if (!loggedIn) {
        return <Button asChild><Link href={`/login?redirect=${encodeURIComponent(href)}`}>{joinMode === 'approval' ? 'Request to join' : 'Join'}</Link></Button>
    }
    const run = (action: () => Promise<{ success: boolean; error?: string }>) =>
        startTransition(async () => {
            // Audit N37: a thrown server error is a message here, never the page's error boundary.
            const result = await action().catch(() => ({ success: false as const, error: 'Couldn’t do that. Try again.' }))
            if (!result.success) return setError(result.error ?? 'Something went wrong.')
            setError(null)
            refreshSidebar()
            router.refresh()
        })

    return (
        <span className="inline-flex items-center gap-2">
            {requestPending ? (
                <>
                    <StatusBadge state="requested">Requested</StatusBadge>
                    <JoinRequestNote orgId={orgId} />
                    <Button variant="ghost" disabled={pending} onClick={() => run(() => cancelJoinRequestAction(orgId))}>Cancel request</Button>
                </>
            ) : (
                <Button disabled={pending} onClick={() => run(() => joinPublicOrgAction(orgId))}>
                    {joinMode === 'approval' ? 'Request to join' : 'Join'}
                </Button>
            )}
            {error ? <span role="alert" className="text-[13px] text-destructive">{error}</span> : null}
        </span>
    )
}

/** Admins' Invite (report §7.11): the one invite panel in a dialog. */
export function OrgInviteDialog({ orgId, orgHandle, title, open, onOpenChange }: {
    orgId: string
    orgHandle: string | null
    title: string
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Invite people to {title}</DialogTitle>
                    <DialogDescription>Share the code or the link, or invite by email.</DialogDescription>
                </DialogHeader>
                {open ? <OrgInvitePanel orgId={orgId} orgHandle={orgHandle} /> : null}
            </DialogContent>
        </Dialog>
    )
}

/** Above a child workspace's title (spec §10 Breadcrumbs): the organization, a mono slash, then this workspace, strong. */
export function OrgBreadcrumb({ parentOrg, current }: { parentOrg: ParentOrgLink; current: string }) {
    const canOpen = Boolean(parentOrg.viewerRole) || parentOrg.isPublic
    return (
        <nav aria-label="Breadcrumb" className="mb-2.5" data-testid="child-org-breadcrumb">
            <ol className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
                <li className="min-w-0 truncate">{canOpen ? <Link href={`/org/${parentOrg.slug ?? parentOrg.id}`} className="hover:text-foreground hover:underline">{parentOrg.title}</Link> : parentOrg.title}</li>
                <li aria-hidden="true" className="font-mono">/</li>
                <li aria-current="page" className="min-w-0 truncate font-medium text-foreground">{current}</li>
            </ol>
        </nav>
    )
}

/**
 * Report §17.1: a chip only when something is unusual. Organization-only is the default, so only `Private` shows;
 * an organization admin who isn't on the team sees a small `Viewing as admin` (never the workspace's own people).
 */
export function ChildOrgChips({ parentOrg, visibility, archived, isWorkspaceMember }: { parentOrg: ParentOrgLink; visibility: string | null | undefined; archived: boolean; isWorkspaceMember: boolean }) {
    const visibilityChip = visibility === 'private' ? 'Private' : null
    const viewingAsAdmin = parentOrg.viewerIsInheritedAdmin && !isWorkspaceMember
    if (!visibilityChip && !viewingAsAdmin && !archived && !parentOrg.suspended) return null
    return (
        <p className="flex flex-wrap items-center gap-1.5" data-testid="child-org-chips">
            {visibilityChip ? <StatusBadge state="private">{visibilityChip}</StatusBadge> : null}
            {viewingAsAdmin ? <StatusBadge state="viewing_as_admin">Viewing as admin</StatusBadge> : null}
            {archived && parentOrg.archived ? <><StatusBadge state="archived">Archived</StatusBadge><span className="nb-compact text-muted-foreground">with {parentOrg.title}</span></> : null}
            {parentOrg.suspended ? <><StatusBadge state="suspended">Suspended</StatusBadge><span className="nb-compact text-muted-foreground">{parentOrg.title} is read-only</span></> : null}
        </p>
    )
}

/** Suspended (everyone; the reason only reaches owners and admins, decision 53) or scheduled for deletion (the owner, with Restore). Report §30.3, §30.5. */
export function OrgStatusBanner({ orgId, organization, isOwner }: { orgId: string; organization: OrgDetail; isOwner: boolean }) {
    const router = useRouter()
    const refreshSidebar = useRefreshSidebar()
    const [pending, start] = useTransition()
    if (organization.suspended) {
        return (
            <Notice tone="danger" className="mt-2">
                This organization is suspended. Everything is read-only.{organization.suspendReason ? ` Reason: ${organization.suspendReason}.` : ''}{isOwner ? ' To appeal, email support@networkbase.in.' : ''}
            </Notice>
        )
    }
    if (organization.deletionScheduledAt && isOwner) {
        const purge = new Date(new Date(organization.deletionScheduledAt).getTime() + 30 * 86_400_000)
        const restore = () => start(async () => {
            const r = await restoreOrgAction(orgId)
            if (!r.success) return void toast.error(r.error ?? 'Couldn’t restore it.')
            toast.success('Organization restored')
            refreshSidebar()
            router.refresh()
        })
        return (
            <Notice tone="warning" className="mt-2" action={<Button size="sm" variant="outline" disabled={pending} onClick={restore}>Restore</Button>}>
                Scheduled for deletion on {formatInZone(purge, { month: 'short', day: 'numeric', year: 'numeric' }, organization.timeZone)}. Restore it before then to keep everything.
            </Notice>
        )
    }
    return null
}

export type OrgNewKind = 'task' | 'assignment' | 'announcement' | 'sprint' | 'project'
const NEW_ITEMS: Array<{ kind: OrgNewKind; label: string; icon: typeof Plus }> = [
    { kind: 'task', label: 'Task', icon: ListTodo },
    // Board/review report §4: opens New on its Assignment tab.
    { kind: 'assignment', label: 'Assignment', icon: ClipboardList },
    { kind: 'announcement', label: 'Announcement', icon: Megaphone },
    { kind: 'sprint', label: 'Sprint', icon: IterationCcw },
    { kind: 'project', label: 'Workspace', icon: FolderKanban },
]

/** The New items, for the header menu and the mobile ⋯ menu (report §18.2, §18.7). */
export function OrgNewItems({ onNew, prefix = '' }: { onNew: (kind: OrgNewKind) => void; prefix?: string }) {
    return <>{NEW_ITEMS.map(({ kind, label, icon: Icon }) => <DropdownMenuItem key={kind} onSelect={() => onNew(kind)}><Icon className="size-4" aria-hidden="true" />{prefix}{label}</DropdownMenuItem>)}</>
}

/** Admins' + New ▾: each item opens the existing composer or modal (report §18.2). */
export function OrgNewMenu({ onNew }: { onNew: (kind: OrgNewKind) => void }) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button data-testid="org-new-menu"><Plus className="size-4" aria-hidden="true" />New<ChevronDown className="size-3.5" aria-hidden="true" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48"><OrgNewItems onNew={onNew} /></DropdownMenuContent>
        </DropdownMenu>
    )
}

/** The child's compact bar on phones: the org's small mark before the workspace name (report §18.7). */
export function OrgCompactMark({ parentOrg }: { parentOrg: ParentOrgLink }) {
    return <span title={parentOrg.title} aria-hidden="true" className="shrink-0"><WorkspaceAvatar project={{ title: parentOrg.title, coverImage: parentOrg.coverImage }} size="row" kind="organization" className="size-5" /></span>
}
