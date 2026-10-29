'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Flag } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { BLOCK_BY_DEFAULT, REASON_RULES, REPORT_REASON_LABEL, reasonsFor, type ReportReason, type ReportTargetKind } from '@/lib/trust/rules'

// Reporting (docs/trust-and-safety-concept.md §5, C15–C17): one dialog for every reportable thing, opened from the
// last item of its "⋯" menu. The case number confirms it inside the dialog; failures stay in the dialog.

export type ReportTarget = {
    kind: ReportTargetKind
    targetId: string
    /** A chat message: its sequence in the channel (targetId is the channel). */
    seq?: number | null
    /** "post", "comment", "message", "workspace"… */
    noun: string
    /** For people and messages: offers "Also block <name>". */
    personName?: string | null
}

type Sent = { caseNumber: string; deadlineHours: number; blocked: boolean }

const deadlineText = (hours: number) => (hours <= 1 ? 'within 1 hour' : hours <= 24 ? 'within 24 hours' : 'within 3 days')

export function ReportDialog({ kind, targetId, seq, noun, personName, open, onOpenChange }: ReportTarget & { open: boolean; onOpenChange: (open: boolean) => void }) {
    const [reason, setReason] = useState<ReportReason | null>(null)
    const [details, setDetails] = useState('')
    const [alsoBlock, setAlsoBlock] = useState(false)
    const [blockTouched, setBlockTouched] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [sent, setSent] = useState<Sent | null>(null)
    const [pending, start] = useTransition()
    const pathname = usePathname()
    const canBlock = Boolean(personName) && (kind === 'person' || kind === 'chat_message')
    const urgent = reason ? REASON_RULES[reason].severity === 'urgent' : false

    const pick = (value: ReportReason) => {
        setReason(value)
        setError(null)
        // Ticked by default for the reasons where distance matters most (T3), until the person changes it.
        if (canBlock && !blockTouched) setAlsoBlock(BLOCK_BY_DEFAULT.includes(value))
    }
    const close = (next: boolean) => {
        onOpenChange(next)
        if (!next) { setReason(null); setDetails(''); setAlsoBlock(false); setBlockTouched(false); setError(null); setSent(null) }
    }
    const submit = () => start(async () => {
        if (!reason) return setError('Pick a reason first.')
        // Loaded on send, so screens that only show the menu don't pull in the server action.
        const { reportAction } = await import('@/app/actions/moderation')
        const result = await reportAction({ kind, targetId, seq: seq ?? null, reason, details: details.trim() || undefined, alsoBlock: canBlock && alsoBlock })
        if (!result.success) return setError(result.error)
        setSent({ caseNumber: result.caseNumber, deadlineHours: result.deadlineHours, blocked: result.blocked })
    })

    return (
        <Dialog open={open} onOpenChange={close}>
            {/* Fixed header and footer, one scrolling body: the dialog always fits the screen (spec: dialog, paper footer). */}
            <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[460px]">
                {sent ? (
                    <>
                        <DialogHeader className="px-6 pt-5 pb-4 pr-14">
                            <DialogTitle>Report sent</DialogTitle>
                            <DialogDescription>
                                Thanks. We&apos;ll review it {deadlineText(sent.deadlineHours)} and let you know in your notifications.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-2 px-6 pb-5">
                            <p className="nb-compact text-foreground">Case <span className="font-mono">{sent.caseNumber}</span>{sent.blocked && personName ? ` · You've also blocked ${personName}.` : ''}</p>
                            <p className="nb-compact text-muted-foreground">You can follow it in <Link href="/settings#settings-privacy-reports" className="underline underline-offset-4">Settings → Privacy → Your reports</Link>.</p>
                        </div>
                        <DialogFooter className="border-t border-border bg-muted px-6 py-4"><Button onClick={() => close(false)}>Done</Button></DialogFooter>
                    </>
                ) : (
                    <>
                        <DialogHeader className="px-6 pt-5 pb-4 pr-14">
                            <DialogTitle>Report {kind === 'person' && personName ? personName : `this ${noun}`}</DialogTitle>
                            <DialogDescription>We never tell them who reported. In an organization, its admins may see what you write here, but not your name.</DialogDescription>
                        </DialogHeader>
                        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-5">
                            <fieldset>
                                <legend className="nb-ui-label mb-2 text-foreground">Why are you reporting it?</legend>
                                <div className="grid gap-1">
                                    {reasonsFor(kind).map((value) => (
                                        <label key={value} className="flex cursor-pointer items-start gap-2.5 rounded-[5px] border border-transparent px-2.5 py-2 transition-colors duration-[130ms] hover:bg-muted has-[:checked]:border-border has-[:checked]:bg-secondary has-[:focus-visible]:border-foreground">
                                            <input type="radio" name="report-reason" value={value} className="peer sr-only" checked={reason === value} onChange={() => pick(value)} />
                                            {/* Spec radio: 16px, strong border; selected shows the accent border and an 8px dot. */}
                                            <span aria-hidden="true" className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border border-input bg-card peer-checked:border-primary">
                                                {reason === value ? <span className="size-2 rounded-full bg-primary" /> : null}
                                            </span>
                                            <span className="min-w-0">
                                                <span className="block text-[13px] font-medium leading-[1.4] text-foreground">{REPORT_REASON_LABEL[value]}</span>
                                                <span className="mt-0.5 block text-[13px] leading-[1.5] text-muted-foreground">{REASON_RULES[value].hint}</span>
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </fieldset>
                            {urgent ? (
                                <p role="note" className="rounded-[5px] border border-[var(--status-warning)]/30 bg-[var(--status-warning-soft)] px-3 py-2 text-[13px] text-foreground">
                                    If someone is in immediate danger, contact local emergency services (112 in India).
                                </p>
                            ) : null}
                            <div>
                                <label htmlFor="report-details" className="nb-ui-label block text-foreground">Details <span className="font-normal text-muted-foreground">(optional)</span></label>
                                <textarea id="report-details" className="mt-1.5 min-h-[88px] w-full resize-y rounded-[5px] border border-input bg-card px-3 py-2.5 text-[13px] leading-[1.5] text-foreground placeholder:text-muted-foreground focus-visible:border-foreground focus-visible:outline-none" rows={3} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="What should we know?" />
                                {kind === 'chat_message' ? <p className="mt-1.5 text-[13px] text-muted-foreground">We&apos;ll include this message and the 5 before it, so the team sees the context.</p> : null}
                            </div>
                            {canBlock ? (
                                <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-foreground">
                                    <Checkbox checked={alsoBlock} onCheckedChange={(value) => { setAlsoBlock(value === true); setBlockTouched(true) }} /> Also block {personName}
                                </label>
                            ) : null}
                            {error ? (
                                <p role="alert" className="rounded-[5px] border border-destructive/30 bg-[var(--status-danger-soft)] px-3 py-2 text-[13px] text-foreground">
                                    {error}{error.startsWith('Sign in') ? <> <Link href={`/login?next=${encodeURIComponent(pathname || '/')}`} className="font-medium underline underline-offset-4">Sign in</Link></> : null}
                                </p>
                            ) : null}
                            <p className="text-[12px] text-muted-foreground">Copyright and legal requests: <Link href="/copyright" className="underline underline-offset-4">Copyright</Link> · <Link href="/grievances" className="underline underline-offset-4">Grievances</Link></p>
                        </div>
                        <DialogFooter className="border-t border-border bg-muted px-6 py-4">
                            <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
                            <Button className="min-w-[112px]" disabled={!reason || pending} onClick={submit}>{pending ? 'Sending…' : 'Send report'}</Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}

/**
 * The "⋯" menu's last item (C15, C16): a divider, then "Report <noun>". Hidden on your own things; signed out, the
 * dialog says "Sign in to report" with a link back to the same page; already reported, it says so.
 */
export function ReportMenuItem({ isOwn, reported, onReport, noun, first = false }: { isOwn?: boolean; reported?: string | null; onReport: () => void; noun: string; first?: boolean }) {
    if (isOwn) return null
    return (
        <>
            {/* The divider sets Report apart from the item's own actions; alone in a menu it needs none. */}
            {first ? null : <DropdownMenuSeparator />}
            {reported ? (
                <DropdownMenuItem disabled><Flag className="size-4" aria-hidden="true" />Reported · in review <span className="ml-auto font-mono text-[11px]">{reported}</span></DropdownMenuItem>
            ) : (
                <DropdownMenuItem onSelect={onReport}>
                    <Flag className="size-4" aria-hidden="true" />Report {noun}
                </DropdownMenuItem>
            )}
        </>
    )
}

/** A standalone "⋯"-less trigger for places that already own a menu button (the menu item opens this). */
export function useReportDialog(target: ReportTarget) {
    const [open, setOpen] = useState(false)
    return {
        open: () => setOpen(true),
        dialog: open ? <ReportDialog {...target} open={open} onOpenChange={setOpen} /> : null,
    }
}
