'use client'

import { useState } from 'react'
import { ShieldCheck, Terminal } from '@/components/ui/icons'

import { grantCliStepUpAction } from '@/app/actions/cli-step-up'
import { useStepUp } from '@/components/trust/StepUp'

/** Report F5: one button; the step-up dialog when a fresh verification is needed; then "go back to your terminal". */
export default function VerifyClient({ sessionId, device }: { sessionId: string; device: { name: string; version: string | null } | null }) {
    const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
    const [error, setError] = useState<string | null>(null)
    const { needs, dialog } = useStepUp('Your terminal asked to do something risky, like archiving or exporting a workspace. Confirm it’s you to allow it for 10 minutes.')
    async function verify() {
        setState('busy')
        const res = await grantCliStepUpAction(sessionId)
        if (needs(res as never, () => void verify())) { setState('idle'); return }
        if (!res.success) { setError(res.error); setState('error'); return }
        setState('done')
    }
    return (
        <main className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-4 px-4 py-16">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Terminal className="size-4" aria-hidden="true" /> NetworkBase CLI</div>
            <h1 className="text-xl font-semibold text-foreground">Verify your terminal</h1>
            {!device ? (
                <p role="alert" className="text-sm text-destructive">This link isn’t for one of your terminal sign-ins. Run the command again in your terminal.</p>
            ) : state === 'done' ? (
                <p role="status" className="flex items-center gap-2 text-sm text-foreground"><ShieldCheck className="size-4 text-[var(--status-success)]" aria-hidden="true" /> Done. Go back to your terminal; it can continue for the next 10 minutes.</p>
            ) : (
                <>
                    <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">{device.name}</span>{device.version ? ` · nb ${device.version}` : ''} wants to do a risky action, like archiving or exporting a workspace. Allow it for 10 minutes.
                    </p>
                    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                    <button type="button" onClick={() => void verify()} disabled={state === 'busy'}
                        className="inline-flex h-9 w-fit items-center gap-2 rounded-[5px] bg-[#D14E24] px-4 text-sm font-medium text-white disabled:opacity-60">
                        <ShieldCheck className="size-4" aria-hidden="true" />{state === 'busy' ? 'Verifying…' : 'Verify it’s me'}
                    </button>
                </>
            )}
            {dialog}
        </main>
    )
}
