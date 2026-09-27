'use client';

import { memo } from 'react';
import { ChevronDown } from 'lucide-react';
import { FILTER_VIEWS, FilterView } from '@/constants/discover';

const DISCOVERY_SCOPES: Array<{ id: FilterView; label: string }> = [
    { id: FILTER_VIEWS.ALL, label: 'All projects' },
    { id: FILTER_VIEWS.TRENDING, label: 'Trending' },
    { id: FILTER_VIEWS.RECOMMENDATIONS, label: 'For you' },
    { id: FILTER_VIEWS.FOLLOWING, label: 'Following' },
];

interface HubHeaderProps {
    filterView: FilterView;
    onSelectView: (view: FilterView) => void;
}

const DiscoverHeader = memo(function DiscoverHeader({
    filterView,
    onSelectView,
}: HubHeaderProps) {
    return (
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
                <h1 className="nb-page-title">Discover</h1>
                <p className="nb-body mt-1 text-muted-foreground">
                    Projects looking for people with your skill.
                </p>
            </div>

            <div className="flex w-full shrink-0 gap-2 sm:w-auto">
            <label className="relative block min-w-0 flex-1 sm:w-[168px]">
                <span className="sr-only">Discovery view</span>
                <select
                    value={filterView}
                    onChange={(event) => onSelectView(event.target.value as FilterView)}
                    className="nb-ui-label h-[var(--ui-control-height-lg)] w-full appearance-none rounded-md border border-input bg-card px-3 pr-9 text-foreground outline-none transition-colors duration-[130ms] hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                    aria-label="Discovery view"
                >
                    {DISCOVERY_SCOPES.map((scope) => (
                        <option key={scope.id} value={scope.id}>
                            {scope.label}
                        </option>
                    ))}
                </select>
                <ChevronDown
                    className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                />
            </label>
            </div>
        </div>
    );
});

export default DiscoverHeader;
