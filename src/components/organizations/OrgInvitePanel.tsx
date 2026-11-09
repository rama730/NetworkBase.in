'use client'

import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal } from 'lucide-react'
import { useEffect, useMemo, useState, useTransition } from 'react'

import { inviteByEmailAction, previewOrgInviteEmailAction, readOrgInvitePanelAction, type OrgInvitePanelData } from '@/app/actions/org-members'
import { regenerateJoinCodeAction, updateOrgSettingsAction } from '@/app/actions/organizations'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { CopyButton } from '@/components/ui/copy-button'
import { JoinCode } from '@/components/organizations/org-ui'
import { fieldLabel } from '@/lib/organizations/display'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/feedback'
import { cn } from '@/lib/utils'
import { parseInviteEmails } from '@/lib/organizations/member-rules'

/**
 * The one invite panel (report §5.5, §7.11, §10.2): the code and link, each with a Copy that says it copied,
 * Invite by email, and a menu for a new code, turning the code off and the join settings. One read, used by
 * the header's Invite, Overview, About and Members, always inside a titled section or dialog. No QR code (section 14).
 * `prominent`: more room when you're the only one here (report §7.10, live-fix 40). `bare` is kept for callers.
 */
export function OrgInvitePanel({ orgId, orgHandle, prominent = false }: { orgId: string; orgHandle: string | null; prominent?: boolean; bare?: boolean }) {
    const client = useQueryClient()
    const query = useQuery({ queryKey: ['org-invite-panel', orgId], queryFn: () => readOrgInvitePanelAction(orgId), staleTime: 30_000 })
    const [emailOpen, setEmailOpen] = useState(false)
    const [confirmNew, setConfirmNew] = useState(false)
    const [pending, startTransition] = useTransition()
    const data = query.data?.success ? query.data.data : null
    if (!data) return query.isPending ? <div className="nb-skeleton h-28 rounded-md" role="status" aria-label="Loading invite" /> : null
    const refresh = () => void client.invalidateQueries({ queryKey: ['org-invite-panel', orgId] })
    const link = data.joinCode && typeof window !== 'undefined' ? `${window.location.origin}/join/${data.joinCode}` : null
    const act = (work: () => Promise<{ success: boolean; error?: string }>, done: string) => startTransition(async () => {
        const result = await work()
        if (!result.success) return void toast.error(result.error ?? 'Something went wrong.')
        toast.success(done)
        refresh()
    })
    return (
        <section aria-label="Invite people" className="space-y-3" data-testid="org-invite-panel">
            {data.joinCode ? (
                // A sunken well inside the section's card (spec §02), not another bordered box.
                <div className={cn('space-y-2 rounded-md bg-muted', prominent ? 'p-4' : 'p-3')}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <JoinCode code={data.joinCode} />
                        <CopyButton text={data.joinCode} label="Copy code" />
                    </div>
                    {link ? (
                        <div className="flex items-center justify-between gap-2">
                            <span className="nb-meta min-w-0 truncate">{link.replace(/^https?:\/\//, '')}</span>
                            <CopyButton text={link} label="Copy link" />
                        </div>
                    ) : null}
                </div>
            ) : <p className="text-[13px] text-muted-foreground">Joining by code is off.</p>}
            <div className="flex items-center gap-2">
                <Button type="button" variant="outline" className="min-w-0 flex-1" onClick={() => setEmailOpen(true)}>Invite by email</Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button type="button" variant="outline" size="icon" className="nb-touch-target" aria-label="Invite options"><MoreHorizontal className="size-4" aria-hidden="true" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {data.codeEnabled ? <DropdownMenuItem onSelect={() => setConfirmNew(true)}>New code</DropdownMenuItem> : null}
                        <DropdownMenuItem disabled={pending} onSelect={() => act(() => updateOrgSettingsAction(orgId, 'access', { join_code_enabled: !data.codeEnabled }), data.codeEnabled ? 'Joining by code is off' : 'Joining by code is on')}>
                            {data.codeEnabled ? 'Turn off code' : 'Turn on code'}
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild><Link href={`/org/${encodeURIComponent(orgHandle ?? orgId)}?tab=settings`}>Join settings</Link></DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            {data.codeEnabled ? <p className="text-[12px] text-muted-foreground">Anyone with this code can join · {data.joinMode === 'approval' ? 'Needs approval' : 'Joins right away'}</p> : null}
            {/* The same confirmation as Settings → Joining (G23). */}
            <ConfirmDialog open={confirmNew} onOpenChange={setConfirmNew} title="Make a new join code?" description="The current code stops working at once. People who haven’t joined need the new one."
                confirmLabel="Make a new code" onConfirm={() => act(async () => regenerateJoinCodeAction(orgId), 'New code ready. The old code no longer works.')} />
            <InviteEmailDialog orgId={orgId} data={data} open={emailOpen} onOpenChange={setEmailOpen} onSent={refresh} />
        </section>
    )
}

/** Invite by email (report §7.11): addresses checked as you paste, role, title, workspace and team, and a live preview. */
function InviteEmailDialog({ orgId, data, open, onOpenChange, onSent }: { orgId: string; data: OrgInvitePanelData; open: boolean; onOpenChange: (open: boolean) => void; onSent: () => void }) {
    const [emails, setEmails] = useState('')
    const [role, setRole] = useState<'member' | 'admin' | 'viewer'>('member')
    const [title, setTitle] = useState('')
    const [message, setMessage] = useState('')
    const [childId, setChildId] = useState('')
    const [unitId, setUnitId] = useState('')
    const [result, setResult] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const parsed = useMemo(() => parseInviteEmails(emails), [emails])
    // The preview waits until typing pauses, so it isn't rebuilt on every key.
    // Audit N20: the title waits too, so typing one doesn't fetch a preview per key.
    const [previewText, setPreviewText] = useState({ message: '', title: '' })
    useEffect(() => { const t = window.setTimeout(() => setPreviewText({ message, title }), 400); return () => window.clearTimeout(t) }, [message, title])
    const preview = useQuery({ queryKey: ['org-invite-preview', orgId, role, previewText.title, previewText.message], queryFn: () => previewOrgInviteEmailAction(orgId, { role, title: previewText.title, message: previewText.message }), enabled: open, staleTime: 60_000 })
    const units = data.children.find((c) => c.id === childId)?.units ?? []
    const send = () => startTransition(async () => {
        const r = await inviteByEmailAction(orgId, { emails, role, title: title || null, childProjectId: childId || null, unitId: unitId || null, message: message.trim() || null })
        if (!r.success) return void setResult(r.error)
        setResult([`${r.invited} sent`, r.existing ? `${r.existing} already had accounts and were told in the app` : null, r.invalid.length ? `${r.invalid.length} skipped: ${r.invalid.join(', ')}` : null].filter(Boolean).join(' · '))
        setEmails('')
        onSent()
    })
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Invite by email</DialogTitle>
                    <DialogDescription>{data.invitesLeft === 0 ? 'No invites left today.' : `${data.invitesLeft} left today.`}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div>
                        <label htmlFor="invite-emails" className={fieldLabel}>Emails</label>
                        <textarea id="invite-emails" value={emails} onChange={(e) => setEmails(e.target.value)} rows={4} placeholder="Comma or one per line" className="nb-textarea mt-1.5" aria-describedby="invite-emails-count" />
                        <p id="invite-emails-count" className="mt-1 text-[13px] text-muted-foreground" aria-live="polite">{emails.trim() ? `${parsed.valid.length} ${parsed.valid.length === 1 ? 'address' : 'addresses'}${parsed.invalid.length ? `, ${parsed.invalid.length} ${parsed.invalid.length === 1 ? 'looks' : 'look'} wrong: ${parsed.invalid.slice(0, 5).join(', ')}` : ''}` : null}</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block"><span className={fieldLabel}>Invite as</span>
                            <select className="nb-select mt-1.5 w-full" value={role} onChange={(e) => { const next = e.target.value as typeof role; setRole(next); if (next !== 'member') { setChildId(''); setUnitId('') } }}>
                                <option value="member">{data.roleNames.member}</option><option value="viewer">{data.roleNames.viewer}</option>
                                {data.viewerRole === 'owner' ? <option value="admin">{data.roleNames.admin}</option> : null}
                            </select>
                        </label>
                        <label className="block"><span className={fieldLabel}>Title (optional)</span>
                            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} className="mt-1.5" />
                        </label>
                        {/* Only members join a workspace; viewers and admins can't be placed in one (audit 3.5). */}
                        {role === 'member' ? <label className="block"><span className={fieldLabel}>Workspace</span>
                            <select className="nb-select mt-1.5 w-full" value={childId} onChange={(e) => { setChildId(e.target.value); setUnitId('') }}>
                                <option value="">No workspace</option>
                                {data.children.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                            </select>
                        </label> : null}
                        {childId && role === 'member' ? (
                            <label className="block"><span className={fieldLabel}>Team</span>
                                <select className="nb-select mt-1.5 w-full" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                                    <option value="">No team</option>
                                    {units.map((u) => <option key={u.id} value={u.id}>{u.title}</option>)}
                                </select>
                            </label>
                        ) : null}
                    </div>
                    <div>
                        <label htmlFor="invite-message" className={fieldLabel}>Add a message (optional)</label>
                        <textarea id="invite-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={2} maxLength={500} placeholder="Welcome to the class. We start on Monday." className="nb-textarea mt-1.5" />
                    </div>
                    {preview.data?.success ? (
                        <div>
                            <p className="nb-micro mb-1.5">Preview · {preview.data.subject}</p>
                            {/* The email itself is drawn on white, as an inbox shows it. */}
                            <iframe title="Invite email preview" sandbox="" srcDoc={preview.data.html} className="h-72 w-full rounded-md border border-border bg-white" />
                        </div>
                    ) : null}
                    {result ? <p role="status" className="text-[13px]">{result}</p> : null}
                </div>
                <DialogFooter paper>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
                    <Button type="button" disabled={pending || parsed.valid.length === 0} onClick={send}>{parsed.valid.length ? `Invite ${parsed.valid.length} ${parsed.valid.length === 1 ? 'person' : 'people'}` : 'Invite'}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
