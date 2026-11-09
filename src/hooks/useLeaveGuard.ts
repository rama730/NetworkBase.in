'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { APP_BEFORE_NAVIGATE_EVENT, type AppBeforeNavigateEvent } from '@/lib/navigation/confirm-navigation';
import { isPlainLeftClick } from '@/lib/navigation/links';

/**
 * Ask before leaving while something would be lost: unsaved profile edits (report §32.3) or a running upload
 * (unified back R6). Ordinary links, browser Back, swipe and programmatic moves (the back arrow) are stopped, and
 * the caller's dialog replays the move on confirm. While `saving`, every move waits silently.
 */
export function useLeaveGuard(dirty: boolean, saving = false) {
    const pathname = usePathname();
    const search = useSearchParams().toString();
    const leaving = useRef(false);
    const state = useRef({ dirty, saving, url: '', history: null as unknown });
    const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);

    // The next browser event must see the committed draft, even before passive effects run.
    useLayoutEffect(() => {
        state.current = { dirty, saving, url: window.location.href, history: window.history.state };
    }, [dirty, saving, pathname, search]);

    useEffect(() => {
        // True when the move may go on now. Otherwise the caller stops it, and the dialog runs `retry` on Discard.
        const canLeave = (retry: () => void) => {
            if (leaving.current) return true;
            if (state.current.saving) return false;
            if (!state.current.dirty) return true;
            setPendingLeave(() => () => { leaving.current = true; retry(); });
            return false;
        };
        const unload = (event: BeforeUnloadEvent) => {
            if (leaving.current || (!state.current.dirty && !state.current.saving)) return;
            event.preventDefault();
            event.returnValue = '';
        };
        const click = (event: MouseEvent) => {
            if ((!state.current.dirty && !state.current.saving) || !isPlainLeftClick(event)) return;
            const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
            if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
            const target = new URL(anchor.href, state.current.url);
            if (!['http:', 'https:'].includes(target.protocol)) return;
            const current = new URL(state.current.url);
            if (target.origin === current.origin && target.pathname === current.pathname && target.search === current.search) return;
            if (canLeave(() => anchor.click())) { leaving.current = true; return; }
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        const pop = (event: PopStateEvent) => {
            if (canLeave(() => window.history.back())) { leaving.current = true; return; }
            event.stopImmediatePropagation();
            // Preserve Next's existing history state; no synthetic sentinel or router patch.
            window.history.pushState(state.current.history, '', state.current.url);
        };
        const navigation = (window as Window & { navigation?: EventTarget & { currentEntry?: { key?: string } } }).navigation;
        const navigate = (event: Event) => {
            const attempt = event as Event & { navigationType?: string; hashChange?: boolean; destination?: { key?: string } };
            if (attempt.navigationType !== 'traverse' || !event.cancelable || attempt.hashChange) return;
            // Some engines dispatch after the entry already changed; their popstate fallback restores it.
            if (attempt.destination?.key && attempt.destination.key === navigation?.currentEntry?.key) return;
            const key = attempt.destination?.key;
            const traverse = navigation as unknown as { traverseTo?: (key: string) => unknown } | undefined;
            if (!canLeave(() => { if (key && traverse?.traverseTo) traverse.traverseTo(key); else window.history.back(); })) event.preventDefault();
            else leaving.current = true;
        };
        // Native traversal cancellation runs before a framework can unmount the editor.
        navigation?.addEventListener('navigate', navigate);
        const programmatic = (event: Event) => {
            if (!canLeave((event as AppBeforeNavigateEvent).detail.go)) event.preventDefault();
            else leaving.current = true;
        };
        window.addEventListener(APP_BEFORE_NAVIGATE_EVENT, programmatic);
        window.addEventListener('beforeunload', unload);
        document.addEventListener('click', click, true);
        window.addEventListener('popstate', pop, true);
        return () => {
            navigation?.removeEventListener('navigate', navigate);
            window.removeEventListener(APP_BEFORE_NAVIGATE_EVENT, programmatic);
            window.removeEventListener('beforeunload', unload);
            document.removeEventListener('click', click, true);
            window.removeEventListener('popstate', pop, true);
        };
    }, []);

    const allowLeave = () => { leaving.current = true; };
    const leaveDialog = {
        open: pendingLeave !== null,
        onOpenChange: (open: boolean) => { if (!open) setPendingLeave(null); },
        onConfirm: () => pendingLeave?.(),
    };
    return { allowLeave, leaveDialog };
}
