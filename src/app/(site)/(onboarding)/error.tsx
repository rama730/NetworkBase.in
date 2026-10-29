'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function OnboardingError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    useEffect(() => {
        console.error('Onboarding error:', error)
    }, [error])

    return (
        <main className="onb-page flex min-h-dvh items-center justify-center px-4">
            <div className="max-w-md text-center" role="alert">
                <h1 className="text-xl font-semibold text-foreground">Setup couldn’t continue</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Steps you already saved are kept, and what you typed since is still in this browser. Try again; if it keeps
                    happening, contact support.
                </p>
                <Button type="button" onClick={reset} className="mt-6 min-h-11">
                    Try again
                </Button>
                {error.digest ? <p className="mt-4 font-mono text-[11px] text-muted-foreground">Reference: {error.digest}</p> : null}
            </div>
        </main>
    )
}
