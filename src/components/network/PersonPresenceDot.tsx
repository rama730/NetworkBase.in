"use client";

import { PersonPresenceBadge } from "@/components/presence/PersonPresence";

/** The Node presence badge in an avatar's corner (people cards, search, discover). */
export function PersonPresenceDot({ userId, lastActiveAt, compact = false }: { userId: string | null | undefined; lastActiveAt?: string | null; compact?: boolean }) {
    return <PersonPresenceBadge userId={userId} lastActiveAt={lastActiveAt} size={compact ? 14 : 16} className="nb-person-presence-dot" />;
}
