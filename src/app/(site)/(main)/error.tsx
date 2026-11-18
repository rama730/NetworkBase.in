'use client'

import { InlineError } from '@/components/errors/ErrorPages'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { useReportBoundaryError } from '@/lib/observability/use-report-boundary-error'

/** Something inside the app failed: only this part says so, with Try again; the app's bar and sidebar keep working. */
export default function MainError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useReportBoundaryError(error)
    const online = useOnlineStatus()
    return <InlineError reset={reset} digest={error.digest} offline={!online} />
}
