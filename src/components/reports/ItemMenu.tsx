'use client'

import type { ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ReportMenuItem, useReportDialog, type ReportTarget } from '@/components/reports/ReportDialog'
import { cn } from '@/lib/utils'

// The "⋯" menu for one item (C15): its own actions first, then a divider and Report as the last item. It shows on
// hover or focus of the row on pointer screens and always on touch.

export function ItemMenu({ label, report, isOwn, reported, children, className, align = 'end' }: {
    label: string
    report?: ReportTarget
    isOwn?: boolean
    reported?: string | null
    children?: ReactNode
    className?: string
    align?: 'start' | 'end'
}) {
    const reporting = useReportDialog(report ?? { kind: 'person', targetId: '', noun: '' })
    const hasReport = Boolean(report) && !isOwn
    if (!children && !hasReport) return null
    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button type="button" aria-label={label}
                        className={cn('nb-touch-target flex size-7 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}>
                        <MoreHorizontal className="size-4" aria-hidden="true" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align={align} className="w-52">
                    {children}
                    {hasReport ? <ReportMenuItem noun={report!.noun} reported={reported} onReport={reporting.open} first={!children} /> : null}
                </DropdownMenuContent>
            </DropdownMenu>
            {hasReport ? reporting.dialog : null}
        </>
    )
}

/**
 * The page header's "⋯" for a workspace or organization you don't own (C15): the last header action, drawn like
 * Share beside it, with Report as its item.
 */
export function HeaderReportMenu({ targetId, noun }: { targetId: string; noun: 'workspace' | 'organization' }) {
    const reporting = useReportDialog({ kind: 'project', targetId, noun })
    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button type="button" aria-label={`${noun === 'organization' ? 'Organization' : 'Workspace'} actions`} title="More actions"
                        className="nb-icon-button h-[var(--ui-control-height)] w-[var(--ui-control-height)] rounded-[5px] border border-border bg-card text-muted-foreground transition-colors duration-[180ms] ease-[cubic-bezier(.2,.8,.3,1)] hover:bg-muted hover:text-foreground">
                        <MoreHorizontal className="size-4" aria-hidden="true" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                    <ReportMenuItem first noun={noun} onReport={reporting.open} />
                </DropdownMenuContent>
            </DropdownMenu>
            {reporting.dialog}
        </>
    )
}
