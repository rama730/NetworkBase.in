'use client';

import { normalizeLinkPreview } from '@/lib/links/preview-data';
import Image from 'next/image';
import { memo, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { LinkPreview } from '@/hooks/useLinkPreview';
import { SharePreviewCard } from '@/components/sharing/SharePreviewCard';

interface LinkPreviewCardProps {
    preview: LinkPreview;
    loading?: boolean;
    onContentLoad?: () => void;
    /** The author's × (removes the preview for everyone). */
    onRemove?: () => void;
}

/** A link's card under its message (theme tokens only); `loading` holds its place so nothing jumps. */
export const LinkPreviewCard = memo(function LinkPreviewCard({ preview, loading = false, onContentLoad, onRemove }: LinkPreviewCardProps) {
    const shell = useRef<HTMLDivElement>(null);
    const [reservedHeight, setReservedHeight] = useState(0);
    useEffect(() => {
        if (!preview.firstParty || preview.firstParty.state !== 'ready' || !shell.current) return;
        const observer = new ResizeObserver(([entry]) => {
            if (entry) setReservedHeight(Math.min(420, Math.ceil(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height)));
        });
        observer.observe(shell.current);
        return () => observer.disconnect();
    }, [preview.firstParty]);
    const safePreview = normalizeLinkPreview(preview, preview.url);
    if (!safePreview) return null;
    preview = safePreview;
    if (preview.firstParty) return <div ref={shell} className="msg-first-party-preview group/preview relative mt-2"
        style={preview.firstParty.state !== 'ready' && reservedHeight ? { minHeight: reservedHeight } : undefined}>
        <SharePreviewCard preview={preview.firstParty} destination={preview.openUrl} linked loading={loading} trailingAction={Boolean(onRemove)} />
        {onRemove ? <button type="button" onClick={onRemove} aria-label="Remove link preview for everyone" title="Remove link preview"
            className="nb-icon-button absolute right-1 top-1 size-11 text-muted-foreground pointer-fine:opacity-0 pointer-fine:group-hover/preview:opacity-100 group-focus-within/preview:opacity-100 focus-visible:opacity-100">
            <X size={14} />
        </button> : null}
    </div>;
    if (!loading && !preview.title && !preview.description && !preview.image) return null;

    const card = (
        <a
            href={preview.url}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            aria-busy={loading || undefined}
            className="nbm-lp msg-rich-content"
        >
            {(preview.image || loading) && (
                <div className="nbm-lp-img">
                    {preview.image ? (
                        <Image
                            src={preview.image}
                            alt=""
                            width={80}
                            height={80}
                            sizes="80px"
                            unoptimized
                            loading="lazy"
                            onLoad={onContentLoad}
                            className="h-full w-full object-cover"
                        />
                    ) : (
                        <div aria-hidden="true" className="nb-skeleton h-full w-full" />
                    )}
                </div>
            )}
            <div className="nbm-lp-text">
                <div className="nbm-lp-domain">{preview.domain}</div>
                {loading && !preview.title ? (
                    <div aria-hidden="true" className="nb-skeleton mt-1 h-3.5 w-4/5 rounded-sm" />
                ) : preview.title ? (
                    <div className="nbm-lp-title">
                        {preview.title}
                    </div>
                ) : null}
                {loading && !preview.description ? (
                    <div aria-hidden="true" className="nb-skeleton mt-1 h-3 w-2/3 rounded-sm" />
                ) : preview.description ? (
                    <div className="nbm-lp-desc">
                        {preview.description}
                    </div>
                ) : null}
            </div>
        </a>
    );
    if (!onRemove) return card;
    return (
        <div className="group/preview relative max-w-[480px]">
            {card}
            <button
                type="button"
                onClick={onRemove}
                aria-label="Remove link preview"
                title="Remove preview"
                className="nbm-cell nbm-lp-x absolute right-1.5 top-3.5 pointer-fine:opacity-0 pointer-fine:group-hover/preview:opacity-100 focus-visible:opacity-100"
            >
                <X size={14} />
            </button>
        </div>
    );
});
