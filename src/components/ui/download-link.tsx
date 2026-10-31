'use client';

import { useState, type ComponentProps } from 'react';

import { downloadFile } from '@/lib/download';

/** A link that saves its file through `downloadFile`. Holding a modifier key still opens it as a normal link. */
export function DownloadLink({ href, filename, onClick, ...props }: ComponentProps<'a'> & { href: string; filename?: string }) {
    const [pending, setPending] = useState(false);
    return (
        <a
            {...props}
            href={href}
            aria-busy={pending || undefined}
            onClick={(event) => {
                onClick?.(event);
                if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                setPending(true);
                void downloadFile(href, { filename }).finally(() => setPending(false));
            }}
        />
    );
}
