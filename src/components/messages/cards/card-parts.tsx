"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast, feedbackError } from "@/lib/feedback";

import { refreshCard } from "@/app/actions/chat/messages";
import { buttonVariants } from "@/components/ui/button";
import type { ChatCardKind, ChatCardView } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";

type ActionResult = { success: boolean; error?: string };

/** The live card behind a message (or a status bar): one query per card, shared by everything that shows it. */
export function useCardQuery(kind: ChatCardKind, refId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.chat.card(kind, refId),
    enabled,
    queryFn: async (): Promise<ChatCardView | null> => {
      const result = await refreshCard({ kind, refId });
      // A failure is not "no access": throw, so it shows Retry.
      if (!result.success) throw new Error(result.error);
      return result.card ?? null;
    },
    // Live updates arrive as card.changed; this is the net for a missed one, and for edits to the role or project.
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useCardAction(kind: string, refId: string) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<ActionResult>, done: string, toastOptions?: Parameters<typeof toast.success>[1]) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await action();
      if (!result.success) toast.error(feedbackError(result.error || "That didn’t work. Try again.", "That didn’t work. Try again."));
      else toast.success(done, toastOptions);
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.card(kind, refId) });
    }
  };
  return { busy, run };
}

export function Shell({ label, status, statusLabel, ariaLabel, children }: { label: string; status: string | null; statusLabel?: string; ariaLabel?: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={ariaLabel ?? label} className="nbm-card">
      <div className="nbm-card-head">
        <span className="nbm-card-kind">{label}</span>
        {status ? <span className="nb-status ml-auto" data-status={STATUS_TONE[status] ?? "archived"} aria-live="polite">{statusLabel ?? status.replace(/_/g, " ")}</span> : null}
      </div>
      <div className="nbm-card-body">{children}</div>
    </div>
  );
}

export function Actions({ children }: { children: React.ReactNode }) {
  // The card's paper footer strip.
  return <div className="nbm-card-foot">{children}</div>;
}

// The shared Button looks, 44px on touch.
export const primary = buttonVariants({ className: "pointer-coarse:h-11" });
export const secondary = buttonVariants({ variant: "outline", className: "pointer-coarse:h-11" });
// Card states on the shared status chip (spec: status colours mean status).
export const STATUS_TONE: Record<string, string> = {
  pending: "draft", proposed: "draft", accepted: "completed", rejected: "blocked", declined: "blocked",
  withdrawn: "archived", cancelled: "archived", expired: "archived", deleted: "archived",
};

