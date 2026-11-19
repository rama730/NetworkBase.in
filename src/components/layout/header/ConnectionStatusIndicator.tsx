"use client";

import { useEffect, useRef } from "react";
import { toast } from "@/lib/feedback";
import { PixelIcon, PixelSpinner } from "@/components/auth/pixel";

import { useRealtime } from "@/components/providers/RealtimeProvider";

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

    // A warning cell in the top bar (shell redesign): RECONNECTING with the pixel spinner, or OFFLINE with Retry.
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={retryRealtime}
            className="nb-cell nb-cell-conn"
            data-tone={isOffline || isUnavailable ? "off" : "re"}
        >
            {isOffline || isUnavailable ? <PixelIcon name="cross" /> : <PixelSpinner />}
            <span>{isOffline ? "Offline" : isUnavailable ? "Unavailable" : "Reconnecting"}</span>
            {isOffline || isUnavailable ? <span className="nb-cell-conn-retry" aria-hidden="true">Retry</span> : null}
        </button>
    );
}
