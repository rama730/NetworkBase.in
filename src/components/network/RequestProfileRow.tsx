import type { ReactNode } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "@/lib/utils/date";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { profileHref } from "@/lib/routing/identifiers";
import { personCardSubtitle } from "@/lib/network/person-card";

export type RequestProfile = {
  id: string;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  headline: string | null;
  location: string | null;
};

/** Shared request row for the Connections queue and Workspace launcher. */
export function RequestProfileRow({
  profile,
  requestedAt,
  actions,
}: {
  profile: RequestProfile;
  requestedAt: Date | string;
  actions: ReactNode;
}) {
  const name = profile.fullName || profile.username || "User";
  // Never a bare name: headline, else location, else @username; the location line only when it isn't the subtitle.
  const subtitle = personCardSubtitle(profile);
  const showLocation = Boolean(profile.location) && subtitle.kind !== "location";

  return (
    <div className="flex items-center gap-4 rounded-[8px] border border-border bg-card p-4 transition-colors hover:border-border/80">
      <Link href={profileHref(profile)} className="shrink-0">
        <UserAvatar identity={profile} size={40} />
      </Link>
      <Link href={profileHref(profile)} className="min-w-0 flex-1">
        <h3 className="truncate text-sm max-md:text-[13px] font-semibold text-foreground hover:text-primary">{name}</h3>
        {subtitle.text ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle.text}</p> : null}
        {showLocation ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{profile.location}</p> : null}
      </Link>
      <p className="hidden shrink-0 text-xs text-muted-foreground sm:block">
        {formatDistanceToNow(new Date(requestedAt), { addSuffix: true })}
      </p>
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </div>
  );
}
