import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CaseView } from '@/components/trust/CaseView'
import { getViewerAuthContext } from '@/lib/server/viewer-context'
import { caseIdByNumber, readCase } from '@/lib/trust/console'
import { parseCaseLabel } from '@/lib/trust/rules'
import { staffRoleOf } from '@/lib/trust/staff'

/** Deep link to one case: /admin/trust/cases/NB-4821 (17.1). The layout already checked staff. */
export default async function TrustCasePage({ params }: { params: Promise<{ number: string }> }) {
    const number = parseCaseLabel(decodeURIComponent((await params).number))
    const caseId = number ? await caseIdByNumber(number) : null
    const c = caseId ? await readCase(caseId) : null
    if (!c) notFound()
    const { user } = await getViewerAuthContext()
    return (
        <div className="mt-4">
            <Link href="/admin/trust" className="mb-3 inline-block text-[13px] underline underline-offset-4">Back to the queue</Link>
            <CaseView c={c} staffId={user!.id} role={staffRoleOf(user)!} />
        </div>
    )
}
