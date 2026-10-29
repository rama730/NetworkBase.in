"use client";

import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { useRef, useState } from "react";
import { Flag } from "lucide-react";

import { messageUserInWindow } from "@/components/messages/message-user";
import { usePersonContext } from "@/components/messages/useConversation";
import { PresenceAvatar } from "@/components/presence/PersonPresence";
import { PresenceBadge } from "@/components/presence/PresenceBadge";
import { StatusInline } from "@/components/presence/StatusInline";
import { usePersonPresence } from "@/components/presence/usePresence";
import { useAuth } from "@/hooks/useAuth";
import { profileHref } from "@/lib/routing/identifiers";
import { ReportDialog } from "@/components/reports/ReportDialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Person = { id: string; username: string | null; full_name: string | null; avatar_url: string | null };

/**
 * The person card (spec §12): 48px square avatar, 14px gap, 15px semibold name, one line under it
 * (location, else headline, else @username), then status, presence and their local time, and two
 * compact actions. A plain card: no inner wells.
 */
function CardBody({ person, onReport }: { person: Person; onReport: () => void }) {
  const { user } = useAuth();
  const presence = usePersonPresence(person.id);
  const context = usePersonContext(person.id);
  const [now] = useState(() => new Date());
  const name = person.full_name || person.username || "Someone";
  const identity = { id: person.id, username: person.username, fullName: person.full_name, avatarUrl: person.avatar_url };
  const { headline, location, timeZone } = context.data ?? {};
  const clock = (zone?: string) => now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: zone });
  // Their time only when their clock differs from yours.
  const theirTime = timeZone && clock(timeZone) !== clock() ? `${clock(timeZone)} local time` : null;
  return (
    <div className="flex w-[320px] max-w-[calc(100vw-24px)] flex-col gap-4 p-5">
      <div className="flex items-center gap-3.5">
        <PresenceAvatar userId={person.id} identity={identity} size={48} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[15px] font-semibold leading-tight text-foreground">{name}</span>
          {location ? <span className="nb-meta truncate">{location}</span>
            : headline ? <span className="nb-compact line-clamp-2 text-muted-foreground">{headline}</span>
            : person.username ? <span className="nb-meta truncate">@{person.username}</span> : null}
        </div>
      </div>
      {location && headline ? <p className="nb-compact -mt-2 line-clamp-2 text-muted-foreground">{headline}</p> : null}
      <div className="flex flex-col gap-1.5">
        {presence.status ? (
          <StatusInline emoji={presence.status.emoji} text={presence.statusText} className="nb-compact line-clamp-2 text-foreground" />
        ) : null}
        {presence.status?.pausesNotifications ? <span className="nb-meta">Notifications paused</span> : null}
        <span className="nb-meta flex min-w-0 items-center gap-1.5">
          <PresenceBadge availability={presence.availability} size={8} style={{ ["--presence-cut" as string]: "var(--popover)" }} />
          {/* No "Offline" guess before presence has loaded. */}
          <span className="truncate">{presence.loaded ? [presence.availabilityText, theirTime].filter(Boolean).join(" · ") : "\u00a0"}</span>
        </span>
      </div>
      <div className="flex gap-2">
        {user?.id !== person.id ? (
          <Button asChild size="sm" className="flex-1 pointer-coarse:h-11">
            <Link href={`/messages?userId=${person.id}`} onClick={(event) => messageUserInWindow(person.id, event)}>Message</Link>
          </Button>
        ) : null}
        <Button asChild variant="outline" size="sm" className="flex-1 pointer-coarse:h-11">
          <Link href={profileHref({ id: person.id, username: person.username })}>View profile</Link>
        </Button>
        {/* Report the person from their card (trust and safety §5.1); never yourself, never signed out. */}
        {user && user.id !== person.id ? (
          <Button type="button" variant="ghost" size="icon-sm" onClick={onReport} aria-label={`Report ${name}`} title="Report" className="shrink-0 text-muted-foreground pointer-coarse:size-11">
            <Flag className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
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
  // The dialog lives beside the card, not in it, so closing the card doesn't close the report.
  const [reporting, setReporting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!person) return <>{children}</>;
  const schedule = (next: boolean, delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), delay);
  };
  return (
    <>
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
          <CardBody person={person} onReport={() => { setOpen(false); setReporting(true); }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
    {reporting ? <ReportDialog kind="person" targetId={person.id} noun="person" personName={person.full_name || person.username} open onOpenChange={setReporting} /> : null}
    </>
  );
}
