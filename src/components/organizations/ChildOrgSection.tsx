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
    moveProjectToOrgAction,
    requestDetachAction,
    setChildVisibilityAction,
} from '@/app/actions/organizations'
import { SettingsCard } from '@/components/projects/settings/SettingsFormFields'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { allowedChildVisibilities, type ChildVisibility } from '@/lib/organizations/child-rules'
import type { Project } from '@/types/discover'

// Settings → Organization (report §21.6): the child's org link, the rules it inherits as locked rows,
// visibility within the cap, inherited admins, and detach. For a personal project: Move to an organization.

const CAP_LABEL: Record<string, string> = { public: 'Public allowed', org: 'Org only at most', private: 'Private only' }
const VIS_LABEL: Record<ChildVisibility, string> = { public: 'Public', org: 'Org only', private: 'Private' }

function useRun() {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
    const run = (action: () => Promise<{ success: boolean; error?: string }>, ok: string) =>
        startTransition(async () => {
            const result = await action()
            setMessage(result.success ? { kind: 'ok', text: ok } : { kind: 'error', text: result.error ?? 'Something went wrong.' })
            if (result.success) router.refresh()
        })
    const status = message ? <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{message.text}</p> : null
    return { pending, run, status }
}

function LockedRow({ label, value, org }: { label: string; value: string; org: string }) {
    return (
        <div className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-b-0">
            <span className="text-sm text-foreground">{label}</span>
            <span className="flex items-center gap-1.5 text-right text-sm text-muted-foreground"><Lock className="size-3.5" aria-hidden="true" />{value} · Set by {org}</span>
        </div>
    )
}

export function ChildOrgSection({ project, isLead, canManage }: { project: Project; isLead: boolean; canManage: boolean }) {
    const parentOrg = project.parentOrg ?? null
    const { pending, run, status } = useRun()
    const [confirm, setConfirm] = useState<'detach' | 'archive' | null>(null)
    const [target, setTarget] = useState(project.moveTargets?.[0]?.id ?? '')
    const projectId = project.id

    if (!parentOrg) {
        const targets = project.moveTargets ?? []
        return (
            <section id="project-settings-child-org" data-project-settings-section className="space-y-6">
                <SettingsCard title="Organization" headingLevel={2} description="Move this project into an organization you belong to. Its admins gain access and its rules apply.">
                    {project.pendingMoveIn ? (
                        <div className="space-y-3">
                            <p className="text-sm">Request pending: move into {project.pendingMoveIn.orgTitle}. An admin there decides.</p>
                            <Button variant="outline" disabled={pending} onClick={() => run(() => cancelMoveInAction(projectId), 'Request cancelled.')}>Cancel request</Button>
                        </div>
                    ) : targets.length === 0 ? (
                        <p className="text-sm text-muted-foreground">You aren’t a member of any organization.</p>
                    ) : (
                        <div className="flex flex-wrap items-center gap-3">
                            <select aria-label="Organization" value={target} onChange={(e) => setTarget(e.target.value)} className="h-[var(--ui-control-height)] rounded-md border border-input bg-background px-2 text-sm">
                                {targets.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                            </select>
                            <Button disabled={pending || !target} onClick={() => run(async () => {
                                const result = await moveProjectToOrgAction(projectId, target)
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
            <SettingsCard title="Organization" headingLevel={2} description={`This project is part of ${parentOrg.title}. Some rules come from there.`}>
                <div className="space-y-6">
                    <p className="text-sm">
                        In <Link href={`/org/${parentOrg.slug ?? parentOrg.id}`} className="font-medium underline underline-offset-4">{parentOrg.title}</Link>
                        {inherited ? ' · you manage it as an org admin' : ''}
                    </p>
                    <div>
                        <LockedRow label="Visibility cap" value={CAP_LABEL[parentOrg.isPublic ? parentOrg.visibilityCap : 'org'] ?? 'Org only at most'} org={parentOrg.title} />
                        <LockedRow label="People outside the organization" value={parentOrg.outsidePeople ? 'Allowed' : 'Not allowed'} org={parentOrg.title} />
                        <LockedRow label="Leaving the organization" value={inherited ? 'Detach at once' : 'Needs admin approval'} org={parentOrg.title} />
                    </div>
                    {canManage || inherited ? (
                        <fieldset>
                            <legend className="nb-ui-label text-sm font-semibold text-foreground">Visibility</legend>
                            <div className="mt-2 space-y-2 text-sm">
                                {(['public', 'org', 'private'] as const).map((v) => options.includes(v) ? (
                                    <label key={v} className="flex items-center gap-2">
                                        <input type="radio" name="child-visibility" checked={current === v} disabled={pending} onChange={() => run(() => setChildVisibilityAction(projectId, v), `Now ${VIS_LABEL[v]}.`)} />
                                        {VIS_LABEL[v]}{v === 'org' ? ` · every member of ${parentOrg.title}` : v === 'private' ? ` · the team and ${parentOrg.title} admins` : ''}
                                    </label>
                                ) : (
                                    <p key={v} className="flex items-center gap-2 text-muted-foreground"><Lock className="size-3.5" aria-hidden="true" />{VIS_LABEL[v]} · Set by {parentOrg.title}</p>
                                ))}
                            </div>
                        </fieldset>
                    ) : null}
                    <div>
                        <p className="nb-ui-label text-sm font-semibold text-foreground">Admins from the organization</p>
                        <p className="nb-compact mt-0.5 text-muted-foreground">They can open, archive and remove this workspace from the organization. Only the owner can delete or transfer it.</p>
                        <ul className="mt-2 space-y-1 text-sm">
                            {parentOrg.inheritedAdmins.map((admin) => <li key={`${admin.name}-${admin.roleName}`}>{admin.name}, {admin.roleName} · Admin · from {parentOrg.title}</li>)}
                        </ul>
                    </div>
                    <div className="space-y-3 border-t border-border pt-4">
                        <p className="nb-ui-label text-sm font-semibold text-foreground">Leave {parentOrg.title}</p>
                        <p className="nb-compact text-muted-foreground">Detaching makes this a Private personal project. Its org views go away.</p>
                        {inherited ? (
                            <div className="flex flex-wrap gap-2">
                                {parentOrg.detachRequested ? <p className="basis-full text-sm">The lead asked to detach.</p> : null}
                                <Button variant="destructive" disabled={pending} onClick={() => setConfirm('detach')}>{parentOrg.detachRequested ? 'Approve and detach' : 'Detach now'}</Button>
                                {parentOrg.detachRequested ? <Button variant="outline" disabled={pending} onClick={() => run(() => cancelDetachRequestAction(projectId), 'Request declined.')}>Decline request</Button> : null}
                                {project.status !== 'archived' ? <Button variant="outline" disabled={pending} onClick={() => setConfirm('archive')}>Archive project</Button> : null}
                            </div>
                        ) : isLead ? (
                            parentOrg.detachRequested ? (
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm">Detach requested. An admin of {parentOrg.title} decides.</p>
                                    <Button variant="outline" disabled={pending} onClick={() => run(() => cancelDetachRequestAction(projectId), 'Request cancelled.')}>Cancel request</Button>
                                </div>
                            ) : (
                                <Button variant="outline" disabled={pending} onClick={() => run(() => requestDetachAction(projectId), `Request sent to ${parentOrg.title} admins.`)}>Request detach</Button>
                            )
                        ) : null}
                        {status}
                    </div>
                </div>
            </SettingsCard>
            <ConfirmDialog
                open={confirm !== null}
                onOpenChange={(open) => { if (!open) setConfirm(null) }}
                title={confirm === 'archive' ? 'Archive this project?' : `Detach from ${parentOrg.title}?`}
                description={confirm === 'archive' ? 'Everything becomes read-only. The lead can unarchive it.' : 'It becomes a Private personal project of its lead.'}
                confirmLabel={confirm === 'archive' ? 'Archive' : 'Detach'}
                variant="destructive"
                onConfirm={() => run(() => (confirm === 'archive' ? archiveChildAction(projectId) : detachChildAction(projectId)), confirm === 'archive' ? 'Archived.' : 'Detached.')}
            />
        </section>
    )
}
