'use client';

import { useEffect } from 'react';

// Match document.title's getter: strip and collapse ASCII whitespace. Comparing
// raw text against that normalized getter can make our observer rewrite forever.
function normalizeTitle(value: string) {
    return value.replace(/[\t\n\f\r ]+/g, ' ').replace(/^ | $/g, '');
}

/**
 * Prefix the tab title ("(3) Messages"). Kept on through navigations (Next rewrites <title>),
 * and several prefixes stack without fighting: each only re-adds its own mark when it's missing.
 */
export function useDocumentTitlePrefix(prefix: string | null | undefined, separator = ' · ') {
    useEffect(() => {
        const text = normalizeTitle(prefix ?? '');
        if (!text) return;
        // No trailing whitespace in the marker: it must also match an empty base title.
        const mark = normalizeTitle(`${text}${separator}`);
        const apply = () => {
            const current = document.title;
            if (current.includes(mark)) return;
            const next = normalizeTitle(`${text}${separator}${current}`);
            if (next !== current) document.title = next;
        };
        apply();
        const observer = new MutationObserver(apply);
        observer.observe(document.head, { subtree: true, childList: true, characterData: true });
        return () => {
            observer.disconnect();
            const current = document.title;
            const next = normalizeTitle(current.replace(mark, ''));
            if (next !== current) document.title = next;
        };
    }, [prefix, separator]);
}
