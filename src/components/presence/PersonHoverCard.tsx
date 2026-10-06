"use client";

import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { useRef, useState } from "react";

import { messageUserInWindow } from "@/components/messages/message-user";
import { PresenceAvatar } from "@/components/presence/PersonPresence";
import { PresenceBadge } from "@/components/presence/PresenceBadge";
import { StatusInline } from "@/components/presence/StatusInline";
import { usePersonPresence } from "@/components/presence/usePresence";
import { useAuth } from "@/hooks/useAuth";
import { profileHref } from "@/lib/routing/identifiers";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Person = { id: string; username: string | null; full_name: string | null; avatar_url: string | null };

function CardBody({ person }: { person: Person }) {
  const { user } = useAuth();
  const presence = usePersonPresence(person.id);
  const name = person.full_name || person.username || "Someone";
  const identity = { id: person.id, username: person.username, fullName: person.full_name, avatarUrl: person.avatar_url };
  return (
    <div className="flex w-[300px] flex-col gap-3.5 p-4">
      <div className="flex items-center gap-3.5">
        <PresenceAvatar userId={person.id} identity={identity} size={48} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="nb-card-title truncate">{name}</span>
          {person.username ? <span className="nb-meta truncate">@{person.username}</span> : null}
        </div>
      </div>
      <div className="flex flex-col gap-2 rounded-md bg-muted p-3">
        {presence.status ? (
          <>
            <StatusInline emoji={presence.status.emoji} text={presence.statusText} className="truncate text-[14px] font-semibold" />
            {presence.status.pausesNotifications ? <span className="text-[13px] text-muted-foreground">Notifications paused</span> : null}
          </>
        ) : null}
        <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <PresenceBadge availability={presence.availability} size={10} style={{ ["--presence-cut" as string]: "var(--muted)" }} />
          {/* No "Offline" guess before presence has loaded. */}
          {presence.loaded ? presence.availabilityText : "\u00a0"}
        </span>
      </div>
      <div className="flex gap-2">
        {user?.id !== person.id ? (
          <Button asChild className="flex-1 pointer-coarse:h-11">
            <Link href={`/messages?userId=${person.id}`} onClick={(event) => messageUserInWindow(person.id, event)}>Message</Link>
          </Button>
        ) : null}
        <Button asChild variant="outline" className="flex-1 pointer-coarse:h-11">
          <Link href={profileHref({ id: person.id, username: person.username })}>View profile</Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * Wraps a person's avatar or name: opens their card on hover (after a short
 * delay) or click/Enter. The card loads only when opened. `label=""` keeps the visible
 * text as the name (a row's "Ana (you)"); `focusable={false}` for a second trigger on the
 * same person (the avatar beside the name), so a row costs one Tab stop.
 */
export function PersonHoverCard({ person, children, label, className, focusable = true }: { person: Person | null; children: React.ReactNode; label?: string; className?: string; focusable?: boolean }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!person) return <>{children}</>;
  const schedule = (next: boolean, delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), delay);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={cn("rounded-md text-left", className)}
        tabIndex={focusable ? undefined : -1}
        aria-hidden={focusable ? undefined : true}
        aria-label={label === undefined ? `About ${person.full_name || person.username || "this person"}` : label || undefined}
        onPointerEnter={(event) => event.pointerType === "mouse" && schedule(true, 450)}
        onPointerLeave={(event) => event.pointerType === "mouse" && schedule(false, 200)}
      >
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          onPointerEnter={() => timer.current && clearTimeout(timer.current)}
          onPointerLeave={() => schedule(false, 200)}
          className="z-50 rounded-lg border border-border bg-popover text-popover-foreground shadow-md outline-none"
        >
          <CardBody person={person} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
