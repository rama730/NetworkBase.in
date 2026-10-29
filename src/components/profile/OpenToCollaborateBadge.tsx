'use client';

import * as Popover from '@radix-ui/react-popover';
import React, { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
    experienceLevelLabel,
    getRolePreferences,
    rolePreferenceLabel,
    WEEKLY_CAPACITY_OPTIONS,
} from '@/lib/profile/role-preferences';

export interface OpenToCollaborateBadgeProps {
    openToCollaborate?: boolean | null;
    openTo?: unknown;
    customRoles?: string[] | null;
    categories?: string[] | null;
    experienceLevel?: unknown;
    hoursPerWeek?: unknown;
    variant?: 'badge' | 'profile-header';
    isOwner?: boolean;
    className?: string;
    interactive?: boolean;
}

export function OpenToCollaborateBadge({
    openToCollaborate = false,
    openTo,
    customRoles = [],
    categories = [],
    experienceLevel,
    hoursPerWeek,
    variant = 'profile-header',
    isOwner = false,
    className,
    interactive,
}: OpenToCollaborateBadgeProps) {
    const isInteractive = interactive !== undefined ? interactive : variant !== 'profile-header';
    const [open, setOpen] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    if (!openToCollaborate) return null;

    if (!isInteractive) {
        return (
            <span
                data-variant={variant}
                className={cn(
                    'nb-person-collaboration',
                    variant === 'profile-header' && 'nb-person-collaboration--profile',
                    className
                )}
            >
                <span>Open to collaborate</span>
            </span>
        );
    }

    const schedule = (next: boolean, delay: number) => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setOpen(next), delay);
    };

    const roles = getRolePreferences(openTo);
    const experience = experienceLevelLabel(experienceLevel);
    const capacity = WEEKLY_CAPACITY_OPTIONS.find((option) => option.value === hoursPerWeek);

    const safeCustomRoles = Array.isArray(customRoles) ? customRoles : [];
    const safeCategories = Array.isArray(categories) ? categories : [];

    const preferences = [
        { label: 'Role types', values: roles.map((role) => rolePreferenceLabel(role) || role) },
        { label: 'Desired roles', values: safeCustomRoles },
        { label: 'Categories', values: safeCategories },
        { label: 'Experience', values: experience ? [experience] : [] },
        { label: 'Weekly hours', values: capacity ? [capacity.compactLabel] : [], description: capacity?.label },
    ].filter((row) => row.values.length > 0);

    const hasPreferences = preferences.length > 0;

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger
                type="button"
                data-variant={variant}
                aria-expanded={open}
                aria-label="Open to collaborate. View collaboration preferences"
                className={cn(
                    'nb-person-collaboration nb-person-collaboration-interactive',
                    className
                )}
                onPointerEnter={(e) => e.pointerType === 'mouse' && schedule(true, 120)}
                onPointerLeave={(e) => e.pointerType === 'mouse' && schedule(false, 150)}
                onClick={() => setOpen((prev) => !prev)}
            >
                <span>Open to collaborate</span>
            </Popover.Trigger>

            <Popover.Portal>
                <Popover.Content
                    side="bottom"
                    align="start"
                    sideOffset={6}
                    collisionPadding={12}
                    onPointerEnter={() => {
                        if (timer.current) clearTimeout(timer.current);
                    }}
                    onPointerLeave={() => schedule(false, 150)}
                    className="z-50 w-[300px] max-w-[calc(100vw-24px)] rounded-[8px] border border-border bg-popover text-popover-foreground shadow-lg outline-none p-3.5 space-y-3 animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 duration-150"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-border/60">
                        <div className="flex items-center gap-1.5 min-w-0">
                            <span className="size-1.5 rounded-[1px] bg-[var(--status-success)] shrink-0" aria-hidden="true" />
                            <span className="text-[13px] font-semibold text-foreground truncate">Collaboration preferences</span>
                        </div>
                        <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded-[3px] bg-[var(--status-success-soft)] text-[var(--status-success)] border border-[color-mix(in_srgb,var(--status-success)_25%,var(--border))] shrink-0">
                            Available
                        </span>
                    </div>

                    {/* Body */}
                    {hasPreferences ? (
                        <dl className="space-y-2.5 text-[12px] leading-tight">
                            {preferences.map((row) => (
                                <div key={row.label} className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-x-2">
                                    <dt className="text-muted-foreground font-normal">{row.label}</dt>
                                    <dd className="min-w-0 text-right font-medium text-foreground [overflow-wrap:anywhere]">
                                        {row.values.join(', ')}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    ) : (
                        <p className="text-[12px] text-muted-foreground leading-normal">
                            {isOwner
                                ? 'Add the role types, roles, and categories that interest you in your Role Preferences.'
                                : 'Open to collaboration. Specific role preferences have not been added yet.'}
                        </p>
                    )}

                    {/* Footer note */}
                    <div className="pt-2 border-t border-border/50 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>Role preferences</span>
                        <span className="text-[10px] text-muted-foreground/75">NetworkBase Collaboration</span>
                    </div>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
