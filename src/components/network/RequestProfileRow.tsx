import type { ReactNode } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "@/lib/utils/date";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { profileHref } from "@/lib/routing/identifiers";

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

  return (
    <div className="flex items-center gap-4 rounded-[8px] border border-border bg-card p-4 transition-colors hover:border-border/80">
      <Link href={profileHref(profile)} className="shrink-0">
        <UserAvatar identity={profile} size={40} />
      </Link>
      <Link href={profileHref(profile)} className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-foreground hover:text-primary">{name}</h3>
        {profile.headline ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{profile.headline}</p> : null}
        {profile.location ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{profile.location}</p> : null}
      </Link>
      <p className="hidden shrink-0 text-xs text-muted-foreground sm:block">
        {formatDistanceToNow(new Date(requestedAt), { addSuffix: true })}
      </p>
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </div>
  );
}
