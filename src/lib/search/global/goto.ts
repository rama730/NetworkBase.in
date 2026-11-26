import { searchSettings } from "@/components/layout/header/global-search";
import { normalizeSearchQuery } from "@/lib/search/query";

import { matchScore } from "./rank";
import type { SearchHit } from "./types";

export type GotoPlace = { kind: "workspace" | "org"; name: string; href: string };

const goto = (id: string, title: string, sub: string, href: string, meta: SearchHit["meta"] = {}): SearchHit => ({
    id: `goto:${id}`, kind: "goto", title, sub, href, why: null, score: 3, createdAt: null, avatarUrl: null, tags: [], act: null, meta,
});

const PAGES = [
    goto("discover", "Discover", "Page · workspaces, organizations and posts", "/discover"),
    goto("network", "Network", "Page · people and your connections", "/network"),
    goto("messages", "Messages", "Page · your conversations", "/messages"),
    goto("my-work", "My work", "Page · what's assigned to you", "/my-work"),
    goto("my-profile", "My profile", "Page · how others see you", "/my-profile"),
    goto("settings", "Settings", "Page · account, privacy, notifications", "/settings"),
];

/** Settings that change right in the row (Go to tab, Settings flip in place). */
const CONTROLS: Record<string, "theme" | "findMe"> = { theme: "theme", "search-findability": "findMe" };

/** Settings, pages and actions for the words (report §4 item 7; it replaces the settings-only search). */
export function searchGoto(q: string, ctx: { place: GotoPlace | null }): SearchHit[] {
    const value = normalizeSearchQuery(q).toLowerCase();
    if (!value) return [];
    const settings = searchSettings(value).map((item) => goto(item.id, item.title, `Settings · ${item.section}`, item.href,
        CONTROLS[item.id] ? { control: CONTROLS[item.id]! } : {}));
    const pages = PAGES.filter((page) => matchScore(page.title, value) < 4);
    return [...verbActions(value, ctx.place), ...pages, ...settings];
}

/** A verb shows actions first; actions that need a workspace use the one you're in. */
export function verbActions(q: string, place: GotoPlace | null): SearchHit[] {
    const value = normalizeSearchQuery(q).toLowerCase();
    const [verb, ...rest] = value.split(" ");
    const object = rest.join(" ");
    if (!verb) return [];
    if (verb === "new" || verb === "create") {
        const all = [
            goto("new-workspace", "New workspace", "Opens the create flow", "/workspaces/new", { action: true }),
            ...(place ? [goto("new-task", `New task in ${place.name}`, `The ${place.kind === "org" ? "organization" : "workspace"} you’re in`, `${place.href}?tab=tasks&new=1`, { action: true })] : []),
            goto("new-message", "New message", "To a person or a group", "/messages/new", { action: true }),
            ...(place ? [goto("new-post", `New post in ${place.name}`, "An update for its followers", `${place.href}?tab=updates`, { action: true })] : []),
        ];
        return object ? all.filter((item) => item.title.toLowerCase().includes(object)) : all;
    }
    if (verb === "invite") return [goto("invite", "Invite people", "From your Network page", "/network?tab=invitations", { action: true })];
    if (verb === "message") return [goto("new-message", "New message", "To a person or a group", "/messages/new", { action: true })];
    if (verb === "join") return [goto("join", "Find organizations to join", "Discover · Organizations", "/discover?show=organizations", { action: true })];
    return [];
}
