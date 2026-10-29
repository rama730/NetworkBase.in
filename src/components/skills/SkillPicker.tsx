'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { defaultClientSkills, resolveClientSkill, useSkillCatalog, type SkillCatalog } from '@/lib/skills/client'
import { normalizeSkillLookup } from '@/lib/skills/normalization'
import type { SkillSummary } from '@/lib/skills/types'
import { SkillChip } from './SkillChip'
import { SkillIcon } from './SkillIcon'

type SkillsEnvelope = { success: true; data: { skills: SkillSummary[] } }

function buildCategorySkills(catalog: SkillCatalog | null): Record<string, SkillSummary[]> {
    const map: Record<string, SkillSummary[]> = {}
    const seen = new Set<string>()
    for (const tuple of Object.values(catalog?.lookup ?? {})) {
        const canonicalKey = tuple[0]
        if (seen.has(canonicalKey)) continue
        seen.add(canonicalKey)
        const cat = tuple[5]
        if (!map[cat]) map[cat] = []
        map[cat].push(resolveClientSkill(tuple[1]))
    }
    return map
}

export function SkillPicker({
    value,
    onChange,
    maxSkills = 25,
    allowCustom = true,
    label = 'Skills',
    description = 'Search skills or add your own.',
    compact = false,
    dense = false,
    progressive = false,
    controlSize = 'default',
    placeholder = 'Search React, Figma, leadership…',
    className,
}: {
    value: string[]
    onChange: (skills: string[]) => void
    maxSkills?: number
    allowCustom?: boolean
    label?: string
    description?: string
    compact?: boolean
    /** Inside a drawer or sheet: no popular shelf, and a short result list (about five rows) instead of a tall one. */
    dense?: boolean
    progressive?: boolean
    controlSize?: 'default' | 'large'
    placeholder?: string
    className?: string
}) {
    const skillCatalog = useSkillCatalog()
    const defaultSkills = useMemo(() => (skillCatalog ? defaultClientSkills() : []), [skillCatalog])
    const categorySkills = useMemo(() => buildCategorySkills(skillCatalog), [skillCatalog])
    const inputId = useId()
    const listboxId = useId()
    const [query, setQuery] = useState('')
    const [category, setCategory] = useState<string | null>(null)
    const [results, setResults] = useState<SkillSummary[]>(defaultSkills)
    const [loading, setLoading] = useState(false)
    const [activeIndex, setActiveIndex] = useState(0)
    const [catalogOpen, setCatalogOpen] = useState(!progressive)
    const requestRef = useRef<AbortController | null>(null)
    const selectedKeys = useMemo(() => new Set(value.map((skill) => resolveClientSkill(skill).canonicalKey)), [value, skillCatalog])

    const handleCategoryClick = useCallback((key: string) => {
        if (category === key) {
            // Clicking the active tab a second time deselects it completely
            setCategory(null)
            setActiveIndex(0)
        } else {
            setCategory(key)
            setActiveIndex(0)
        }
    }, [category])

    // Update results immediately when category changes without waiting for network
    useEffect(() => {
        if (!query.trim()) {
            if (!category || category === 'all') {
                setResults(defaultSkills)
            } else {
                setResults(categorySkills[category] || [])
            }
            setActiveIndex(0)
            return
        }

        const controller = new AbortController()
        requestRef.current?.abort()
        requestRef.current = controller
        const timer = window.setTimeout(async () => {
            setLoading(true)
            try {
                const params = new URLSearchParams({ limit: '40', catalog: skillCatalog?.version ?? '' })
                params.set('q', query.trim())
                if (category && category !== 'all') params.set('category', category)
                const response = await fetch(`/api/v1/skills?${params}`, { signal: controller.signal })
                if (!response.ok) throw new Error('Skill search failed')
                const payload = (await response.json()) as SkillsEnvelope
                if (!controller.signal.aborted) {
                    // Filter in code so only skills matching the selected category are displayed
                    const fetched = payload.data.skills
                    const filtered = !category || category === 'all' ? fetched : fetched.filter((s) => s.categoryKey === category)
                    setResults(filtered)
                    setActiveIndex(0)
                }
            } catch (error) {
                if (!controller.signal.aborted) {
                    // Fallback to local client search
                    const normalized = normalizeSkillLookup(query)
                    const pool = !category || category === 'all'
                        ? defaultSkills
                        : (categorySkills[category] || [])
                    const localMatches = pool.filter((s) => normalizeSkillLookup(s.name).includes(normalized))
                    setResults(localMatches)
                    console.warn('[skills] catalog search unavailable, using client fallback', error)
                }
            } finally {
                if (!controller.signal.aborted) setLoading(false)
            }
        }, 180)

        return () => {
            window.clearTimeout(timer)
            controller.abort()
        }
    }, [category, categorySkills, defaultSkills, query, skillCatalog?.version])

    // Strictly filter selectable results by category in programming to ensure no foreign skills leak in
    const selectableResults = useMemo(() => {
        const unselected = results.filter((skill) => !selectedKeys.has(skill.canonicalKey))
        if (!category || category === 'all') return unselected
        return unselected.filter((skill) => skill.categoryKey === category)
    }, [category, results, selectedKeys])

    // For the "All" category when search is empty: show only a few curated items
    const displayedResults = useMemo(() => {
        if ((category === null || category === 'all') && !query.trim()) {
            return selectableResults.slice(0, 8)
        }
        return selectableResults
    }, [category, query, selectableResults])

    // Top curated skills for the horizontal scroll shelf in "All" category
    const popularShelfSkills = useMemo(() => {
        return defaultSkills.filter((skill) => !selectedKeys.has(skill.canonicalKey)).slice(0, 14)
    }, [defaultSkills, selectedKeys])

    const exactMatch = results.some((skill) => normalizeSkillLookup(skill.name) === normalizeSkillLookup(query))
    const canAddCustom = allowCustom && query.trim().length >= 2 && !exactMatch && !selectedKeys.has(resolveClientSkill(query).canonicalKey)
    const isVisible = category !== null || Boolean(query.trim())
    const showCatalogControls = !progressive || catalogOpen || isVisible
    const optionCount = displayedResults.length + (canAddCustom ? 1 : 0)

    const selectSkill = useCallback((name: string) => {
        if (value.length >= maxSkills) return
        const canonical = resolveClientSkill(name)
        if (selectedKeys.has(canonical.canonicalKey)) return
        onChange([...value, canonical.name])
        setQuery('')
    }, [maxSkills, onChange, selectedKeys, value])

    const removeSkill = (name: string) => {
        const key = resolveClientSkill(name).canonicalKey
        onChange(value.filter((skill) => resolveClientSkill(skill).canonicalKey !== key))
    }

    return (
        <div className={cn('min-w-0 space-y-3', className)}>
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <label htmlFor={inputId} className="nb-ui-label block text-foreground">
                        {label}
                    </label>
                    {description ? (
                        <p id={`${inputId}-description`} className="nb-compact mt-1 text-muted-foreground">
                            {description}
                        </p>
                    ) : null}
                </div>
                <span className="shrink-0 nb-meta tabular-nums text-muted-foreground" aria-live="polite">
                    {value.length}/{maxSkills}
                </span>
            </div>

            {value.length > 0 ? (
                <div className="flex min-w-0 flex-wrap gap-2" aria-label="Selected skills">
                    {value.map((skill) => (
                        <SkillChip
                            key={resolveClientSkill(skill).canonicalKey}
                            skill={skill}
                            size={compact ? 'sm' : 'md'}
                            onRemove={() => removeSkill(skill)}
                        />
                    ))}
                </div>
            ) : null}

            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                    id={inputId}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'ArrowDown') {
                            event.preventDefault()
                            if (!isVisible) {
                                setCategory('all')
                            } else {
                                setActiveIndex((index) => Math.min(Math.max(0, optionCount - 1), index + 1))
                            }
                        }
                        if (event.key === 'ArrowUp') {
                            event.preventDefault()
                            if (isVisible) {
                                setActiveIndex((index) => Math.max(0, index - 1))
                            }
                        }
                        if (event.key === 'Escape') {
                            setQuery('')
                            setCategory(null)
                            setActiveIndex(0)
                            if (progressive) setCatalogOpen(false)
                        }
                        if (event.key === 'Enter') {
                            event.preventDefault()
                            if (isVisible) {
                                const result = displayedResults[activeIndex]
                                if (result) selectSkill(result.name)
                                else if (canAddCustom) selectSkill(query.trim())
                            }
                        }
                    }}
                    role="combobox"
                    aria-expanded={isVisible}
                    aria-haspopup="listbox"
                    aria-controls={listboxId}
                    aria-describedby={description ? `${inputId}-description` : undefined}
                    aria-activedescendant={isVisible && optionCount > 0 ? `${listboxId}-option-${activeIndex}` : undefined}
                    autoComplete="off"
                    placeholder={placeholder}
                    onFocus={() => setCatalogOpen(true)}
                    className={cn(
                        'w-full rounded-md border border-border bg-card pl-9 pr-9 text-[15px] text-foreground placeholder:text-muted-foreground outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60',
                        controlSize === 'large' ? 'h-[var(--ui-control-height-lg)]' : 'h-[var(--ui-control-height)]'
                    )}
                    disabled={value.length >= maxSkills}
                />
                {loading ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-label="Searching skills" /> : null}
            </div>

            {/* Category Navigation Bar: Single-row horizontal scroll to avoid multi-line wrapping */}
            {showCatalogControls ? <div
                className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none]"
                aria-label="Filter skills by category"
                role="group"
            >
                <button
                    type="button"
                    aria-pressed={category === 'all'}
                    onClick={() => handleCategoryClick('all')}
                    className={cn(
                        'nb-ui-label nb-touch-target shrink-0 whitespace-nowrap rounded-[3px] px-3 py-1.5 transition-colors focus-visible:brightness-95',
                        category === 'all'
                            ? 'bg-foreground text-background shadow-xs'
                            : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                >
                    All
                </button>
                {(skillCatalog?.categories ?? []).map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        aria-pressed={category === item.key}
                        onClick={() => handleCategoryClick(item.key)}
                        className={cn(
                            'nb-ui-label nb-touch-target shrink-0 whitespace-nowrap rounded-[3px] px-3 py-1.5 transition-colors focus-visible:brightness-95',
                            category === item.key
                                ? 'bg-foreground text-background shadow-xs'
                                : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                    >
                        {item.name}
                    </button>
                ))}
            </div> : null}

            {/* "All" Category Horizontal Shelf: Curated popular skills with quick-add */}
            {!dense && category === 'all' && !query.trim() && popularShelfSkills.length > 0 ? (
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="nb-micro text-muted-foreground">
                            Popular skills
                        </span>
                    </div>
                    <div
                        className="flex items-center gap-2 overflow-x-auto pb-1.5 no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none]"
                        role="region"
                        aria-label="Popular skills shelf"
                    >
                        {popularShelfSkills.map((skill) => (
                            <button
                                key={skill.canonicalKey}
                                type="button"
                                onClick={() => selectSkill(skill.name)}
                                className="nb-touch-target group flex shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-left transition hover:border-foreground/30 hover:bg-muted/60"
                                title={`Add ${skill.name}`}
                            >
                                <SkillIcon skill={skill} size={18} />
                                <div className="min-w-0">
                                    <span className="nb-ui-label block truncate text-foreground">
                                        {skill.name}
                                    </span>
                                    <span className="block truncate nb-meta capitalize text-muted-foreground">
                                        {skill.categoryKey.replaceAll('-', ' ')}
                                    </span>
                                </div>
                                <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition group-hover:border-foreground/40 group-hover:text-foreground">
                                    <Plus className="h-3 w-3" />
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}

            {/* Available Skills Listbox: Hidden initially on All tab, toggled by tab clicks or search query */}
            {isVisible ? (
                <div
                    id={listboxId}
                    role="listbox"
                    aria-busy={loading}
                    aria-label="Available skills"
                    className={cn("overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-none divide-y divide-border/30", dense ? "max-h-[232px]" : "min-h-40 max-h-72")}
                >
                    {displayedResults.map((skill, index) => (
                        <button
                            id={`${listboxId}-option-${index}`}
                            key={skill.canonicalKey}
                            type="button"
                            role="option"
                            tabIndex={-1}
                            aria-selected={index === activeIndex}
                            onMouseEnter={() => setActiveIndex(index)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectSkill(skill.name)}
                            className={cn(
                                'group flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition',
                                index === activeIndex ? 'bg-muted text-foreground' : 'hover:bg-muted/50 text-foreground'
                            )}
                        >
                            <div className="flex min-w-0 items-center gap-3">
                                <SkillIcon skill={skill} size={20} />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium text-foreground">{skill.name}</span>
                                    <span className="block truncate text-xs capitalize text-muted-foreground">{skill.categoryKey.replaceAll('-', ' ')} · {skill.kind.replaceAll('-', ' ')}</span>
                                </span>
                            </div>
                            <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground opacity-60 transition group-hover:opacity-100 group-hover:border-foreground/30 group-hover:text-foreground">
                                <Plus className="h-3.5 w-3.5" />
                            </span>
                        </button>
                    ))}

                    {/* Custom Skill Addition */}
                    {canAddCustom ? (
                        <button
                            id={`${listboxId}-option-${displayedResults.length}`}
                            type="button"
                            role="option"
                            tabIndex={-1}
                            aria-selected={activeIndex === displayedResults.length}
                            onMouseEnter={() => setActiveIndex(displayedResults.length)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectSkill(query.trim())}
                            className={cn(
                                'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition',
                                activeIndex === displayedResults.length ? 'bg-muted text-foreground' : 'hover:bg-muted/50 text-foreground'
                            )}
                        >
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-muted text-foreground">
                                <Plus className="h-3.5 w-3.5" />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-foreground">Add “{query.trim()}”</span>
                                <span className="block truncate text-xs text-muted-foreground">Custom skill · we’ll review it</span>
                            </span>
                        </button>
                    ) : null}

                    {/* Helper hint when viewing curated items in All */}
                    {category === 'all' && !query.trim() && displayedResults.length > 0 ? (
                        <div className="px-3 py-2 text-center text-xs text-muted-foreground">
                            Showing popular skills. Search above or select a category to browse all technologies.
                        </div>
                    ) : null}

                    {/* Empty State */}
                    {!loading && optionCount === 0 ? (
                        <div className="p-2">
                            <div className="nb-empty-state nb-grid-ground py-6 text-center" role="status">
                                <div className="nb-empty-state-icon-box">
                                    <Search className="nb-empty-state-icon" />
                                </div>
                                <h4 className="nb-empty-state-title">No matching skills found</h4>
                                <p className="nb-empty-state-desc">
                                    {category !== 'all'
                                        ? `Try switching to another category or searching for a specific term.`
                                        : `Try searching for a different technology or adding a custom skill.`}
                                </p>
                            </div>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}
