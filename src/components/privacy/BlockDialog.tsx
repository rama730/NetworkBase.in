'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { toast } from '@/lib/feedback'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useReportDialog } from '@/components/reports/ReportDialog'

// One Block and one Unblock, the same wording everywhere you meet a person (Blocking B5, B12, B41). Both confirm
// first, both offer Undo for 10 seconds, and both tell every open screen that the relationship changed (B11).

export type BlockPerson = { id: string; name: string }
export type BlockSource = 'profile' | 'message' | 'comment' | 'person_card' | 'member_list' | 'settings'
type Impact = { sharedSpaces: string[]; sharedCount: number; connected: boolean }

export const RELATIONSHIP_EVENT = 'nb:relationship-changed'
export function announceRelationshipChange(userId: string) {
    window.dispatchEvent(new CustomEvent(RELATIONSHIP_EVENT, { detail: { userId } }))
}

export function useBlockFlow(source: BlockSource = 'profile') {
    const [person, setPerson] = useState<BlockPerson | null>(null)
    const [mode, setMode] = useState<'block' | 'unblock' | null>(null)
    const [impact, setImpact] = useState<Impact | null>(null)
    const [alsoReport, setAlsoReport] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [pending, start] = useTransition()
    const reporting = useReportDialog({ kind: 'person', targetId: person?.id ?? '', noun: 'person', personName: person?.name })

    const close = () => { setMode(null); setImpact(null); setAlsoReport(false); setError(null) }
    // Stable, so a list can hand them to every row without re-rendering it.
    const openBlock = useCallback((next: BlockPerson) => {
        setPerson(next); setMode('block'); setImpact(null); setError(null)
        void import('@/app/actions/blocking').then(({ readBlockImpactAction }) => readBlockImpactAction(next.id)).then((r) => r.success && setImpact(r), () => undefined)
    }, [])
    const openUnblock = useCallback((next: BlockPerson) => { setPerson(next); setMode('unblock'); setError(null) }, [])

    const block = (target: BlockPerson, report: boolean) => start(async () => {
        const { blockPersonAction, undoBlockAction } = await import('@/app/actions/blocking')
        const result = await blockPersonAction(target.id, source)
        if (!result.success) return setError(result.error)
        close()
        announceRelationshipChange(target.id)
        toast(`${target.name} blocked`, {
            duration: result.undoSeconds * 1000,
            action: { label: 'Undo', onClick: async () => {
                const undo = await undoBlockAction(target.id)
                toast(undo.success ? `${target.name} unblocked` : undo.error)
                if (undo.success) announceRelationshipChange(target.id)
            } },
        })
        if (report) reporting.open()
    })
    const unblock = (target: BlockPerson) => start(async () => {
        const { unblockPersonAction, blockPersonAction } = await import('@/app/actions/blocking')
        const result = await unblockPersonAction(target.id)
        if (!result.success) return setError(result.error)
        close()
        announceRelationshipChange(target.id)
        toast(`${target.name} unblocked`, {
            duration: 10_000,
            action: { label: 'Undo', onClick: async () => {
                const again = await blockPersonAction(target.id, source)
                toast(again.success ? `${target.name} blocked again` : again.error)
                if (again.success) announceRelationshipChange(target.id)
            } },
        })
    })

    const name = person?.name ?? 'them'
    const dialog = (
        <>
            <Dialog open={mode !== null} onOpenChange={(next) => !next && close()}>
                <DialogContent className="max-w-[460px]">
                    {mode === 'block' ? (
                        <>
                            <DialogHeader>
                                <DialogTitle>Block {name}?</DialogTitle>
                                <DialogDescription>They won’t be able to find you, message you, mention you or see your posts, and you won’t see theirs. They won’t be told.</DialogDescription>
                            </DialogHeader>
                            <ul className="list-disc space-y-1 pl-5 text-[13px] text-foreground">
                                {impact?.connected ? <li>Your connection and any requests between you will be removed.</li> : <li>Any requests or invitations between you will be removed.</li>}
                                {impact && impact.sharedCount > 0 ? (
                                    <li>You’re both in {impact.sharedSpaces.join(' and ')}{impact.sharedCount > impact.sharedSpaces.length ? ` and ${impact.sharedCount - impact.sharedSpaces.length} more` : ''}. You’ll both stay members; their messages and posts will be folded away for you.</li>
                                ) : null}
                                <li>You can undo this for 10 seconds, or unblock them any time from Settings → Privacy.</li>
                            </ul>
                            <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-foreground">
                                <Checkbox checked={alsoReport} onCheckedChange={(value) => setAlsoReport(value === true)} /> Also report {name}
                            </label>
                        </>
                    ) : (
                        <DialogHeader>
                            <DialogTitle>Unblock {name}?</DialogTitle>
                            <DialogDescription>They’ll be able to find you, message you if your settings allow, and see your public posts again. They won’t be told. Your connection won’t come back; either of you can send a new request.</DialogDescription>
                        </DialogHeader>
                    )}
                    {error ? <p role="alert" className="rounded-[5px] border border-destructive/30 bg-[var(--status-danger-soft)] px-3 py-2 text-[13px]">{error}</p> : null}
                    <DialogFooter>
                        <Button variant="ghost" onClick={close}>Cancel</Button>
                        {mode === 'block'
                            ? <Button variant="destructive" disabled={pending || !person} onClick={() => person && block(person, alsoReport)}>{pending ? 'Blocking…' : `Block ${name}`}</Button>
                            : <Button disabled={pending || !person} onClick={() => person && unblock(person)}>{pending ? 'Unblocking…' : `Unblock ${name}`}</Button>}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {reporting.dialog}
        </>
    )
    return { openBlock, openUnblock, dialog }
}

/** The Block confirmation for a place that shows many people (a person card): mounted only once asked, opens at once. */
export function BlockPersonDialog({ person, source, unblock = false }: { person: BlockPerson; source: BlockSource; unblock?: boolean }) {
    const flow = useBlockFlow(source)
    const { openBlock, openUnblock } = flow
    // Opens once, as asked: the block itself changing `unblock` must not open the opposite dialog.
    const [ask] = useState(() => ({ ...person, unblock }))
    useEffect(() => { (ask.unblock ? openUnblock : openBlock)({ id: ask.id, name: ask.name }) }, [ask, openBlock, openUnblock])
    return flow.dialog
}
