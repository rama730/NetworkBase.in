'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
    Download,
    File,
    ImageOff,
    Play,
    RotateCw,
    Video,
} from 'lucide-react';
import {
    normalizeMediaDimensions,
    type MediaDimensions,
} from '@/lib/messaging/media-metadata';
import { attachmentRetryUrl } from '@/lib/messaging/attachment-ttl';
import { cn } from '@/lib/utils';
import { DownloadLink } from '@/components/ui/download-link';
import dynamic from 'next/dynamic';
import type { MediaItem } from '@/components/ui/media-viewer';
import { formatFileSize } from '@/lib/messaging/channel-view';
import { formatDuration, parsePreview, tileBox } from '@/lib/messaging/media-kind';
import { middleCut } from '@/lib/messaging/mix-format';
import { PixelBeat } from '@/components/messages/mix/primitives';
import { prefersReducedMotionFromAttributes } from '@/lib/theme/appearance';
import { useOverlayHistory } from "@/lib/navigation/overlay-history";

const MediaViewerModal = dynamic(
    () => import('@/components/ui/media-viewer').then((m) => m.MediaViewerModal),
    { ssr: false },
);

export interface ChatAttachmentV2 {
    id: string;
    type: 'image' | 'video' | 'audio' | 'file';
    /** 0149 extras: the 12×12 pixel preview, a video's or audio's length, an audio waveform. */
    preview?: string | null;
    durationMs?: number | null;
    peaks?: number[] | null;
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
                    {more > 0 && index === 3 ? <span className="nbm-tile-more" aria-hidden="true">+{more}</span> : null}
                </div>
            ))}
        </div>
    );
}

/** Reduced motion (the app setting or the OS, both on <html>): read after mount, so server and client agree. */
function useReducedMotion() {
    const [reduced, setReduced] = useState(false);
    useEffect(() => setReduced(prefersReducedMotionFromAttributes(document.documentElement)), []);
    return reduced;
}

/** The 12×12 colour grid, painted at once and pixelated, under the image while it loads. */
function PixelPreview({ colors }: { colors: string[] }) {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const ctx = ref.current?.getContext('2d');
        if (!ctx) return;
        colors.forEach((color, i) => {
            ctx.fillStyle = color;
            ctx.fillRect(i % 12, Math.floor(i / 12), 1, 1);
        });
    }, [colors]);
    return <canvas ref={ref} width={12} height={12} aria-hidden="true" className="nbm-pxpreview" />;
}

/**
 * One photo or video in the timeline (the mix, §7.2): the exact box from the start, the pixel preview painted at once,
 * the thumbnail (or the file) settling over it; a slow line says so after 2 s; a video shows its poster, a square play
 * cell and its length; a GIF says GIF and holds still under reduced motion; an error keeps the box with Retry and Download.
 */
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
    const box = tileBox(attachment.width, attachment.height);
    const colors = useMemo(() => parsePreview(attachment.preview), [attachment.preview]);
    const [loaded, setLoaded] = useState(false);
    const [hasError, setHasError] = useState(false);
    const [slow, setSlow] = useState(false);
    const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const isGif = (attachment.mimeType ?? '').toLowerCase() === 'image/gif';
    const still = useReducedMotion() && isGif;
    const isVideo = attachment.type === 'video';

    // Historical video tiles render only the stored poster (thumbnail).
    // The selected viewer owns the first video-body request and playback.
    const previewUrl = !isVideo
        ? attachment.localUrl || attachment.thumbnailUrl || attachment.url
        : attachment.thumbnailUrl;
    const displayUrl = fallbackUrl || previewUrl;

    useEffect(() => {
        setLoaded(false);
        setHasError(false);
        setFallbackUrl(null);
    }, [previewUrl]);
    // A slow line: after 2 s still loading, say so on the tile.
    useEffect(() => {
        if (loaded || hasError || !displayUrl) return;
        const timer = window.setTimeout(() => setSlow(true), 2000);
        return () => window.clearTimeout(timer);
    }, [loaded, hasError, displayUrl, attempt]);

    const retry = () => {
        setHasError(false);
        setLoaded(false);
        setSlow(false);
        setAttempt((n) => n + 1);
        setFallbackUrl(attachmentRetryUrl(attachment.url, attempt + 1) ?? `${attachment.url}${attachment.url.includes('?') ? '&' : '?'}retry=${attempt + 1}`);
    };
    const frameStyle: CSSProperties = { width: `${box.width}px`, aspectRatio: box.ratio };

    return (
        <div className="nbm-mtile msg-media-frame group/video" style={frameStyle} data-media-orientation={getMediaOrientation(normalizeMediaDimensions(attachment.width, attachment.height))}>
            {!hasError ? (
                <button
                    type="button"
                    onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const time = returnedVideoState?.id === attachment.id ? returnedVideoState.time : 0;
                        onClick(rect, time);
                    }}
                    aria-label={attachment.filename ? `Open media viewer for ${attachment.filename}` : 'Open media viewer'}
                    className="nbm-mtile-hit"
                />
            ) : null}

            {/* Under everything: the pixel preview, else the soft cell. */}
            {colors ? <PixelPreview colors={colors} /> : null}

            {displayUrl && !hasError ? (
                // Native img: local object URLs and signed fallbacks don't fit an image loader.
                <img
                    key={attempt}
                    src={displayUrl}
                    alt={attachment.filename || ''}
                    onLoad={() => {
                        setLoaded(true);
                        setSlow(false);
                        onContentLoad?.();
                    }}
                    onError={() => {
                        if (!fallbackUrl && displayUrl !== attachment.url && !isVideo) {
                            setFallbackUrl(attachment.url);
                        } else if (!fallbackUrl && displayUrl === attachment.url) {
                            const renewed = attachmentRetryUrl(attachment.url, 0);
                            if (renewed) setFallbackUrl(renewed);
                            else setHasError(true);
                        } else {
                            setHasError(true);
                        }
                    }}
                    className={cn('nbm-mtile-img', loaded ? 'is-loaded' : '', still ? 'is-still' : '')}
                />
            ) : null}

            {isVideo && !displayUrl && !hasError ? <span className="nbm-mtile-glyph" aria-hidden="true"><Video className="h-6 w-6" /></span> : null}

            {slow && !loaded && !hasError ? (
                <span className="nbm-tile-slow" aria-hidden="true"><PixelBeat />Loading · {formatFileSize(attachment.sizeBytes ?? 0)}</span>
            ) : null}

            {/* A video reads as a video: a square ink play cell and its length. */}
            {isVideo && !hasError ? (
                <>
                    <span className="nbm-tile-play" aria-hidden="true"><Play className="h-5 w-5" fill="currentColor" /></span>
                    {attachment.durationMs ? <span className="nbm-tile-duration" aria-hidden="true">{formatDuration(attachment.durationMs)}</span> : null}
                </>
            ) : null}
            {isGif && !hasError ? <span className="nbm-tile-duration" aria-hidden="true">GIF</span> : null}
            {still && !hasError ? <span className="nbm-tile-play" aria-hidden="true"><Play className="h-5 w-5" fill="currentColor" /></span> : null}

            {hasError ? (
                <div className="nbm-tile-err" role="group" aria-label={isVideo ? 'Video didn’t load' : 'Image didn’t load'}>
                    <ImageOff className="h-5 w-5" aria-hidden="true" />
                    <p>{isVideo ? 'Video didn’t load' : 'Image didn’t load'}</p>
                    <div className="flex gap-1.5">
                        <button type="button" className="nbm-tile-err-act" onClick={retry}><RotateCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry</button>
                        <DownloadLink href={attachment.url} filename={attachment.filename} className="nbm-tile-err-act" aria-label={`Download ${attachment.filename}`}><Download className="h-3.5 w-3.5" aria-hidden="true" /> Download</DownloadLink>
                    </div>
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
    // A list cell: the glyph tile, the name cut in the middle (the version stays), mono "PDF · 1.2 MB", a square Download.
    const extension = (attachment.filename.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? '').toUpperCase();
    const content = (
        <>
            <span className="nbm-fchip-glyph" aria-hidden="true"><File className="h-[18px] w-[18px]" /></span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-foreground" title={attachment.filename}>{middleCut(attachment.filename)}</span>
                <span className="nbm-lrow-meta block">{[extension, attachment.sizeBytes ? formatFileSize(attachment.sizeBytes) : null].filter(Boolean).join(" · ")}</span>
            </span>
        </>
    );
    const download = (
        <DownloadLink
            href={attachment.url}
            filename={attachment.filename}
            className="nbm-cell nb-touch-target shrink-0"
            aria-label={`Download ${attachment.filename}`}
            title="Download"
        >
            <Download className="h-4 w-4" />
        </DownloadLink>
    );
    return (
        <div className="nbm-fchip">
            {onPreview ? (
                <button type="button" onClick={onPreview} className="flex min-w-0 flex-1 items-center gap-3 p-2.5 text-left">{content}</button>
            ) : (
                <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-3 p-2.5">{content}</a>
            )}
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
