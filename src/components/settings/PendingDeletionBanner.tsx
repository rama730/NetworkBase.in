"use client";

import { toast, feedbackError } from "@/lib/feedback";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cancelAccountDeletion } from "@/app/actions/account";
import { formatCalendarDate } from "@/lib/ui/date-formatting";

interface Props {
    hardDeleteAt: string;
    onCancelled: () => void;
}

export default function PendingDeletionBanner({ hardDeleteAt, onCancelled }: Props) {
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
                toast.success("Account reactivated successfully!");
                onCancelled();
            } else {
                toast.error(feedbackError(result.error || "Failed to cancel deletion", "Failed to cancel deletion"));
            }
        } catch {
            toast.error("Failed to cancel deletion");
        } finally {
            setCancelling(false);
        }
    };

    return (
        <div className="flex flex-wrap items-center gap-3 border-t border-border py-3 text-[12px] text-muted-foreground">
            <AlertTriangle className="size-3.5 shrink-0 text-[var(--status-warning)]" aria-hidden="true" />
            <span className="min-w-0 flex-1">Account deletion scheduled for <strong className="font-medium text-foreground">{formatCalendarDate(deleteDate)}</strong>{daysRemaining > 0 ? ` · ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining` : ""}.</span>
            <Button variant="outline" size="sm" onClick={handleCancel} disabled={cancelling}>{cancelling ? "Cancelling…" : "Reactivate account"}</Button>
        </div>
    );
}
