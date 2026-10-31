'use client';

import type { ComponentProps } from 'react';

import { useDownload } from '@/hooks/useDownload';

/** A link that saves its file through `downloadFile`. Holding a modifier key still opens it as a normal link. */
export function DownloadLink({ href, filename, onClick, ...props }: ComponentProps<'a'> & { href: string; filename?: string }) {
    const { download, pending } = useDownload();
    return (
        <a
            {...props}
            href={href}
            aria-busy={pending || undefined}
            onClick={(event) => {
                onClick?.(event);
                if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                void download(href, { filename });
            }}
        />
    );
}
