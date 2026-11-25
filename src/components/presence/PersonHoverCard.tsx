"use client";

import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { useRef, useState } from "react";
import { Ban, Flag } from "lucide-react";

import { useBlockedIds } from "@/components/messages/ChatShellProvider";
import { messageUserInWindow } from "@/components/messages/message-user";
import { BlockPersonDialog } from "@/components/privacy/BlockDialog";
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
import { messageGate } from "@/lib/messaging/can-message";
import { padCount } from "@/lib/ui/tab-marker";

type Person = { id: string; username: string | null; full_name: string | null; avatar_url: string | null };

/**
 * The person card (controls round 2): a small piece of their profile. A plain head (no band) with the eyebrow, a 56px
 * picture, the serif name and @handle; their headline; status, presence and local time; stat cells for what you
 * share; Message, View profile, Report and Block.
 */
function CardBody({ person, onReport, onBlock, blocked }: { person: Person; onReport: () => void; onBlock: () => void; blocked: boolean }) {
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
  // Message follows who can message whom (EntryPoints): off with a tag and reason, or Unblock when you blocked them.
  const gate = messageGate({ canMessage: context.data?.canMessage, blocked: context.data?.blocked ?? blocked, blockedByMe: blocked });
  const shared = context.data ? [["Shared workspaces", context.data.sharedProjects.length], ["Shared channels", context.data.sharedChannels.length]] as const : null;
  return (
    <div className="nb-hcard">
      <div className="nb-hcard-head">
        <p className="nb-hcard-eyebrow">{location ? `Profile · ${location}` : "Profile"}</p>
        <div className="nb-hcard-id">
          <PresenceAvatar userId={person.id} identity={identity} size={56} />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="nb-hcard-name">{name}</span>
            {person.username ? <span className="nb-meta truncate">@{person.username}</span> : null}
          </div>
        </div>
      </div>
      {headline ? <p className="nb-hcard-line">{headline}</p> : null}
      <div className="nb-hcard-presence">
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
      {shared ? (
        <div className="nb-hcard-stats">
          {shared.map(([label, n]) => <div key={label}>{label}<b>{padCount(n)}</b></div>)}
        </div>
      ) : null}
      <div className="nb-hcard-acts">
        {user?.id !== person.id && gate.state === "open" ? (
          <Button asChild size="sm" className="flex-1 pointer-coarse:h-11">
            <Link href={`/messages?userId=${person.id}`} onClick={(event) => messageUserInWindow(person.id, event)}>Message</Link>
          </Button>
        ) : null}
        {user?.id !== person.id && gate.state === "off" ? (
          <span className="nb-hcard-off">
            <Button type="button" size="sm" disabled className="pointer-coarse:h-11">Message</Button>
            <span className="nb-state-tag">{gate.tag}</span>
          </span>
        ) : null}
        <Button asChild variant="outline" size="sm" className="flex-1 pointer-coarse:h-11">
          <Link href={profileHref({ id: person.id, username: person.username })}>View profile</Link>
        </Button>
        {/* Report the person from their card (trust and safety §5.1); never yourself, never signed out. */}
        {user && user.id !== person.id ? (
          <Button type="button" variant="ghost" size="icon-sm" onClick={onReport} aria-label={`Report ${name}`} className="shrink-0 text-muted-foreground pointer-coarse:size-11">
            <Flag className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
        {user && user.id !== person.id ? (
          <Button type="button" variant={blocked ? "default" : "ghost"} size={blocked ? "sm" : "icon-sm"} onClick={onBlock} aria-label={`${blocked ? "Unblock" : "Block"} ${name}`} className={cn("shrink-0 pointer-coarse:h-11", blocked ? "" : "text-muted-foreground pointer-coarse:size-11")}>
            {blocked ? "Unblock" : <Ban className="size-4" aria-hidden="true" />}
          </Button>
        ) : null}
      </div>
      {gate.state === "off" && gate.reason ? <p className="nb-hcard-reason">{gate.reason}</p> : null}
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
  // Block from the card (Blocking B5): each ask mounts a fresh confirmation; it stays out of the tree until then.
  const [blockAsk, setBlockAsk] = useState(0);
  const blockedIds = useBlockedIds();
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
        onPointerEnter={(event) => event.pointerType === "mouse" && schedule(true, 400)}
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
          className="z-50 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md outline-none"
        >
          <CardBody person={person} blocked={blockedIds.has(person.id)} onReport={() => { setOpen(false); setReporting(true); }} onBlock={() => { setOpen(false); setBlockAsk((n) => n + 1); }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
    {blockAsk ? <BlockPersonDialog key={blockAsk} person={{ id: person.id, name: person.full_name || person.username || "this person" }} source="person_card" unblock={blockedIds.has(person.id)} /> : null}
    {reporting ? <ReportDialog kind="person" targetId={person.id} noun="person" personName={person.full_name || person.username} open onOpenChange={setReporting} /> : null}
    </>
  );
}
