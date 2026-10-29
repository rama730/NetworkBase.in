'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition, type ReactNode } from 'react'

import { openCaseAction } from '@/app/actions/moderation-staff'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { REASON_RULES, REPORT_REASON_LABEL, REPORT_REASONS, type ReportReason } from '@/lib/trust/rules'

export const FIELD = 'mt-1.5 w-full rounded-[5px] border border-input bg-card px-3 text-[13px] font-normal text-foreground'

/** New case (17.12) and "Act on account" (17.8, pre-filled with the @handle). */
export function NewCaseDialog({ trigger, what = '' }: { trigger: ReactNode; what?: string }) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [reason, setReason] = useState<ReportReason>('other')
    const [pending, start] = useTransition()
    const submit = (form: FormData) => start(async () => {
        const result = await openCaseAction({
            what: String(form.get('what') ?? ''), reason, severity: (form.get('severity') || undefined) as 'urgent' | 'high' | 'normal' | undefined,
            source: form.get('source') as 'email' | 'staff' | 'legal', details: String(form.get('details') ?? '') || undefined,
            emailRef: String(form.get('emailRef') ?? '') || undefined, legalHold: form.get('legalHold') === 'on',
        })
        if (!result.success) return setError(result.error)
        setOpen(false)
        router.push(`/admin/trust/cases/${result.label}`)
    })
    return (
        <Dialog open={open} onOpenChange={(next) => { setOpen(next); setError(null) }}>
            <DialogTrigger asChild>{trigger}</DialogTrigger>
            <DialogContent className="max-w-[460px]">
                <DialogHeader>
                    <DialogTitle>New case</DialogTitle>
                    <DialogDescription>For reports that came by email, legal requests, or something you found yourself.</DialogDescription>
                </DialogHeader>
                <form id="new-case" action={submit} className="space-y-3">
                    <label className="block text-sm font-medium">What
                        <input name="what" required defaultValue={what} className={`${FIELD} h-[var(--ui-control-height)]`} placeholder="Link to a profile, workspace or org, or @handle" />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                        <label className="block text-sm font-medium">Source
                            <select name="source" defaultValue={what ? 'staff' : 'email'} className={`${FIELD} h-[var(--ui-control-height)]`}>
                                <option value="email">Email</option><option value="staff">Staff</option><option value="legal">Legal</option>
                            </select>
                        </label>
                        <label className="block text-sm font-medium">Severity
                            <select name="severity" key={reason} defaultValue={REASON_RULES[reason].severity} className={`${FIELD} h-[var(--ui-control-height)]`}>
                                <option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option>
                            </select>
                        </label>
                    </div>
                    <label className="block text-sm font-medium">Reason
                        <select value={reason} onChange={(e) => setReason(e.target.value as ReportReason)} className={`${FIELD} h-[var(--ui-control-height)]`}>
                            {REPORT_REASONS.map((r) => <option key={r} value={r}>{REPORT_REASON_LABEL[r]}</option>)}
                        </select>
                    </label>
                    <label className="block text-sm font-medium">Details
                        <textarea name="details" rows={3} maxLength={2000} className={`${FIELD} py-2`} />
                    </label>
                    <label className="block text-sm font-medium">Email reference (optional)
                        <input name="emailRef" maxLength={300} className={`${FIELD} h-[var(--ui-control-height)]`} placeholder="The support@ subject line" />
                    </label>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="legalHold" /> Legal hold (keep everything past retention)</label>
                    {error ? <p role="alert" className="rounded-[5px] border border-destructive/30 bg-[var(--status-danger-soft)] px-3 py-2 text-[13px]">{error}</p> : null}
                </form>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                    <Button type="submit" form="new-case" disabled={pending}>{pending ? 'Opening…' : 'Open case'}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
