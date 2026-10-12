'use client';

import { SkillPicker } from '@/components/skills/SkillPicker';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PROJECT_STATUS, PROJECT_TYPE, type ProjectStatus, type ProjectType } from '@/constants/discover';
import { DISCOVER_STATUSES, type DiscoverQuery } from '@/lib/discover/query';
import { PROJECT_TYPE_OPTIONS } from '@/lib/projects/project-create-options';
import { projectStageLabel } from '@/lib/projects/status-presentation';

const MAX_SKILLS = 8;

/**
 * Status, type, skills and "hide opened" (spec §15): a bottom sheet on phones, a side drawer above.
 * Each change applies at once (the feed behind updates); Done just closes.
 */
export function DiscoverFiltersPanel({ open, onOpenChange, query, onChange, onClear, activeFilters }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    query: DiscoverQuery;
    onChange: (patch: Partial<DiscoverQuery>) => void;
    onClear: () => void;
    /** Filters set: Clear all does nothing at 0, so it's off. */
    activeFilters: number;
}) {
    const phone = useMediaQuery('(max-width: 767px)');
    const statuses: ProjectStatus[] = [PROJECT_STATUS.ALL, ...DISCOVER_STATUSES];

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                presentation={phone ? 'bottom-sheet' : 'right-drawer'}
                className={phone ? '' : 'gap-0 p-0 sm:max-w-[420px]'}
            >
                <div className="border-b border-border px-5 py-4">
                    <DialogTitle className="nb-card-title">Filters</DialogTitle>
                </div>
                <div className="app-scroll app-scroll-y min-h-0 flex-1 space-y-6 px-5 py-5">
                    <fieldset>
                        <legend className="nb-ui-label mb-2">Stage</legend>
                        {/* Native radios (arrow keys, one Tab stop) drawn as buttons; the selected one is ink-filled (spec). */}
                        <div className="flex flex-wrap gap-1.5">
                            {statuses.map((status) => (
                                <label key={status} className="nb-ui-label relative inline-flex h-[var(--ui-control-height)] cursor-pointer items-center rounded-md border border-input bg-card px-3 text-foreground hover:bg-muted has-[:checked]:border-foreground has-[:checked]:bg-foreground has-[:checked]:text-background has-[:focus-visible]:shadow-[inset_0_0_0_2px_var(--primary)] pointer-coarse:h-11">
                                    <input
                                        type="radio"
                                        name="discover-stage"
                                        value={status}
                                        checked={query.status === status}
                                        onChange={() => onChange({ status })}
                                        className="peer sr-only"
                                    />
                                    {status === PROJECT_STATUS.ALL ? 'Any' : projectStageLabel(status)}
                                </label>
                            ))}
                        </div>
                    </fieldset>

                    <div>
                        <label htmlFor="discover-filter-type" className="nb-ui-label mb-2 block">Type</label>
                        <Select value={query.type} onValueChange={(value) => onChange({ type: value as ProjectType })}>
                            <SelectTrigger id="discover-filter-type" className="bg-card pointer-coarse:h-11">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={PROJECT_TYPE.ALL}>Any type</SelectItem>
                                {PROJECT_TYPE_OPTIONS.map((type) => <SelectItem key={type.id} value={type.id}>{type.label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>

                    <SkillPicker
                        value={query.tech}
                        onChange={(tech) => onChange({ tech: tech.slice(0, MAX_SKILLS) })}
                        maxSkills={MAX_SKILLS}
                        allowCustom={false}
                        compact
                        dense
                        progressive
                        label="Skills"
                        description="Projects that use any of these skills."
                        placeholder="Search React, Figma, Python…"
                    />

                    <label className="flex min-h-11 cursor-pointer items-center gap-3">
                        <Checkbox checked={query.hideOpened} onCheckedChange={(checked) => onChange({ hideOpened: checked === true })} />
                        <span className="nb-compact">Hide projects I&apos;ve opened</span>
                    </label>
                </div>
                <DialogFooter paper className="m-0 flex-row justify-between rounded-none sm:justify-between">
                    <Button type="button" variant="ghost" onClick={onClear} disabled={activeFilters === 0} className="pointer-coarse:h-11">Clear all</Button>
                    <Button type="button" onClick={() => onOpenChange(false)} className="pointer-coarse:h-11">Done</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
