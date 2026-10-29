"use client";

import { useState } from "react";
import { toast } from "@/lib/feedback";

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
  const [pending, setPending] = useState<{ count: number; noun: string; label: string; run: () => Promise<void> | void } | null>(null);

  /** `label` is the button text ("Mark all as read"); each tab clears its own scope. */
  const request = (count: number, run: () => Promise<void> | void, noun = "conversation", label = MARK_ALL_LABEL) => {
    if (!count) return;
    if (needsMarkAllConfirm(count)) setPending({ count, noun, label, run });
    else void run();
  };

  const conversations = (rows: ChatChannelSummary[], label = MARK_ALL_LABEL) => request(rows.length, async () => {
    rows.forEach((c) => applyRead(c.id, c.last_seq));
    const result = await markReadMany({ items: rows.map((c) => ({ channelId: c.id, seq: c.last_seq })) });
    refresh();
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    toast.success(`${rows.length} conversation${rows.length === 1 ? "" : "s"} marked as read`);
  }, "conversation", label);

  const dialog = (
    <ConfirmDialog
      open={Boolean(pending)}
      onOpenChange={(open) => !open && setPending(null)}
      title={`${pending?.label ?? MARK_ALL_LABEL}?`}
      description={pending ? `${pending.count} ${pending.noun}${pending.count === 1 ? "" : "s"} will be marked as read.` : undefined}
      confirmLabel={pending?.label ?? MARK_ALL_LABEL}
      // The dialog waits for it (its own spinner) and closes when done.
      onConfirm={async () => {
        await pending?.run();
      }}
    />
  );

  return { request, conversations, dialog };
}
