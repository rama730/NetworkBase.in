"use client";

import { toast } from "@/lib/feedback";

import { getOrCreateDm } from "@/app/actions/chat/members";
import { openChatWindow, prefersChatWindow } from "@/components/messages/chat-window-store";
import { chatErrorMessage } from "@/lib/messaging/errors";

/** One open per person at a time: a second click while the first resolves reuses it. */
const pending = new Map<string, Promise<void>>();

/**
 * "Message" buttons keep linking to /messages?userId=. At 768px+ off /messages
 * they open the DM in the launcher window instead (C6). Returns the open in flight when handled, else false.
 */
export function messageUserInWindow(userId: string, event?: { preventDefault: () => void }): Promise<void> | false {
  if (!prefersChatWindow()) return false;
  event?.preventDefault();
  const open = pending.get(userId) ?? getOrCreateDm({ userId }).then((result) => {
    if (result.success) openChatWindow(result.channelId);
    else toast.error(chatErrorMessage(result.error));
  }).catch(() => { toast.error(chatErrorMessage(undefined)); }).finally(() => pending.delete(userId));
  pending.set(userId, open);
  return open;
}
