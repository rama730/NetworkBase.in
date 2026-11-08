'use client'

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Building2, Check, Clock, Code2, Copy, Mail, UserCheck } from 'lucide-react'

import { renameOrgHandleAction } from '@/app/actions/organizations'
import { askParentOrgAction, cancelOrgVerificationAction, checkOrgProofAction, confirmOrgEmailCodeAction, requestOrgEmailCodeAction, requestOrgVerificationAction, searchParentOrgsAction } from '@/app/actions/trust'
import { Button } from '@/components/ui/button'
import { useRefreshSidebar } from '@/hooks/useRefreshSidebar'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/feedback'
import type { OrgDetail } from '@/lib/organizations/detail'
import { orgDiscoverStatus } from '@/lib/organizations/profile-rules'
import { typeProfile } from '@/lib/organizations/type-profile'
import type { OrgMemberRole } from '@/lib/organizations/settings'
import { cn } from '@/lib/utils'
import { fieldError, fieldHint, fieldLabel } from '@/lib/organizations/display'
import { Notice } from '@/components/ui/notice'
import { VerifiedMark } from '@/components/organizations/org-ui'

// Settings → Visibility and discovery (2026-11-05-org-address-discovery-verification-findings.md §4, §5, §10): how
// outsiders find the organization — On Discover, the Web address and the Verified badge, each split by a hairline
// inside the one section, under Visibility and above What visitors can see.

const DATE = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })
const labelClass = fieldLabel
const helpClass = fieldHint
const linkClass = 'nb-link text-[13px]'
const SITE = 'networkbase.in'

const copy = (text: string, done: string) => void navigator.clipboard?.writeText(text).then(() => toast.success(done), () => toast.error('Couldn’t copy. Select it and copy it yourself.'))

/** One part of the rule: ✓ when met, otherwise what's missing and its action. */
function Part({ met, label, missing, action }: { met: boolean; label: string; missing: string; action?: ReactNode }) {
    return (
        <li className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 text-[13px]">
            {met ? <Check className="size-4 text-[var(--status-success)]" aria-hidden="true" /> : <span aria-hidden="true" className="size-1.5 justify-self-center rounded-full bg-muted-foreground" />}
            <span className={met ? 'text-foreground' : 'text-muted-foreground'}>{met ? label : missing}<span className="sr-only">{met ? ' (done)' : ' (to do)'}</span></span>
            {met ? null : action}
        </li>
    )
}

/** §4.2 On Discover: whether outsiders can find it there, and if not, why and what to do. */
export function OrgOnDiscover({ organization, visibility, handle, onOpenSection }: {
    organization: OrgDetail; visibility: string | null; handle: string | null; onOpenSection: (id: string) => void
}) {
    const status = orgDiscoverStatus({
        verified: organization.verified, hasDescription: organization.hasDescription, workspaces: organization.childProjectCount, members: organization.memberCount,
        visibility, archived: organization.archived, deletionScheduledAt: organization.deletionScheduledAt, suspended: organization.suspended, discoverHidden: organization.discoverHidden,
    })
    const where = handle ? `/org/${encodeURIComponent(handle)}` : null
    const parts = status.state === 'waiting' ? status.parts : { description: true, content: true }
    const moderation = <button type="button" className={linkClass} onClick={() => onOpenSection('org-moderation')}>Go to Moderation</button>
    const line = (icon: ReactNode, text: string, tone: 'muted' | 'warning' | 'success' = 'muted') => (
        <p className={cn('flex items-start gap-2 text-[13px]', tone === 'warning' ? 'text-[var(--status-warning)]' : tone === 'success' ? 'text-[var(--status-success)]' : 'text-muted-foreground')}>{icon}<span>{text}</span></p>
    )
    return (
        <div data-testid="org-on-discover">
            <h3 className={labelClass}>Shown on Discover</h3>
            <p className={helpClass}>Whether people who don’t have the link can find it under Organizations on Discover, and in search engines.</p>
            <div className="mt-3 space-y-2">
                {status.state === 'private' ? line(null, 'Not on Discover. Private organizations never show there or in search engines.')
                    : status.state === 'archived' ? line(null, 'Not on Discover while it’s archived.')
                        : status.state === 'deleting' ? line(null, 'Not on Discover while it’s scheduled for deletion.')
                            : status.state === 'suspended' ? <div className="flex flex-wrap items-center gap-3">{line(null, 'Not on Discover while it’s suspended.')}{moderation}</div>
                                : status.state === 'hidden' ? <div className="flex flex-wrap items-center gap-3">{line(null, 'NetworkBase hid it from Discover.')}{moderation}</div>
                                    : status.state === 'listed' ? <>
                                        <div className="flex flex-wrap items-center gap-3">
                                            {line(<Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />, 'On Discover. People find it under Organizations, and search engines can list it.', 'success')}
                                            {handle ? <Link href={`/discover?org=${encodeURIComponent(handle)}`} className={linkClass}>View on Discover</Link> : null}
                                        </div>
                                        <p className={helpClass}>Just met the last part? It can take a few minutes to appear.</p>
                                    </> : <>
                                        {line(<Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />, 'Not on Discover yet', 'warning')}
                                        <p className="text-[13px] text-muted-foreground">Organizations show once they have a tagline or description, and a workspace or a second member, or once they’re verified.</p>
                                        <ul className="mt-1 space-y-1.5" aria-label="What’s needed">
                                            <Part met={parts.description} label="Tagline or description" missing="Add a tagline or description"
                                                action={<button type="button" className={linkClass} onClick={() => onOpenSection('general')}>Go to Details</button>} />
                                            <Part met={parts.content} label={`${organization.childProjectCount} ${organization.childProjectCount === 1 ? 'workspace' : 'workspaces'} · ${organization.memberCount} ${organization.memberCount === 1 ? 'member' : 'members'}`}
                                                missing="Add a workspace or invite someone"
                                                action={<span className="flex gap-3">{handle ? <Link href={`/workspaces/new?org=${encodeURIComponent(handle)}`} className={linkClass}>New workspace</Link> : null}{where ? <Link href={`${where}?tab=members`} className={linkClass}>Invite people</Link> : null}</span>} />
                                            <li className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 text-[13px]">
                                                <span aria-hidden="true" className="justify-self-center text-muted-foreground">or</span>
                                                <span className="text-muted-foreground">Get verified, and it shows at once</span>
                                                <a href="#org-verified-badge" className={linkClass}>Verified badge</a>
                                            </li>
                                        </ul>
                                    </>}
            </div>
        </div>
    )
}

/** §4.3 Web address: the link people share. The owner changes it once every 7 days; the old one redirects 90 days. */
export function OrgWebAddress({ orgId, organization, role, handle }: { orgId: string; organization: OrgDetail; role: OrgMemberRole; handle: string | null }) {
    const router = useRouter()
    const refreshSidebar = useRefreshSidebar()
    const [value, setValue] = useState(handle ?? '')
    const [pending, start] = useTransition()
    const [error, setError] = useState<string | null>(null)
    const isOwner = role === 'owner'
    const link = `${SITE}/org/${handle ?? ''}`
    const locked = Boolean(organization.handleRenameAvailableAt)
    return (
        <div data-testid="org-web-address">
            <h3 className={labelClass}>Web address</h3>
            <p className={helpClass}>The link you share with people. It isn’t how they join; that’s the join code.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="nb-meta min-w-0 break-all text-foreground">{link}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => copy(`https://${link}`, 'Link copied')}><Copy className="size-3.5" aria-hidden="true" />Copy</Button>
            </div>
            {isOwner ? (
                <div className="mt-3">
                    <label htmlFor="org-handle" className={labelClass}>Change the address</label>
                    <div className="mt-1.5 flex max-w-xl flex-wrap items-center gap-2">
                        {/* The fixed part is the input's leading affix (spec §10 Input). */}
                        <div className="flex h-[var(--ui-control-height)] min-w-0 flex-1 items-stretch overflow-hidden rounded-md border border-input bg-card sm:max-w-md">
                            <span className="nb-meta flex shrink-0 items-center border-r border-border bg-muted px-2" aria-hidden="true">{SITE}/org/</span>
                            <input id="org-handle" value={value} onChange={(e) => { setValue(e.target.value); setError(null) }} disabled={locked} maxLength={40} className="min-w-0 flex-1 bg-transparent px-2 text-[15px] outline-none disabled:opacity-50" aria-describedby="org-handle-help" />
                        </div>
                        <Button variant="outline" size="sm" disabled={pending || locked || value.trim().toLowerCase() === handle} onClick={() => start(async () => {
                            const r = await renameOrgHandleAction(orgId, value)
                            if (!r.success) return setError(r.error ?? 'Couldn’t change it.')
                            toast.success('Address changed')
                            refreshSidebar()
                            router.replace(`/org/${value.trim().toLowerCase()}?tab=settings&settings=access`)
                        })}>Change</Button>
                    </div>
                    <p id="org-handle-help" className={helpClass}>{locked ? `You can change it again on ${DATE.format(new Date(organization.handleRenameAvailableAt!))}.` : 'Change it once every 7 days. The old link keeps working for 90 days.'}</p>
                    {error ? <p role="alert" className={fieldError}>{error}</p> : null}
                </div>
            ) : <p className={helpClass}>Only the owner can change it.</p>}
        </div>
    )
}

type Way = 'email' | 'parent' | 'code' | 'team'

/** §5 Verified badge: what it is, whether you need it, and four ways in. The owner asks; admins see the state. */
export function OrgVerifiedBadge({ orgId, organization, role, onOpenSection }: { orgId: string; organization: OrgDetail; role: OrgMemberRole; onOpenSection: (id: string) => void }) {
    const router = useRouter()
    const isOwner = role === 'owner'
    const [open, setOpen] = useState<Way | null>(null)
    const [pending, start] = useTransition()
    const [error, setError] = useState<string | null>(null)
    const run = (work: () => Promise<{ success: boolean; error?: string }>, done: string, after?: () => void) => start(async () => {
        setError(null)
        const r = await work()
        if (!r.success) return setError(r.error ?? 'Couldn’t do that. Try again.')
        toast.success(done)
        after?.()
        router.refresh()
    })
    const pendingAsk = organization.verificationPending
    const outcome = organization.verificationOutcome
    const ways: Way[] = typeProfile(organization.type).verifyFirst === 'institution' ? ['email', 'parent', 'code', 'team'] : ['email', 'code', 'parent', 'team']
    const tryAnother = isOwner ? <button type="button" className={linkClass} disabled={pending} onClick={() => run(() => cancelOrgVerificationAction(orgId), 'Choose another way', () => setOpen(null))}>Try another way</button> : null
    return (
        <div id="org-verified-badge" data-testid="org-verified-badge" className="scroll-mt-24">
            <h3 className={labelClass}>Verified badge</h3>
            <p className={helpClass}>A badge beside the name that tells visitors NetworkBase checked you’re real.</p>
            <Notice className="mt-3"><span className="font-medium">Do you need it?</span> Useful for colleges, companies and public communities. A class usually doesn’t need it: it reaches Discover by itself once it has a description and a workspace or a second member.</Notice>
            <div className="mt-3 space-y-2" aria-live="polite">
                {organization.verified ? (
                    <p className="flex items-center gap-2 text-[13px] text-foreground"><VerifiedMark label={organization.verifiedLabel} />{organization.verifiedLabel}{organization.verifiedAt ? ` · since ${DATE.format(new Date(organization.verifiedAt))}` : ''}</p>
                ) : pendingAsk?.method === 'email' ? (
                    <EmailCodeStep orgId={orgId} masked={pendingAsk.masked} waitSeconds={pendingAsk.waitSeconds} isOwner={isOwner} tryAnother={tryAnother} onDone={() => router.refresh()} />
                ) : pendingAsk?.method === 'parent' ? (
                    <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground"><Clock className="size-4" aria-hidden="true" />Waiting for {pendingAsk.parentTitle} to confirm it.{tryAnother}</div>
                ) : pendingAsk?.method === 'team' ? (
                    <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground"><Clock className="size-4" aria-hidden="true" />Requested. The NetworkBase team will review it.{tryAnother}</div>
                ) : outcome ? (
                    <p className="text-[13px]">{outcome.state === 'declined' ? 'Not verified this time.' : 'The badge was removed.'}{outcome.reason ? ` ${outcome.reason}` : ''} {isOwner ? 'Try another way below.' : ''}</p>
                ) : null}
                {!isOwner && !organization.verified ? <p className={helpClass}>The owner can ask for this.</p> : null}
            </div>
            {!organization.verified && !pendingAsk ? (
                <div className="mt-3">
                    <p className={labelClass}>Ways to verify</p>
                    <ul className="mt-2 space-y-2">
                        {ways.map((way) => (
                            <WayRow key={way} way={way} organization={organization} isOwner={isOwner} open={open === way} onToggle={() => { setOpen(open === way ? null : way); setError(null) }}>
                                {way === 'email' ? <EmailStart orgId={orgId} pending={pending} run={run} />
                                    : way === 'parent' ? <ParentStart orgId={orgId} organization={organization} pending={pending} run={run} onOpenSection={onOpenSection} />
                                        : way === 'code' ? <CodeStart orgId={orgId} organization={organization} pending={pending} run={run} onOpenSection={onOpenSection} />
                                            : <TeamStart orgId={orgId} pending={pending} run={run} />}
                            </WayRow>
                        ))}
                    </ul>
                    {error ? <p role="alert" className={fieldError}>{error}</p> : null}
                </div>
            ) : error ? <p role="alert" className={fieldError}>{error}</p> : null}
        </div>
    )
}

const WAY: Record<Way, { icon: typeof Mail; title: string; line: (o: OrgDetail) => string; button: (o: OrgDetail) => string }> = {
    email: { icon: Mail, title: 'School or work email', line: () => 'We email a code to an address on your domain, like @rvce.edu.in. Verified at once.', button: () => 'Use email' },
    parent: {
        icon: Building2, title: 'Confirmed by your parent organization',
        line: (o) => o.partOfOrg ? (o.partOfOrg.verified ? `${o.partOfOrg.title} is verified here. One of its admins confirms you.` : `${o.partOfOrg.title} isn’t verified yet, so it can’t confirm you.`) : 'Link “Part of” to an organization on NetworkBase that’s verified; one of its admins confirms you.',
        button: (o) => o.partOfOrg ? `Ask ${o.partOfOrg.title.length > 18 ? 'them' : o.partOfOrg.title}` : 'Link Part of',
    },
    code: { icon: Code2, title: 'A code on your website, GitHub or domain', line: () => 'Put a short code there, then Check. Verified at once.', button: () => 'Get code' },
    team: { icon: UserCheck, title: 'Ask our team', line: () => 'Tell us who you are and how to check. No website needed.', button: () => 'Ask' },
}

function WayRow({ way, organization, isOwner, open, onToggle, children }: { way: Way; organization: OrgDetail; isOwner: boolean; open: boolean; onToggle: () => void; children: ReactNode }) {
    const w = WAY[way]
    const Icon = w.icon
    return (
        <li className="rounded-md border border-border" data-testid={`verify-way-${way}`}>
            <div className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-2 px-3 py-2.5 text-[13px]">
                <Icon className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
                <span><span className="block font-medium text-foreground">{w.title}</span><span className="block text-muted-foreground">{w.line(organization)}</span></span>
                {isOwner ? <Button type="button" size="sm" variant="outline" aria-expanded={open} onClick={onToggle}>{w.button(organization)}</Button> : null}
            </div>
            {open && isOwner ? <div className="border-t border-border px-3 py-3">{children}</div> : null}
        </li>
    )
}

type Run = (work: () => Promise<{ success: boolean; error?: string }>, done: string, after?: () => void) => void

function EmailStart({ orgId, pending, run }: { orgId: string; pending: boolean; run: Run }) {
    const [email, setEmail] = useState('')
    return (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => requestOrgEmailCodeAction(orgId, email), 'Code sent') }}>
            <label className="min-w-0 flex-1"><span className={labelClass}>Email on your organization’s domain</span>
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@rvce.edu.in" autoComplete="email" className="mt-1" />
            </label>
            <Button type="submit" size="sm" disabled={pending || !email.includes('@')}>Send code</Button>
            <p className={cn(helpClass, 'basis-full')}>It needn’t be your sign-in email. Not Gmail, Outlook and the like; with a website in Links, an address on its domain. The code works for 10 minutes.</p>
        </form>
    )
}

/** Way 1, step 2: the code from the email, Resend after 45 seconds (3 an hour), or another way. */
function EmailCodeStep({ orgId, masked, waitSeconds, isOwner, tryAnother, onDone }: { orgId: string; masked: string; waitSeconds: number; isOwner: boolean; tryAnother: ReactNode; onDone: () => void }) {
    const [code, setCode] = useState('')
    const [wait, setWait] = useState(waitSeconds)
    const [pending, start] = useTransition()
    const [error, setError] = useState<string | null>(null)
    useEffect(() => { setWait(waitSeconds) }, [waitSeconds])
    useEffect(() => {
        if (wait <= 0) return
        const t = setTimeout(() => setWait((n) => n - 1), 1000)
        return () => clearTimeout(t)
    }, [wait])
    if (!isOwner) return <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><Clock className="size-4" aria-hidden="true" />A code was sent to {masked}.</p>
    return (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); start(async () => {
            setError(null)
            const r = await confirmOrgEmailCodeAction(orgId, code)
            if (!r.success) return setError(r.error)
            toast.success('Verified')
            onDone()
        }) }}>
            <p className="text-[13px] text-foreground">Enter the code sent to {masked}</p>
            <div className="flex flex-wrap items-center gap-2">
                <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" aria-label="6-digit code" placeholder="123456" className="w-32 font-mono tracking-[0.2em]" />
                <Button type="submit" size="sm" disabled={pending || code.length !== 6}>Verify</Button>
                {wait > 0 ? <span className="nb-meta">Resend in 0:{String(wait).padStart(2, '0')}</span>
                    : <button type="button" className={linkClass} disabled={pending} onClick={() => start(async () => {
                        setError(null)
                        const r = await cancelOrgVerificationAction(orgId)
                        if (!r.success) return setError(r.error)
                        onDone()
                    })}>Use a different address or resend</button>}
                {tryAnother}
            </div>
            {error ? <p role="alert" className={fieldError}>{error}</p> : null}
        </form>
    )
}

function ParentStart({ orgId, organization, pending, run, onOpenSection }: { orgId: string; organization: OrgDetail; pending: boolean; run: Run; onOpenSection: (id: string) => void }) {
    const parent = organization.partOfOrg
    if (!parent) return <p className="text-[13px] text-muted-foreground">In Organization profile, choose your parent from the list under “Part of”. <button type="button" className={linkClass} onClick={() => onOpenSection('org-profile')}>Go to Organization profile</button></p>
    if (!parent.verified) return <p className="text-[13px] text-muted-foreground">{parent.title} has to be verified on NetworkBase first. Try another way meanwhile.</p>
    return (
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
            <span className="text-muted-foreground">We’ll ask {parent.title}’s admins. They see it on their Overview and confirm or decline.</span>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => askParentOrgAction(orgId), `Asked ${parent.title}`)}>Ask {parent.title}</Button>
        </div>
    )
}

function CodeStart({ orgId, organization, pending, run, onOpenSection }: { orgId: string; organization: OrgDetail; pending: boolean; run: Run; onOpenSection: (id: string) => void }) {
    const code = organization.proofCode ?? ''
    return (
        <div className="space-y-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-md bg-muted px-2 py-1 font-mono text-[13px] text-foreground">{code}</code>
                <Button type="button" size="sm" variant="outline" onClick={() => copy(code, 'Code copied')}><Copy className="size-3.5" aria-hidden="true" />Copy</Button>
            </div>
            <ul className="space-y-2 text-muted-foreground">
                <li className="flex flex-wrap items-center justify-between gap-2"><span><span className="font-medium text-foreground">Website:</span> put the code anywhere on your home page, for example in a footer or a meta tag.</span>
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => checkOrgProofAction(orgId, 'website'), 'Verified')}>Check website</Button></li>
                <li className="flex flex-wrap items-center justify-between gap-2"><span><span className="font-medium text-foreground">GitHub:</span> put it in your GitHub organization’s description.</span>
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => checkOrgProofAction(orgId, 'github'), 'Verified')}>Check GitHub</Button></li>
                <li className="flex flex-wrap items-center justify-between gap-2"><span><span className="font-medium text-foreground">Domain:</span> add a TXT record with the code on your website’s domain.</span>
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => checkOrgProofAction(orgId, 'dns'), 'Verified')}>Check DNS</Button></li>
            </ul>
            <p className={helpClass}>We check the website or GitHub in your Links. {organization.hasWebsite ? null : <button type="button" className={linkClass} onClick={() => onOpenSection('links')}>Add it in Links</button>}</p>
        </div>
    )
}

function TeamStart({ orgId, pending, run }: { orgId: string; pending: boolean; run: Run }) {
    const [explanation, setExplanation] = useState('')
    const [links, setLinks] = useState('')
    const file = useRef<HTMLInputElement>(null)
    return (
        <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault()
            const form = new FormData()
            form.set('explanation', explanation)
            form.set('links', links)
            const doc = file.current?.files?.[0]
            if (doc) form.set('document', doc)
            run(() => requestOrgVerificationAction(orgId, form), 'Request sent')
        }}>
            <label className="block"><span className={labelClass}>Who you are, and how we can check it</span>
                <textarea required minLength={20} maxLength={2000} rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)}
                    placeholder="I teach CSE 3B at Northgate Institute. You can reach the department office at…" className="nb-textarea mt-1.5" />
            </label>
            <label className="block"><span className={labelClass}>Links that show it (optional, one per line)</span>
                <textarea rows={2} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://www.linkedin.com/company/…" className="nb-textarea mt-1.5" />
            </label>
            <label className="block"><span className={labelClass}>A document (optional)</span><span className={`block ${helpClass}`}>A letter or registration certificate. PDF, JPG, PNG or WebP, up to 3.5 MB.</span>
                <input ref={file} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="mt-1.5 block text-[13px] text-foreground file:mr-3 file:h-[var(--ui-control-height-sm)] file:rounded-md file:border file:border-border file:bg-card file:px-3 file:text-[13px] file:font-medium" />
            </label>
            <p className={helpClass}>Only the NetworkBase team sees it, and the document is deleted 30 days after we decide.</p>
            <Button type="submit" size="sm" disabled={pending || explanation.trim().length < 20}>Send request</Button>
        </form>
    )
}

/** G8: "Part of" as text, optionally linked to an organization on NetworkBase (search as you type). */
export function PartOfField({ orgId, value, linked, disabled, onChange, inputId, placeholder }: {
    orgId: string | null; value: string; linked: { id: string; title: string; verified: boolean } | null; disabled?: boolean
    onChange: (next: { text: string; linked: { id: string; title: string; verified: boolean } | null }) => void
    inputId?: string; placeholder?: string
}) {
    const [focused, setFocused] = useState(false)
    const [active, setActive] = useState(0)
    const q = value.trim()
    const results = useQuery({ queryKey: ['part-of-search', orgId, q], queryFn: () => searchParentOrgsAction(orgId, q), enabled: focused && q.length >= 2 && !linked, staleTime: 30_000 })
    const list = results.data ?? []
    const open = focused && list.length > 0 && !linked
    const pick = (o: { id: string; title: string; verified: boolean }) => { onChange({ text: o.title, linked: { id: o.id, title: o.title, verified: o.verified } }); setFocused(false) }
    return (
        <div className="relative">
            <Input id={inputId} placeholder={placeholder} value={value} disabled={disabled} maxLength={100} className="mt-2" aria-label="Part of" role="combobox" aria-expanded={open} aria-controls="part-of-options" aria-autocomplete="list"
                aria-activedescendant={open ? `part-of-option-${active}` : undefined}
                onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 150)}
                onKeyDown={(e) => {
                    // Listbox keys (spec §34): arrows move, Enter picks, Escape closes.
                    if (!open) return
                    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % list.length) }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + list.length) % list.length) }
                    else if (e.key === 'Enter') { e.preventDefault(); const o = list[active]; if (o) pick(o) }
                    else if (e.key === 'Escape') setFocused(false)
                }}
                onChange={(e) => { setActive(0); onChange({ text: e.target.value, linked: null }) }} />
            {linked ? (
                <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                    <Building2 className="size-4" aria-hidden="true" />Linked to {linked.title} on NetworkBase{linked.verified ? <VerifiedMark label="Verified" size={14} /> : null}
                    {disabled ? null : <button type="button" className="nb-link" onClick={() => onChange({ text: value, linked: null })}>Unlink</button>}
                </p>
            ) : open ? (
                <ul id="part-of-options" role="listbox" aria-label="Organizations on NetworkBase" className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-md">
                    {list.map((o, i) => (
                        <li key={o.id} id={`part-of-option-${i}`} role="option" aria-selected={i === active}
                            className={cn('flex min-h-[34px] cursor-pointer items-center justify-between gap-2 px-3 text-[13px]', i === active ? 'bg-muted' : 'hover:bg-muted')}
                            onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(o)}>
                            <span className="truncate">{o.title}</span>{o.verified ? <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground"><VerifiedMark size={14} />Verified</span> : null}
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    )
}
