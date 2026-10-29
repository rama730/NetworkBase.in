'use client'

import { useState } from 'react'

import { ReportDialog } from '@/components/reports/ReportDialog'

/** Report from the join page (trust and safety §5.1): the code is what lets a non-member see this org. */
export function JoinReportLink({ orgId, code }: { orgId: string; code: string }) {
    const [open, setOpen] = useState(false)
    return (
        <>
            <button type="button" onClick={() => setOpen(true)} className="nb-compact mx-auto block text-muted-foreground underline underline-offset-4 hover:text-foreground">
                Report this organization
            </button>
            {open ? <ReportDialog kind="project" targetId={orgId} noun="organization" joinCode={code} open onOpenChange={setOpen} /> : null}
        </>
    )
}
