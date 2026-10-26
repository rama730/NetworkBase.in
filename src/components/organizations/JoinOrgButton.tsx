'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { joinOrganizationAction } from '@/app/actions/organizations'
import { Button } from '@/components/ui/button'
import type { OrgJoinMode } from '@/lib/organizations/join-rules'

/** Join (instant mode) or Request to join (approval mode) with an optional note. */
export function JoinOrgButton({ code, joinMode, orgHref }: { code: string; joinMode: OrgJoinMode; orgHref: string }) {
    const router = useRouter()
    const [note, setNote] = useState('')
    const [message, setMessage] = useState<{ kind: 'status' | 'error'; text: string } | null>(null)
    const [pending, startTransition] = useTransition()

    const submit = () =>
        startTransition(async () => {
            const result = await joinOrganizationAction(code, joinMode === 'approval' ? note : null)
            if (!result.success) return setMessage({ kind: 'error', text: result.error })
            if (result.outcome === 'joined' || result.outcome === 'already_member') return router.push(orgHref)
            setMessage({ kind: 'status', text: 'Request sent. The admins will review it.' })
        })

    if (message?.kind === 'status') {
        return <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-center text-sm">{message.text}</p>
    }

    return (
        <div className="space-y-3">
            {joinMode === 'approval' ? (
                <>
                    <label htmlFor="join-note" className="text-sm font-medium">Add a note (optional)</label>
                    <textarea
                        id="join-note"
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        maxLength={500}
                        rows={3}
                        placeholder="Section B, roll 42"
                        className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                </>
            ) : null}
            {message ? <p role="alert" className="text-sm text-destructive">{message.text}</p> : null}
            <Button type="button" onClick={submit} disabled={pending} className="min-h-11 w-full">
                {pending ? 'Joining…' : joinMode === 'approval' ? 'Request to join' : 'Join'}
            </Button>
        </div>
    )
}
