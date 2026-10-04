'use client';

import { useEffect } from 'react';

export function useDocumentTitlePrefix(prefix: string | null | undefined) {
    useEffect(() => {
        if (!prefix) return;
        const previous = document.title;
        document.title = `${prefix} | ${previous}`;
        return () => {
            document.title = previous;
        };
    }, [prefix]);
}
