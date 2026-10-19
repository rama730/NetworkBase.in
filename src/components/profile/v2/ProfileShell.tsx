'use client';

import React from 'react';
import { useBottomStickyRail } from '@/hooks/useBottomStickyRail';

export function ProfileShell({
    header,
    tabs,
    main,
    mainBottom,
    highlights,
    rail,
}: {
    header: React.ReactNode;
    tabs: React.ReactNode;
    main: React.ReactNode;
    mainBottom?: React.ReactNode;
    highlights?: React.ReactNode;
    rail: React.ReactNode;
}) {
    const stickyRail = useBottomStickyRail();

    return (
        <div className="min-h-full bg-background text-foreground">
            <div className="mx-auto max-w-[1060px] px-4 py-6 sm:px-6">
                <div className="space-y-5">
                    {header}
                    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6 lg:items-start">
                        <div className="contents lg:min-w-0 lg:block lg:space-y-6">
                            <div data-testid="profile-tabs-shell" className="order-1 min-w-0">
                                {tabs}
                            </div>
                            <div className="order-2">{main}</div>
                            {mainBottom ? <div className="order-4" role="region" aria-label="Project contributions">{mainBottom}</div> : null}
                        </div>
                        <aside {...stickyRail} role="complementary" className="contents lg:min-w-0 lg:block lg:sticky lg:self-start" aria-label="Profile details">
                            <div className="contents lg:block lg:space-y-6">
                                {highlights ? <div className="order-3 space-y-6">{highlights}</div> : null}
                                {rail ? <div className="order-5 space-y-6">{rail}</div> : null}
                            </div>
                        </aside>
                    </div>
                </div>
            </div>
        </div>
    );
}
