'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

import { WORKSPACE_STATUS, WORKSPACE_TYPE } from '@/constants/discover';
import { activeFilterCount, isDefaultDiscoverQuery, parseDiscoverQuery, type DiscoverQuery } from '@/lib/discover/query';

// What an empty URL means: a value equal to it is left out of the URL.
const DEFAULTS = parseDiscoverQuery(() => null);

/**
 * Discover's filters live in the URL (shareable, and back returns to them). Changes use history.replaceState:
 * Next keeps useSearchParams in sync without re-running the server page, so a control never snaps back
 * while the server answers. The feed query refetches on the new key by itself.
 */
export function useDiscoverUrlFilters() {
    const searchParams = useSearchParams();
    const pathname = usePathname();

    const urlFilters = useMemo(() => parseDiscoverQuery((key) => searchParams.get(key)), [searchParams]);

    const updateUrlFilters = useCallback((patch: Partial<DiscoverQuery>) => {
        // From the live URL, not this render's searchParams: a debounced search firing after a filter change
        // must not write the old filters back.
        const params = new URLSearchParams(window.location.search);
        for (const [key, value] of Object.entries(patch) as Array<[keyof DiscoverQuery, DiscoverQuery[keyof DiscoverQuery]]>) {
            const isDefault = Array.isArray(value)
                ? value.length === 0
                : value === DEFAULTS[key] || value === '' || value === undefined;
            if (isDefault) params.delete(key);
            else params.set(key, Array.isArray(value) ? value.join(',') : String(value));
        }
        const query = params.toString();
        const url = `${pathname}${query ? `?${query}` : ''}`;
        // Nothing changed (Enter on the same search, the selected option again): no history entry.
        if (url === `${window.location.pathname}${window.location.search}`) return;
        // Filters replace: back leaves Discover in one step and comes back to these filters (unified back A2).
        window.history.replaceState(window.history.state, '', url);
    }, [pathname]);

    /** Clears the filter tags, and the search too unless `keepSearch`. Scope and sort stay. */
    const clearFilters = useCallback((options: { keepSearch?: boolean } = {}) => {
        updateUrlFilters({
            ...(options.keepSearch ? {} : { q: '' }),
            status: WORKSPACE_STATUS.ALL,
            type: WORKSPACE_TYPE.ALL,
            tech: [],
            hideOpened: false,
            org: '',
            orgType: '',
            verified: false,
        });
    }, [updateUrlFilters]);

    return {
        urlFilters,
        updateUrlFilters,
        clearFilters,
        activeFilters: activeFilterCount(urlFilters),
        isDefault: isDefaultDiscoverQuery(urlFilters),
    };
}
