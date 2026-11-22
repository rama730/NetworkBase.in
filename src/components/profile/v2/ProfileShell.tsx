'use client';

import React from 'react';
import { useBottomStickyRail } from '@/hooks/useBottomStickyRail';

/**
 * The profile page (mix): the band, the tab bar touching it, the skills strip, then the main column and one card
 * on the right. The tab bar is a direct child of the page so it can stick for the whole scroll. On phones the card
 * goes under the main column.
 */
export function ProfileShell({
    header,
    tabs,
    strip,
    main,
    rail,
}: {
    header: React.ReactNode;
    tabs: React.ReactNode;
    strip?: React.ReactNode;
    main: React.ReactNode;
    rail: React.ReactNode;
}) {
    const stickyRail = useBottomStickyRail({ topInset: '68px' });
    return (
        <div className="min-h-full bg-background text-foreground">
            <div className="nb-pf-page">
                {header}
                {tabs}
                {strip}
                <div className="nb-pf-body">
                    <div className="nb-pf-col" data-testid="profile-tabs-shell">{main}</div>
                    {rail ? <aside {...stickyRail} className="nb-pf-rail" aria-label="Profile details">{rail}</aside> : null}
                </div>
            </div>
        </div>
    );
}
