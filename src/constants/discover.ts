// Hub Constants
import { PROJECT_TYPE_OPTIONS } from '@/lib/workspaces/workspace-create-options';

export const FILTER_VIEWS = {
    ALL: 'all',
    TRENDING: 'trending',
    RECOMMENDATIONS: 'recommendations',
    FOLLOWING: 'following',
} as const;

export const PROJECT_STATUS = {
    ALL: 'all',
    IDEA: 'draft',       // Maps to schema 'draft'
    IN_PROGRESS: 'active', // Maps to schema 'active'
    LAUNCHED: 'completed', // Maps to schema 'completed'
} as const;

// The types themselves are the ones a project is created with (PROJECT_TYPE_OPTIONS).
export const PROJECT_TYPE = {
    ALL: 'all',
} as const;

export const SORT_OPTIONS = {
    NEWEST: 'newest',
    OLDEST: 'oldest',
    MOST_VIEWED: 'most_viewed',
    MOST_FOLLOWED: 'most_followed',
    TRENDING: 'trending',
} as const;

// Type exports
export type FilterView = 'all' | 'trending' | 'recommendations' | 'following';
export type ProjectStatus = typeof PROJECT_STATUS[keyof typeof PROJECT_STATUS];
export type ProjectType = typeof PROJECT_TYPE.ALL | (typeof PROJECT_TYPE_OPTIONS)[number]['id'];
export type SortOption = typeof SORT_OPTIONS[keyof typeof SORT_OPTIONS];

/** Tag on the anonymous Discover page cache; revalidated whenever a project's public data changes. */
export const DISCOVER_ANON_CACHE_TAG = 'discover-anon';
