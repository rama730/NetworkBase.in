'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Search, SlidersHorizontal, Users, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FILTER_VIEWS, PROJECT_STATUS, PROJECT_TYPE, type FilterView, type SortOption } from '@/constants/discover';
import { DISCOVER_SORTS, type DiscoverQuery } from '@/lib/discover/query';
import { projectStageLabel } from '@/lib/projects/status-presentation';
import { PROJECT_TYPE_OPTIONS } from '@/lib/projects/project-create-options';
import { resolveClientSkill } from '@/lib/skills/client';

const SCOPES: Array<{ id: FilterView; label: string; subtitle: string }> = [
    { id: FILTER_VIEWS.ALL, label: 'All projects', subtitle: 'Projects looking for people with your skills.' },
    { id: FILTER_VIEWS.TRENDING, label: 'Trending', subtitle: 'Projects getting the most attention right now.' },
    { id: FILTER_VIEWS.RECOMMENDATIONS, label: 'For you', subtitle: 'Projects that match your skills and interests.' },
    { id: FILTER_VIEWS.FOLLOWING, label: 'Following', subtitle: 'Projects you follow.' },
];

const SORT_LABELS: Record<string, string> = { newest: 'Newest', oldest: 'Oldest', most_viewed: 'Most viewed', most_followed: 'Most followed' };

export const typeLabel = (id: string) => PROJECT_TYPE_OPTIONS.find((type) => type.id === id)?.label ?? id;

/** Discover's search box: the URL follows the text after a short pause; the text follows the URL (Back, global search). */
function SearchBox({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
    const [text, setText] = useState(value);
    const [synced, setSynced] = useState(value);
    // The URL changed elsewhere (Back, the top bar's search): show it.
    if (value !== synced) {
        setSynced(value);
        setText(value);
    }
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
    const change = (next: string, delay = 250) => {
        setText(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            setSynced(next.trim());
            onSearch(next.trim());
        }, delay);
    };
    return (
        <div role="search" className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
                type="search"
                value={text}
                onChange={(event) => change(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') change(text, 0); }}
                placeholder="Search projects"
                aria-label="Search projects"
                className="h-[var(--ui-control-height)] w-full rounded-md border border-input bg-card pl-9 pr-9 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 md:text-sm pointer-coarse:h-11 [&::-webkit-search-cancel-button]:hidden"
            />
            {text ? (
                <button type="button" onClick={() => change('', 0)} className="nb-icon-button absolute right-1 top-1/2 -translate-y-1/2" aria-label="Clear search">
                    <X className="size-4" aria-hidden="true" />
                </button>
            ) : null}
        </div>
    );
}

/** A selected filter as a tag with ×: readable without colour (its label says what it is). */
function FilterTag({ children, onRemove, label }: { children: ReactNode; onRemove: () => void; label: string }) {
    return (
        <span className="nb-tag gap-1 pr-0.5">
            {children}
            <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="nb-touch-target -my-1 inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="size-3.5" aria-hidden="true" />
            </button>
        </span>
    );
}

interface DiscoverHeaderProps {
    query: DiscoverQuery;
    activeFilters: number;
    onChange: (patch: Partial<DiscoverQuery>, options?: { replace?: boolean }) => void;
    onClearFilters: () => void;
    onOpenFilters: () => void;
    filtersButtonRef: React.Ref<HTMLButtonElement>;
    /** Below 1200px the People rail opens from a button (spec §09 R5); at 1200px+ it sits beside the feed. */
    people?: ReactNode;
}

/** Title, scope and search, sort and filters (spec §15), and the selected filters as tags. */
export default function DiscoverHeader({ query, activeFilters, onChange, onClearFilters, onOpenFilters, filtersButtonRef, people }: DiscoverHeaderProps) {
    const [peopleOpen, setPeopleOpen] = useState(false);
    // The drawer is for narrow screens: once the rail sits beside the feed, it's closed.
    const railShown = useMediaQuery('(min-width: 1200px)');
    const scope = SCOPES.find((item) => item.id === query.view) ?? SCOPES[0]!;
    // Trending and For you rank by their own score: a sort wouldn't apply.
    const sortable = query.view === FILTER_VIEWS.ALL || query.view === FILTER_VIEWS.FOLLOWING;

    const resultLine = [
        query.q ? `Results for “${query.q}”` : null,
        activeFilters ? `${activeFilters} ${activeFilters === 1 ? 'filter' : 'filters'}` : null,
    ].filter(Boolean).join(' · ');

    return (
        <div className="flex min-w-0 flex-col gap-4">
            <div className="min-w-0">
                <h1 className="nb-page-title">Discover</h1>
                <p className="nb-body mt-1 text-muted-foreground">
                    {scope.subtitle}
                    {/* Read out when a search or filter changes the feed. */}
                    <span aria-live="polite" className="nb-meta ml-2 whitespace-nowrap">{resultLine}</span>
                </p>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Select value={query.view} onValueChange={(value) => onChange({ view: value as FilterView })}>
                    <SelectTrigger aria-label="Discovery view" className="w-auto min-w-[136px] bg-card pointer-coarse:h-11">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {SCOPES.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}
                    </SelectContent>
                </Select>
                <SearchBox value={query.q} onSearch={(q) => onChange({ q }, { replace: Boolean(query.q) })} />
                <div className="flex items-center gap-2 max-sm:w-full">
                    {sortable ? (
                        <Select value={query.sort} onValueChange={(value) => onChange({ sort: value as SortOption })}>
                            <SelectTrigger aria-label="Sort projects" className="w-auto min-w-[132px] bg-card max-sm:flex-1 pointer-coarse:h-11">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {DISCOVER_SORTS.map((value) => <SelectItem key={value} value={value}>{SORT_LABELS[value]}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    ) : null}
                    <Button ref={filtersButtonRef} type="button" variant="outline" onClick={onOpenFilters} aria-haspopup="dialog" className="bg-card max-sm:flex-1 pointer-coarse:h-11">
                        <SlidersHorizontal className="size-4" aria-hidden="true" />
                        Filters
                        {activeFilters ? <span className="nb-tab-count">{activeFilters}<span className="sr-only"> active</span></span> : null}
                    </Button>
                    {people ? (
                        <Button type="button" variant="outline" onClick={() => setPeopleOpen(true)} className="bg-card min-[1200px]:hidden max-sm:flex-1 pointer-coarse:h-11">
                            <Users className="size-4" aria-hidden="true" />
                            People
                        </Button>
                    ) : null}
                </div>
            </div>

            {activeFilters ? (
                <div className="flex flex-wrap items-center gap-1.5" aria-label="Selected filters" role="group">
                    {query.status !== PROJECT_STATUS.ALL ? (
                        <FilterTag label={`status ${projectStageLabel(query.status)}`} onRemove={() => onChange({ status: PROJECT_STATUS.ALL })}>
                            Status: {projectStageLabel(query.status)}
                        </FilterTag>
                    ) : null}
                    {query.type !== PROJECT_TYPE.ALL ? (
                        <FilterTag label={`type ${typeLabel(query.type)}`} onRemove={() => onChange({ type: PROJECT_TYPE.ALL })}>
                            Type: {typeLabel(query.type)}
                        </FilterTag>
                    ) : null}
                    {query.tech.map((skill) => (
                        <FilterTag key={skill} label={`skill ${resolveClientSkill(skill).name}`} onRemove={() => onChange({ tech: query.tech.filter((value) => value !== skill) })}>
                            {resolveClientSkill(skill).name}
                        </FilterTag>
                    ))}
                    {query.hideOpened ? (
                        <FilterTag label="hide opened projects" onRemove={() => onChange({ hideOpened: false })}>Hiding opened</FilterTag>
                    ) : null}
                    <Button type="button" variant="ghost" size="sm" onClick={onClearFilters} className="text-primary pointer-coarse:h-11">Clear all</Button>
                </div>
            ) : null}

            {people ? (
                <Dialog open={peopleOpen && !railShown} onOpenChange={setPeopleOpen}>
                    <DialogContent presentation="right-drawer" className="overflow-y-auto p-4 sm:max-w-[400px]">
                        <DialogTitle className="nb-card-title">People you should meet</DialogTitle>
                        {people}
                    </DialogContent>
                </Dialog>
            ) : null}
        </div>
    );
}
