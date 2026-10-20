"use client";

import { PresenceBadge } from "@/components/presence/PresenceBadge";
import { usePersonPresence, useProjectPresence } from "@/components/presence/usePresence";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { cn } from "@/lib/utils";

/** Badge size for an avatar size: 24 → 11, 40 → 14, 64 → 20, larger → 26. */
export function badgeSizeFor(avatarSize: number) {
  if (avatarSize <= 24) return 11;
  if (avatarSize <= 40) return 14;
  if (avatarSize <= 64) return 20;
  return 26;
}

/** A person's live badge (availability or their status), privacy applied server-side. */
export function PersonPresenceBadge({
  userId,
  lastActiveAt,
  live,
  size = 14,
  statusSize,
  className,
  style,
}: {
  userId: string | null | undefined;
  lastActiveAt?: string | null;
  live?: boolean;
  size?: number;
  /** The size the badge grows to when the person has a status emoji. */
  statusSize?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const presence = usePersonPresence(userId, { fallbackLastActiveAt: lastActiveAt, live });
  if (!userId) return null;
  return (
    <PresenceBadge
      availability={presence.availability}
      size={size}
      label={presence.label}
      className={className}
      style={style}
      statusEmoji={presence.status?.emoji}
      statusSize={statusSize}
      statusTimer={presence.statusTimer}
      statusPaused={presence.status?.pausesNotifications}
      animate={presence.loaded}
      pulseKey={presence.updatedAt}
    />
  );
}

type AvatarProps = React.ComponentProps<typeof UserAvatar>;

/** UserAvatar with the presence badge on its bottom-right corner. */
export function PresenceAvatar({
  userId,
  lastActiveAt,
  live,
  size = 40,
  className,
  ...avatar
}: Omit<AvatarProps, "size"> & { userId: string | null | undefined; lastActiveAt?: string | null; live?: boolean; size?: number }) {
  const badge = badgeSizeFor(size);
  return (
    <span className={cn("relative inline-flex flex-none", className)} style={{ width: size, height: size }}>
      <UserAvatar size={size} {...avatar} />
      <PersonPresenceBadge userId={userId} lastActiveAt={lastActiveAt} live={live} size={badge} statusSize={size >= 32 ? 20 : undefined} className="absolute" style={{ right: -3, bottom: -3 }} />
    </span>
  );
}

/** A project's badge: its status glyph if set, else its activity. */
export function ProjectPresenceBadge({
  projectId,
  updatedAt,
  size = 14,
  statusSize,
  className,
  style,
  testId,
  activityLabel,
}: {
  testId?: string;
  /** Finer project wording ("Active 5m ago", "Last updated: …") to use instead of the generic one. */
  activityLabel?: string;
  projectId: string | null | undefined;
  updatedAt?: string | Date | null;
  size?: number;
  /** The size the badge grows to when the project has a status emoji. */
  statusSize?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  // Without an id (slug-only links) the badge still shows activity from updatedAt.
  const presence = useProjectPresence(projectId, updatedAt);
  return (
    <PresenceBadge
      availability={presence.availability}
      size={size}
      label={activityLabel ? (presence.statusLine ? `${presence.statusLine} · ${activityLabel}` : activityLabel) : presence.label}
      className={className}
      style={style}
      testId={testId}
      statusEmoji={presence.status?.emoji}
      statusSize={statusSize}
    />
  );
}
