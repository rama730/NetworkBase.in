"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const NOTE_LIMIT = 500;

/** Withdrawing is quiet but not free: reviewers are told, and the project's cooldown rules apply to applying again. */
export default function WithdrawApplicationDialog({
    open,
    roleTitle,
    onClose,
    onConfirm,
}: {
    open: boolean;
    roleTitle?: string | null;
    onClose: () => void;
    /** Resolves to an error message, or null when the withdrawal went through. */
    onConfirm: (note: string) => Promise<string | null>;
}) {
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setNote("");
            setError(null);
        }
    }, [open]);

    const confirm = async () => {
        setBusy(true);
        setError(null);
        try {
            const failure = await onConfirm(note.trim());
            if (failure) setError(failure);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
            <DialogContent className="sm:max-w-[440px]">
                <DialogHeader>
                    <DialogTitle>Withdraw your application?</DialogTitle>
                    <DialogDescription>
                        {roleTitle ? `The reviewers for ${roleTitle} are told you withdrew.` : "The reviewers are told you withdrew."} You can apply again later.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-1.5">
                    <label htmlFor="withdraw-application-note" className="text-[13px] font-medium text-foreground">
                        Note for the reviewers <span className="text-xs font-normal text-muted-foreground">(optional)</span>
                    </label>
                    <textarea
                        id="withdraw-application-note"
                        value={note}
                        onChange={(event) => setNote(event.target.value.slice(0, NOTE_LIMIT))}
                        maxLength={NOTE_LIMIT}
                        rows={3}
                        className="w-full resize-none rounded-[5px] border border-border bg-card p-3 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                    />
                </div>
                {error ? <p role="alert" className="rounded-[5px] border border-border bg-muted p-3 text-sm text-foreground">{error}</p> : null}
                <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Keep application</Button>
                    <Button type="button" variant="destructive" onClick={() => void confirm()} disabled={busy}>
                        {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                        Withdraw
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
