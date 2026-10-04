'use client';

import { useEffect } from 'react';

/**
 * Prefix the tab title ("(3) Messages"). Kept on through navigations (Next rewrites <title>),
 * and several prefixes stack without fighting: each only re-adds its own mark when it's missing.
 */
export function useDocumentTitlePrefix(prefix: string | null | undefined, separator = ' | ') {
    useEffect(() => {
        if (!prefix) return;
        const mark = `${prefix}${separator}`;
        const apply = () => {
            if (!document.title.includes(mark)) document.title = `${mark}${document.title}`;
        };
        apply();
        const observer = new MutationObserver(apply);
        observer.observe(document.head, { subtree: true, childList: true, characterData: true });
        return () => {
            observer.disconnect();
            document.title = document.title.replace(mark, '');
        };
    }, [prefix, separator]);
}
