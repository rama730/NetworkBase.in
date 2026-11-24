'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
    Download,
    File,
    Image as ImageIcon,
    Play,
    Video,
} from '@/components/ui/icons';
import {
    fitMediaWithinBounds,
    MESSAGE_MEDIA_INLINE_BOUNDS,
    normalizeMediaDimensions,
    type MediaDimensions,
} from '@/lib/messaging/media-metadata';
import { attachmentRetryUrl } from '@/lib/messaging/attachment-ttl';
import { cn } from '@/lib/utils';
import { DownloadLink } from '@/components/ui/download-link';
import dynamic from 'next/dynamic';
import type { MediaItem } from '@/components/ui/media-viewer';
import { formatFileSize } from '@/lib/messaging/channel-view';
import { useOverlayHistory } from "@/lib/navigation/overlay-history";

const MediaViewerModal = dynamic(
    () => import('@/components/ui/media-viewer').then((m) => m.MediaViewerModal),
    { ssr: false },
);

export interface ChatAttachmentV2 {
    id: string;
    type: 'image' | 'video' | 'file';
    url: string;
    filename: string;
    sizeBytes: number | null;
    mimeType: string | null;
    thumbnailUrl: string | null;
    width: number | null;
    height: number | null;
    localUrl?: string;
}

export function MessageAttachmentsV2({
    attachments,
    onContentLoad,
}: {
    attachments: ChatAttachmentV2[];
    onContentLoad?: () => void;
    isOwn?: boolean;
    hasReactions?: boolean;
}) {
    const { mediaAttachments, fileAttachments, viewerAttachments } = useMemo(() => {
        const media: ChatAttachmentV2[] = [];
        const files: ChatAttachmentV2[] = [];
        const viewer: MediaItem[] = [];

        for (const raw of attachments) {
            let att = raw;
            if (raw.type === 'file') {
                const ext = raw.filename.split('.').pop()?.toLowerCase();
                const isVideoExt = ext === 'mp4' || ext === 'webm' || ext === 'ogg' || ext === 'mov';
                const isImageExt = ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'gif' || ext === 'webp';
                if (raw.mimeType?.startsWith('video/') || isVideoExt) {
                    att = { ...raw, type: 'video' };
                } else if (raw.mimeType?.startsWith('image/') || isImageExt) {
                    att = { ...raw, type: 'image' };
                }
            }

            if (att.type === 'image' || att.type === 'video') {
                media.push(att);
                viewer.push({
                    id: att.id,
                    url: att.url,
                    filename: att.filename,
                    type: att.type,
                    localUrl: att.localUrl || undefined,
                    thumbnailUrl: att.thumbnailUrl || undefined,
                });
            } else {
                files.push(att);
                if (att.filename.toLowerCase().endsWith('.pdf')) {
                    viewer.push({
                        id: att.id,
                        url: att.url,
                        filename: att.filename,
                        type: att.type,
                        localUrl: att.localUrl || undefined,
                        thumbnailUrl: att.thumbnailUrl || undefined,
                    });
                }
            }
        }

        return { mediaAttachments: media, fileAttachments: files, viewerAttachments: viewer };
    }, [attachments]);

    const [activeAttachmentId, setActiveAttachmentId] = useState<string | null>(null);
    // Back or swipe closes the viewer first (unified back A3).
    useOverlayHistory("media", activeAttachmentId !== null, () => setActiveAttachmentId(null));
    const [originRect, setOriginRect] = useState<DOMRect | null>(null);
    const [videoTime, setVideoTime] = useState<number>(0);
    const [returnedVideoState, setReturnedVideoState] = useState<{ id: string; time: number } | null>(null);

    if (attachments.length === 0) return null;

    return (
        <>
            <div className="w-fit min-w-0 max-w-full space-y-2">
                {mediaAttachments.length > 0 ? (
                    <MediaAttachmentListV2
                        attachments={mediaAttachments}
                        onOpenMedia={(id, rect, time) => {
                            setActiveAttachmentId(id);
                            setOriginRect(rect);
                            if (time !== undefined) setVideoTime(time);
                            setReturnedVideoState(null); // Clear previous return state when opening
                        }}
                        onContentLoad={onContentLoad}
                        returnedVideoState={returnedVideoState}
                    />
                ) : null}

                {fileAttachments.length > 0 ? (
                    <div className="w-[480px] min-w-0 max-w-full space-y-1 overflow-hidden">
                        {fileAttachments.map((attachment) => (
                            <FileAttachmentCardV2
                                key={attachment.id}
                                attachment={attachment}
                                onPreview={attachment.filename.toLowerCase().endsWith('.pdf')
                                    ? () => {
                                        setActiveAttachmentId(attachment.id);
                                        setOriginRect(null);
                                    }
                                    : undefined}
                            />
                        ))}
                    </div>
                ) : null}
            </div>

            {activeAttachmentId ? (
                <MediaViewerModal
                    attachments={viewerAttachments}
                    initialAttachmentId={activeAttachmentId}
                    originRect={originRect}
                    initialVideoTime={videoTime}
                    onClose={(returnedState) => {
                        setActiveAttachmentId(null);
                        setOriginRect(null);
                        setVideoTime(0);
                        if (returnedState) {
                            setReturnedVideoState(returnedState);
                        }
                    }}
                />
            ) : null}
        </>
    );
}

function MediaAttachmentListV2({
    attachments,
    onOpenMedia,
    onContentLoad,
    returnedVideoState,
}: {
    attachments: ChatAttachmentV2[];
    onOpenMedia: (id: string, rect: DOMRect, time?: number) => void;
    onContentLoad?: () => void;
    returnedVideoState?: { id: string; time: number } | null;
}) {
    // Four tiles at most; the fourth says how many more and opens the viewer (which has them all).
    const shown = attachments.slice(0, 4);
    const more = attachments.length - shown.length;
    return (
        <div
            className="msg-bento-grid gap-1.5"
            data-count={shown.length}
        >
            {shown.map((attachment, index) => (
                <div key={attachment.id} className="relative min-h-0 min-w-0">
                    <MediaAttachmentTileV2
                        attachment={attachment}
                        onClick={(rect, time) => onOpenMedia(attachment.id, rect, time)}
                        onContentLoad={onContentLoad}
                        returnedVideoState={returnedVideoState}
                    />
                    {more > 0 && index === 3 ? (
                        <span className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-[inherit] bg-foreground/55 text-[20px] font-semibold text-background" aria-hidden="true">
                            +{more}
                        </span>
                    ) : null}
                </div>
            ))}
        </div>
    );
}

function MediaAttachmentTileV2({
    attachment,
    onClick,
    onContentLoad,
    returnedVideoState,
}: {
    attachment: ChatAttachmentV2;
    onClick: (rect: DOMRect, time?: number) => void;
    onContentLoad?: () => void;
    returnedVideoState?: { id: string; time: number } | null;
}) {
    const initialDimensions = useMemo(
        () => normalizeMediaDimensions(attachment.width, attachment.height),
        [attachment.height, attachment.width],
    );
    const [dimensions, setDimensions] = useState<MediaDimensions | null>(initialDimensions);
    const [loaded, setLoaded] = useState(false);
    const [hasError, setHasError] = useState(false);
    const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

    const previewUrl = attachment.type === 'image'
        ? attachment.localUrl || attachment.thumbnailUrl || attachment.url
        : attachment.thumbnailUrl;
    const displayUrl = fallbackUrl || previewUrl;

    // Reset loaded/error states only if the underlying preview URL changes (e.g. optimistic -> remote)
    useEffect(() => {
        setLoaded(false);
        setHasError(false);
        setFallbackUrl(null);
    }, [previewUrl]);

    const fittedSize = dimensions
        ? fitMediaWithinBounds(dimensions, MESSAGE_MEDIA_INLINE_BOUNDS)
        : null;
    const frameStyle: CSSProperties = fittedSize
        ? {
            width: `${fittedSize.width}px`,
            aspectRatio: `${dimensions!.width} / ${dimensions!.height}`,
        }
        : {
            width: `${MESSAGE_MEDIA_INLINE_BOUNDS.maxWidth}px`,
            aspectRatio: '1 / 1',
        };

    const recordDimensions = useCallback((width: number, height: number) => {
        const nextDimensions = normalizeMediaDimensions(width, height);
        if (nextDimensions) setDimensions(nextDimensions);
    }, []);

    return (
        <div
            className={cn(
                'msg-media-frame group/video relative max-w-full overflow-hidden rounded-lg bg-muted',
            )}
            style={frameStyle}
            data-media-orientation={getMediaOrientation(dimensions)}
        >
            {!hasError ? (
                <button
                    type="button"
                    onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const time = returnedVideoState?.id === attachment.id
                            ? returnedVideoState.time
                            : 0;
                        onClick(rect, time);
                    }}
                    aria-label={attachment.filename
                        ? `Open media viewer for ${attachment.filename}`
                        : 'Open media viewer'}
                    className="absolute inset-0 z-10 rounded-[inherit] border-0 focus:outline-none focus-visible:bg-foreground/25"
                />
            ) : null}

            {attachment.type === 'image' ? (
                <div
                    className={cn(
                        'pointer-events-none absolute inset-0 flex items-center justify-center bg-secondary transition-opacity duration-[180ms]',
                        loaded ? 'opacity-0' : 'animate-none opacity-100',
                    )}
                >
                    <ImageIcon className="h-6 w-6 text-muted-foreground" />
                </div>
            ) : null}

            {attachment.type === 'video' ? (
                displayUrl ? (
                    // Historical video tiles deliberately render only the stored thumbnail.
                    // The selected viewer owns the first video-body request and playback.
                     
                    <img
                        src={displayUrl}
                        alt={attachment.filename || ''}
                        onLoad={() => {
                            setLoaded(true);
                            onContentLoad?.();
                        }}
                        onError={() => {
                            setHasError(true);
                            setLoaded(true);
                        }}
                        className="absolute inset-0 block h-full w-full rounded-[inherit] object-cover transition-opacity duration-[180ms]"
                    />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-secondary">
                        <Video className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                    </div>
                )
            ) : (
                // Native img is intentional: local object URLs and remote
                // attachment fallbacks are not compatible with image loaders.
                 
                <img
                    src={displayUrl || undefined}
                    alt={attachment.filename || ''}
                    onLoad={(event) => {
                        const target = event.currentTarget as HTMLImageElement;
                        recordDimensions(target.naturalWidth, target.naturalHeight);
                        setLoaded(true);
                        onContentLoad?.();
                    }}
                    onError={() => {
                        if (!fallbackUrl && displayUrl !== attachment.url) {
                            setFallbackUrl(attachment.url);
                        } else if (displayUrl === attachment.url) {
                            const renewed = attachmentRetryUrl(attachment.url, 0);
                            if (renewed) setFallbackUrl(renewed);
                            else { setHasError(true); setLoaded(true); }
                        } else {
                            setHasError(true);
                            setLoaded(true);
                        }
                    }}
                    className={cn(
                        'absolute inset-0 h-full w-full block rounded-[inherit] object-cover transition-opacity duration-[180ms]',
                        loaded && !hasError ? 'opacity-100' : 'opacity-0',
                    )}
                />
            )}

            {/* A video reads as a video, not a photo. */}
            {attachment.type === 'video' && !hasError ? (
                <span className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
                    <span className="grid size-10 place-items-center rounded-full bg-foreground/60 text-background">
                        <Play className="h-5 w-5 translate-x-px" fill="currentColor" />
                    </span>
                </span>
            ) : null}

            {hasError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-muted text-muted-foreground">
                    <File className="h-6 w-6 mb-1 text-muted-foreground" />
                    <p className="text-[11px] font-semibold">Media unavailable</p>
                    <p className="mt-0.5 max-w-full truncate px-2 text-[11px]">{attachment.filename}</p>
                </div>
            ) : null}

        </div>
    );
}

function FileAttachmentCardV2({
    attachment,
    onPreview,
}: {
    attachment: ChatAttachmentV2;
    onPreview?: () => void;
}) {
    // The file's type at a glance ("PDF", "ZIP"), and Download always visible.
    const extension = (attachment.filename.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? '').toUpperCase();
    const content = (
        <>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-card">
                <File className="h-[18px] w-[18px] text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
                <p className="truncate break-all text-[13px] font-medium text-foreground">
                    {attachment.filename}
                </p>
                <p className="nb-meta">{[extension, attachment.sizeBytes ? formatFileSize(attachment.sizeBytes) : null].filter(Boolean).join(" · ")}</p>
            </div>
        </>
    );
    const download = (
        <DownloadLink
            href={attachment.url}
            filename={attachment.filename}
            className="nb-icon-button size-9 shrink-0 pointer-coarse:size-11"
            aria-label={`Download ${attachment.filename}`}
            title="Download"
        >
            <Download className="h-4 w-4" />
        </DownloadLink>
    );

    if (onPreview) {
        return (
            <div className="flex w-full min-w-0 max-w-full items-center gap-1 overflow-hidden rounded-lg border border-border bg-card pr-1.5 transition-colors duration-[130ms] hover:bg-muted">
                <button type="button" onClick={onPreview} className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left">
                    {content}
                </button>
                {download}
            </div>
        );
    }

    return (
        <div className="flex w-full min-w-0 max-w-full items-center gap-1 overflow-hidden rounded-lg border border-border bg-card pr-1.5 transition-colors duration-[130ms] hover:bg-muted">
            <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-3 p-3">
                {content}
            </a>
            {download}
        </div>
    );
}

export function PdfViewerV2({ attachment }: { attachment: { localUrl?: string; url: string; filename: string } }) {
    const [sourceUrl, setSourceUrl] = useState(attachment.localUrl || attachment.url);
    const [error, setError] = useState(false);

    useEffect(() => {
        setSourceUrl(attachment.localUrl || attachment.url);
        setError(false);
    }, [attachment.localUrl, attachment.url]);

    if (error) {
        return (
            <div className="flex h-full flex-col items-center justify-center p-4 text-center text-foreground">
                <File className="mb-2 h-12 w-12 text-muted-foreground" />
                <p className="mb-4 text-sm font-medium text-muted-foreground">Security restrictions prevent inline viewing.</p>
                <DownloadLink
                    href={attachment.url || attachment.localUrl || '#'}
                    filename={attachment.filename}
                    className="inline-flex h-[var(--ui-control-height)] items-center rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-[var(--primary-hover)]"
                >
                    Download PDF
                </DownloadLink>
            </div>
        );
    }

    return (
        <iframe
            src={sourceUrl}
            className="block h-full w-full border-0 bg-card"
            title={attachment.filename}
            onError={() => {
                if (sourceUrl === attachment.localUrl && attachment.url) {
                    setSourceUrl(attachment.url);
                    return;
                }
                setError(true);
            }}
        />
    );
}

function getMediaOrientation(dimensions: MediaDimensions | null) {
    if (!dimensions || dimensions.width === dimensions.height) return 'square';
    return dimensions.width > dimensions.height ? 'landscape' : 'portrait';
}
