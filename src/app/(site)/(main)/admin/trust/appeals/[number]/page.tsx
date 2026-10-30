import { redirect } from 'next/navigation'

import { caseLabel, parseCaseLabel } from '@/lib/trust/rules'

/** Appeals open in the Inbox, marked as their own type (R2). */
export default async function TrustAppealPage({ params }: { params: Promise<{ number: string }> }) {
    const number = parseCaseLabel(decodeURIComponent((await params).number))
    redirect(number ? `/admin/trust?case=${caseLabel(number)}&type=appeal` : '/admin/trust?view=appeals')
}
