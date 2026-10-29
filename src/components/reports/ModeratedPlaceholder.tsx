'use client'

import { useQuery } from '@tanstack/react-query'
import { EyeOff } from 'lucide-react'

import type { ModeratedItem } from '@/lib/trust/placeholders'
import { ruleLabel } from '@/lib/trust/rules'
import { cn } from '@/lib/utils'

// Hidden and removed content, shown where it was (docs/trust-and-safety-concept.md §7.1, §8.1). The feeds merge
// these rows in by time; the author sees the rule, case and Appeal, everyone else only that something was hidden.

export type { ModeratedItem }

/** One request per workspace or conversation, shared by every feed on the page. */
export function useModeratedItems(scope: { workspaceId: string } | { channelId: string } | null) {
    const key = scope ? ('workspaceId' in scope ? `w:${scope.workspaceId}` : `c:${scope.channelId}`) : ''
    return useQuery({
        queryKey: ['moderated-items', key],
        queryFn: async () => (await import('@/app/actions/moderation')).moderatedItemsAction(scope!),
        enabled: Boolean(scope),
        staleTime: 60_000,
    }).data ?? []
}

/** Merge placeholders into a list by time, only within the range already loaded (newest first unless told). */
export function withPlaceholders<T extends { createdAt: string }>(items: T[], placeholders: ModeratedItem[], complete: boolean, newestFirst = true) {
    const merged: Array<{ item: T } | { placeholder: ModeratedItem }> = items.map((item) => ({ item }))
    const edge = items.at(-1)?.createdAt ?? null
    for (const placeholder of placeholders) {
        const at = placeholder.createdAt
        if (!at || (!complete && edge && (newestFirst ? at < edge : at > edge))) continue
        const index = merged.findIndex((entry) => 'item' in entry && (newestFirst ? entry.item.createdAt < at : entry.item.createdAt > at))
        merged.splice(index === -1 ? merged.length : index, 0, { placeholder })
    }
    return merged
}

export function moderatedText(item: ModeratedItem, noun: string) {
    if (item.state === 'review') return `This ${noun} is hidden while we review a report`
    if (!item.mine) return `This ${noun} was hidden`
    const what = item.state === 'hidden' ? `Your ${noun} was hidden by NetworkBase` : `Your ${noun} was removed`
    return [what, item.rule ? ruleLabel(item.rule) : null, item.caseLabel].filter(Boolean).join(' · ')
}

export function ModeratedPlaceholder({ item, noun, className }: { item: ModeratedItem; noun: string; className?: string }) {
    return (
        <div role="note" className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[8px] border border-dashed border-border bg-muted/50 px-3 py-2.5 text-[13px] text-muted-foreground', className)}>
            <EyeOff className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{moderatedText(item, noun)}</span>
            {item.canAppeal && item.caseLabel ? <a href={`/appeal/${item.caseLabel}`} className="font-medium text-foreground underline underline-offset-4">Appeal</a> : null}
        </div>
    )
}
