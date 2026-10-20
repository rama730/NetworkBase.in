"use client";

import { PersonPresenceBadge } from "@/components/presence/PersonPresence";
import { usePersonPresence } from "@/components/presence/usePresence";

/** The Node presence badge in an avatar's corner (people cards, search, discover). */
export function PersonPresenceDot({ userId, lastActiveAt, compact = false }: { userId: string | null | undefined; lastActiveAt?: string | null; compact?: boolean }) {
    return <PersonPresenceBadge userId={userId} lastActiveAt={lastActiveAt} size={compact ? 16 : 20} statusSize={20} className="nb-person-presence-dot" />;
}

/** The badge's meaning as text, for screen readers, beside the name (the avatar link is hidden from them). */
export function PersonPresenceText({ userId, lastActiveAt }: { userId: string | null | undefined; lastActiveAt?: string | null }) {
    const presence = usePersonPresence(userId, { fallbackLastActiveAt: lastActiveAt ?? null });
    return presence.loaded || lastActiveAt ? <span className="sr-only">, {presence.availabilityText}</span> : null;
}
