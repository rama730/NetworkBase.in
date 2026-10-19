"use client";

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

/** Review keeps two decision buttons out of a narrow person-card header/footer. */
export function PersonCardReview({ name, description, note, onAccept, onDecline }: {
    name: string; description: string; note?: string | null;
    onAccept: () => Promise<unknown>; onDecline: () => Promise<unknown>;
}) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
    const [error, setError] = useState<string | null>(null);
    async function decide(action: 'accept' | 'decline') {
        if (busy) return;
        setBusy(action); setError(null);
        try {
            const result = await (action === 'accept' ? onAccept() : onDecline());
            if (result === false) { setError('The decision could not be saved. Please try again.'); return; }
            setOpen(false);
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'The decision could not be saved. Please try again.'); }
        finally { setBusy(null); }
    }
    return <Dialog open={open} onOpenChange={next => { if (!busy) { setOpen(next); setError(null); } }}>
        <DialogTrigger asChild><button type="button" className="nb-person-connect" aria-label={`Review request from ${name}`}>Review</button></DialogTrigger>
        <DialogContent className="nb-person-dialog"><DialogHeader><DialogTitle>Review request</DialogTitle></DialogHeader>
            <p className="nb-compact break-words"><strong>{name}</strong> · {description}</p>
            {note?.trim() ? <p className="nb-compact whitespace-pre-wrap break-words">{note}</p> : null}
            {error ? <p role="alert" className="nb-compact rounded-sm border border-border bg-muted p-3">{error}</p> : null}
            <div className="flex gap-2">
                <button className="nb-person-connect" disabled={Boolean(busy)} onClick={() => void decide('accept')}>{busy === 'accept' ? 'Accepting…' : 'Accept'}</button>
                <button className="nb-person-control" disabled={Boolean(busy)} onClick={() => void decide('decline')}>{busy === 'decline' ? 'Declining…' : 'Decline'}</button>
            </div>
        </DialogContent>
    </Dialog>;
}

export function PersonCardCancelMenu({ label, name, href, busy, onCancel }: {
    label: 'Requested' | 'Invited'; name: string; href: string; busy?: boolean; onCancel: () => Promise<unknown>;
}) {
    return <DropdownMenu><DropdownMenuTrigger asChild>
        <button className="nb-person-control" disabled={busy} aria-label={`${label}: options for ${name}`}>{busy ? 'Cancelling…' : label}<ChevronDown className="size-3" aria-hidden="true" /></button>
    </DropdownMenuTrigger><DropdownMenuContent align="end">
        <DropdownMenuItem asChild><Link href={href}>View profile</Link></DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onSelect={() => { void onCancel(); }}>Cancel {label === 'Invited' ? 'invitation' : 'request'}</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>;
}
