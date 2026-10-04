'use client';

import { useState } from 'react';
import { Flag } from 'lucide-react';
import { toast } from 'sonner';

import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';

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

    const handleSubmit = async () => {
        if (!reason) {
            toast.error('Please select a reason');
            return;
        }
        setSubmitting(true);
        try {
            const result = await onSubmit(reason as ReportReason, details || undefined);
            if (!result.success) {
                toast.error(result.error || 'Failed to submit report');
                return;
            }
            toast.success('Report submitted. We\'ll review it shortly.');
            onClose();
            setReason('');
            setDetails('');
        } catch {
            toast.error('Failed to submit report');
        } finally {
            setSubmitting(false);
        }
    };

    // The shared Dialog: role, focus trap, Esc and focus return come with it.
    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && !submitting && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogTitle className="flex items-center gap-2">
                    <Flag className="size-5 text-destructive" aria-hidden="true" /> Report this message
                </DialogTitle>
                <fieldset className="space-y-2">
                    <legend className="sr-only">Reason</legend>
                    {REPORT_REASONS.map((r) => (
                        <label key={r.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                            reason === r.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
                        }`}>
                            <input
                                type="radio"
                                name="report-reason"
                                value={r.id}
                                checked={reason === r.id}
                                onChange={() => setReason(r.id)}
                                className="accent-primary"
                            />
                            <span className="text-sm text-foreground">{r.label}</span>
                        </label>
                    ))}
                </fieldset>
                <textarea
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    placeholder="Add details (optional)"
                    aria-label="Details (optional)"
                    rows={3}
                    className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:border-primary/30"
                />
                <DialogFooter>
                    <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted">
                        Cancel
                    </button>
                    <button type="button" onClick={() => void handleSubmit()} disabled={submitting || !reason} className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-white hover:bg-destructive/90 disabled:opacity-50 dark:text-background">
                        {submitting ? 'Submitting…' : 'Submit report'}
                    </button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
