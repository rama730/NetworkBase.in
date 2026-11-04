'use client'

import { useState, useTransition } from 'react'

import { listAssignmentsAction, updateAssignmentAction, type AssignmentRow } from '@/app/actions/assignments'
import { Button } from '@/components/ui/button'
import { EditAssignmentDialog } from '@/components/organizations/AssignmentDialogs'
import { toast } from '@/lib/feedback'

// Review UX 1.8: on a main assignment the title, instructions, due date and priority change for everyone, here.
export function MasterEditButton({ orgId, masterId, onSaved }: { orgId: string; masterId: string; onSaved?: () => void }) {
    const [row, setRow] = useState<{ row: AssignmentRow; timeZone: string | null } | null>(null)
    const [pending, startTransition] = useTransition()
    const open = () => startTransition(async () => {
        const r = await listAssignmentsAction(orgId, { masterId })
        const found = r.success ? r.rows[0] : undefined
        if (found && r.success) setRow({ row: found, timeZone: r.timeZone })
        else toast.warning(r.success ? 'That assignment is no longer available.' : r.error)
    })
    return (
        <>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={open}>Edit for everyone</Button>
            {row ? (
                <EditAssignmentDialog orgId={orgId} row={row.row} open timeZone={row.timeZone} onClose={() => setRow(null)}
                    onSave={(patch) => startTransition(async () => {
                        const result = await updateAssignmentAction(masterId, patch)
                        if (!result.success) return void toast.warning(result.error)
                        setRow(null)
                        onSaved?.()
                    })} />
            ) : null}
        </>
    )
}
