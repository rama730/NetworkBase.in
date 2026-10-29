'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Archive, Building2, ChevronDown, Flag, FolderKanban, IterationCcw, ListTodo, Megaphone, MoreHorizontal, Plus, UserPlus } from 'lucide-react'

import { cancelJoinRequestAction, joinPublicOrgAction, regenerateJoinCodeAction } from '@/app/actions/organizations'
import { restoreOrgAction } from '@/app/actions/org-lifecycle'
import { ReportDialog } from '@/components/reports/ReportDialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { OrgDetail, ParentOrgLink } from '@/lib/organizations/detail'

// The organization parts of the project header (report §18.1–18.2, §18.6). ProjectLayout keeps its layout;
// these fill the identity line, the facts and the visitor's actions.

/** `@handle · Education · Teacher`, plus the archived line (report §18.1, §18.6). */
export function OrgIdentityLine({ handle, organization, memberRole, archived }: {
    handle: string | null
    organization: OrgDetail
    memberRole: 'owner' | 'admin' | 'member' | 'viewer' | null
    archived: boolean
}) {
    const parts = [handle ? `@${handle}` : null, organization.typeLabel, memberRole ? organization.roleNames[memberRole] : null].filter(Boolean)
    return (
        <div className="space-y-1">
            <p className="nb-compact text-muted-foreground" data-testid="org-identity-line">{parts.join(' · ')}</p>
            {archived ? (
                <p className="nb-compact flex items-center gap-1.5 text-muted-foreground">
                    <span className="nb-status inline-flex items-center gap-1" data-status="archived"><Archive className="size-3" aria-hidden="true" />Archived</span>
                    This organization is archived. Everything is read-only.
                </p>
            ) : null}
        </div>
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

/** Admins' Invite: the join code with Copy, Copy invite message and Regenerate (report §18.2, §6.1). Email lists come with Members (P10). */
export function OrgInviteDialog({ orgId, title, joinCode, open, onOpenChange }: {
    orgId: string
    title: string
    joinCode: string | null
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const router = useRouter()
    const [code, setCode] = useState(joinCode)
    const [message, setMessage] = useState<string | null>(null)
    const [confirming, setConfirming] = useState(false)
    const [pending, startTransition] = useTransition()

    const copy = async (text: string, label: string) => {
        try {
            await navigator.clipboard.writeText(text)
            setMessage(label)
        } catch {
            setMessage('Copy failed. Select the text and copy it yourself.')
        }
    }
    const regenerate = () =>
        startTransition(async () => {
            const result = await regenerateJoinCodeAction(orgId)
            setConfirming(false)
            if (!result.success) return setMessage(result.error)
            setCode(result.joinCode)
            setMessage('New code ready. The old code no longer works.')
            router.refresh()
        })

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><UserPlus className="size-4" aria-hidden="true" />Invite people to {title}</DialogTitle>
                    <DialogDescription>Share the code. People enter it at /join or open the link.</DialogDescription>
                </DialogHeader>
                {code ? (
                    <div className="space-y-4">
                        <p className="select-all text-center font-mono text-4xl font-semibold tracking-[0.25em]" aria-label={`Join code ${code.split('').join(' ')}`}>{code}</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                            <Button variant="outline" onClick={() => copy(code, 'Code copied')}>Copy code</Button>
                            <Button variant="outline" onClick={() => copy(`Join ${title} on NetworkBase with code ${code}: ${window.location.origin}/join/${code}`, 'Invite message copied')}>Copy invite message</Button>
                        </div>
                        {confirming ? (
                            <div className="rounded-md border border-border p-3 text-sm">
                                <p>The current code stops working at once. People who haven’t joined need the new one.</p>
                                <div className="mt-3 flex gap-2">
                                    <Button size="sm" variant="destructive" disabled={pending} onClick={regenerate}>Make a new code</Button>
                                    <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Keep this code</Button>
                                </div>
                            </div>
                        ) : (
                            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>Regenerate code</Button>
                        )}
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">Only owners and admins see the join code.</p>
                )}
                <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">{message}</p>
            </DialogContent>
        </Dialog>
    )
}

/** Above a child project's title: the org, linked for people who can open it (report §18.4). */
export function OrgBreadcrumb({ parentOrg }: { parentOrg: ParentOrgLink }) {
    const canOpen = Boolean(parentOrg.viewerRole) || parentOrg.isPublic
    const label = <span className="inline-flex items-center gap-1.5"><Building2 className="size-3.5" aria-hidden="true" />{parentOrg.title} /</span>
    return (
        <p className="nb-compact text-muted-foreground" data-testid="child-org-breadcrumb">
            {canOpen ? <Link href={`/org/${parentOrg.slug ?? parentOrg.id}`} className="hover:text-foreground hover:underline">{label}</Link> : label}
        </p>
    )
}

/** `Org only` / `Private` and, for inherited admins, `<Org> admin` (report §18.4, §18.6). */
export function ChildOrgChips({ parentOrg, visibility, archived }: { parentOrg: ParentOrgLink; visibility: string | null | undefined; archived: boolean }) {
    const visibilityChip = visibility === 'org' ? 'Org only' : visibility === 'private' ? 'Private' : null
    if (!visibilityChip && !parentOrg.viewerIsInheritedAdmin && !archived) return null
    return (
        <p className="flex flex-wrap items-center gap-1.5" data-testid="child-org-chips">
            {visibilityChip ? <span className="nb-status" data-status="draft">{visibilityChip}</span> : null}
            {parentOrg.viewerIsInheritedAdmin ? <span className="nb-status" data-status="active">Admin · from {parentOrg.title}</span> : null}
            {archived && parentOrg.archived ? <span className="nb-status" data-status="archived">Archived with {parentOrg.title}</span> : null}
        </p>
    )
}

/** Suspended (everyone, with the reason for members) or scheduled for deletion (the owner, with Restore). Report §30.3, §30.5. */
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
                Scheduled for deletion on {purge.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
                <button type="button" disabled={pending} className="font-medium underline underline-offset-2" onClick={() => start(async () => { const r = await restoreOrgAction(orgId); if (r.success) router.refresh() })}>Restore</button>
            </p>
        )
    }
    return null
}

/** The org header's ⋯ menu: Report (report §30.3). */
export function OrgHeaderMenu({ orgId }: { orgId: string }) {
    const [open, setOpen] = useState(false)
    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button type="button" aria-label="Organization actions" className="nb-icon-button nb-touch-target"><MoreHorizontal className="size-4" aria-hidden="true" /></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onSelect={() => setOpen(true)}><Flag className="size-4" aria-hidden="true" />Report organization</DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            {open ? <ReportDialog kind="project" targetId={orgId} noun="organization" open={open} onOpenChange={setOpen} /> : null}
        </>
    )
}

export type OrgNewKind = 'assignment' | 'announcement' | 'sprint' | 'project'
const NEW_ITEMS: Array<{ kind: OrgNewKind; label: string; icon: typeof Plus }> = [
    { kind: 'assignment', label: 'Assignment', icon: ListTodo },
    { kind: 'announcement', label: 'Announcement', icon: Megaphone },
    { kind: 'sprint', label: 'Sprint', icon: IterationCcw },
    { kind: 'project', label: 'Project', icon: FolderKanban },
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
