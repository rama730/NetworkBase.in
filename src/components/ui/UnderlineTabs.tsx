'use client';

import { cn } from '@/lib/utils';

// Board/review report §5: one tab style for "which kind" choices — the profile's Overview · Portfolio look: plain
// text, an orange line under the chosen one, a hairline under the row. Arrow keys, Home and End move between tabs.

export function UnderlineTabs<K extends string>({ tabs, value, onChange, onIntent, label, idPrefix, className, controls = true }: {
    tabs: ReadonlyArray<{ key: K; label: string }>
    value: K
    onChange: (next: K) => void
    onIntent?: (next: K) => void
    /** The tablist's name for screen readers ("Profile sections", "What are you creating?"). */
    label: string
    idPrefix: string
    className?: string
    /** Point each tab at a `${idPrefix}-panel-${key}` panel (off when the form below simply changes). */
    controls?: boolean
}) {
    return (
        <div role="tablist" aria-label={label} className={cn('flex min-h-11 w-full items-end gap-5 border-b border-border bg-background', className)}>
            {tabs.map((t) => {
                const active = t.key === value;
                return (
                    <button
                        key={t.key}
                        type="button"
                        role="tab"
                        id={`${idPrefix}-tab-${t.key}`}
                        aria-selected={active}
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
                        className={cn(
                            'nb-ui-label -mb-px min-h-11 border-b-2 border-transparent px-1 py-3 text-left focus-visible:bg-muted/70 focus-visible:outline-none',
                            active ? 'border-primary font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        {t.label}
                    </button>
                );
            })}
        </div>
    );
}
