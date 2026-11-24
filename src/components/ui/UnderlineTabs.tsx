'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TabMarker } from '@/components/ui/TabMarker';
import { padCount } from '@/lib/ui/tab-marker';

// Board/review report §5: one tab style for "which kind" choices — the profile's Overview · Portfolio look: plain
// text, an orange line under the chosen one, a hairline under the row. Arrow keys, Home and End move between tabs.
// It takes its surface's colour (sprint cleanup §2: a page background drew a band inside dialogs).

export function UnderlineTabs<K extends string>({ tabs, value, onChange, onIntent, label, idPrefix, className, controls = true, variant = 'underline', trailing }: {
    /** `count`: the spec's 12px mono count after the label (§10 Tabs); `warn` tints it when it needs attention. `icon`: the workspace row's 16px icon. */
    tabs: ReadonlyArray<{ key: K; label: string; count?: number; warn?: boolean; icon?: LucideIcon }>
    value: K
    onChange: (next: K) => void
    onIntent?: (next: K) => void
    /** The tablist's name for screen readers ("Profile sections", "What are you creating?"). */
    label: string
    idPrefix: string
    className?: string
    /** Point each tab at a `${idPrefix}-panel-${key}` panel (off when the form below simply changes). */
    controls?: boolean
    /** `workspace`: the workspace page's tab row (icon, control height, clay icon when chosen) — create wizard v6 Start. */
    variant?: 'underline' | 'workspace'
    /** Sits at the row's right end, outside the tab list (Start's Lives in drop-down). */
    trailing?: ReactNode
}) {
    const workspace = variant === 'workspace';
    return (
        <div className={cn(trailing ? 'flex w-full flex-wrap items-center justify-between gap-x-4 border-b border-border' : 'contents')}>
        <div role="tablist" aria-label={label} className={cn(workspace ? 'relative -mb-px flex min-w-0 items-center overflow-x-auto app-scroll app-scroll-x' : 'flex min-h-11 w-full items-end gap-5', !trailing && 'border-b border-border', className)}>
            {tabs.map((t) => {
                const active = t.key === value;
                return (
                    <button
                        key={t.key}
                        type="button"
                        role="tab"
                        id={`${idPrefix}-tab-${t.key}`}
                        aria-selected={active}
                        aria-label={t.count !== undefined ? `${t.label}, ${t.count}` : undefined}
                        aria-controls={controls ? `${idPrefix}-panel-${t.key}` : undefined}
                        tabIndex={active ? 0 : -1}
                        onClick={() => onChange(t.key)}
                        onMouseEnter={() => onIntent?.(t.key)}
                        onFocus={() => onIntent?.(t.key)}
                        onKeyDown={(event) => {
                            const index = tabs.findIndex((tab) => tab.key === value);
                            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
                            if (next === null) return;
                            event.preventDefault();
                            const key = tabs[next]!.key;
                            onChange(key);
                            document.getElementById(`${idPrefix}-tab-${key}`)?.focus();
                        }}
                        className={workspace
                            ? cn('nb-tab nb-ui-label relative flex h-[var(--ui-control-height)] shrink-0 items-center gap-2 whitespace-nowrap px-3 transition-colors duration-[180ms] ease-[cubic-bezier(.2,.8,.3,1)] focus-visible:bg-muted/70 focus-visible:outline-none', active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')
                            : cn(
                            'nb-ui-label -mb-px min-h-11 border-b-2 border-transparent px-1 py-3 text-left focus-visible:bg-muted/70 focus-visible:outline-none',
                            active ? 'border-primary font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        {t.icon ? <t.icon aria-hidden="true" className={cn('size-4 max-sm:hidden', active ? 'text-primary' : 'text-muted-foreground')} /> : null}
                        {t.label}
                        {t.count !== undefined ? <span className={cn('nb-tab-count ml-1.5', t.warn && t.count > 0 && 'bg-[var(--status-warning-soft)] text-[var(--status-warning)]')}><span aria-hidden="true">{padCount(t.count)}</span></span> : null}
                    </button>
                );
            })}
            <TabMarker overlap />
        </div>
        {trailing}
        </div>
    );
}
