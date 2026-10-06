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
export function DiscoverFiltersPanel({ open, onOpenChange, query, onChange, onClear }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    query: DiscoverQuery;
    onChange: (patch: Partial<DiscoverQuery>) => void;
    onClear: () => void;
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
                        {/* Single choice: a radio group of buttons; the selected one is ink-filled (spec). */}
                        <div role="radiogroup" aria-label="Stage" className="flex flex-wrap gap-1.5">
                            {statuses.map((status) => {
                                const selected = query.status === status;
                                return (
                                    <button
                                        key={status}
                                        type="button"
                                        role="radio"
                                        aria-checked={selected}
                                        onClick={() => onChange({ status })}
                                        className={`nb-ui-label inline-flex h-[var(--ui-control-height)] items-center rounded-md border px-3 pointer-coarse:h-11 ${selected ? 'border-foreground bg-foreground text-background' : 'border-input bg-card text-foreground hover:bg-muted'}`}
                                    >
                                        {status === PROJECT_STATUS.ALL ? 'Any' : projectStageLabel(status)}
                                    </button>
                                );
                            })}
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
                    <Button type="button" variant="ghost" onClick={onClear} className="pointer-coarse:h-11">Clear all</Button>
                    <Button type="button" onClick={() => onOpenChange(false)} className="pointer-coarse:h-11">Done</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
