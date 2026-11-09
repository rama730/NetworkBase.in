'use client'

import { useRefreshSidebar } from '@/hooks/useRefreshSidebar'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { cancelJoinRequestAction, joinOrganizationAction, updateJoinRequestNoteAction } from '@/app/actions/organizations'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { StatusBadge } from '@/components/organizations/org-ui'
import { fieldError, fieldLabel } from '@/lib/organizations/display'
import { toast } from '@/lib/feedback'
import type { OrgJoinMode } from '@/lib/organizations/join-rules'

/** Join (instant mode) or Request to join (approval mode) with an optional note. */
export function JoinOrgButton({ code, joinMode, orgHref }: { code: string; joinMode: OrgJoinMode; orgHref: string }) {
    const router = useRouter()
    const refreshSidebar = useRefreshSidebar()
    const [note, setNote] = useState('')
    const [message, setMessage] = useState<{ kind: 'status' | 'error'; text: string } | null>(null)
    const [pending, startTransition] = useTransition()

    const submit = () =>
        startTransition(async () => {
            // Audit N37: a thrown server error is a message, never the page's error boundary.
            const result = await joinOrganizationAction(code, joinMode === 'approval' ? note : null).catch(() => ({ success: false as const, error: 'Couldn’t do that. Try again.' }))
            if (!result.success) return setMessage({ kind: 'error', text: result.error })
            refreshSidebar()
            if (result.outcome === 'joined' || result.outcome === 'already_member') return router.replace(orgHref)
            setMessage({ kind: 'status', text: 'Request sent. The admins will review it.' })
        })

    if (message?.kind === 'status') {
        return <Notice tone="info">{message.text}</Notice>
    }

    return (
        <div className="space-y-3">
            {joinMode === 'approval' ? (
                <>
                    <label htmlFor="join-note" className={fieldLabel}>Add a note (optional)</label>
                    <textarea
                        id="join-note"
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        maxLength={500}
                        rows={3}
                        placeholder="Section B, roll 42"
                        className="nb-textarea"
                    />
                </>
            ) : null}
            {message ? <p role="alert" className={fieldError}>{message.text}</p> : null}
            <Button type="button" onClick={submit} disabled={pending} className="min-h-11 w-full">
                {pending ? 'Joining…' : joinMode === 'approval' ? 'Request to join' : 'Join'}
            </Button>
        </div>
    )
}

/** Report §26.2: the one "request pending" (join page and a private organization's page): badge, line, note, Cancel. */
export function JoinRequestPending({ orgId }: { orgId: string }) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)
    return (
        <div className="flex flex-col items-center gap-2 text-center">
            <StatusBadge state="requested">Requested</StatusBadge>
            <p role="status" className="text-[13px] text-muted-foreground">Request sent. The admins will review it.</p>
            <div className="flex flex-wrap justify-center gap-2">
                <JoinRequestNote orgId={orgId} />
                <Button type="button" variant="outline" disabled={pending} onClick={() => startTransition(async () => {
                    const result = await cancelJoinRequestAction(orgId)
                    if (!result.success) return setError(result.error)
                    router.refresh()
                })}>Cancel request</Button>
            </div>
            {error ? <p role="alert" className={fieldError}>{error}</p> : null}
        </div>
    )
}

/** "Add a note" while a join request waits (report §26.5); the admins see it on the request. */
export function JoinRequestNote({ orgId, size = 'default' }: { orgId: string; size?: 'sm' | 'default' }) {
    const [open, setOpen] = useState(false)
    const [note, setNote] = useState('')
    const [pending, startTransition] = useTransition()
    if (!open) return <Button type="button" size={size} variant="ghost" onClick={() => setOpen(true)}>Add a note</Button>
    return (
        <form className="flex w-full max-w-sm flex-col gap-1.5" onSubmit={(e) => {
            e.preventDefault()
            startTransition(async () => {
                const result = await updateJoinRequestNoteAction(orgId, note)
                if (!result.success) return void toast.error(result.error)
                toast.success('Note added to your request')
                setOpen(false)
            })
        }}>
            <textarea aria-label="Note for the admins" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className="nb-textarea" />
            <Button type="submit" size="sm" disabled={pending}>Save note</Button>
        </form>
    )
}
