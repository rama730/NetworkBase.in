'use client'

import { useQuery } from '@tanstack/react-query'

import { readSharedOrgsAction } from '@/app/actions/org-workspace'

// Shared-org chip (report §30.1, §30.6): an org you and this person are both in, where they show it on their
// profile. Ids asked for in the same tick go in one request.

let pending = new Map<string, Array<(title: string | null) => void>>()
let timer: ReturnType<typeof setTimeout> | null = null

function loadSharedOrg(userId: string) {
    return new Promise<string | null>((resolve) => {
        pending.set(userId, [...(pending.get(userId) ?? []), resolve])
        timer ??= setTimeout(async () => {
            const batch = pending
            pending = new Map()
            timer = null
            const map = await readSharedOrgsAction([...batch.keys()]).catch(() => ({} as Record<string, string>))
            for (const [id, waiters] of batch) waiters.forEach((done) => done(map[id] ?? null))
        }, 16)
    })
}

export function SharedOrgChip({ userId, className }: { userId: string | null | undefined; className?: string }) {
    const { data } = useQuery({ queryKey: ['shared-org', userId], queryFn: () => loadSharedOrg(userId!), enabled: Boolean(userId), staleTime: 5 * 60_000 })
    if (!data) return null
    // A metadata line, not a hand-made chip (org design plan OUT4).
    return <span className={className ?? 'nb-meta inline-block max-w-full truncate align-middle'} title={`You’re both in ${data.replace(/ \+(\d+)$/, ' and $1 more')}`}>{data}</span>
}
