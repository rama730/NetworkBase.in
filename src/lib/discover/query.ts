import {
    FILTER_VIEWS,
    PROJECT_STATUS,
    PROJECT_TYPE,
    SORT_OPTIONS,
    type FilterView,
    type ProjectStatus,
    type ProjectType,
    type SortOption,
} from '@/constants/discover';
import { PROJECT_TYPE_OPTIONS } from '@/lib/workspaces/workspace-create-options';
import type { DiscoverFilters as PeopleFilters } from '@/app/actions/connections';

/** Discover's people rail: people you can see and connect with. The server render and the rail use the same filters. */
export const DISCOVER_RAIL_FILTERS: PeopleFilters = { openProfilesOnly: true };
export const DISCOVER_RAIL_CARD_COUNT = 3;
export const DISCOVER_RAIL_PEOPLE_LIMIT = DISCOVER_RAIL_CARD_COUNT + 4;

/** What a Discover URL asks for. One parser for the server page, the URL hook and the feed hook. */
export type DiscoverQuery = {
    q: string;
    view: FilterView;
    status: ProjectStatus;
    type: ProjectType;
    sort: SortOption;
    tech: string[];
    hideOpened: boolean;
    /** Show: Everything · Projects · Organizations · Updates; org: one org's @handle (report §24.3). */
    show: 'all' | 'projects' | 'organizations' | 'updates';
    org: string;
};

const SHOWS = ['all', 'projects', 'organizations', 'updates'] as const;

const VIEWS: readonly string[] = [FILTER_VIEWS.ALL, FILTER_VIEWS.TRENDING, FILTER_VIEWS.RECOMMENDATIONS, FILTER_VIEWS.FOLLOWING];
// Discover never lists drafts, so "Idea" isn't a filter here.
export const DISCOVER_STATUSES: readonly ProjectStatus[] = [PROJECT_STATUS.IN_PROGRESS, PROJECT_STATUS.LAUNCHED];
export const DISCOVER_SORTS: readonly SortOption[] = [SORT_OPTIONS.NEWEST, SORT_OPTIONS.OLDEST, SORT_OPTIONS.MOST_VIEWED, SORT_OPTIONS.MOST_FOLLOWED];
const TYPES: readonly string[] = PROJECT_TYPE_OPTIONS.map((type) => type.id);

const pick = <T extends string>(value: string | null, allowed: readonly string[], fallback: T): T =>
    value && allowed.includes(value) ? (value as T) : fallback;

/** Unknown values fall back to the default instead of reaching the server. */
export function parseDiscoverQuery(get: (key: string) => string | null | undefined): DiscoverQuery {
    const read = (key: string) => get(key) ?? null;
    return {
        q: (read('q') ?? '').trim().slice(0, 200),
        view: pick(read('view'), VIEWS, FILTER_VIEWS.ALL),
        status: pick(read('status'), DISCOVER_STATUSES, PROJECT_STATUS.ALL),
        type: pick(read('type'), TYPES, PROJECT_TYPE.ALL),
        sort: pick(read('sort'), DISCOVER_SORTS, SORT_OPTIONS.NEWEST),
        tech: Array.from(new Set((read('tech') ?? '').split(',').map((value) => value.trim()).filter(Boolean))).slice(0, 8),
        hideOpened: read('hideOpened') === 'true',
        show: pick(read('show'), SHOWS, 'all'),
        org: /^[a-z0-9-]{1,40}$/.test(read('org') ?? '') ? read('org')! : '',
    };
}

/** The unfiltered newest feed: the one the server renders and the shared cache serves. "Hide opened" is client-only. */
export function isDefaultDiscoverQuery(query: DiscoverQuery): boolean {
    return query.view === FILTER_VIEWS.ALL
        && query.status === PROJECT_STATUS.ALL
        && query.type === PROJECT_TYPE.ALL
        && query.sort === SORT_OPTIONS.NEWEST
        && query.tech.length === 0
        && !query.q
        && query.show === 'all'
        && !query.org;
}

/** The filters shown as tags (status, type, skills, hide opened): the Filters button's count. */
export function activeFilterCount(query: DiscoverQuery): number {
    return (query.status !== PROJECT_STATUS.ALL ? 1 : 0)
        + (query.type !== PROJECT_TYPE.ALL ? 1 : 0)
        + query.tech.length
        + (query.hideOpened ? 1 : 0)
        + (query.org ? 1 : 0);
}
