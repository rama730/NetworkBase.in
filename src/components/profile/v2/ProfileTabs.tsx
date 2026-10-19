'use client';

import { cn } from '@/lib/utils';
import type { ProfileTabKey } from './types';

const TABS: Array<{ key: ProfileTabKey; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'portfolio', label: 'Portfolio' },
];

export function ProfileTabs({
    value,
    onChange,
    onIntent,
    className,
}: {
    value: ProfileTabKey;
    onChange: (next: ProfileTabKey) => void;
    onIntent?: (next: ProfileTabKey) => void;
    className?: string;
}) {
    return (
        <div
            className={cn(
                'bg-background',
                className
            )}
        >
            <div
                role="tablist"
                aria-label="Profile sections"
                className="flex min-h-11 w-full items-end gap-5 overflow-x-auto border-b border-border bg-background scrollbar-none"
            >
                    {TABS.map((t) => {
                        const active = t.key === value;
                        return (
                            <button
                                key={t.key}
                                type="button"
                                onClick={() => onChange(t.key)}
                                onMouseEnter={() => onIntent?.(t.key)}
                                onFocus={() => onIntent?.(t.key)}
                                role="tab"
                                id={`profile-tab-${t.key}`}
                                aria-selected={active}
                                tabIndex={active ? 0 : -1}
                                onKeyDown={event => {
                                    const index = TABS.findIndex(tab => tab.key === value);
                                    const next = event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
                                    if (next === null) return;
                                    event.preventDefault();
                                    const key = TABS[next]!.key;
                                    onChange(key);
                                    document.getElementById(`profile-tab-${key}`)?.focus();
                                }}
                                aria-controls={`profile-panel-${t.key}`}
                                className={cn(
                                    'nb-ui-label -mb-px min-h-11 border-b-2 border-transparent px-1 py-3 text-left focus-visible:bg-muted/70 focus-visible:outline-none',
                                    active
                                        ? 'border-primary font-semibold text-foreground'
                                        : 'text-muted-foreground hover:text-foreground'
                                )}
                            >
                                {t.label}
                            </button>
                        );
                    })}
            </div>
        </div>
    );
}
