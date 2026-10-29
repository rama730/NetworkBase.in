'use client';

import { useState } from 'react';
import { Flag } from 'lucide-react';
import { toast } from '@/lib/feedback';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { chatErrorMessage } from '@/lib/messaging/errors';

const REPORT_REASONS = [
    { id: 'spam', label: 'Spam' },
    { id: 'harassment', label: 'Harassment' },
    { id: 'hate_speech', label: 'Hate speech' },
    { id: 'inappropriate', label: 'Inappropriate content' },
    { id: 'other', label: 'Other' },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]['id'];

interface ReportMessageDialogProps {
    isOpen: boolean;
    onClose: () => void;
    /** The caller picks the report action, so old and new chat share this dialog. */
    onSubmit: (reason: ReportReason, details: string | undefined) => Promise<{ success: boolean; error?: string }>;
}

export function ReportMessageDialog({ isOpen, onClose, onSubmit }: ReportMessageDialogProps) {
    const [reason, setReason] = useState<string>('');
    const [details, setDetails] = useState('');
    const [submitting, setSubmitting] = useState(false);
    // Said in the dialog, next to what needs fixing (never a toast that disappears).
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async () => {
        if (!reason) {
            setError('Pick a reason first.');
            return;
        }
        setError(null);
        setSubmitting(true);
        try {
            const result = await onSubmit(reason as ReportReason, details || undefined);
            if (!result.success) {
                setError(chatErrorMessage(result.error));
                return;
            }
            toast.success('Report submitted', { description: 'We’ll review it shortly.' });
            onClose();
            setReason('');
            setDetails('');
        } catch {
            setError(chatErrorMessage('chat_network'));
        } finally {
            setSubmitting(false);
        }
    };

    // The shared Dialog: role, focus trap, Esc and focus return come with it.
    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && !submitting && onClose()}>
            <DialogContent className="sm:max-w-[460px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Flag size={18} className="text-destructive" aria-hidden="true" /> Report this message
                    </DialogTitle>
                </DialogHeader>
                <fieldset className="space-y-2">
                    <legend className="sr-only">Reason</legend>
                    {REPORT_REASONS.map((r) => (
                        <label key={r.id} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 transition-colors duration-[130ms] ${
                            reason === r.id ? 'border-foreground bg-muted' : 'border-border hover:bg-muted'
                        }`}>
                            <input
                                type="radio"
                                name="report-reason"
                                value={r.id}
                                checked={reason === r.id}
                                onChange={() => { setReason(r.id); setError(null); }}
                                className="size-4 accent-[var(--primary)]"
                            />
                            <span className="text-[13px] text-foreground">{r.label}</span>
                        </label>
                    ))}
                </fieldset>
                <textarea
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    placeholder="Add details (optional)"
                    aria-label="Details (optional)"
                    rows={3}
                    className="w-full rounded-md border border-input bg-card px-3 py-2 text-[15px] outline-none focus:border-ring"
                />
                {error ? <p role="alert" className="text-[13px] text-destructive">{error}</p> : null}
                <DialogFooter paper>
                    <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
                    <Button type="button" variant="destructive" onClick={() => void handleSubmit()} disabled={submitting}>
                        {submitting ? 'Submitting…' : 'Submit report'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
