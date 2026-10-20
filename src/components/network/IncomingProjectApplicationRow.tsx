"use client";

import Link from "next/link";
import { Check, Loader2, X } from "lucide-react";
import { formatDistanceToNowStrict } from "@/lib/utils/date";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { conversationHref } from "@/lib/messaging/routes";
import { profileHref } from "@/lib/routing/identifiers";

export type IncomingProjectApplication = {
  id: string;
  isInvitation?: boolean;
  projectId: string | null;
  projectTitle: string;
  projectSlug?: string | null;
  roleTitle: string;
  createdAt?: string | Date | null;
  /** An application's private thread. */
  channelId?: string | null;
  actor?: {
    id?: string | null;
    username?: string | null;
    fullName?: string | null;
    avatarUrl?: string | null;
  };
  applicant: {
    id?: string | null;
    username?: string | null;
    fullName?: string | null;
    avatarUrl?: string | null;
  };
};

type IncomingProjectApplicationRowProps = {
  app: IncomingProjectApplication;
  busy?: boolean;
  isAccepting?: boolean;
  isRejecting?: boolean;
  onAccept: () => void;
  onReject: () => void;
};

export function IncomingProjectApplicationRow({
  app,
  busy = false,
  isAccepting = false,
  isRejecting = false,
  onAccept,
  onReject,
}: IncomingProjectApplicationRowProps) {
  const actor = app.actor ?? app.applicant;
  const actorName = actor.fullName || actor.username || "User";
  const projectHref = `/projects/${app.projectSlug || app.projectId}`;
  const sourceLabel = app.isInvitation ? "Project invitation" : "Project application";
  const receivedAt = app.createdAt
    ? formatDistanceToNowStrict(new Date(app.createdAt), { addSuffix: true })
    : null;
  const isBusy = busy || isAccepting || isRejecting;

  return (
    <div className="flex flex-col gap-3 rounded-[8px] border border-border bg-card p-4 transition-colors hover:border-border/80 sm:flex-row sm:items-start">
      <Link href={profileHref(actor)} className="w-fit">
        <UserAvatar identity={actor} size={40} />
      </Link>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            href={profileHref(actor)}
            className="truncate text-sm max-md:text-[13px] font-semibold text-foreground transition-colors hover:text-primary"
          >
            {actorName}
          </Link>
          <span className="text-xs text-muted-foreground">
            {app.isInvitation ? "invited you to join as" : "applied for"}
          </span>
          <span className="truncate text-xs font-medium text-primary">{app.roleTitle}</span>
          <span className="rounded-[3px] bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {sourceLabel}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <Link href={projectHref} className="truncate hover:text-primary">
            {app.projectTitle}
          </Link>
          {receivedAt ? <span aria-label={`Received ${receivedAt}`}>{receivedAt}</span> : null}
          {app.channelId ? <Link href={conversationHref(app.channelId)} className="font-medium text-primary hover:underline">Read cover letter</Link> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
        <Button size="sm" onClick={onAccept} disabled={isBusy} aria-label={`Accept ${sourceLabel.toLowerCase()} from ${actorName} for ${app.projectTitle}`}>
          {isAccepting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Accept
        </Button>
        <Button size="sm" variant="outline" onClick={onReject} disabled={isBusy} aria-label={`Decline ${sourceLabel.toLowerCase()} from ${actorName} for ${app.projectTitle}`}>
          {isRejecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
          Decline
        </Button>
      </div>
    </div>
  );
}
