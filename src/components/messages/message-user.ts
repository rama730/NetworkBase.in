"use client";

import { toast } from "sonner";

import { getOrCreateDm } from "@/app/actions/chat/members";
import { openChatWindow, prefersChatWindow } from "@/components/messages/chat-window-store";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { isChatV3Enabled } from "@/lib/messaging/flag";

const CHAT_V3 = isChatV3Enabled();

/**
 * "Message" buttons keep linking to /messages?userId=. At 768px+ off /messages
 * they open the DM in the launcher window instead (C6). Returns true when handled.
 */
export function messageUserInWindow(userId: string, event?: { preventDefault: () => void }) {
  if (!CHAT_V3 || !prefersChatWindow()) return false;
  event?.preventDefault();
  void getOrCreateDm({ userId }).then((result) => {
    if (result.success) openChatWindow(result.channelId);
    else toast.error(chatErrorMessage(result.error));
  });
  return true;
}
