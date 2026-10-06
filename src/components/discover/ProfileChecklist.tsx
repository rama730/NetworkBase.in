'use client';

import { useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ROUTES } from '@/constants/routes';
import { cn } from '@/lib/utils';

const KEY = 'onboarding:profile-strength:v1';
// A dismiss here (both copies: under the header and in the rail) or in another tab.
const subscribe = (onChange: () => void) => {
    window.addEventListener('storage', onChange);
    return () => window.removeEventListener('storage', onChange);
};
const read = () => {
    try {
        return window.localStorage.getItem(KEY);
    } catch {
        return null;
    }
};

/** What onboarding left to do, for the account that finished it on this browser. A neutral card; dismissible. */
export function ProfileChecklist({ userId, className }: { userId: string; className?: string }) {
    const raw = useSyncExternalStore(subscribe, read, () => null);
    const items = useMemo(() => {
        try {
            const parsed = raw ? JSON.parse(raw) as { userId?: string; items?: string[] } : null;
            return parsed?.userId === userId && Array.isArray(parsed.items) ? parsed.items.slice(0, 5) : [];
        } catch {
            return [];
        }
    }, [raw, userId]);
    if (!items.length) return null;

    const dismiss = () => {
        try {
            window.localStorage.removeItem(KEY);
        } catch {
            // Storage blocked: it stays hidden until the page reloads.
        }
        window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    };

    return (
        <section aria-labelledby="profile-checklist-title" className={cn('rounded-lg border border-border bg-card p-4', className)}>
            <div className="flex items-start justify-between gap-3">
                <h2 id="profile-checklist-title" className="nb-ui-label pt-1">Finish your profile</h2>
                <button type="button" onClick={dismiss} className="nb-icon-button nb-touch-target -mr-1 -mt-1" aria-label="Dismiss profile checklist">
                    <X className="size-4" aria-hidden="true" />
                </button>
            </div>
            <p className="nb-compact mt-1 text-muted-foreground">Projects find you faster when your profile is complete.</p>
            <ul className="nb-compact mt-2 list-disc space-y-1 pl-5">
                {items.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <Button asChild variant="outline" size="sm" className="mt-3 pointer-coarse:h-11">
                <Link href={ROUTES.MY_PROFILE}>Complete your profile</Link>
            </Button>
        </section>
    );
}
