'use client'

import { useState } from 'react'

import SecurityStepUpDialog from '@/components/settings/SecurityStepUpDialog'
import type { SecurityStepUpMethod } from '@/lib/security/step-up-methods'

type StepUp = { methods: SecurityStepUpMethod[]; factorId?: string }

/**
 * Fresh verification for the console's riskiest actions (F16): when an action answers with `stepUp`, ask for the
 * authenticator (or password) and run it again.
 */
export function useStepUp(description: string) {
    const [pending, setPending] = useState<(StepUp & { retry: () => void }) | null>(null)
    /** True when the result asked for a step-up; the dialog is then open and retries on success. */
    const needs = (result: { success: boolean } & Partial<{ stepUp: StepUp }>, retry: () => void) => {
        if (result.success || !result.stepUp?.methods.length) return false
        setPending({ ...result.stepUp, retry })
        return true
    }
    const dialog = pending ? (
        <SecurityStepUpDialog open onOpenChange={(open) => !open && setPending(null)} title="Verify it’s you" description={description}
            availableMethods={pending.methods} factorId={pending.factorId} onVerified={() => { const retry = pending.retry; setPending(null); retry() }} />
    ) : null
    return { needs, dialog }
}
