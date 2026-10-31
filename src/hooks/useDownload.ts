'use client';

import { useCallback, useState } from 'react';

import { downloadFile } from '@/lib/download';

/** `downloadFile` for a control that shows when it's busy. */
export function useDownload() {
    const [pending, setPending] = useState(false);
    const download = useCallback(async (url: string, options?: { filename?: string }) => {
        setPending(true);
        try {
            return await downloadFile(url, options);
        } finally {
            setPending(false);
        }
    }, []);
    return { download, pending };
}
