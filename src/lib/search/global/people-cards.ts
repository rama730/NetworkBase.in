import "server-only";

import type { SuggestedProfile } from "@/app/actions/connections";
import { readPersonCardDetails } from "@/lib/network/person-card-read";

import { searchPeople } from "./kinds";

/**
 * The results page's People tab (spec §12, §16): the global search's people — the same privacy rule as the box —
 * in the shape Network's PersonCard draws, so the tab is Network's own card, not a look-alike.
 */
export async function searchPeopleCards(viewerId: string, q: string, limit = 60): Promise<SuggestedProfile[]> {
    const hits = await searchPeople(viewerId, q, limit);
    if (!hits.length) return [];
    const ids = hits.map((hit) => String(hit.meta.userId));
    const details = await readPersonCardDetails(viewerId, ids);
    return hits.map((hit) => {
        const id = String(hit.meta.userId);
        const status: SuggestedProfile["connectionStatus"] = hit.act === "Message" ? "connected"
            : hit.act === "Pending" ? (hit.meta.pendingSent ? "pending_sent" : "pending_received") : "none";
        return {
            id,
            username: (hit.meta.username as string | null) ?? null,
            fullName: (hit.meta.fullName as string | null) ?? hit.title,
            avatarUrl: hit.avatarUrl,
            headline: (hit.meta.headline as string | null) ?? null,
            location: (hit.meta.location as string | null) ?? null,
            connectionStatus: status,
            canConnect: status === "none",
            skills: hit.tags,
            mutualConnections: Number(hit.meta.mutual) || 0,
            openToCollaborate: Boolean(hit.meta.openCollab),
            ...details[id],
        } as SuggestedProfile;
    });
}
