import type { DiscoverFeedItem, DiscoverUpdateView, Workspace } from "@/types/discover";

/** A post goes after every second workspace card (UP11). */
export const FEED_GROUP = 2;
/** An update is never placed within this many cards of its own project's card (or of another update from it). */
const SPACING = 6;

/**
 * Mixes project cards and update cards into one feed.
 *
 * Positions depend only on the projects before them, never on how many are loaded: an update takes the slot
 * after every *complete* group of two projects, so loading the next page can add items at the end but never
 * moves one already on screen. When no waiting update clears the spacing rule, the slot stays empty rather than
 * break the rule. With no projects to mix into (a search that only update text matches), updates stand alone.
 *
 * ponytail: updates arrive a page ahead of the projects that need them, so a slot is filled the first time it is
 * built. If updates ever lag behind, a late page could fill an empty slot above the viewer; key the slot to the
 * update's id if that shows.
 */
export function interleaveWorkspacesAndUpdates(projects: Workspace[], updates: DiscoverUpdateView[]): DiscoverFeedItem[] {
    if (projects.length === 0) return updates.map((data) => ({ kind: "update" as const, data }));

    const items: DiscoverFeedItem[] = [];
    const waiting = [...updates];
    const recent: string[] = [];
    const remember = (projectId: string) => {
        recent.push(projectId);
        if (recent.length > SPACING) recent.shift();
    };

    projects.forEach((project, index) => {
        items.push({ kind: "project", data: project });
        remember(project.id);
        if ((index + 1) % FEED_GROUP !== 0) return;

        const fits = waiting.findIndex((update) => !recent.includes(update.projectId));
        if (fits === -1) return;
        const [update] = waiting.splice(fits, 1);
        if (!update) return;
        items.push({ kind: "update", data: update });
        remember(update.projectId);
    });
    return items;
}

/**
 * Posts alone, as a timeline: at most two in a row from one workspace (UP11). The rest wait for the next post from
 * elsewhere, which keeps what's already on screen in place as pages load. On the last page, whatever waited follows.
 */
export function limitPostRuns(posts: DiscoverUpdateView[], exhausted: boolean, maxRun = 2): DiscoverUpdateView[] {
    const out: DiscoverUpdateView[] = [];
    const waiting: DiscoverUpdateView[] = [];
    const fits = (post: DiscoverUpdateView) => !(out.length >= maxRun && out.slice(-maxRun).every((placed) => placed.projectId === post.projectId));
    const drain = () => {
        for (let at = waiting.findIndex(fits); at !== -1; at = waiting.findIndex(fits)) out.push(waiting.splice(at, 1)[0]!);
    };
    for (const post of posts) {
        drain();
        if (fits(post)) out.push(post);
        else waiting.push(post);
    }
    drain();
    return exhausted ? [...out, ...waiting] : out;
}

/** The key a feed item keeps while the list changes under it. Project and update ids can't collide. */
export const feedItemKey = (item: DiscoverFeedItem) => `${item.kind === "project" ? "p" : "u"}:${item.data.id}`;
