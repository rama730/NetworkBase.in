"use client";
import { PixelBeat } from "@/components/ui/PixelBeat";

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Flag, MessageSquare, MoreHorizontal } from 'lucide-react';
import { useReportDialog, type ReportTarget } from '@/components/reports/ReportDialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/lib/feedback';

/** Direct Accept and Decline decision buttons with an upper-right corner overflow menu for notes and reporting. */
export function PersonCardReview({ name, description, note, onAccept, onDecline, report }: {
    name: string; description?: string; note?: string | null;
    onAccept: () => Promise<unknown>; onDecline: () => Promise<unknown>;
    /** Report this request or invitation (C15); it opens over the review. */
    report?: ReportTarget;
}) {
    const reporting = useReportDialog(report ?? { kind: 'person', targetId: '', noun: '' });
    const [noteOpen, setNoteOpen] = useState(false);
    const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);

    async function decide(action: 'accept' | 'decline') {
        if (busy) return;
        setBusy(action);
        try {
            const result = await (action === 'accept' ? onAccept() : onDecline());
            if (result === false) {
                toast.error('The decision could not be saved. Try again.');
            }
        } catch (failure) {
            toast.error(failure instanceof Error ? failure.message : 'The decision could not be saved. Try again.');
        } finally {
            setBusy(null);
        }
    }

    return (
        <>
            {/* Upper right corner subtle overflow menu */}
            {note?.trim() || report ? (
                <div className="absolute top-3 right-3 z-10" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className="inline-flex size-7 items-center justify-center rounded-[5px] text-muted-foreground/70 hover:text-foreground hover:bg-muted/80 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                aria-label={`More options for request from ${name}`}
                            >
                                <MoreHorizontal className="size-4" aria-hidden="true" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {note?.trim() ? (
                                <DropdownMenuItem onSelect={() => setNoteOpen(true)}>
                                    <MessageSquare className="size-3.5 mr-2" aria-hidden="true" />
                                    View note
                                </DropdownMenuItem>
                            ) : null}
                            {report ? (
                                <DropdownMenuItem onSelect={reporting.open}>
                                    <Flag className="size-3.5 mr-2" aria-hidden="true" />
                                    Report {report.noun}
                                </DropdownMenuItem>
                            ) : null}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            ) : null}

            {/* Bottom decision action buttons */}
            <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                <button
                    type="button"
                    className="nb-person-connect text-xs min-h-[32px] px-3.5 font-medium inline-flex items-center gap-1.5"
                    disabled={Boolean(busy)}
                    onClick={() => void decide('accept')}
                    aria-label={`Accept request from ${name}`}
                >
                    {busy === 'accept' ? <PixelBeat className="mr-0.5" /> : null}
                    {busy === 'accept' ? 'Accepting…' : 'Accept'}
                </button>
                <button
                    type="button"
                    className="nb-person-control text-xs min-h-[32px] px-3 font-medium inline-flex items-center gap-1.5"
                    disabled={Boolean(busy)}
                    onClick={() => void decide('decline')}
                    aria-label={`Decline request from ${name}`}
                >
                    {busy === 'decline' ? <PixelBeat className="mr-0.5" /> : null}
                    {busy === 'decline' ? 'Declining…' : 'Decline'}
                </button>
            </div>

            {note?.trim() ? (
                <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
                    <DialogContent className="nb-person-dialog">
                        <DialogHeader>
                            <DialogTitle>Note from {name}</DialogTitle>
                            {description ? <DialogDescription className="nb-compact break-words">{description}</DialogDescription> : null}
                        </DialogHeader>
                        <p className="nb-compact whitespace-pre-wrap break-words">{note}</p>
                    </DialogContent>
                </Dialog>
            ) : null}

            {reporting.dialog}
        </>
    );
}

export const PersonCardDecision = PersonCardReview;

export function PersonCardCancelMenu({ label, name, href, busy, onCancel }: {
    label: 'Requested' | 'Invited'; name: string; href: string; busy?: boolean; onCancel: () => Promise<unknown>;
}) {
    return <DropdownMenu><DropdownMenuTrigger asChild>
        <button className="nb-person-control" disabled={busy} aria-label={`${label}: options for ${name}`}>{busy ? 'Canceling…' : label}<ChevronDown className="size-3" aria-hidden="true" /></button>
    </DropdownMenuTrigger><DropdownMenuContent align="end">
        <DropdownMenuItem asChild><Link href={href}>View profile</Link></DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onSelect={() => { void onCancel(); }}>Cancel {label === 'Invited' ? 'invitation' : 'request'}</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>;
}
