'use client';

import { cn } from '@/lib/utils';
import { UnderlineTabs } from '@/components/ui/UnderlineTabs';
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
    // Board/review report §5: the shared underline tabs; New task and New sprint use the same component.
    return (
        <div className={cn('bg-background', className)}>
            <UnderlineTabs tabs={TABS} value={value} onChange={onChange} onIntent={onIntent} label="Profile sections" idPrefix="profile" />
        </div>
    );
}
