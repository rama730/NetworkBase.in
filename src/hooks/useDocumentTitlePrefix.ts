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
// Marks that lead the title (the unread count): other prefixes go after them, so the count always comes first.
const firstMarks = new Set<string>();

export function useDocumentTitlePrefix(prefix: string | null | undefined, separator = ' · ', { first = false }: { first?: boolean } = {}) {
    useEffect(() => {
        const text = normalizeTitle(prefix ?? '');
        if (!text) return;
        // No trailing whitespace in the marker: it must also match an empty base title.
        const mark = normalizeTitle(`${text}${separator}`);
        if (first) firstMarks.add(mark);
        const apply = () => {
            const current = document.title;
            if (current.includes(mark)) return;
            // Nothing is ever cut out of the title (a file named "image (1).png" keeps its "(1)"): a later prefix is
            // added after a leading count instead of in front of it.
            const lead = [...firstMarks].find((m) => current.startsWith(m));
            const after = first ? undefined : lead;
            const next = normalizeTitle(after ? `${after} ${text}${separator}${current.slice(after.length)}` : `${text}${separator}${current}`);
            if (next !== current) document.title = next;
        };
        // Next streams <title> into <body> on some loads; then the head never changes when the page sets its title, so
        // the element itself (and its parent, in case it's replaced) is watched too, and re-found after each change.
        const watch = () => {
            observer.disconnect();
            observer.observe(document.head, { subtree: true, childList: true, characterData: true });
            const title = document.querySelector('title');
            if (!title || document.head.contains(title)) return;
            observer.observe(title, { subtree: true, childList: true, characterData: true });
            if (title.parentNode) observer.observe(title.parentNode, { childList: true });
        };
        const observer = new MutationObserver(() => { apply(); watch(); });
        apply();
        watch();
        return () => {
            observer.disconnect();
            if (first) firstMarks.delete(mark);
            const current = document.title;
            const next = normalizeTitle(current.replace(mark, ''));
            if (next !== current) document.title = next;
        };
    }, [first, prefix, separator]);
}
