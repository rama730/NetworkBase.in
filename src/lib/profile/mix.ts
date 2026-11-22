/**
 * Rules for the profile and Edit profile in the mix style (spec: docs/superpowers/specs/2026-11-23-profile-mix-prototype.html).
 * Pure functions, shared by both pages and their tests.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-07-01" or an ISO timestamp → { year: 2026, month: 'Jul' }. */
function ym(value: string | null | undefined) {
    const m = typeof value === 'string' ? value.match(/^(\d{4})-(\d{2})/) : null;
    return m ? { year: m[1]!, month: MONTHS[Number(m[2]) - 1] ?? '' } : null;
}

/** The timeline's date column: current work reads NOW + since; past work the year and the range. */
export function contributionDate(c: { startDate?: string | null; endDate?: string | null; currentlyActive?: boolean }) {
    const start = ym(c.startDate), end = ym(c.endDate);
    if (c.currentlyActive || (start && !end)) return { now: true, top: 'Now', sub: start ? `Since ${start.month} ${start.year}` : '' };
    if (!start && !end) return { now: false, top: '', sub: '' };
    const last = end ?? start!;
    const sub = start && end ? (start.year === end.year ? `${start.month} – ${end.month}` : `${start.month} ${start.year} – ${end.month} ${end.year}`) : `${last.month} ${last.year}`;
    return { now: false, top: last.year, sub };
}

/** The About card's Now line: three roles, then "+N more". */
export function currentRoles<T>(entries: T[], limit = 3) {
    return { shown: entries.slice(0, limit), more: Math.max(0, entries.length - limit) };
}

type Kinded = { projectId?: string | null; projectKind?: string | null };
export type ContributionKind = 'org' | 'workspace' | 'outside';
export function contributionKind(c: Kinded): ContributionKind {
    return !c.projectId ? 'outside' : c.projectKind === 'organization' ? 'org' : 'workspace';
}
/** Counts for the filter chips: All · Organizations · Workspaces · Outside projects. */
export function filterCounts(entries: Kinded[]) {
    const counts = { all: entries.length, org: 0, workspace: 0, outside: 0 };
    for (const c of entries) counts[contributionKind(c)]++;
    return counts;
}

/**
 * Pinned first, then the order you chose, then newest start, then id. Once you've moved anything on the timeline
 * (Move up/down) that order is used; until then, the Organizations order from Manage organizations.
 */
export function orderContributions<T extends { id: string; featured?: boolean | null; profileOrder?: number | null; timelineOrder?: number | null; startDate?: string | null; createdAt?: string | null }>(entries: T[]): T[] {
    const moved = entries.some((e) => e.timelineOrder != null);
    const rank = (e: T) => (moved ? e.timelineOrder : e.profileOrder) ?? Infinity;
    return [...entries].sort((a, b) => {
        if (Boolean(b.featured) !== Boolean(a.featured)) return Number(Boolean(b.featured)) - Number(Boolean(a.featured));
        const oa = rank(a), ob = rank(b);
        if (oa !== ob) return oa - ob;
        const da = a.startDate || a.createdAt || '', db = b.startDate || b.createdAt || '';
        if (da !== db) return db.localeCompare(da);
        return b.id.localeCompare(a.id);
    });
}

function listDiff(after: string[], before: string[]) {
    const add = after.filter((x) => !before.includes(x)), rm = before.filter((x) => !after.includes(x));
    if (!add.length && !rm.length) return 'Reordered';
    const part = (arr: string[], sign: string) => arr.length ? `${arr.slice(0, 2).map((x) => sign + x).join(', ')}${arr.length > 2 ? ` +${arr.length - 2} more` : ''}` : '';
    return [part(add, '+'), part(rm, '−')].filter(Boolean).join(' · ');
}

/** The Changes card says what changed in words: "+React", "@a → @b", "Turned on", "Edited". */
export function changeSummary(field: string, before: unknown, after: unknown): string {
    if (Array.isArray(after) || Array.isArray(before)) {
        const key = (x: unknown) => typeof x === 'string' ? x : JSON.stringify(x);
        return listDiff((after as unknown[] ?? []).map(key), (before as unknown[] ?? []).map(key));
    }
    if (field === 'photo') return after === 'new' ? (before === 'pixel' ? 'Added' : 'New photo') : after === 'pixel' ? 'Removed' : 'Edited';
    if (typeof after === 'boolean') return after ? 'Turned on' : 'Turned off';
    if (field === 'username') return `@${before} → @${after}`;
    const b = typeof before === 'string' ? before.trim() : before, a = typeof after === 'string' ? after.trim() : after;
    return !b ? 'Added' : !a ? 'Removed' : 'Edited';
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/**
 * Another tab saved while you edited. A field only they changed comes in; a field you both changed to different
 * values is a clash you pick (Keep mine / Use theirs).
 */
export function mergeConflict(base: Record<string, unknown>, mine: Record<string, unknown>, theirs: Record<string, unknown>, fields: string[]) {
    const merged: Record<string, unknown> = { ...mine }, clashes: Record<string, unknown> = {};
    for (const f of fields) {
        const iChanged = !same(mine[f], base[f]), theyChanged = !same(theirs[f], base[f]);
        if (theyChanged && !iChanged) merged[f] = theirs[f];
        else if (theyChanged && iChanged && !same(mine[f], theirs[f])) clashes[f] = theirs[f];
    }
    return { merged, clashes };
}

/** Three names to offer when the one you typed is taken; each ≤ 20 characters. */
export function freeUsernames(handle: string): string[] {
    const fit = (base: string, suffix: string) => base.slice(0, 20 - suffix.length) + suffix;
    return [...new Set([fit(handle, '1'), fit(handle, '_dev'), fit(handle, '26')])];
}

export function normalizeWebsite(value: string) {
    const v = value.trim();
    return v && !/^https?:\/\//i.test(v) ? `https://${v}` : v;
}
export function websiteError(value: string): string | null {
    const v = value.trim();
    return v && !/^https?:\/\/[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(v) ? 'Enter a full address, like https://example.com' : null;
}
