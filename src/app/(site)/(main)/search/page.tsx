import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";

import SearchPageClient from "@/components/search/SearchPageClient";
import { db } from "@/lib/db";
import { buildRouteMetadata } from "@/lib/metadata/route-metadata";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { logSearch } from "@/lib/search/global/extras";
import { parseSearchInput } from "@/lib/search/global/parse";
import { runGlobalSearch } from "@/lib/search/global/run";
import { parseSearchPageState } from "@/lib/search/global/url-state";

export function generateMetadata() {
    return buildRouteMetadata({ title: "Search · NetworkBase", description: "Everything that matches: organizations, workspaces, posts, people, your messages and pages.", path: "/search" });
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The results page (global search mix §3, §4b): the box's search with 60 a kind, rendered on the server. */
export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
    const raw = await searchParams;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) if (typeof value === "string") params.set(key, value);
    const { user } = await getViewerAuthContext();
    if (!user) redirect(`/login?next=${encodeURIComponent(`/search?${params.toString()}`)}`);

    const state = parseSearchPageState(params);
    const { text, scope } = parseSearchInput(state.q);
    const result = text ? await runGlobalSearch({ viewerId: user.id, q: text, ctx: state.ctx, place: null, scope, perKind: 60, exact: state.exact }) : null;
    // Saved under the words that were searched (a typo corrected, a shortcut parsed), the same way Save stores them.
    const saved = result ? await db.execute(sql`SELECT id, notify FROM saved_searches WHERE user_id = ${user.id}::uuid AND lower(query) = lower(${result.q}) AND tab = ${state.tab} ORDER BY created_at LIMIT 1`)
        .then((rows) => (rows as unknown as Array<{ id: string; notify: "weekly" | "daily" | "off" }>)[0] ?? null).catch(() => null) : null;
    if (result) void logSearch(user.id, result.q);

    return <SearchPageClient key={`${text}|${state.exact}`} initialState={state} result={result} saved={saved} />;
}
