import { redirect } from 'next/navigation'

import { caseLabel, parseCaseLabel } from '@/lib/trust/rules'

/** Case links open in the Inbox's middle pane (R3). */
export default async function TrustCasePage({ params }: { params: Promise<{ number: string }> }) {
    const number = parseCaseLabel(decodeURIComponent((await params).number))
    redirect(number ? `/admin/trust?case=${caseLabel(number)}` : '/admin/trust')
}
