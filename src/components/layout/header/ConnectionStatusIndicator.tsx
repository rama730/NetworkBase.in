"use client";

import { useEffect, useRef } from "react";
import { toast } from "@/lib/feedback";
import { RefreshCw, WifiOff } from "lucide-react";

import { useRealtime } from "@/components/providers/RealtimeProvider";
import { cn } from "@/lib/utils";

export function ConnectionStatusIndicator() {
    const { connectionHealth, retryRealtime } = useRealtime();

    const previous = useRef(connectionHealth);
    const feedbackId = useRef<string | number | undefined>(undefined);
    useEffect(() => {
        const before = previous.current;
        const timer = setTimeout(() => {
            previous.current = connectionHealth;
            if (connectionHealth === "healthy") {
                if (before !== "healthy") toast.success("You’re back online", { id: feedbackId.current });
            } else {
                const options = { id: feedbackId.current, description: connectionHealth === "offline" ? "Live updates paused." : connectionHealth === "unavailable" ? "Last loaded data kept." : undefined,
                    action: { label: "Reconnect", onClick: () => { retryRealtime(); } } };
                feedbackId.current = connectionHealth === "reconnecting" ? toast.loading("Reconnecting…", options)
                    : connectionHealth === "offline" ? toast.warning("You’re offline", options) : toast.error("Live updates are unavailable", options);
            }
        }, connectionHealth === "healthy" ? 1500 : 800);
        return () => clearTimeout(timer);
    }, [connectionHealth, retryRealtime]);

    if (connectionHealth === "healthy") return null;

    const isOffline = connectionHealth === "offline";
    const isUnavailable = connectionHealth === "unavailable";
    const label = isOffline
        ? "You are offline. Live updates will resume when the connection returns."
        : isUnavailable
            ? "Live updates are unavailable. Retry connection."
            : "Live updates are reconnecting. Retry connection.";

    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={retryRealtime}
            className={cn(
                "inline-flex h-10 w-10 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
                isOffline || isUnavailable
                    ? "border-border bg-transparent text-[var(--status-warning)]"
                    : "border-border bg-transparent text-muted-foreground",
            )}
        >
            {isOffline || isUnavailable ? (
                <WifiOff className="h-4 w-4" aria-hidden="true" />
            ) : (
                <RefreshCw className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            )}
        </button>
    );
}
