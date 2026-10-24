"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { APPLICATION_DECISION_REASON_TEMPLATES, type ApplicationDecisionReasonCode } from "@/lib/applications/reasons";
import { useMediaQuery } from "@/hooks/useMediaQuery";

const NOTE_LIMIT = 500;

/** The reasons a reviewer can pick; the others (role filled, withdrawn, reopened) are written by the system. */
const DECLINE_REASONS: { code: ApplicationDecisionReasonCode; label: string }[] = [
    { code: "skills_mismatch", label: "Skills don't match this role" },
    { code: "experience", label: "Needs more experience" },
    { code: "availability", label: "Availability doesn't line up" },
    { code: "other", label: "Another direction" },
];

export type DecisionInput = { reason: ApplicationDecisionReasonCode; note: string };

/**
 * The decision itself: declining asks for a reason and an optional note the applicant sees; accepting offers an optional
 * welcome. It lives inside any dialog (its own, or the review dialog's second step), so deciding never closes and reopens
 * a dialog under the reviewer's focus.
 */
export function DecisionForm({
    mode,
    applicantName,
    roleTitle,
    onCancel,
    onConfirm,
    onBusyChange,
}: {
    mode: "accept" | "decline";
    applicantName: string;
    roleTitle?: string | null;
    onCancel: () => void;
    /** Resolves to an error message to show in the form, or null once the decision was saved. */
    onConfirm: (input: DecisionInput) => Promise<string | null>;
    onBusyChange?: (busy: boolean) => void;
}) {
    const [reason, setReason] = useState<ApplicationDecisionReasonCode>(mode === "decline" ? "skills_mismatch" : "other");
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const isSubmittingRef = useRef(false);

    const updateBusy = (nextBusy: boolean) => {
        setBusy(nextBusy);
        onBusyChange?.(nextBusy);
    };

    const confirm = async () => {
        if (isSubmittingRef.current || busy) return;
        isSubmittingRef.current = true;
        updateBusy(true);
        setError(null);
        try {
            const failure = await onConfirm({ reason, note: note.trim() });
            if (failure) setError(failure);
        } catch (err) {
            setError(err instanceof Error ? err.message : "The decision could not be saved. Try again.");
        } finally {
            isSubmittingRef.current = false;
            updateBusy(false);
        }
    };

    const declining = mode === "decline";
    return (
        <>
            <DialogHeader>
                <DialogTitle>{declining ? `Decline ${applicantName}?` : `Accept ${applicantName}?`}</DialogTitle>
                <DialogDescription>
                    {declining
                        ? "They are told, with the reason you pick. You can undo this for 10 minutes."
                        : `They join the project${roleTitle ? ` as ${roleTitle}` : ""} and the other applicants for that role are told if it fills.`}
                </DialogDescription>
            </DialogHeader>
            {declining ? (
                <fieldset className="space-y-1.5">
                    <legend className="text-[13px] font-medium text-foreground">Reason</legend>
                    {DECLINE_REASONS.map((option) => (
                        <label key={option.code} className="flex cursor-pointer items-start gap-2 rounded-[5px] border border-border px-3 py-2 text-[13px] has-[:checked]:border-primary has-[:checked]:bg-primary/5 pointer-coarse:min-h-11">
                            <input
                                type="radio"
                                name="decision-reason"
                                value={option.code}
                                checked={reason === option.code}
                                onChange={() => setReason(option.code)}
                                className="mt-0.5"
                            />
                            <span>
                                <span className="block text-foreground">{option.label}</span>
                                <span className="block text-xs text-muted-foreground">{APPLICATION_DECISION_REASON_TEMPLATES[option.code]}</span>
                            </span>
                        </label>
                    ))}
                </fieldset>
            ) : null}
            <div className="space-y-1.5">
                <label htmlFor="decision-note" className="text-[13px] font-medium text-foreground">
                    {declining ? "Add a note" : "Welcome note"} <span className="text-xs font-normal text-muted-foreground">(optional)</span>
                </label>
                <textarea
                    id="decision-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value.slice(0, NOTE_LIMIT))}
                    maxLength={NOTE_LIMIT}
                    rows={3}
                    autoFocus
                    placeholder={declining ? "Shown to the applicant after the reason." : "Say hello, or what happens next."}
                    className="w-full resize-none rounded-[5px] border border-border bg-card p-3 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                />
                <p className="text-right text-xs text-muted-foreground">{note.length}/{NOTE_LIMIT}</p>
            </div>
            {error ? <p role="alert" className="rounded-[5px] border border-border bg-muted p-3 text-sm text-foreground">{error}</p> : null}
            <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>{"Cancel"}</Button>
                <Button type="button" variant={declining ? "destructive" : "default"} onClick={() => void confirm()} disabled={busy}>
                    {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                    {declining ? "Decline" : "Accept"}
                </Button>
            </DialogFooter>
        </>
    );
}

/** The decision form in a dialog of its own (the chat card, the status bar and the Workspace list). */
export function DecisionDialog({
    open,
    mode,
    applicantName,
    roleTitle,
    onClose,
    onConfirm,
    returnFocusTo,
}: {
    open: boolean;
    mode: "accept" | "decline";
    applicantName: string;
    roleTitle?: string | null;
    onClose: () => void;
    onConfirm: (input: DecisionInput) => Promise<string | null>;
    /** Where focus goes when the dialog closes, when the control that opened it is gone. */
    returnFocusTo?: HTMLElement | null;
}) {
    const phone = useMediaQuery("(max-width: 639px)");
    const [isBusy, setIsBusy] = useState(false);
    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next && !isBusy) onClose(); }}>
            <DialogContent
                presentation={phone ? "bottom-sheet" : "center"}
                className={phone ? "p-4" : "sm:max-w-[460px]"}
                onCloseAutoFocus={(event) => {
                    if (!returnFocusTo) return;
                    event.preventDefault();
                    returnFocusTo.focus();
                }}
            >
                <DecisionForm mode={mode} applicantName={applicantName} roleTitle={roleTitle} onCancel={onClose} onConfirm={onConfirm} onBusyChange={setIsBusy} />
            </DialogContent>
        </Dialog>
    );
}
