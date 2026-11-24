'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Lock } from 'lucide-react'

import {
    archiveChildAction,
    cancelDetachRequestAction,
    cancelMoveInAction,
    detachChildAction,
    moveWorkspaceToOrgAction,
    requestDetachAction,
    setChildFollowSprintsAction,
    unarchiveChildAction,
    setChildVisibilityAction,
} from '@/app/actions/organizations'
import { SettingsSwitch } from '@/components/settings/ui/SettingsSwitch'
import { SettingsCard } from '@/components/workspaces/settings/SettingsFormFields'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { allowedChildVisibilities, type ChildVisibility } from '@/lib/organizations/child-rules'
import { fieldError, fieldHint, fieldLabel, visibilityLabel } from '@/lib/organizations/display'
import { toast } from '@/lib/feedback'
import type { Workspace } from '@/types/discover'

// Settings → Organization (report §21.6): the child's org link, the rules it inherits as locked rows,
// visibility within the cap, inherited admins, and detach. For a personal project: Move to an organization.

const CAP_LABEL: Record<string, string> = { public: 'Public', org: 'Organization only', private: 'Private' }
const VIS_LABEL = (v: ChildVisibility) => visibilityLabel(v)

function useRun() {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)
    // A toast when it worked; the reason stays next to the control when it didn't (spec §33).
    const run = (action: () => Promise<{ success: boolean; error?: string }>, ok: string) =>
        startTransition(async () => {
            const result = await action()
            if (!result.success) return setError(result.error ?? 'Something went wrong.')
            setError(null)
            toast.success(ok)
            router.refresh()
        })
    const status = error ? <p role="alert" className={fieldError}>{error}</p> : null
    return { pending, run, status }
}

function LockedRow({ label, value, org }: { label: string; value: string; org: string }) {
    return (
        <div className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-b-0">
            <span className="text-[13px] text-foreground">{label}</span>
            <span className="flex items-center gap-1.5 text-right text-[13px] text-muted-foreground"><Lock className="size-3.5" aria-hidden="true" />{value} · Set by {org}</span>
        </div>
    )
}

export function ChildOrgSection({ project, isLead, canManage }: { project: Workspace; isLead: boolean; canManage: boolean }) {
    const parentOrg = project.parentOrg ?? null
    const { pending, run, status } = useRun()
    const [confirm, setConfirm] = useState<'detach' | 'archive' | null>(null)
    const [target, setTarget] = useState(project.moveTargets?.[0]?.id ?? '')
    const projectId = project.id

    if (!parentOrg) {
        const targets = project.moveTargets ?? []
        return (
            <section id="project-settings-child-org" data-project-settings-section className="space-y-6">
                <SettingsCard title="Organization" headingLevel={2} description="Move this workspace into an organization you belong to. Its admins gain access and its rules apply.">
                    {project.pendingMoveIn ? (
                        <div className="space-y-3">
                            <p className="text-[13px]">Request pending: move into {project.pendingMoveIn.orgTitle}. An admin there decides.</p>
                            <Button variant="outline" disabled={pending} onClick={() => run(() => cancelMoveInAction(projectId), 'Request canceled.')}>Cancel request</Button>
                        </div>
                    ) : targets.length === 0 ? (
                        <p className="text-[13px] text-muted-foreground">You aren’t a member of any organization.</p>
                    ) : (
                        <div className="flex flex-wrap items-center gap-3">
                            <select aria-label="Organization" value={target} onChange={(e) => setTarget(e.target.value)} className="nb-select">
                                {targets.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                            </select>
                            <Button disabled={pending || !target} onClick={() => run(async () => {
                                const result = await moveWorkspaceToOrgAction(projectId, target)
                                return result.success ? { success: true, error: undefined } : result
                            }, 'Done. If you are not an admin there, your request waits for one.')}>Move to organization</Button>
                        </div>
                    )}
                    <div className="mt-3">{status}</div>
                </SettingsCard>
            </section>
        )
    }

    const inherited = parentOrg.viewerIsInheritedAdmin
    const options = allowedChildVisibilities(parentOrg.visibilityCap, parentOrg.isPublic)
    const current = (project.visibility === 'unlisted' ? 'public' : project.visibility) as ChildVisibility
    return (
        <section id="project-settings-child-org" data-project-settings-section className="space-y-6">
            <SettingsCard title="Organization" headingLevel={2} description={`This workspace is part of ${parentOrg.title}. Some rules come from there.`}>
                <div className="space-y-6">
                    <p className="text-[13px]">
                        In <Link href={`/org/${parentOrg.slug ?? parentOrg.id}`} className="nb-link">{parentOrg.title}</Link>
                        {inherited ? ' · you manage it as an organization admin' : ''}
                    </p>
                    <div>
                        <LockedRow label="Highest allowed visibility" value={CAP_LABEL[parentOrg.isPublic ? parentOrg.visibilityCap : 'org'] ?? 'Organization only'} org={parentOrg.title} />
                        <LockedRow label="People outside the organization" value={parentOrg.outsidePeople ? 'Allowed' : 'Not allowed'} org={parentOrg.title} />
                        <LockedRow label="Leaving the organization" value={inherited ? 'Remove now' : 'Needs admin approval'} org={parentOrg.title} />
                    </div>
                    {canManage || inherited ? (
                        // Report §18.7, gap 41: following can change after creation.
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className={fieldLabel}>Follow {parentOrg.title}’s sprints</p>
                                <p className={fieldHint}>New sprints here link to the organization’s sprint holding their dates. Sprints already made stay as they are.</p>
                            </div>
                            <SettingsSwitch checked={parentOrg.followsSprints} disabled={pending}
                                onCheckedChange={(on) => run(() => setChildFollowSprintsAction(projectId, on), on ? `Following ${parentOrg.title}’s sprints.` : 'Not following.')} aria-label={`Follow ${parentOrg.title}’s sprints`} />
                        </div>
                    ) : null}
                    <div>
                        <p className={fieldLabel}>Admins from the organization</p>
                        <p className={fieldHint}>They can open, archive and remove this workspace from the organization. Only the owner can delete or transfer it.</p>
                        <ul className="mt-2 space-y-1 text-[13px]">
                            {parentOrg.inheritedAdmins.map((admin) => <li key={`${admin.name}-${admin.roleName}`}>{admin.name}, {admin.roleName} · Admin · from {parentOrg.title}</li>)}
                        </ul>
                    </div>
                    {project.status === 'archived' && (isLead || inherited) ? (
                        // Report §35.3, decision 91: whoever archived it can unarchive it; an admin's archive needs an admin.
                        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
                            <p className="text-[13px]">This workspace is archived and read-only.</p>
                            <Button variant="outline" disabled={pending} onClick={() => run(() => unarchiveChildAction(projectId), 'Open again. The team was told.')}>Unarchive</Button>
                        </div>
                    ) : null}
                    <div className="space-y-3 border-t border-border pt-4">
                        <p className={fieldLabel}>Leave {parentOrg.title}</p>
                        <p className={fieldHint}>Removing makes this a private personal workspace. Its organization views go away.</p>
                        {inherited ? (
                            <div className="flex flex-wrap gap-2">
                                {parentOrg.detachRequested ? <p className="basis-full text-[13px]">The owner asked to leave.</p> : null}
                                <Button variant="destructive" disabled={pending} onClick={() => setConfirm('detach')}>{parentOrg.detachRequested ? 'Approve and remove' : 'Remove now'}</Button>
                                {parentOrg.detachRequested ? <Button variant="outline" disabled={pending} onClick={() => run(() => cancelDetachRequestAction(projectId), 'Request declined.')}>Decline request</Button> : null}
                                {project.status !== 'archived' ? <Button variant="outline" disabled={pending} onClick={() => setConfirm('archive')}>Archive workspace</Button> : null}
                            </div>
                        ) : isLead ? (
                            parentOrg.detachRequested ? (
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-[13px]">Request to leave sent. An admin of {parentOrg.title} decides.</p>
                                    <Button variant="outline" disabled={pending} onClick={() => run(() => cancelDetachRequestAction(projectId), 'Request canceled.')}>Cancel request</Button>
                                </div>
                            ) : (
                                <Button variant="outline" disabled={pending} onClick={() => run(() => requestDetachAction(projectId), `Request sent to ${parentOrg.title} admins.`)}>Request to leave</Button>
                            )
                        ) : null}
                        {status}
                    </div>
                </div>
            </SettingsCard>
            <ConfirmDialog
                open={confirm !== null}
                onOpenChange={(open) => { if (!open) setConfirm(null) }}
                title={confirm === 'archive' ? 'Archive this workspace?' : `Remove from ${parentOrg.title}?`}
                description={confirm === 'archive' ? 'Everything becomes read-only. The owner can unarchive it.' : 'It becomes a Private personal workspace of its owner.'}
                confirmLabel={confirm === 'archive' ? 'Archive' : 'Remove from organization'}
                variant={confirm === 'archive' ? 'default' : 'destructive'}
                onConfirm={() => run(() => (confirm === 'archive' ? archiveChildAction(projectId) : detachChildAction(projectId)), confirm === 'archive' ? 'Archived.' : 'Detached.')}
            />
        </section>
    )
}

/**
 * Visibility for a workspace inside an organization (report §18.7): in Access, the one place for it; options the
 * organization blocks show "Set by CSE 3B".
 */
export function ChildVisibilityPicker({ project, canManage }: { project: Workspace; canManage: boolean }) {
    const parentOrg = project.parentOrg
    const { pending, run, status } = useRun()
    if (!parentOrg) return null
    const options = allowedChildVisibilities(parentOrg.visibilityCap, parentOrg.isPublic)
    const current = (project.visibility === 'unlisted' ? 'public' : project.visibility) as ChildVisibility
    return (
        <fieldset>
            <legend className="sr-only">Visibility</legend>
            <div className="space-y-2.5 text-[13px]">
                {(['public', 'org', 'private'] as const).map((v) => options.includes(v) ? (
                    <label key={v} className="flex items-center gap-2.5">
                        <input type="radio" className="nb-radio" name="child-visibility" checked={current === v} disabled={pending || !canManage} onChange={() => run(() => setChildVisibilityAction(project.id, v), `Now ${VIS_LABEL(v)}.`)} />
                        {VIS_LABEL(v)}{v === 'org' ? ` · every member of ${parentOrg.title}` : v === 'private' ? ` · the team and ${parentOrg.title} admins` : ''}
                    </label>
                ) : (
                    <p key={v} className="flex items-center gap-2 text-muted-foreground"><Lock className="size-3.5" aria-hidden="true" />{VIS_LABEL(v)} · Set by {parentOrg.title}</p>
                ))}
            </div>
            <div className="mt-2">{status}</div>
        </fieldset>
    )
}
