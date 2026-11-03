'use client'

import { typeProfile } from '@/lib/organizations/type-profile'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Archive, Building2, ChevronDown, FolderKanban, IterationCcw, ListTodo, Megaphone, Plus, UserPlus } from 'lucide-react'

import { cancelJoinRequestAction, joinPublicOrgAction, regenerateJoinCodeAction } from '@/app/actions/organizations'
import { JoinRequestNote } from '@/components/organizations/JoinOrgButton'
import { restoreOrgAction } from '@/app/actions/org-lifecycle'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { OrgInvitePanel } from '@/components/organizations/OrgInvitePanel'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { OrgDetail, ParentOrgLink } from '@/lib/organizations/detail'
import { formatInZone } from '@/lib/organizations/zoned-time'

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

/** The archived line (report §18.6). */
export function OrgArchivedNotice() {
    return (
        <p className="nb-compact flex items-center gap-1.5 text-muted-foreground">
            <span className="nb-status inline-flex items-center gap-1" data-status="archived"><Archive className="size-3" aria-hidden="true" />Archived</span>
            This organization is archived. Everything is read-only.
        </p>
    )
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
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)

    if (!loggedIn) {
        return <Button asChild size="sm"><Link href={`/login?redirect=${encodeURIComponent(href)}`}>{joinMode === 'approval' ? 'Request to join' : 'Join'}</Link></Button>
    }
    const run = (action: () => Promise<{ success: boolean; error?: string }>) =>
        startTransition(async () => {
            const result = await action()
            if (!result.success) return setError(result.error ?? 'Something went wrong.')
            setError(null)
            router.refresh()
        })

    return (
        <span className="inline-flex items-center gap-2">
            {requestPending ? (
                <>
                    <Button size="sm" variant="outline" disabled>Request pending</Button>
                    <JoinRequestNote orgId={orgId} size="sm" />
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelJoinRequestAction(orgId))}>Cancel request</Button>
                </>
            ) : (
                <Button size="sm" disabled={pending} onClick={() => run(() => joinPublicOrgAction(orgId))}>
                    {joinMode === 'approval' ? 'Request to join' : 'Join'}
                </Button>
            )}
            {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
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
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><UserPlus className="size-4" aria-hidden="true" />Invite people to {title}</DialogTitle>
                    <DialogDescription>Share the code or the link, or invite by email.</DialogDescription>
                </DialogHeader>
                {open ? <OrgInvitePanel orgId={orgId} orgHandle={orgHandle} /> : null}
            </DialogContent>
        </Dialog>
    )
}

/** Above a child project's title: the org, linked for people who can open it (report §18.4). */
export function OrgBreadcrumb({ parentOrg }: { parentOrg: ParentOrgLink }) {
    const canOpen = Boolean(parentOrg.viewerRole) || parentOrg.isPublic
    // Report §17.1: the one organization link, with no trailing slash above the title.
    const label = <span className="inline-flex items-center gap-1.5"><Building2 className="size-3.5" aria-hidden="true" />{parentOrg.title}</span>
    return (
        <p className="nb-compact text-muted-foreground" data-testid="child-org-breadcrumb">
            {canOpen ? <Link href={`/org/${parentOrg.slug ?? parentOrg.id}`} className="hover:text-foreground hover:underline">{label}</Link> : label}
        </p>
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
            {visibilityChip ? <span className="nb-status" data-status="draft">{visibilityChip}</span> : null}
            {viewingAsAdmin ? <span className="nb-status" data-status="active">Viewing as admin</span> : null}
            {archived && parentOrg.archived ? <span className="nb-status" data-status="archived">Archived with {parentOrg.title}</span> : null}
            {parentOrg.suspended ? <span className="nb-status" data-status="blocked">{parentOrg.title} is suspended · read only</span> : null}
        </p>
    )
}

/** Suspended (everyone; the reason only reaches owners and admins, decision 53) or scheduled for deletion (the owner, with Restore). Report §30.3, §30.5. */
export function OrgStatusBanner({ orgId, organization, isOwner }: { orgId: string; organization: OrgDetail; isOwner: boolean }) {
    const router = useRouter()
    const [pending, start] = useTransition()
    if (organization.suspended) {
        return (
            <p role="status" className="mt-2 rounded-[5px] border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-foreground">
                This organization is suspended. Everything is read-only.{organization.suspendReason ? ` Reason: ${organization.suspendReason}.` : ''}{isOwner ? ' To appeal, email support@networkbase.in.' : ''}
            </p>
        )
    }
    if (organization.deletionScheduledAt && isOwner) {
        const purge = new Date(new Date(organization.deletionScheduledAt).getTime() + 30 * 86_400_000)
        return (
            <p role="status" className="mt-2 flex flex-wrap items-center gap-2 rounded-[5px] border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-foreground">
                Scheduled for deletion on {formatInZone(purge, { month: 'short', day: 'numeric', year: 'numeric' }, organization.timeZone)}
                <button type="button" disabled={pending} className="font-medium underline underline-offset-2" onClick={() => start(async () => { const r = await restoreOrgAction(orgId); if (r.success) router.refresh() })}>Restore</button>
            </p>
        )
    }
    return null
}

export type OrgNewKind = 'assignment' | 'announcement' | 'sprint' | 'project'
const NEW_ITEMS: Array<{ kind: OrgNewKind; label: string; icon: typeof Plus }> = [
    { kind: 'assignment', label: 'Assignment', icon: ListTodo },
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
                <Button size="sm" data-testid="org-new-menu"><Plus className="size-4" aria-hidden="true" />New<ChevronDown className="size-3.5" aria-hidden="true" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48"><OrgNewItems onNew={onNew} /></DropdownMenuContent>
        </DropdownMenu>
    )
}

/** The child's compact bar on phones: the org's small logo before the project name (report §18.7). */
export function OrgCompactMark({ parentOrg }: { parentOrg: ParentOrgLink }) {
    return parentOrg.coverImage
        ? <img src={parentOrg.coverImage} alt={parentOrg.title} className="size-4 shrink-0 rounded-[3px] object-cover" />
        : <Building2 className="size-4 shrink-0 text-muted-foreground" aria-label={parentOrg.title} />
}
