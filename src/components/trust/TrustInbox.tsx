'use client'

import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '@/lib/feedback'

import {
    bulkDecideAction, caseDetailAction, caseIdByLabelAction, decideCaseAction, inboxCountsAction, inboxPageAction, undoDecisionAction, verificationDetailAction,
} from '@/app/actions/moderation-staff'
import { CasePane } from '@/components/trust/CasePane'
import { VerificationList } from '@/components/trust/ConsoleTabs'
import { DecisionPanel, isTyping, Kbd } from '@/components/trust/DecisionPanel'
import { InboxList, itemKey } from '@/components/trust/InboxList'
import { useLive, useLiveEvents, useServerNow } from '@/components/trust/live'
import { Button } from '@/components/ui/button'
import { ComponentErrorBoundary } from '@/components/ui/ComponentErrorBoundary'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import type { InboxFilters, InboxItem } from '@/lib/trust/inbox'
import { caseLabel, parseCaseLabel } from '@/lib/trust/rules'
import { keepStamp } from '@/lib/navigation/in-app-history'
import { closeOverlay, openOverlay } from '@/lib/navigation/overlay-history'
import { useDocumentTitlePrefix } from '@/hooks/useDocumentTitlePrefix'

// The Inbox (Trust & Safety Console Redesign R2, R3, R8, S6, S8): list, case and decision as separate pieces of
// data, updated in place by actions and live events; the URL holds the view and the open case without reloading.

const FILTER_KEYS = ['view', 'q', 'severity', 'kind', 'source', 'sort', 'due', 'org'] as const
const UNDO_MS = 10_000
type Recent = { caseId: string; label: string; at: number }
type Cursor = { at: string; id: string } | null

function useWide(query: string) {
    const [match, setMatch] = useState(false)
    useEffect(() => {
        const m = window.matchMedia(query)
        setMatch(m.matches)
        const on = () => setMatch(m.matches)
        m.addEventListener('change', on)
        return () => m.removeEventListener('change', on)
    }, [query])
    return match
}

export function TrustInbox() {
    const params = useSearchParams()
    const queryClient = useQueryClient()
    const { me } = useLive()
    const now = useServerNow()
    const wide = useWide('(min-width: 1280px)')
    const medium = useWide('(min-width: 1024px)')
    const filters = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || undefined]).filter(([, v]) => v)) as InboxFilters, [params])
    const selectedLabel = params.get('case')
    useDocumentTitlePrefix(selectedLabel ? selectedLabel.toUpperCase() : null) // unified back R8
    const selectedOrg = params.get('org-request')
    const selectedKey = selectedOrg ? `org:${selectedOrg}` : selectedLabel ? `${params.get('type') === 'appeal' ? 'appeal' : 'case'}:${selectedLabel.toUpperCase()}` : null

    const [checked, setChecked] = useState<string[]>([])
    const [highlight, setHighlight] = useState<Set<string>>(new Set())
    const [recent, setRecent] = useState<Recent[]>([])
    const [help, setHelp] = useState(false)
    const [deciding, setDeciding] = useState(false)
    const anchor = useRef<string | null>(null)

    /** URL changes without a server round trip (S6); `replace` for typing, push for opening a case. */
    const setUrl = useCallback((changes: Record<string, string | undefined>, replace = false) => {
        const next = new URLSearchParams(window.location.search)
        for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k) }
        const url = `${window.location.pathname}${next.toString() ? `?${next}` : ''}`
        if (replace) window.history.replaceState(keepStamp(window.history.state), '', url); else window.history.pushState(null, '', url)
    }, [])
    // Filters replace: back leaves the inbox in one step (unified back A2).
    const setFilters = useCallback((changes: Partial<InboxFilters>) => { setChecked([]); setUrl(changes as Record<string, string | undefined>, true) }, [setUrl])

    const inbox = useInfiniteQuery({
        queryKey: ['trust', 'inbox', filters],
        queryFn: ({ pageParam }) => inboxPageAction(filters, pageParam),
        initialPageParam: null as Cursor,
        getNextPageParam: (last) => last?.next ?? undefined,
        placeholderData: keepPreviousData,
        staleTime: 5_000,
    })
    const counts = useQuery({ queryKey: ['trust', 'counts'], queryFn: inboxCountsAction, staleTime: 10_000 })
    const items = useMemo(() => inbox.data?.pages.flatMap((p) => p?.items ?? []) ?? [], [inbox.data])
    const selectedItem = items.find((i) => itemKey(i) === selectedKey) ?? null

    // A case opened by link that isn't in this view still opens.
    const looked = useQuery({
        queryKey: ['trust', 'case-id', selectedLabel],
        queryFn: () => caseIdByLabelAction(selectedLabel!),
        enabled: Boolean(selectedLabel && !selectedItem && parseCaseLabel(selectedLabel)),
        staleTime: Infinity,
    })
    const caseId = selectedItem && selectedItem.type !== 'verification' ? selectedItem.id : selectedLabel ? looked.data ?? null : null
    const detail = useQuery({ queryKey: ['trust', 'case', caseId], queryFn: () => caseDetailAction(caseId!), enabled: Boolean(caseId), staleTime: 5_000 })
    const verification = useQuery({ queryKey: ['trust', 'verification', selectedOrg], queryFn: () => verificationDetailAction(selectedOrg!), enabled: Boolean(selectedOrg) })

    const prefetch = useCallback((i: InboxItem) => {
        if (i.type === 'verification') return
        void queryClient.prefetchQuery({ queryKey: ['trust', 'case', i.id], queryFn: () => caseDetailAction(i.id), staleTime: 5_000 })
    }, [queryClient])
    const open = useCallback((i: InboxItem | undefined) => {
        if (!i) return
        anchor.current = i.id
        const changes = i.type === 'verification'
            ? { 'org-request': i.id, case: undefined, type: undefined }
            : { case: caseLabel(i.number ?? 0), type: i.type === 'appeal' ? 'appeal' : undefined, 'org-request': undefined }
        // Side by side (1024px+), picking a case adds no step; full screen on a phone it does, so back
        // returns to the list (unified back R5, A3).
        if (medium) setUrl(changes, true)
        else openOverlay('trust-case', (mode) => setUrl(changes, mode === 'replace'))
        prefetch(i)
        // Opening a case moves focus to its title (S14).
        window.setTimeout(() => document.getElementById('case-title')?.focus({ preventScroll: true }), 50)
    }, [setUrl, prefetch, medium])
    const close = () => closeOverlay('trust-case', () => setUrl({ case: undefined, type: undefined, 'org-request': undefined }, true))

    // Live: refetch only what an event touched, half a second at a time (S1, S4, S6).
    const lastIds = useRef<Set<string>>(new Set())
    useLiveEvents((events) => {
        void queryClient.invalidateQueries({ queryKey: ['trust', 'inbox'] })
        void queryClient.invalidateQueries({ queryKey: ['trust', 'counts'] })
        const touched = new Set(events.map((e) => e.caseId))
        if (caseId && touched.has(caseId) && events.some((e) => e.caseId === caseId && e.actorId !== me && e.kind !== 'viewed')) {
            void queryClient.invalidateQueries({ queryKey: ['trust', 'case', caseId] })
        }
        for (const id of touched) if (id && id !== caseId) void queryClient.invalidateQueries({ queryKey: ['trust', 'case', id] })
    })
    // New rows get a short highlight.
    useEffect(() => {
        const ids = new Set(items.map((i) => i.id))
        const fresh = lastIds.current.size ? [...ids].filter((id) => !lastIds.current.has(id)) : []
        lastIds.current = ids
        if (!fresh.length) return
        setHighlight(new Set(fresh))
        const t = window.setTimeout(() => setHighlight(new Set()), 1_500)
        return () => window.clearTimeout(t)
    }, [items])

    const refreshAll = useCallback(() => queryClient.invalidateQueries({ queryKey: ['trust'] }), [queryClient])
    const undo = useCallback(async (r: Recent) => {
        const result = await undoDecisionAction(r.caseId)
        toast(result.success ? `Decision undone · ${r.label}` : result.error)
        if (result.success) setRecent((prev) => prev.filter((x) => x !== r))
        void refreshAll()
    }, [refreshAll])

    /** After Send: the next case opens, and Undo stays in the Recent strip (R8, S8). */
    const onSent = useCallback(({ caseId: sentId, label }: { caseId: string; label: string }) => {
        const entry = { caseId: sentId, label, at: Date.now() }
        setRecent((prev) => [entry, ...prev].slice(0, 5))
        setDeciding(false)
        toast(`Decision sent · ${label}`, { duration: UNDO_MS, action: { label: 'Undo', onClick: () => void undo(entry) } })
        const index = items.findIndex((i) => i.id === sentId)
        const next = items.slice(index + 1).find((i) => i.state !== 'decided') ?? items.slice(0, Math.max(0, index)).find((i) => i.state !== 'decided')
        if (next) open(next); else close()
        window.setTimeout(() => document.querySelector<HTMLButtonElement>(`[data-key="${next ? itemKey(next) : ''}"] button`)?.focus({ preventScroll: true }), 60)
        void refreshAll()
     
    }, [items, open, undo, refreshAll])

    const quickDismiss = useCallback(async (i: InboxItem) => {
        const label = caseLabel(i.number ?? 0)
        const r = await decideCaseAction(i.id, { outcome: 'no_violation', expectedVersion: i.version })
        if (!r.success) return void toast(r.error)
        const entry = { caseId: i.id, label, at: Date.now() }
        setRecent((prev) => [entry, ...prev].slice(0, 5))
        toast(`No rule broken · ${label}`, { duration: UNDO_MS, action: { label: 'Undo', onClick: () => void undo(entry) } })
        void refreshAll()
    }, [undo, refreshAll])

    const check = useCallback((i: InboxItem, range: boolean) => {
        setChecked((prev) => {
            if (!range || !anchor.current) { anchor.current = i.id; return prev.includes(i.id) ? prev.filter((x) => x !== i.id) : [...prev, i.id] }
            const ids = items.filter((x) => x.type === 'case').map((x) => x.id)
            const a = ids.indexOf(anchor.current), b = ids.indexOf(i.id)
            if (a < 0 || b < 0) return [...new Set([...prev, i.id])]
            return [...new Set([...prev, ...ids.slice(Math.min(a, b), Math.max(a, b) + 1)])]
        })
    }, [items])
    const bulk = async (kind: 'dismiss' | 'hide') => {
        const ids = checked
        const r = await bulkDecideAction(ids, kind === 'dismiss' ? { outcome: 'no_violation' } : { outcome: 'actioned', content: 'hide', rule: 15 })
        toast(r.success ? `${r.done} decided${r.failed ? ` · ${r.failed} couldn’t be (claimed by someone or already decided)` : ''}` : r.error)
        setChecked([])
        void refreshAll()
    }

    // J / K, Enter, U, ?, / (R8).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
            const index = items.findIndex((i) => itemKey(i) === selectedKey)
            if (e.key === 'j' || e.key === 'J') { e.preventDefault(); open(items[index < 0 ? 0 : Math.min(items.length - 1, index + 1)]) }
            else if (e.key === 'k' || e.key === 'K') { e.preventDefault(); open(items[Math.max(0, index - 1)]) }
            else if (e.key === 'Enter' && document.activeElement?.closest('[aria-label="Cases"]')) document.getElementById('case-title')?.focus()
            else if (e.key === 'u' || e.key === 'U') { const r = recent.find((x) => Date.now() - x.at < UNDO_MS); if (r) void undo(r) }
            else if (e.key === '?') setHelp(true)
            else if (e.key === '/') { e.preventDefault(); document.getElementById('inbox-search')?.focus() }
            else if (e.key === 'Escape' && checked.length) setChecked([])
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    })

    const hasSelection = Boolean(selectedKey)
    const c = detail.data
    const middle = selectedOrg ? (
        verification.data ? <VerificationList rows={[verification.data]} onDone={() => { close(); void refreshAll() }} /> : verification.isLoading ? <PaneSkeleton /> : <p className="p-4 text-[13px] text-muted-foreground">This request was already handled.</p>
    ) : !hasSelection ? (
        <p className="pt-16 text-center text-[13px] text-muted-foreground">Pick a case, or press <Kbd>J</Kbd> to start at the top.</p>
    ) : detail.isError || looked.isError ? (
        <p className="p-4 text-[13px]">Couldn’t load · <button type="button" className="underline underline-offset-4" onClick={() => void detail.refetch()}>Retry</button></p>
    ) : c ? (
        <CasePane c={c} onMerged={() => { close(); void refreshAll() }} />
    ) : detail.isLoading || looked.isLoading || (!caseId && !looked.isFetched) ? <PaneSkeleton /> : <p className="p-4 text-[13px] text-muted-foreground">That case doesn’t exist.</p>

    return (
        <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)_360px]">
            <div className={`flex min-h-0 flex-col border-border lg:border-r ${hasSelection ? 'hidden lg:flex' : 'flex'}`}>
                <ComponentErrorBoundary fallbackMessage="Couldn’t load the list">
                    <div className="min-h-0 flex-1">
                        <InboxList items={items} filters={filters} counts={counts.data ?? undefined} now={now} selected={selectedKey} checked={checked} highlight={highlight}
                            loading={inbox.isLoading} error={inbox.isError} hasNext={Boolean(inbox.hasNextPage)} loadingNext={inbox.isFetchingNextPage}
                            setFilters={setFilters} onSelect={open} onPrefetch={prefetch} onCheck={check} onClearChecked={() => setChecked([])} onQuickDismiss={quickDismiss}
                            onBulk={(k) => void bulk(k)} onRetry={() => void inbox.refetch()} onNext={() => void inbox.fetchNextPage()} />
                    </div>
                </ComponentErrorBoundary>
                <RecentStrip recent={recent} onUndo={(r) => void undo(r)} onOpen={(r) => setUrl({ case: r.label, type: undefined, 'org-request': undefined })} />
            </div>
            <div className={`min-h-0 overflow-y-auto px-4 pb-24 md:px-6 ${hasSelection ? 'block' : 'hidden lg:block'}`} data-scroll-root="inbox-case">
                {hasSelection ? <button type="button" onClick={close} className="mt-2 text-[13px] underline underline-offset-4 lg:hidden">Back to the inbox</button> : null}
                <ComponentErrorBoundary key={selectedKey ?? 'none'} fallbackMessage="Couldn’t load this case">{middle}</ComponentErrorBoundary>
            </div>
            {wide ? (
                <aside aria-label="Decision" className="hidden min-h-0 overflow-y-auto border-l border-border px-4 py-3 xl:block">
                    <ComponentErrorBoundary key={caseId ?? 'none'} fallbackMessage="Couldn’t load the decision panel">
                        {c ? <DecisionPanel c={c} onSent={onSent} /> : <p className="pt-16 text-center text-[13px] text-muted-foreground">{selectedOrg ? 'Verify or decline beside the request.' : 'The decision appears here.'}</p>}
                    </ComponentErrorBoundary>
                </aside>
            ) : c ? (
                <>
                    <div className="fixed bottom-0 right-0 z-30 w-full border-t border-border bg-background px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 lg:w-auto lg:border-0 lg:bg-transparent lg:pb-6 lg:pr-6">
                        <Button className="w-full lg:w-auto" onClick={() => setDeciding(true)}>Decide</Button>
                    </div>
                    <Dialog open={deciding} onOpenChange={setDeciding}>
                        <DialogContent presentation={medium ? 'right-drawer' : 'bottom-sheet'} className="max-h-[90dvh] w-full overflow-y-auto px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 lg:max-w-[400px]">
                            <DialogHeader className="sr-only"><DialogTitle>Decide {caseLabel(c.number)}</DialogTitle><DialogDescription>The decision for this case</DialogDescription></DialogHeader>
                            <ComponentErrorBoundary fallbackMessage="Couldn’t load the decision panel"><DecisionPanel c={c} onSent={onSent} /></ComponentErrorBoundary>
                        </DialogContent>
                    </Dialog>
                </>
            ) : null}
            <Dialog open={help} onOpenChange={setHelp}>
                <DialogContent size="confirm">
                    <DialogHeader><DialogTitle>Keyboard shortcuts</DialogTitle><DialogDescription>They work whenever you’re not typing.</DialogDescription></DialogHeader>
                    <dl className="grid grid-cols-[88px_1fr] gap-y-1.5 text-[13px]">
                        {[['J / K', 'Next / previous case'], ['Enter', 'Open the case'], ['1 / 2', 'No rule broken / Take action'], ['R', 'Pick the rule'], ['⌘ Enter', 'Send decision'],
                            ['U', 'Undo the last decision'], ['/', 'Search'], ['Shift-click', 'Select a range'], ['?', 'This list']].map(([k, v]) => (
                            <div key={k} className="contents"><dt className="font-mono">{k}</dt><dd>{v}</dd></div>
                        ))}
                    </dl>
                </DialogContent>
            </Dialog>
        </div>
    )
}

function PaneSkeleton() {
    return (
        <div aria-hidden="true" className="space-y-4 pt-4">
            <Skeleton className="h-4 w-40" /><Skeleton className="h-6 w-2/3" /><Skeleton className="h-14 w-full" /><Skeleton className="h-40 w-full" /><Skeleton className="h-24 w-full" />
        </div>
    )
}

/** Your last 5 decisions, with Undo while their 10 seconds last (S8, G7). */
function RecentStrip({ recent, onUndo, onOpen }: { recent: Recent[]; onUndo: (r: Recent) => void; onOpen: (r: Recent) => void }) {
    const [, tick] = useState(0)
    useEffect(() => {
        if (!recent.some((r) => Date.now() - r.at < UNDO_MS)) return
        const t = window.setInterval(() => tick((n) => n + 1), 1_000)
        return () => window.clearInterval(t)
    }, [recent])
    if (!recent.length) return null
    return (
        <section aria-label="Recent decisions" className="border-t border-border px-3 py-2">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Recent decisions</p>
            <ul className="space-y-1 text-[12px]">
                {recent.map((r) => {
                    const left = Math.ceil((UNDO_MS - (Date.now() - r.at)) / 1000)
                    return (
                        <li key={`${r.caseId}:${r.at}`} className="flex items-center gap-2">
                            <button type="button" className="font-mono tabular-nums underline-offset-4 hover:underline" onClick={() => onOpen(r)}>{r.label}</button>
                            {left > 0 ? <button type="button" className="ml-auto font-medium underline underline-offset-4" onClick={() => onUndo(r)}>Undo · {left}s<Kbd>U</Kbd></button> : <span className="ml-auto text-muted-foreground">sent</span>}
                        </li>
                    )
                })}
            </ul>
        </section>
    )
}
