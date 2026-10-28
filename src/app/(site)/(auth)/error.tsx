'use client'

import Link from 'next/link'
import { RefreshCw } from 'lucide-react'
import { AuthShell } from '@/components/auth/AuthShell'
import { Button } from '@/components/ui/button'

export default function AuthError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    return (
        <AuthShell title="Something went wrong" description="We couldn't load this page. Try again, or go back to sign in." panel={null}>
            <div className="space-y-3">
                <Button className="h-11 w-full font-medium" onClick={reset}>
                    <RefreshCw className="size-4" aria-hidden="true" />
                    Try again
                </Button>
                <Button asChild variant="ghost" className="h-11 w-full"><Link href="/login">Back to sign in</Link></Button>
                {error.digest ? <p className="nb-auth-note text-center font-mono text-muted-foreground">Ref: {error.digest}</p> : null}
            </div>
        </AuthShell>
    )
}
