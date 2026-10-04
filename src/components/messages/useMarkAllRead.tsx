"use client";

import { useState } from "react";
import { toast } from "sonner";

import { markReadMany } from "@/app/actions/chat/read";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MARK_ALL_LABEL, needsMarkAllConfirm } from "@/lib/messaging/channel-view";
import { chatErrorMessage } from "@/lib/messaging/errors";
import type { ChatChannelSummary } from "@/lib/messaging/types";

/**
 * One "mark all as read" for Shift+Esc, section headers, Home and Inbox: same label,
 * a confirmation above 5 items, the read state applied at once. Render `dialog`.
 */
export function useMarkAllRead() {
  const { applyRead, refresh } = useChatShell();
  const [pending, setPending] = useState<{ count: number; noun: string; run: () => Promise<void> | void } | null>(null);

  const request = (count: number, run: () => Promise<void> | void, noun = "conversation") => {
    if (!count) return;
    if (needsMarkAllConfirm(count)) setPending({ count, noun, run });
    else void run();
  };

  const conversations = (rows: ChatChannelSummary[]) => request(rows.length, async () => {
    rows.forEach((c) => applyRead(c.id, c.last_seq));
    const result = await markReadMany({ items: rows.map((c) => ({ channelId: c.id, seq: c.last_seq })) });
    refresh();
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    toast.success(`${rows.length} conversation${rows.length === 1 ? "" : "s"} marked as read`);
  });

  const dialog = (
    <ConfirmDialog
      open={Boolean(pending)}
      onOpenChange={(open) => !open && setPending(null)}
      title={`${MARK_ALL_LABEL}?`}
      description={pending ? `${pending.count} ${pending.noun}${pending.count === 1 ? "" : "s"} will be marked as read.` : undefined}
      confirmLabel={MARK_ALL_LABEL}
      onConfirm={() => {
        const run = pending?.run;
        setPending(null);
        void run?.();
      }}
    />
  );

  return { request, conversations, dialog };
}
