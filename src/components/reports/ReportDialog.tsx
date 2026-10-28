'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { Flag } from 'lucide-react'

import { reportContentAction } from '@/app/actions/trust'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/lib/feedback'
import { REPORT_REASONS, REPORT_REASON_LABEL, type ReportReason, type ReportTargetKind } from '@/lib/organizations/trust-rules'

// Report (report §30.3): orgs, projects, posts, announcements, docs and comments. Platform admins review it.

export function ReportDialog({ kind, targetId, noun, open, onOpenChange }: { kind: ReportTargetKind; targetId: string; noun: string; open: boolean; onOpenChange: (open: boolean) => void }) {
    const [reason, setReason] = useState<ReportReason | null>(null)
    const [details, setDetails] = useState('')
    const [pending, start] = useTransition()
    const submit = () => start(async () => {
        if (!reason) return
        const result = await reportContentAction({ kind, targetId, reason, details: details.trim() || undefined })
        if (!result.success) return void toast.error(result.error)
        toast.success('Thanks. Our team will review it.')
        onOpenChange(false)
        setReason(null)
        setDetails('')
    })
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Report this {noun}</DialogTitle>
                    <DialogDescription>Only the NetworkBase team sees reports. They are anonymous to the people involved.</DialogDescription>
                </DialogHeader>
                <fieldset className="space-y-2 text-sm">
                    <legend className="sr-only">Reason</legend>
                    {REPORT_REASONS.map((value) => (
                        <label key={value} className="flex items-center gap-2">
                            <input type="radio" name="report-reason" checked={reason === value} onChange={() => setReason(value)} /> {REPORT_REASON_LABEL[value]}
                        </label>
                    ))}
                </fieldset>
                <label className="block text-sm">Details (optional)
                    <textarea className="mt-1 min-h-20 w-full rounded-[5px] border border-border bg-background p-2 text-sm" maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} />
                </label>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button disabled={!reason || pending} onClick={submit}>Send report</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

/** A plain "Report" control that opens the dialog; `children` replaces the default label. */
export function ReportButton({ kind, targetId, noun, className, children }: { kind: ReportTargetKind; targetId: string; noun: string; className?: string; children?: ReactNode }) {
    const [open, setOpen] = useState(false)
    return (
        <>
            <button type="button" onClick={() => setOpen(true)} className={className ?? 'inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground'}>
                {children ?? <><Flag className="size-3.5" aria-hidden="true" />Report</>}
            </button>
            {open ? <ReportDialog kind={kind} targetId={targetId} noun={noun} open={open} onOpenChange={setOpen} /> : null}
        </>
    )
}
