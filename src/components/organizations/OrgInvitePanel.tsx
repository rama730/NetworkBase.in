'use client'

import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, MoreHorizontal } from 'lucide-react'
import { useEffect, useMemo, useState, useTransition } from 'react'

import { inviteByEmailAction, previewOrgInviteEmailAction, readOrgInvitePanelAction, type OrgInvitePanelData } from '@/app/actions/org-members'
import { regenerateJoinCodeAction, updateOrgSettingsAction } from '@/app/actions/organizations'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/feedback'
import { parseInviteEmails } from '@/lib/organizations/member-rules'

const select = 'h-9 rounded-md border border-border bg-background px-2 text-sm'

/**
 * The one invite panel (report §5.5, §7.11, §10.2): the code and link, each with a Copy that says it copied,
 * Invite by email, and a menu for a new code, turning the code off and the join settings. One read, used by
 * the header's Invite, About and Members. No QR code (section 14).
 */
export function OrgInvitePanel({ orgId, orgHandle }: { orgId: string; orgHandle: string | null }) {
    const client = useQueryClient()
    const query = useQuery({ queryKey: ['org-invite-panel', orgId], queryFn: () => readOrgInvitePanelAction(orgId), staleTime: 30_000 })
    const [copied, setCopied] = useState<'code' | 'link' | null>(null)
    const [emailOpen, setEmailOpen] = useState(false)
    const [confirmNew, setConfirmNew] = useState(false)
    const [pending, startTransition] = useTransition()
    const data = query.data?.success ? query.data.data : null
    if (!data) return query.isPending ? <div className="nb-skeleton h-24 rounded-lg" aria-label="Loading invite" /> : null
    const refresh = () => void client.invalidateQueries({ queryKey: ['org-invite-panel', orgId] })
    const link = data.joinCode && typeof window !== 'undefined' ? `${window.location.origin}/join/${data.joinCode}` : null
    const copy = (what: 'code' | 'link', text: string) => void navigator.clipboard.writeText(text).then(() => {
        setCopied(what)
        setTimeout(() => setCopied((c) => (c === what ? null : c)), 2_000)
    }).catch(() => toast.error('Copy failed. Select the text and copy it yourself.'))
    const act = (work: () => Promise<{ success: boolean; error?: string }>, done: string) => startTransition(async () => {
        const result = await work()
        if (!result.success) return void toast.error(result.error ?? 'Something went wrong.')
        toast.success(done)
        setConfirmNew(false)
        refresh()
    })
    return (
        <section aria-label="Invite people" className="space-y-2" data-testid="org-invite-panel">
            <div className="flex items-center justify-between gap-2">
                <h3 className="nb-micro text-muted-foreground">Invite people</h3>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild><button type="button" aria-label="Invite options" className="rounded p-1 text-muted-foreground hover:bg-muted"><MoreHorizontal className="size-4" /></button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {data.codeEnabled ? <DropdownMenuItem onSelect={() => setConfirmNew(true)}>New code</DropdownMenuItem> : null}
                        <DropdownMenuItem onSelect={() => act(() => updateOrgSettingsAction(orgId, 'access', { join_code_enabled: !data.codeEnabled }), data.codeEnabled ? 'Joining by code is off' : 'Joining by code is on')}>
                            {data.codeEnabled ? 'Turn off code' : 'Turn on code'}
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild><Link href={`/org/${encodeURIComponent(orgHandle ?? orgId)}?tab=settings`}>Join settings</Link></DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            {data.joinCode ? (
                <div className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                        <span className="select-all font-mono text-lg font-semibold tracking-[0.2em]" aria-label={`Join code ${data.joinCode.split('').join(' ')}`}>{data.joinCode}</span>
                        <Button type="button" size="sm" variant="outline" onClick={() => copy('code', data.joinCode!)}>{copied === 'code' ? <><Check className="size-3.5" aria-hidden="true" />Copied</> : 'Copy code'}</Button>
                    </div>
                    {link ? (
                        <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-[13px] text-muted-foreground">{link.replace(/^https?:\/\//, '')}</span>
                            <Button type="button" size="sm" variant="outline" onClick={() => copy('link', link)}>{copied === 'link' ? <><Check className="size-3.5" aria-hidden="true" />Copied</> : 'Copy link'}</Button>
                        </div>
                    ) : null}
                </div>
            ) : <p className="text-sm text-muted-foreground">Joining by code is off.</p>}
            {confirmNew ? (
                <div className="rounded-md border border-border p-3 text-sm">
                    <p>The current code stops working at once. People who haven’t joined need the new one.</p>
                    <div className="mt-2 flex gap-2">
                        <Button size="sm" variant="destructive" disabled={pending} onClick={() => act(async () => regenerateJoinCodeAction(orgId), 'New code ready. The old code no longer works.')}>Make a new code</Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmNew(false)}>Keep this code</Button>
                    </div>
                </div>
            ) : null}
            <Button type="button" variant="outline" className="w-full" onClick={() => setEmailOpen(true)}>Invite by email</Button>
            {data.codeEnabled ? <p className="text-[12px] text-muted-foreground">Anyone with this code can join · {data.joinMode === 'approval' ? 'Needs approval' : 'Joins right away'}</p> : null}
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
    const [previewMessage, setPreviewMessage] = useState('')
    useEffect(() => { const t = window.setTimeout(() => setPreviewMessage(message), 400); return () => window.clearTimeout(t) }, [message])
    const preview = useQuery({ queryKey: ['org-invite-preview', orgId, role, title, previewMessage], queryFn: () => previewOrgInviteEmailAction(orgId, { role, title, message: previewMessage }), enabled: open, staleTime: 60_000 })
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
            <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Invite by email</DialogTitle>
                    <DialogDescription>{data.invitesLeft === 0 ? 'No invites left today.' : `${data.invitesLeft} left today`}</DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                    <textarea value={emails} onChange={(e) => setEmails(e.target.value)} rows={4} placeholder="Emails, comma or one per line" aria-label="Emails to invite" className="w-full rounded-md border border-border bg-background p-2 text-sm" />
                    {emails.trim() ? <p className="text-[12px] text-muted-foreground" aria-live="polite">{parsed.valid.length} {parsed.valid.length === 1 ? 'address' : 'addresses'}{parsed.invalid.length ? `, ${parsed.invalid.length} ${parsed.invalid.length === 1 ? 'looks' : 'look'} wrong: ${parsed.invalid.slice(0, 5).join(', ')}` : ''}</p> : null}
                    <div className="flex flex-wrap gap-1.5">
                        <select aria-label="Invite as" className={select} value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                            <option value="member">{data.roleNames.member}</option><option value="viewer">{data.roleNames.viewer}</option>
                            {data.viewerRole === 'owner' ? <option value="admin">{data.roleNames.admin}</option> : null}
                        </select>
                        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="Title (optional)" aria-label="Title" className="h-9 w-44" />
                        <select aria-label="Workspace" className={select} value={childId} onChange={(e) => { setChildId(e.target.value); setUnitId('') }}>
                            <option value="">No workspace</option>
                            {data.children.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                        </select>
                        {childId ? (
                            <select aria-label="Team" className={select} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                                <option value="">No team</option>
                                {units.map((u) => <option key={u.id} value={u.id}>{u.title}</option>)}
                            </select>
                        ) : null}
                    </div>
                    <label className="block space-y-1 text-sm"><span className="font-medium">Add a message (optional)</span>
                        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} maxLength={500} placeholder="Welcome to the class. We start on Monday." className="w-full rounded-md border border-border bg-background p-2 text-sm" />
                    </label>
                    {preview.data?.success ? (
                        <div>
                            <p className="nb-micro mb-1 text-muted-foreground">Preview · {preview.data.subject}</p>
                            <iframe title="Invite email preview" sandbox="" srcDoc={preview.data.html} className="h-72 w-full rounded-md border border-border bg-white" />
                        </div>
                    ) : null}
                    {result ? <p role="status" className="text-sm">{result}</p> : null}
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
                        <Button type="button" disabled={pending || parsed.valid.length === 0} onClick={send}>{parsed.valid.length ? `Invite ${parsed.valid.length} ${parsed.valid.length === 1 ? 'person' : 'people'}` : 'Invite'}</Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
