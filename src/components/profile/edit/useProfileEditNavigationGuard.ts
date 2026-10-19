'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { APP_BEFORE_NAVIGATE_EVENT } from '@/lib/navigation/confirm-navigation';

/** Keep the draft mounted when an ordinary link or browser Back is canceled. */
export function useProfileEditNavigationGuard(dirty: boolean, saving: boolean) {
    const pathname = usePathname();
    const search = useSearchParams().toString();
    const leaving = useRef(false);
    const state = useRef({ dirty, saving, url: '', history: null as unknown });

    // The next browser event must see the committed draft, even before passive effects run.
    useLayoutEffect(() => {
        state.current = { dirty, saving, url: window.location.href, history: window.history.state };
    }, [dirty, saving, pathname, search]);

    useEffect(() => {
        const canLeave = () => {
            if (leaving.current) return true;
            if (state.current.saving) return false;
            return !state.current.dirty || window.confirm('Discard unsaved profile changes and leave this page?');
        };
        const unload = (event: BeforeUnloadEvent) => {
            if (leaving.current || (!state.current.dirty && !state.current.saving)) return;
            event.preventDefault();
            event.returnValue = '';
        };
        const click = (event: MouseEvent) => {
            if ((!state.current.dirty && !state.current.saving) || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
            if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
            const target = new URL(anchor.href, state.current.url);
            if (!['http:', 'https:'].includes(target.protocol)) return;
            const current = new URL(state.current.url);
            if (target.origin === current.origin && target.pathname === current.pathname && target.search === current.search) return;
            if (canLeave()) { leaving.current = true; return; }
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        const pop = (event: PopStateEvent) => {
            if (canLeave()) { leaving.current = true; return; }
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
            if (!canLeave()) event.preventDefault();
            else leaving.current = true;
        };
        // Native traversal cancellation runs before a framework can unmount the editor.
        navigation?.addEventListener('navigate', navigate);
        const programmatic = (event: Event) => {
            if (!canLeave()) event.preventDefault();
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

    return () => { leaving.current = true; };
}
