'use client'

import { useState, useTransition } from 'react'
import { Eye } from 'lucide-react'

import { exitMemberPreviewAction, startMemberPreviewAction } from '@/app/actions/member-preview'
import { Button } from '@/components/ui/button'

// Preview as member (report §45.6, decision 175). A full reload, so every screen reads again under member rules.

export function useStartMemberPreview(orgId: string) {
    const [error, setError] = useState<string | null>(null)
    const [pending, start] = useTransition()
    const run = () => start(async () => {
        const result = await startMemberPreviewAction(orgId)
        if (!result.success) return setError(result.error)
        window.location.reload()
    })
    return { run, pending, error }
}

export function PreviewAsMemberButton({ orgId }: { orgId: string }) {
    const { run, pending, error } = useStartMemberPreview(orgId)
    return (
        <>
            <Button type="button" size="sm" variant="ghost" className="hidden md:inline-flex" disabled={pending} onClick={run}><Eye className="size-4" aria-hidden="true" />Preview as member</Button>
            {error ? <span role="alert" className="text-[13px] text-destructive">{error}</span> : null}
        </>
    )
}

export function MemberPreviewBar() {
    const [pending, start] = useTransition()
    return (
        <div role="status" className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-4 py-2 text-[13px] text-foreground">
            <span>Previewing as a member · Nothing you do here is saved</span>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { await exitMemberPreviewAction(); window.location.reload() })}>Exit preview</Button>
        </div>
    )
}
