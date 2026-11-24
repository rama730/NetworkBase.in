"use client";

import { toast, feedbackError } from "@/lib/feedback";
import { useState } from "react";
import { AlertTriangle } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { cancelAccountDeletion } from "@/app/actions/account";
import { formatCalendarDate } from "@/lib/ui/date-formatting";
import { PixelIcon } from "@/components/auth/pixel";

interface Props {
    hardDeleteAt: string;
    onCancelled: () => void;
    /** Under the top bar (shell redesign): a mono eyebrow with the pixel clock, on the warning tint. */
    shell?: boolean;
}

export default function PendingDeletionBanner({ hardDeleteAt, onCancelled, shell = false }: Props) {
    const [cancelling, setCancelling] = useState(false);

    const deleteDate = new Date(hardDeleteAt);
    const daysRemaining = Math.max(
        0,
        Math.ceil((deleteDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    );

    const handleCancel = async () => {
        setCancelling(true);
        try {
            const result = await cancelAccountDeletion();
            if (result.success) {
                toast.success("Account reactivated");
                onCancelled();
            } else {
                toast.error(feedbackError(result.error || "Couldn’t cancel deletion", "Couldn’t cancel deletion"));
            }
        } catch {
            toast.error("Couldn’t cancel deletion");
        } finally {
            setCancelling(false);
        }
    };

    if (shell) {
        return (
            <div className="nb-delbar" role="status">
                <span className="nb-delbar-eyebrow"><PixelIcon name="clock" />Deletion pending</span>
                <span className="min-w-0 flex-1">Your account and everything in it will be deleted on <strong className="font-medium text-foreground">{formatCalendarDate(deleteDate)}</strong>{daysRemaining > 0 ? ` · ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left` : ""}.</span>
                <Button variant="outline" size="sm" onClick={handleCancel} disabled={cancelling}>{cancelling ? "Cancelling…" : "Cancel deletion"}</Button>
            </div>
        );
    }

    return (
        <div className="flex flex-wrap items-center gap-3 border-t border-border py-3 nb-compact text-muted-foreground">
            <AlertTriangle className="size-3.5 shrink-0 text-[var(--status-warning)]" aria-hidden="true" />
            <span className="min-w-0 flex-1">Account deletion scheduled for <strong className="font-medium text-foreground">{formatCalendarDate(deleteDate)}</strong>{daysRemaining > 0 ? ` · ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining` : ""}.</span>
            <Button variant="outline" size="sm" onClick={handleCancel} disabled={cancelling}>{cancelling ? "Reactivating…" : "Reactivate account"}</Button>
        </div>
    );
}
