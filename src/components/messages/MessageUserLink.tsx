"use client";

import Link from "next/link";
import { useState } from "react";
import { MessageSquare } from "lucide-react";

import { useMessageGate } from "@/components/messages/message-gates";
import { messageUserInWindow } from "@/components/messages/message-user";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { cn } from "@/lib/utils";

/**
 * A Message link anywhere in the app (EntryPoints): opens the DM (the window at 768px+, else the page), says
 * "Opening…" with the pixel beat until it does, and follows who can message whom — off with "Can’t message" (the
 * reason, when it is their privacy, on hover and for screen readers), nothing when you blocked them.
 */
export function MessageUserLink({ userId, className, children = "Message" }: { userId: string; className?: string; children?: React.ReactNode }) {
  const gate = useMessageGate(userId);
  const [opening, setOpening] = useState(false);
  if (gate.state === "unblock") return null;
  if (gate.state === "off") {
    return (
      <span className="nb-msg-off" title={gate.reason ?? undefined}>
        <span className={cn(className, "nb-msg-off-label")} aria-disabled="true">{children}</span>
        <span className="nb-state-tag">{gate.tag}</span>
        {gate.reason ? <span className="sr-only">{gate.reason}</span> : null}
      </span>
    );
  }
  return (
    <Link
      href={`/messages?userId=${userId}`}
      aria-busy={opening || undefined}
      aria-disabled={opening || undefined}
      className={className}
      onClick={(event) => {
        if (opening) { event.preventDefault(); return; }
        const open = messageUserInWindow(userId, event);
        if (open) { setOpening(true); void open.finally(() => setOpening(false)); }
      }}
    >
      {opening ? <><PixelBeat />Opening…</> : children}
    </Link>
  );
}

/** In a person's menu when they only take messages from connections: Message stays, off, with the tag and the reason. */
export function MessageOffMenuItem() {
  return (
    <DropdownMenuItem disabled className="nb-msg-off-item">
      <MessageSquare className="size-4" aria-hidden="true" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">Message <span className="nb-state-tag">Can’t message</span></span>
        <span className="nb-msg-off-reason">Only accepts messages from connections</span>
      </span>
    </DropdownMenuItem>
  );
}
