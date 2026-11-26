import type { SearchKind } from "./parse";

export type SearchAct = "Connect" | "Pending" | "Message" | "Follow" | "Open" | null;

/** One result, whatever its kind; `meta` holds the kind's own facts (report §4b item 8). */
export type SearchHit = {
    id: string;
    kind: SearchKind | "scope" | "channels";
    title: string;
    sub: string;
    href: string;
    why: string | null;
    score: number;
    createdAt: string | null;
    avatarUrl: string | null;
    tags: string[];
    act: SearchAct;
    meta: Record<string, string | number | boolean | null>;
};

export type SearchSkillCard = { name: string; people: number; workspaces: number; orgs: number };

export type SearchEmail = { kind: "person"; hit: SearchHit } | { kind: "invite"; address: string };

export type GlobalSearchResult = {
    q: string;
    /** Set when a typo was corrected: what was typed. */
    fixedFrom: string | null;
    groups: Partial<Record<SearchHit["kind"], SearchHit[]>>;
    /** Matches per kind, up to the fetch cap. */
    counts: Partial<Record<SearchHit["kind"], number>>;
    skill: SearchSkillCard | null;
    suggestions: string[];
    email: SearchEmail | null;
    tookMs: number;
};
