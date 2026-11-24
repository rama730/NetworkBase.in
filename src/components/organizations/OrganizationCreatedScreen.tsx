'use client'

import { CopyButton } from '@/components/ui/copy-button'
import { JoinCode } from '@/components/organizations/org-ui'

import { Button } from '@/components/ui/button'
import { PixelTick } from '@/components/ui/PixelTick'
import { useState, type ReactNode } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { orgInviteMessage } from '@/lib/organizations/creation'

export type CreatedOrganization = {
    title: string
    joinCode: string
    /** The web address (2026-11-05 findings §3): networkbase.in/org/<handle>. */
    handle?: string | null
    /** Invites sent at creation (report §34.8). */
    invites?: { coAdmins: number; members: number; skipped: number }
    creatorTitle?: string | null
    /** Report §27.3: whether people join at once or wait for approval. */
    joinMode?: 'instant' | 'approval' | null
}

/** After creating an org (report §34.8): the join code large, Copy code, Copy invite message, what was sent, then Go to organization. */
export function OrganizationCreatedScreen({ title, joinCode, handle, invites, creatorTitle, joinMode, onContinue }: CreatedOrganization & { onContinue: () => void }) {
    const { user } = useAuth()
    const name = (user?.user_metadata?.full_name as string | undefined)?.trim()
    const signedBy = [name, creatorTitle?.trim()].filter(Boolean).join(', ') || null
    // The same hosts as everywhere else (org design plan CR13): the join link on this site, as the invite panel
    // gives it; the web address as networkbase.in, as Settings and About show it.
    const origin = typeof window === 'undefined' ? 'https://networkbase.in' : window.location.origin
    const invite = `${orgInviteMessage({ title, joinCode, signedBy })} ${origin}/join/${joinCode}`
    const orgLink = handle ? `https://networkbase.in/org/${handle}` : null
    const sent = [
        invites?.coAdmins ? `${invites.coAdmins} co-admin ${invites.coAdmins === 1 ? 'invite' : 'invites'}` : null,
        invites?.members ? `${invites.members} member ${invites.members === 1 ? 'invite' : 'invites'}` : null,
    ].filter(Boolean).join(' and ')
    const joining = joinMode === 'approval' ? 'Needs your approval' : joinMode === 'instant' ? 'People join right away' : null
    const skipped = invites?.skipped ?? 0
    const [done, setDone] = useState<string[]>([])
    const tick = (key: string) => setDone((current) => (current.includes(key) ? current : [...current, key]))
    const initials = (title.match(/\b[\p{L}\p{N}]/gu) ?? ['N']).slice(0, 2).join('').toUpperCase()
    const base = `/org/${encodeURIComponent(handle ?? '')}`
    const tasks: Array<{ key: string; title: string; line: string; action: ReactNode }> = [
        { key: 'code', title: 'Share the join code', line: 'People join with it. Copy it, or the invite message.', action: <span onClickCapture={() => tick('code')}><CopyButton text={joinCode} label="Copy the code" variant="ghost" /></span> },
        { key: 'workspace', title: 'Make the first workspace', line: 'One per team, or one for everyone.', action: handle ? <a className="nb-link text-[13px]" href={`/workspaces/new?org=${encodeURIComponent(handle)}`} onClick={() => tick('workspace')}>New workspace</a> : null },
        { key: 'welcome', title: 'Write the welcome doc', line: 'What new members read first.', action: handle ? <a className="nb-link text-[13px]" href={`${base}?tab=docs`} onClick={() => tick('welcome')}>Open doc</a> : null },
        ...(invites?.coAdmins ? [] : [{ key: 'coadmin', title: 'Add a co-admin', line: 'So it never depends on one person.', action: handle ? <a className="nb-link text-[13px]" href={`${base}?tab=members`} onClick={() => tick('coadmin')}>Add</a> : null }]),
    ]
    return (
        // A section, not a second <main>: the app shell already has one (spec §34). Create wizard v6: the Finish frame.
        <section aria-labelledby="org-created-title" className="nbs h-full min-h-0 overflow-y-auto bg-card">
            <div className="nb-finish w-full max-w-[1220px] px-4 pb-12 pt-6 md:px-6 md:pt-7">
                <div className="min-w-0">
                    <div className="nb-finish-hero">
                        <span className="nb-creating-mark" aria-hidden="true" style={{ ['--fill' as string]: '100%' }}><span>{initials}</span><PixelTick className="nb-finish-tick" draw /></span>
                        {orgLink ? <p className="font-mono text-[12px] text-muted-foreground">{orgLink.replace(/^https?:\/\//, '')}</p> : null}
                        <h1 id="org-created-title" className="nb-creating-title">{title} is ready.</h1>
                        <p className="nb-creating-lead">People join with this code. You can copy or regenerate it later in Settings.</p>
                    </div>

                    <section className="nbs-frame" aria-labelledby="org-created-code">
                        <p id="org-created-code" className="nbs-glabel pt-[18px]">Join code{joining ? <span className="r"><span className="nbs-tag">{joining}</span></span> : null}</p>
                        <div className="nb-sbody">
                            <div className="rounded-lg bg-muted p-5 text-center"><JoinCode code={joinCode} className="text-3xl" /></div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <CopyButton text={joinCode} label="Copy code" size="default" className="nb-touch-target" />
                                <CopyButton text={invite} label="Copy invite message" size="default" className="nb-touch-target" />
                            </div>
                            {sent ? <p className="mt-3 text-[13px] text-foreground" data-testid="org-created-invites">{[joining, `${sent} sent`].filter(Boolean).join(' · ')}</p> : null}
                            {skipped ? <p className="mt-1 text-[13px] text-muted-foreground">{skipped} {skipped === 1 ? 'address' : 'addresses'} looked wrong and {skipped === 1 ? 'was' : 'were'} skipped</p> : null}
                        </div>
                    </section>

                    <section data-get-started className="nbs-frame" aria-labelledby="org-created-tasks">
                        <p id="org-created-tasks" className="nbs-glabel pt-[18px]">Get started<span className="r"><span className="font-mono text-[12px] tabular-nums text-muted-foreground">{done.length} of {tasks.length}</span></span></p>
                        {tasks.map((task) => (
                            <div key={task.key} data-task={task.key} data-done={done.includes(task.key)} className="nb-gs-row">
                                <span className="nb-gs-box" data-done={done.includes(task.key) || undefined} aria-hidden="true">{done.includes(task.key) ? <PixelTick draw /> : null}</span>
                                <div className="min-w-0"><p className="t">{task.title}</p><p className="d">{task.line}</p></div>
                                <div className="ctl">{task.action}</div>
                            </div>
                        ))}
                    </section>

                    <div className="nb-finish-actions">
                        {/* Report §45.8: the teacher guide, from the Ready screen. */}
                        <a href="/help/running-a-class" target="_blank" rel="noopener" className="nb-link mr-auto text-[13px]">Running a class on NetworkBase</a>
                        <Button type="button" className="nb-finish-open" onClick={onContinue}>Go to organization</Button>
                    </div>
                </div>

                <aside aria-label="Its link" className="nb-review-side">
                    {orgLink ? (
                        <section className="nbs-frame" data-testid="org-created-link" aria-labelledby="org-created-link-title">
                            <p id="org-created-link-title" className="nbs-glabel pt-[18px]">Your organization’s link</p>
                            <div className="nb-sbody space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="nb-meta min-w-0 break-all text-foreground">{orgLink.replace(/^https?:\/\//, '')}</span>
                                    <CopyButton text={orgLink} label="Copy link" size="default" className="nb-touch-target" />
                                </div>
                                <p className="text-[13px] text-muted-foreground">It shows on Discover once it has a description and a workspace or a second member, or once it’s verified. Settings, under Visibility and discovery, says where it stands.</p>
                            </div>
                        </section>
                    ) : null}
                </aside>
            </div>
        </section>
    )
}
