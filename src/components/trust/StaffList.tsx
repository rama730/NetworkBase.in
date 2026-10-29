'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { setStaffRoleAction } from '@/app/actions/moderation-staff'
import SecurityStepUpDialog from '@/components/settings/SecurityStepUpDialog'
import { FIELD } from '@/components/trust/NewCaseDialog'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/feedback'
import type { SecurityStepUpMethod } from '@/lib/security/step-up-methods'
import type { StaffRole } from '@/lib/trust/staff'

/** Staff list (F17): admins add or remove staff; a change applies at the person's next sign-in. */
export function StaffList({ staff, canEdit }: { staff: Array<{ id: string; role: StaffRole; name: string | null; email: string | null }>; canEdit: boolean }) {
    const router = useRouter()
    const [who, setWho] = useState('')
    const [role, setRole] = useState<StaffRole>('moderator')
    const [pending, start] = useTransition()
    const [stepUp, setStepUp] = useState<{ methods: SecurityStepUpMethod[]; factorId?: string; retry: () => void } | null>(null)
    const run = (target: string, next: StaffRole | null, done: string) => start(async () => {
        const result = await setStaffRoleAction(target, next)
        if (!result.success && 'stepUp' in result && result.stepUp.methods.length) return setStepUp({ ...result.stepUp, retry: () => run(target, next, done) })
        toast(result.success ? done : result.error)
        if (result.success) { setWho(''); router.refresh() }
    })
    return (
        <div className="space-y-3">
            <ul className="divide-y divide-border">
                {staff.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 py-1.5 text-[13px]">
                        <span className="min-w-0 flex-1 truncate">{s.name ?? s.email ?? s.id}</span>
                        <span className="nb-meta">{s.role}</span>
                        {canEdit ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(s.id, null, `${s.name ?? 'Staff member'} removed from staff`)}>Remove</Button> : null}
                    </li>
                ))}
            </ul>
            {canEdit ? (
                <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(who, role, `${who} is now ${role === 'admin' ? 'an admin' : 'a moderator'}`) }}>
                    <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="@handle or email" aria-label="Person" className={`${FIELD} mt-0 h-[var(--ui-control-height)] min-w-0 flex-1`} />
                    <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} aria-label="Role" className={`${FIELD} mt-0 h-[var(--ui-control-height)] w-auto`}>
                        <option value="moderator">Moderator</option><option value="admin">Admin</option>
                    </select>
                    <Button type="submit" variant="outline" disabled={pending || !who.trim()}>Add to staff</Button>
                </form>
            ) : <p className="text-[13px] text-muted-foreground">Only admins change staff.</p>}
            <p className="nb-meta">Changes apply when the person next signs in. Staff need an authenticator.</p>
            {stepUp ? (
                <SecurityStepUpDialog open onOpenChange={(open) => !open && setStepUp(null)} title="Verify it’s you" description="Changing staff needs one more check."
                    availableMethods={stepUp.methods} factorId={stepUp.factorId} onVerified={() => { const retry = stepUp.retry; setStepUp(null); retry() }} />
            ) : null}
        </div>
    )
}
