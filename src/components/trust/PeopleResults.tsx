'use client'
import { PixelBeat } from "@/components/ui/PixelBeat";

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { UserRound } from '@/components/ui/icons'

import { personDetailAction } from '@/app/actions/moderation-staff'
import { PersonView } from '@/components/trust/PersonView'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { UserAvatar } from '@/components/ui/UserAvatar'
import type { searchPeople } from '@/lib/trust/console'

/** People search results; a person opens in a side drawer (R1 Enforcement). */
export function PeopleResults({ people }: { people: Awaited<ReturnType<typeof searchPeople>> }) {
    const [open, setOpen] = useState<string | null>(null)
    const person = useQuery({ queryKey: ['trust', 'person', open], queryFn: () => personDetailAction(open!), enabled: Boolean(open), staleTime: 30_000 })
    if (!people.length) return <EmptyState icon={UserRound} className="mt-6" title="No one matches" description="Try the exact @handle or email." />
    return (
        <>
            <ul className="mt-3 divide-y divide-border">
                {people.map((p) => (
                    <li key={p.id}>
                        <button type="button" onClick={() => setOpen(p.id)} className="flex min-h-14 w-full items-center gap-3 px-2 py-2 text-left hover:bg-muted/50">
                            <UserAvatar identity={{ id: p.id, fullName: p.name, username: p.username, avatarUrl: p.avatar }} size={32} roundedClassName="rounded-[5px]" />
                            <span className="min-w-0 flex-1 text-[13px]"><span className="font-medium">{p.name ?? 'No name'}</span> {p.username ? <span className="text-muted-foreground">@{p.username}</span> : null}</span>
                            <span className="text-[13px] text-muted-foreground">{p.restriction ?? 'Good standing'}</span>
                        </button>
                    </li>
                ))}
            </ul>
            <Dialog open={Boolean(open)} onOpenChange={(next) => !next && setOpen(null)}>
                <DialogContent presentation="right-drawer" className="w-full max-w-[560px] overflow-y-auto">
                    <DialogHeader className="sr-only"><DialogTitle>Person</DialogTitle><DialogDescription>Their standing and history</DialogDescription></DialogHeader>
                    {person.data ? <PersonView p={person.data} /> : <p role="status" className="nb-waiting text-[13px] text-muted-foreground">{person.isError ? 'Couldn’t load · try again' : <><PixelBeat />Loading…</>}</p>}
                </DialogContent>
            </Dialog>
        </>
    )
}
