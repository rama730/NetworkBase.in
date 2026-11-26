import type { SearchContextKey } from "./parse";
import type { SearchTab } from "./rank";
import type { GlobalSearchResult, SearchHit } from "./types";

/** Everything the results page shows lives in the address (round two item 10), except the quick look. */
export type SearchPageState = {
    q: string; tab: SearchTab; kind: "all" | "orgs" | "spaces" | "posts"; skills: string[]; updated: "any" | "week" | "month";
    open: boolean; roles: boolean; otype: string[]; rel: "any" | "conn" | "second"; loc: string[]; popen: boolean;
    from: string[]; file: boolean; sort: number; view: "cards" | "list"; more: number; exact: boolean; ctx: SearchContextKey;
    /** The result open in quick look; not in the address. */
    peek?: string | null;
};

export const SORTS: Record<SearchTab, string[]> = {
    discover: ["Best match", "Newest", "Most followed"],
    people: ["Best match", "Most mutuals", "Name"],
    msgs: ["Newest", "Oldest"],
    goto: ["Best match"],
};
export const ORG_TYPE_LABEL: Record<string, string> = { education: "Education", company: "Company", community: "Community", research: "Research", club: "Club", other: "Other" };
const TABS: SearchTab[] = ["discover", "people", "msgs", "goto"];
const CONTEXTS: SearchContextKey[] = ["discover", "network", "messages", "workspace", "org", "settings"];
const PAGE = 6;
const MAX_MORE = 20;

const list = (value: string | null) => (value ? value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 12) : []);
const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
const whole = (value: string | null, max: number) => Math.min(max, Math.max(0, Number.parseInt(value ?? "0", 10) || 0));

export function parseSearchPageState(params: URLSearchParams): SearchPageState {
    return {
        q: (params.get("q") ?? "").slice(0, 100),
        tab: pick(params.get("tab"), TABS, "discover"),
        kind: pick(params.get("kind"), ["all", "orgs", "spaces", "posts"] as const, "all"),
        skills: list(params.get("skill")),
        updated: pick(params.get("updated"), ["any", "week", "month"] as const, "any"),
        open: params.get("open") === "1",
        roles: params.get("roles") === "1",
        otype: list(params.get("otype")),
        rel: pick(params.get("rel"), ["any", "conn", "second"] as const, "any"),
        loc: list(params.get("loc")),
        popen: params.get("popen") === "1",
        from: list(params.get("from")),
        file: params.get("file") === "1",
        sort: whole(params.get("sort"), 9),
        view: params.get("view") === "list" ? "list" : "cards",
        more: whole(params.get("more"), MAX_MORE),
        exact: params.get("exact") === "1",
        ctx: pick(params.get("ctx"), CONTEXTS, "discover"),
    };
}

export function serializeSearchPageState(s: SearchPageState): string {
    const params = new URLSearchParams({ q: s.q });
    const put = (key: string, value: string | false) => { if (value) params.set(key, value); };
    put("tab", s.tab !== "discover" && s.tab);
    put("kind", s.kind !== "all" && s.kind);
    put("skill", s.skills.join(","));
    put("updated", s.updated !== "any" && s.updated);
    put("open", s.open && "1");
    put("roles", s.roles && "1");
    put("otype", s.otype.join(","));
    put("rel", s.rel !== "any" && s.rel);
    put("loc", s.loc.join(","));
    put("popen", s.popen && "1");
    put("from", s.from.join(","));
    put("file", s.file && "1");
    put("sort", s.sort > 0 && String(s.sort));
    put("view", s.view === "list" && "list");
    put("more", s.more > 0 && String(s.more));
    put("exact", s.exact && "1");
    put("ctx", s.ctx !== "discover" && s.ctx);
    return params.toString();
}

export type FacetKey = "kind" | "skill" | "updated" | "open" | "roles" | "otype" | "rel" | "loc" | "popen" | "from" | "file";
const toggle = (values: string[], value: string) => (values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);

/** One facet click: a new state, back at the first page, quick look closed. */
export function toggleFacet(s: SearchPageState, key: FacetKey, value: string): SearchPageState {
    const next: SearchPageState = { ...s, more: 0, peek: null };
    switch (key) {
        case "kind": next.kind = value as SearchPageState["kind"]; break;
        case "skill": next.skills = toggle(s.skills, value); break;
        case "updated": next.updated = value as SearchPageState["updated"]; break;
        case "open": next.open = !s.open; break;
        case "roles": next.roles = !s.roles; break;
        case "otype": next.otype = toggle(s.otype, value); break;
        case "rel": next.rel = value as SearchPageState["rel"]; break;
        case "loc": next.loc = toggle(s.loc, value); break;
        case "popen": next.popen = !s.popen; break;
        case "from": next.from = toggle(s.from, value); break;
        case "file": next.file = !s.file; break;
    }
    return next;
}

export const clearFilters = (s: SearchPageState): SearchPageState => ({
    ...s, kind: "all", skills: [], updated: "any", open: false, roles: false, otype: [], rel: "any", loc: [], popen: false, from: [], file: false, more: 0, peek: null,
});

export type FacetOpt = { value: string; label: string; count: number; on: boolean; zero: boolean };
export type Facet = { key: FacetKey; title: string; opts: FacetOpt[] };
export type Chip = { label: string; key: FacetKey; value: string };
export type PageRow = { type: "head"; label: string; count: number } | { type: "conv"; label: string } | { type: "hit"; hit: SearchHit };

const countBy = (hits: SearchHit[], keys: (hit: SearchHit) => string[]) => {
    const map = new Map<string, number>();
    for (const hit of hits) for (const key of keys(hit)) if (key) map.set(key, (map.get(key) ?? 0) + 1);
    return map;
};
const opt = (value: string, label: string, count: number, on: boolean): FacetOpt => ({ value, label, count, on, zero: !count && !on });
const age = (hit: SearchHit, now: number) => {
    const at = Date.parse(String(hit.meta.updatedAt ?? hit.createdAt ?? ""));
    return Number.isFinite(at) ? (now - at) / 86_400_000 : Number.POSITIVE_INFINITY;
};
const within = (s: SearchPageState, hit: SearchHit, now: number) => s.updated === "any" || age(hit, now) <= (s.updated === "week" ? 7 : 31);
const skillOpts = (hits: SearchHit[], s: SearchPageState) => {
    const counts = countBy(hits, (hit) => hit.tags);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([value]) => value);
    for (const chosen of s.skills) if (!top.includes(chosen)) top.push(chosen);
    return top.map((value) => opt(value, value, counts.get(value) ?? 0, s.skills.includes(value)));
};

/**
 * The SearchPage board's logic: facet counts from what matched (before filters), the active filters as chips, the
 * tab's sort, group heads, conversation heads, and Show more.
 */
export function applyFilters(result: GlobalSearchResult, s: SearchPageState, goto: SearchHit[], now = Date.now()) {
    const base = {
        orgs: result.groups.orgs ?? [], spaces: result.groups.workspaces ?? [], posts: result.groups.posts ?? [],
        people: result.groups.people ?? [], msgs: result.groups.messages ?? [],
    };
    const tabCounts = { discover: base.orgs.length + base.spaces.length + base.posts.length, people: base.people.length, msgs: base.msgs.length, goto: goto.length };
    // Every filter but `except`: a facet counts what the other picked filters leave (round two item 1, review 7).
    const filtered = (except: FacetKey | null) => {
        let { orgs, spaces, posts, people, msgs } = base;
        const has = (hit: SearchHit) => s.skills.every((skill) => hit.tags.includes(skill));
        if (except !== "skill" && s.skills.length) { orgs = orgs.filter(has); spaces = spaces.filter(has); people = people.filter(has); posts = posts.filter((p) => s.skills.some((skill) => p.sub.toLowerCase().includes(skill.toLowerCase()))); }
        if (except !== "updated") { spaces = spaces.filter((hit) => within(s, hit, now)); posts = posts.filter((hit) => within(s, hit, now)); }
        if (except !== "open" && s.open) spaces = spaces.filter((hit) => hit.meta.openToCollaborate);
        if (except !== "roles" && s.roles) spaces = spaces.filter((hit) => Number(hit.meta.openRoles) > 0);
        if (except !== "otype" && s.otype.length) orgs = orgs.filter((hit) => s.otype.includes(String(hit.meta.orgType)));
        if (except !== "rel" && s.rel !== "any") people = people.filter((hit) => hit.meta.relKey === s.rel);
        if (except !== "loc" && s.loc.length) people = people.filter((hit) => s.loc.includes(String(hit.meta.location)));
        if (except !== "popen" && s.popen) people = people.filter((hit) => hit.meta.openCollab);
        if (except !== "from" && s.from.length) msgs = msgs.filter((hit) => s.from.includes(String(hit.meta.author)));
        if (except !== "file" && s.file) msgs = msgs.filter((hit) => hit.meta.hasFile);
        return { orgs, spaces, posts, people, msgs };
    };
    let { orgs, spaces, posts, people, msgs } = filtered(null);

    const sortName = SORTS[s.tab][s.sort % SORTS[s.tab].length]!;
    const by = (fn: (hit: SearchHit) => number) => (a: SearchHit, b: SearchHit) => fn(b) - fn(a);
    if (sortName === "Newest") { spaces = [...spaces].sort(by((hit) => -age(hit, now))); posts = [...posts].sort(by((hit) => -age(hit, now))); }
    if (sortName === "Most followed") { spaces = [...spaces].sort(by((hit) => Number(hit.meta.followers) || 0)); orgs = [...orgs].sort(by((hit) => Number(hit.meta.followers) || 0)); }
    if (sortName === "Most mutuals") people = [...people].sort(by((hit) => Number(hit.meta.mutual) || 0));
    if (sortName === "Name") people = [...people].sort((a, b) => a.title.localeCompare(b.title));
    if (sortName === "Oldest") msgs = [...msgs].reverse();

    const limit = PAGE * (s.more + 1);
    const rows: PageRow[] = [];
    let tabTotal = 0;
    if (s.tab === "discover") {
        const want = (kind: SearchPageState["kind"]) => s.kind === "all" || s.kind === kind;
        const groups: Array<[string, SearchHit[]]> = [];
        if (want("orgs")) groups.push(["Organizations", orgs]);
        if (want("spaces")) groups.push(["Workspaces", spaces]);
        if (want("posts")) groups.push(["Posts", posts]);
        tabTotal = groups.reduce((sum, [, hits]) => sum + hits.length, 0);
        let left = limit;
        for (const [label, hits] of groups) {
            if (!hits.length || left <= 0) continue;
            rows.push({ type: "head", label, count: hits.length });
            for (const hit of hits.slice(0, left)) rows.push({ type: "hit", hit });
            left -= hits.length;
        }
    } else if (s.tab === "people") {
        tabTotal = people.length;
        for (const hit of people.slice(0, limit)) rows.push({ type: "hit", hit });
    } else if (s.tab === "msgs") {
        tabTotal = msgs.length;
        // One head per conversation, in the order each first appears; the sort holds inside it (review 9).
        const byPlace = new Map<string, SearchHit[]>();
        for (const hit of msgs.slice(0, limit)) {
            const place = String(hit.meta.place ?? "");
            byPlace.set(place, [...(byPlace.get(place) ?? []), hit]);
        }
        for (const [place, hits] of byPlace) {
            rows.push({ type: "conv", label: place });
            for (const hit of hits) rows.push({ type: "hit", hit });
        }
    } else {
        tabTotal = goto.length;
        for (const hit of goto) rows.push({ type: "hit", hit });
    }
    const shown = rows.filter((row) => row.type === "hit").length;

    const facets: Facet[] = [];
    const cut = (key: FacetKey) => filtered(key);
    if (s.tab === "discover") {
        const all = cut("kind");
        facets.push({ key: "kind", title: "Show", opts: [opt("all", "Everything", all.orgs.length + all.spaces.length + all.posts.length, s.kind === "all"), opt("orgs", "Organizations", all.orgs.length, s.kind === "orgs"), opt("spaces", "Workspaces", all.spaces.length, s.kind === "spaces"), opt("posts", "Posts", all.posts.length, s.kind === "posts")] });
        const forSkill = cut("skill");
        facets.push({ key: "skill", title: "Skills", opts: skillOpts([...forSkill.orgs, ...forSkill.spaces], s) });
        const forUpdated = cut("updated");
        const dated = [...forUpdated.spaces, ...forUpdated.posts];
        facets.push({ key: "updated", title: "Updated", opts: [opt("any", "Any time", dated.length, s.updated === "any"), opt("week", "Past week", dated.filter((h) => age(h, now) <= 7).length, s.updated === "week"), opt("month", "Past month", dated.filter((h) => age(h, now) <= 31).length, s.updated === "month")] });
        facets.push({ key: "open", title: "Workspace", opts: [opt("1", "Open to collaborate", cut("open").spaces.filter((h) => h.meta.openToCollaborate).length, s.open)] });
        facets.push({ key: "roles", title: "", opts: [opt("1", "Has open roles", cut("roles").spaces.filter((h) => Number(h.meta.openRoles) > 0).length, s.roles)] });
        const types = countBy(cut("otype").orgs, (hit) => [String(hit.meta.orgType ?? "")]);
        const typeKeys = new Set([...countBy(base.orgs, (hit) => [String(hit.meta.orgType ?? "")]).keys()]);
        facets.push({ key: "otype", title: "Organization type", opts: [...typeKeys].map((value) => opt(value, ORG_TYPE_LABEL[value] ?? value, types.get(value) ?? 0, s.otype.includes(value))) });
    } else if (s.tab === "people") {
        const forRel = cut("rel").people;
        facets.push({ key: "rel", title: "Who", opts: [opt("any", "Anyone", forRel.length, s.rel === "any"), opt("conn", "Your connections", forRel.filter((h) => h.meta.relKey === "conn").length, s.rel === "conn"), opt("second", "Friends of connections", forRel.filter((h) => h.meta.relKey === "second").length, s.rel === "second")] });
        facets.push({ key: "skill", title: "Skills", opts: skillOpts(cut("skill").people, s) });
        const locs = countBy(cut("loc").people, (hit) => [String(hit.meta.location ?? "")]);
        const locKeys = [...countBy(base.people, (hit) => [String(hit.meta.location ?? "")]).keys()];
        facets.push({ key: "loc", title: "Location", opts: locKeys.map((value) => opt(value, value, locs.get(value) ?? 0, s.loc.includes(value))) });
        facets.push({ key: "popen", title: "Status", opts: [opt("1", "Open to collaborate", cut("popen").people.filter((h) => h.meta.openCollab).length, s.popen)] });
    } else if (s.tab === "msgs") {
        const from = countBy(cut("from").msgs, (hit) => [String(hit.meta.author ?? "")]);
        const fromKeys = [...countBy(base.msgs, (hit) => [String(hit.meta.author ?? "")]).keys()];
        facets.push({ key: "from", title: "From", opts: fromKeys.map((value) => opt(value, value, from.get(value) ?? 0, s.from.includes(value))) });
        facets.push({ key: "file", title: "Has", opts: [opt("1", "A file", cut("file").msgs.filter((h) => h.meta.hasFile).length, s.file)] });
    }
    for (const facet of facets) facet.opts = facet.opts.filter((o) => o.label);

    const chips: Chip[] = [];
    if (s.tab === "discover") {
        if (s.kind !== "all") chips.push({ label: { orgs: "Organizations", spaces: "Workspaces", posts: "Posts" }[s.kind], key: "kind", value: "all" });
        for (const skill of s.skills) chips.push({ label: `Skill: ${skill}`, key: "skill", value: skill });
        if (s.updated !== "any") chips.push({ label: s.updated === "week" ? "Past week" : "Past month", key: "updated", value: "any" });
        if (s.open) chips.push({ label: "Open to collaborate", key: "open", value: "1" });
        if (s.roles) chips.push({ label: "Has open roles", key: "roles", value: "1" });
        for (const type of s.otype) chips.push({ label: ORG_TYPE_LABEL[type] ?? type, key: "otype", value: type });
    } else if (s.tab === "people") {
        if (s.rel !== "any") chips.push({ label: s.rel === "conn" ? "Your connections" : "Friends of connections", key: "rel", value: "any" });
        for (const skill of s.skills) chips.push({ label: `Skill: ${skill}`, key: "skill", value: skill });
        for (const loc of s.loc) chips.push({ label: loc, key: "loc", value: loc });
        if (s.popen) chips.push({ label: "Open to collaborate", key: "popen", value: "1" });
    } else if (s.tab === "msgs") {
        for (const from of s.from) chips.push({ label: `From: ${from}`, key: "from", value: from });
        if (s.file) chips.push({ label: "Has a file", key: "file", value: "1" });
    }

    return { rows, facets, chips, tabCounts, tabTotal, shown, sortLabel: sortName };
}

/** Quick look keys (round two item 5): j/↓ next, k/↑ previous (both wrap), Space open/close, Esc close. */
export function nextPeek(ids: string[], current: string | null, key: string): string | null {
    if (!ids.length) return null;
    const at = current ? ids.indexOf(current) : -1;
    if (key === "j" || key === "ArrowDown") return ids[(at + 1) % ids.length]!;
    if (key === "k" || key === "ArrowUp") return ids[(at - 1 + ids.length) % ids.length]!;
    if (key === " ") return at >= 0 ? null : ids[0]!;
    if (key === "Escape") return null;
    return current;
}
