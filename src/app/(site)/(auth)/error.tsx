'use client'

import { ServerErrorPage } from '@/components/errors/ErrorPages'
import { useReportBoundaryError } from '@/lib/observability/use-report-boundary-error'

/** A sign-in page failed: the full-page "Something went wrong" with Try again and a way back to sign in. */
export default function AuthError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useReportBoundaryError(error)
    return <ServerErrorPage reset={reset} digest={error.digest} homeHref="/login" homeLabel="Back to sign in" />
}
