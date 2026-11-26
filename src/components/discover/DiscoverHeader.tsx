'use client';

import { ORG_TYPES, orgTypeLabel } from '@/lib/organizations/config';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { SlidersHorizontal, Users, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SearchField } from '@/components/ui/SearchField';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FILTER_VIEWS, WORKSPACE_STATUS, WORKSPACE_TYPE, SORT_OPTIONS, type FilterView, type SortOption } from '@/constants/discover';
import { DISCOVER_SORTS, type DiscoverQuery } from '@/lib/discover/query';
import { projectStageLabel } from '@/lib/workspaces/status-presentation';
import { WORKSPACE_TYPE_OPTIONS } from '@/lib/workspaces/workspace-create-options';
import { resolveClientSkill } from '@/lib/skills/client';

const SCOPES: Array<{ id: FilterView; label: string; subtitle: string }> = [
    { id: FILTER_VIEWS.ALL, label: 'All workspaces', subtitle: 'Every open workspace and its latest updates, newest first.' },
    { id: FILTER_VIEWS.TRENDING, label: 'Trending', subtitle: 'Workspaces getting the most attention right now.' },
    { id: FILTER_VIEWS.RECOMMENDATIONS, label: 'For you', subtitle: 'Workspaces that match your skills and interests.' },
    { id: FILTER_VIEWS.FOLLOWING, label: 'Following', subtitle: 'Workspaces you follow, and what they post.' },
];

const SHOW_OPTIONS: Array<{ id: DiscoverQuery['show']; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'updates', label: 'Posts' },
    { id: 'projects', label: 'Workspaces' },
    { id: 'organizations', label: 'Organizations' },
];

const SORT_LABELS: Record<string, string> = { newest: 'Newest', oldest: 'Oldest', most_viewed: 'Most viewed', most_followed: 'Most followed' };

const typeLabel = (id: string) => WORKSPACE_TYPE_OPTIONS.find((type) => type.id === id)?.label ?? id;

/** Discover's search box: the URL follows the text after a short pause; the text follows the URL (Back, global search). */
function SearchBox({ value, loading = false, onSearch }: { value: string; loading?: boolean; onSearch: (q: string) => void }) {
    const [text, setText] = useState(value);
    const [shown, setShown] = useState(value);
    // The URL changed elsewhere (Back, the top bar's search): show it, unless it's what's typed already
    // (so a pause never trims a space you're about to type past).
    if (value !== shown) {
        setShown(value);
        if (value !== text.trim()) setText(value);
    }
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
    // The same pause as Network's search.
    const change = (next: string, delay = 300) => {
        setText(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => onSearch(next.trim()), delay);
    };
    return (
        <SearchField
            value={text}
            loading={loading || text.trim() !== value.trim()}
            onChange={(next) => change(next, next ? 300 : 0)}
            onEnter={(input) => {
                change(text, 0);
                // On a phone, put the keyboard away so the results show.
                if (window.matchMedia('(pointer: coarse)').matches) input.blur();
            }}
            label="Search workspaces and updates"
            pageSearch
            className="flex-1 sm:w-64 sm:flex-none"
        />
    );
}

/** A selected filter as a tag with ×: readable without colour (its label says what it is). */
function FilterTag({ children, onRemove, label }: { children: ReactNode; onRemove: () => void; label: string }) {
    return (
        <span className="nb-tag gap-1 pr-0.5">
            {children}
            <button type="button" data-filter-remove="" onClick={onRemove} aria-label={`Remove ${label}`} className="nb-touch-target -my-1 inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="size-3.5" aria-hidden="true" />
            </button>
        </span>
    );
}

export interface DiscoverHeaderProps {
    query: DiscoverQuery;
    activeFilters: number;
    /** Read out when results settle: "12 projects", "No projects match". */
    announcement: string;
    loading?: boolean;
    onChange: (patch: Partial<DiscoverQuery>) => void;
    onClearFilters: () => void;
    onOpenFilters: () => void;
    filtersButtonRef: RefObject<HTMLButtonElement | null>;
    /** Below 1200px, when there are people to suggest, they open from a button (spec §09 R5). */
    people?: ReactNode;
}

/** Title, scope and search, sort and filters (spec §15), and the selected filters as tags. */
export default function DiscoverHeader({ query, activeFilters, announcement, loading = false, onChange, onClearFilters, onOpenFilters, filtersButtonRef, people }: DiscoverHeaderProps) {
    const [peopleOpen, setPeopleOpen] = useState(false);
    const railShown = useMediaQuery('(min-width: 1200px)');
    const phone = useMediaQuery('(max-width: 767px)');
    // Once the rail sits beside the feed the drawer is closed for good (it doesn't reopen on narrowing).
    if (railShown && peopleOpen) setPeopleOpen(false);
    const scope = SCOPES.find((item) => item.id === query.view) ?? SCOPES[0]!;
    // Trending and For you rank by their own score: a sort wouldn't apply.
    const sortable = query.view === FILTER_VIEWS.ALL || query.view === FILTER_VIEWS.FOLLOWING;
    // A search ranks by relevance unless another order is picked.
    const sortLabel = (value: string) => (value === SORT_OPTIONS.NEWEST && query.q ? 'Best match' : SORT_LABELS[value]);


    const searchLine = query.q ? `Results for “${query.q}”` : '';

    return (
        <div className="flex min-w-0 flex-col gap-4">
            <div className="min-w-0">
                <h1 className="nb-page-title">Discover</h1>
                <p className="nb-body mt-1 text-muted-foreground">{scope.subtitle}</p>
                {searchLine ? <p className="nb-meta mt-1 truncate" title={searchLine}>{searchLine}</p> : null}
                {/* Said once results settle, not on every keystroke. */}
                <p aria-live="polite" className="sr-only">{announcement}</p>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Select value={query.view} onValueChange={(value) => onChange({ view: value as FilterView })}>
                    <SelectTrigger aria-label="View" className="w-auto min-w-[136px] bg-card pointer-coarse:h-11">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {SCOPES.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select value={query.show} onValueChange={(value) => onChange({ show: value as DiscoverQuery['show'], ...(value === 'organizations' ? {} : { orgType: '', verified: false }) })}>
                    <SelectTrigger aria-label="Show" className="w-auto min-w-[128px] bg-card pointer-coarse:h-11">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {SHOW_OPTIONS.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}
                    </SelectContent>
                </Select>
                {/* Report §31.6: with Organizations, a type filter and Verified only. */}
                {query.show === 'organizations' ? (
                    <>
                        <Select value={query.orgType || 'all'} onValueChange={(value) => onChange({ orgType: value === 'all' ? '' : value })}>
                            <SelectTrigger aria-label="Organization type" className="w-auto min-w-[140px] bg-card pointer-coarse:h-11">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All types</SelectItem>
                                {ORG_TYPES.map((type) => <SelectItem key={type} value={type}>{orgTypeLabel(type, null)}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <label className="flex items-center gap-1.5 text-sm text-foreground">
                            <input type="checkbox" checked={query.verified} onChange={(e) => onChange({ verified: e.target.checked })} /> Verified only
                        </label>
                    </>
                ) : null}
                <SearchBox value={query.q} loading={loading} onSearch={(q) => onChange({ q })} />
                <div className="flex items-center gap-2 max-sm:w-full">
                    {sortable ? (
                        <Select value={query.sort} onValueChange={(value) => onChange({ sort: value as SortOption })}>
                            <SelectTrigger aria-label="Sort workspaces" className="w-auto min-w-[132px] bg-card max-sm:flex-1 pointer-coarse:h-11">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {DISCOVER_SORTS.map((value) => <SelectItem key={value} value={value}>{sortLabel(value)}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    ) : null}
                    <Button ref={filtersButtonRef} type="button" variant="outline" onClick={onOpenFilters} aria-haspopup="dialog" className="bg-card max-sm:flex-1 pointer-coarse:h-11">
                        <SlidersHorizontal className="size-4" aria-hidden="true" />
                        Filters
                        {activeFilters ? <span className="nb-tab-count">{activeFilters}<span className="sr-only"> active</span></span> : null}
                    </Button>
                    {people ? (
                        <Button type="button" variant="outline" onClick={() => setPeopleOpen(true)} aria-haspopup="dialog" className="bg-card max-sm:flex-1 pointer-coarse:h-11">
                            <Users className="size-4" aria-hidden="true" />
                            People
                        </Button>
                    ) : null}
                </div>
            </div>

            {activeFilters ? <DiscoverFilterTags query={query} onChange={onChange} onClearFilters={onClearFilters} filtersButtonRef={filtersButtonRef} /> : null}

            {people ? (
                <Dialog open={peopleOpen} onOpenChange={setPeopleOpen}>
                    <DialogContent presentation={phone ? 'bottom-sheet' : 'right-drawer'} className={phone ? 'overflow-y-auto p-4' : 'overflow-y-auto p-4 sm:max-w-[400px]'}>
                        <DialogTitle className="nb-card-title">Suggested people</DialogTitle>
                        {people}
                    </DialogContent>
                </Dialog>
            ) : null}
        </div>
    );
}

/** The selected filters as tags with ×, and Clear all (spec §15); Discover's header and the search results page share it. */
export function DiscoverFilterTags({ query, onChange, onClearFilters, filtersButtonRef }: Pick<DiscoverHeaderProps, 'query' | 'onChange' | 'onClearFilters' | 'filtersButtonRef'>) {
    const tags = useRef<HTMLDivElement>(null);
    // Removing a tag moves focus to the next tag, or to Filters when it was the last.
    const remove = (patch: Partial<DiscoverQuery>) => {
        const buttons = Array.from(tags.current?.querySelectorAll<HTMLButtonElement>('[data-filter-remove]') ?? []);
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        onChange(patch);
        requestAnimationFrame(() => {
            const next = Array.from(tags.current?.querySelectorAll<HTMLButtonElement>('[data-filter-remove]') ?? []);
            (next[Math.min(Math.max(at, 0), next.length - 1)] ?? filtersButtonRef.current)?.focus();
        });
    };
    return (
        <div ref={tags} className="flex flex-wrap items-center gap-1.5" aria-label="Selected filters" role="group">
            {query.status !== WORKSPACE_STATUS.ALL ? (
                <FilterTag label={`stage ${projectStageLabel(query.status)}`} onRemove={() => remove({ status: WORKSPACE_STATUS.ALL })}>
                    Stage: {projectStageLabel(query.status)}
                </FilterTag>
            ) : null}
            {query.type !== WORKSPACE_TYPE.ALL ? (
                <FilterTag label={`type ${typeLabel(query.type)}`} onRemove={() => remove({ type: WORKSPACE_TYPE.ALL })}>
                    Type: {typeLabel(query.type)}
                </FilterTag>
            ) : null}
            {query.tech.map((skill) => (
                <FilterTag key={skill} label={`skill ${resolveClientSkill(skill).name}`} onRemove={() => remove({ tech: query.tech.filter((value) => value !== skill) })}>
                    {resolveClientSkill(skill).name}
                </FilterTag>
            ))}
            {query.org ? (
                <FilterTag label={`organization ${query.org}`} onRemove={() => remove({ org: '' })}>In {query.org}</FilterTag>
            ) : null}
            {query.hideOpened ? (
                <FilterTag label="hiding workspaces you’ve viewed" onRemove={() => remove({ hideOpened: false })}>Hiding workspaces you’ve viewed</FilterTag>
            ) : null}
            <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                    onClearFilters();
                    requestAnimationFrame(() => filtersButtonRef.current?.focus());
                }}
                className="text-primary pointer-coarse:h-11"
            >
                Clear all
            </Button>
        </div>
    );
}
