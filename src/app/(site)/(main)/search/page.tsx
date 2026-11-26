import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";

import SearchPageClient from "@/components/search/SearchPageClient";
import { db } from "@/lib/db";
import { buildRouteMetadata } from "@/lib/metadata/route-metadata";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { parseSearchInput } from "@/lib/search/global/parse";

export function generateMetadata() {
    return buildRouteMetadata({ title: "Search · NetworkBase", description: "Everything that matches: organizations, workspaces, posts, people, your messages and pages.", path: "/search" });
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");

/**
 * The results page (global search mix): Discover's and Network's own parts under one header. The tabs load in the
 * browser like Discover and Network do; the server only checks sign-in and whether these words are a saved search.
 */
export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
    const raw = await searchParams;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) if (typeof value === "string") params.set(key, value);
    const { user } = await getViewerAuthContext();
    if (!user) redirect(`/login?next=${encodeURIComponent(`/search?${params.toString()}`)}`);

    const { text } = parseSearchInput(one(raw.q));
    const tab = ["discover", "people", "msgs", "goto"].includes(one(raw.tab)) ? one(raw.tab) : "discover";
    const saved = text ? await db.execute(sql`SELECT id, notify FROM saved_searches WHERE user_id = ${user.id}::uuid AND lower(query) = lower(${text}) AND tab = ${tab} ORDER BY created_at LIMIT 1`)
        .then((rows) => (rows as unknown as Array<{ id: string; notify: "weekly" | "daily" | "off" }>)[0] ?? null).catch(() => null) : null;

    return <SearchPageClient saved={saved} />;
}
