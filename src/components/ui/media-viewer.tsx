"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback, CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Download, Image as ImageIcon, ImageOff, Info, Link2, Minus, Plus, RotateCw, SquareArrowOutUpRight, X } from 'lucide-react';
import ResolvedVideoPlayer from '@/components/messages/parts/resolved-video-player';
import { MixPlayerBar } from '@/components/messages/parts/MixPlayerBar';
import { PdfViewerV2 } from '@/components/messages/parts/message-attachments';
import { PixelBeat } from '@/components/messages/mix/primitives';
import { cn } from '@/lib/utils';
import { DownloadLink } from '@/components/ui/download-link';
import { copyWithToast } from '@/lib/clipboard';
import { formatFileSize } from '@/lib/messaging/channel-view';
import { formatDuration, paintPreview, parsePreview, previewCanvasSize } from '@/lib/messaging/media-kind';
import { clampZoom, viewerLabel, viewerMeta } from '@/lib/messaging/viewer';
import { prefersReducedMotionFromAttributes } from '@/lib/theme/appearance';

export interface MediaItem {
    id: string;
    url: string;
    localUrl?: string;
    thumbnailUrl?: string;
    filename: string;
    type: 'image' | 'video' | 'file' | 'audio' | string;
    /** Optional details for the mono meta line and the Info panel. */
    sizeBytes?: number | null;
    width?: number | null;
    height?: number | null;
    durationMs?: number | null;
    preview?: string | null;
    /** Chat only: who sent it, when, and the message (Copy link, Jump to message). Hidden elsewhere. */
    context?: { sender?: string; at?: string; href?: string };
}

interface MediaViewerProps {
    attachments: MediaItem[];
    initialAttachmentId: string;
    originRect: DOMRect | null;
    initialVideoTime?: number;
    onClose: (returnedState?: { id: string; time: number }) => void;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])';

/**
 * One viewer for chat, Discover, updates and files (the mix, §7.2): a real dialog on the ink stage; chrome as cells with
 * hairlines; the sender and time (chat); the file name with a mono meta line; zoom cells (− · 100 % · + · Fit · 1:1),
 * wheel / double-click zoom and drag to pan; the mix player for video; a filmstrip; an Info panel; keys.
 */
export function MediaViewerModal({
    attachments,
    initialAttachmentId,
    originRect,
    initialVideoTime,
    onClose,
}: MediaViewerProps) {
    const initialIndex = useMemo(() => {
        const index = attachments.findIndex((attachment) => attachment.id === initialAttachmentId);
        return index === -1 ? 0 : index;
    }, [attachments, initialAttachmentId]);

    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    // Opened by a click: the video starts with sound (a click is consent).
    const [viewerMuted, setViewerMuted] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [isEntering, setIsEntering] = useState(true);
    const [isExiting, setIsExiting] = useState(false);
    const [isMediaLoaded, setIsMediaLoaded] = useState(false);
    const [slow, setSlow] = useState(false);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [infoOpen, setInfoOpen] = useState(false);
    const [reduced, setReduced] = useState(false);
    const viewerVideoRef = useRef<HTMLVideoElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const opener = useRef<HTMLElement | null>(null);
    const panStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

    const currentAttachment = attachments[currentIndex] ?? null;
    const currentAttachmentId = currentAttachment?.id ?? null;
    const hasMultiple = attachments.length > 1;
    const isImage = currentAttachment?.type === 'image';

    // Swipe gesture refs
    const touchStartX = useRef(0);
    const touchEndX = useRef(0);
    const touchStartY = useRef(0);
    const [dragY, setDragY] = useState(0);
    const [isDragging, setIsDragging] = useState(false);

    const handleClose = useCallback(() => {
        setIsExiting(true);
        let returnedState = undefined;
        if (currentAttachment?.type === 'video') {
            const video = viewerVideoRef.current;
            if (video) {
                returnedState = { id: currentAttachment.id, time: video.currentTime };
            }
        }
        setTimeout(() => {
            onClose(returnedState);
            opener.current?.focus?.();
        }, 250);
    }, [onClose, currentAttachment]);

    useEffect(() => {
        opener.current = document.activeElement as HTMLElement | null;
        setReduced(prefersReducedMotionFromAttributes(document.documentElement));
        setMounted(true);
        const timer = setTimeout(() => setIsEntering(false), 50);
        return () => clearTimeout(timer);
    }, []);
    // Focus goes to the close cell when the dialog opens.
    useEffect(() => {
        if (mounted) closeRef.current?.focus();
    }, [mounted]);

    useEffect(() => {
        setCurrentIndex(initialIndex);
        setZoomLevel(1);
    }, [initialIndex]);

    useEffect(() => {
        setZoomLevel(1);
        setPan({ x: 0, y: 0 });
        setIsMediaLoaded(false);
        setFailed(false);
        setSlow(false);
    }, [currentAttachmentId]);
    // A long load says so (pixel beat) after 2 s.
    useEffect(() => {
        if (isMediaLoaded || failed) return;
        const timer = window.setTimeout(() => setSlow(true), 2000);
        return () => window.clearTimeout(timer);
    }, [isMediaLoaded, failed, currentAttachmentId, attempt]);

    const moveNext = useCallback(() => {
        if (attachments.length === 0) return;
        setCurrentIndex((previous) => (previous + 1) % attachments.length);
    }, [attachments.length]);

    const movePrevious = useCallback(() => {
        if (attachments.length === 0) return;
        setCurrentIndex((previous) => (previous - 1 + attachments.length) % attachments.length);
    }, [attachments.length]);

    const zoomTo = useCallback((next: number) => {
        const z = clampZoom(next);
        setZoomLevel(z);
        if (z === 1) setPan({ x: 0, y: 0 });
    }, []);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') handleClose();
            if (event.key === 'Tab') {
                // Keep focus inside the dialog.
                const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((el) => el.offsetParent !== null);
                if (!items.length) return;
                const first = items[0]!, last = items[items.length - 1]!;
                // Focus on the page behind (a click on the picture drops it on <body>) comes back in.
                if (!dialogRef.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
                return;
            }
            const target = event.target as HTMLElement | null;
            // A key a control already used stays used; text fields and sliders keep every key.
            if (event.defaultPrevented || target?.closest('input, textarea, [role="slider"]')) return;
            // Buttons and links keep Space; speed cells keep their arrows.
            if (event.key === ' ' && target?.closest('button, a')) return;
            if (event.key.startsWith('Arrow') && target?.closest('[role="radio"], [role="radiogroup"]')) return;
            if (event.key === ' ') {
                event.preventDefault();
                const video = viewerVideoRef.current;
                if (video) {
                    if (video.paused) video.play().catch(() => undefined);
                    else video.pause();
                }
            }
            if (event.key === 'i') setInfoOpen((open) => !open);
            if (isImage && (event.key === '+' || event.key === '=')) zoomTo(zoomLevel + 0.25);
            if (isImage && event.key === '-') zoomTo(zoomLevel - 0.25);
            if (isImage && event.key === '0') zoomTo(1);
            if (!hasMultiple) return;
            if (event.key === 'ArrowRight') moveNext();
            if (event.key === 'ArrowLeft') movePrevious();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [hasMultiple, moveNext, movePrevious, handleClose, isImage, zoomLevel, zoomTo]);

    if (!currentAttachment || !mounted) return null;

    // FLIP from the tile, unless motion is reduced (then a fade only).
    const originX = originRect ? originRect.left + originRect.width / 2 : window.innerWidth / 2;
    const originY = originRect ? originRect.top + originRect.height / 2 : window.innerHeight / 2;
    const transX = originX - window.innerWidth / 2;
    const transY = originY - window.innerHeight / 2;
    const initScale = originRect ? Math.min(originRect.width / 800, originRect.height / 600) : 0.15;

    const animationStyle: CSSProperties = (isEntering || isExiting)
        ? {
            transform: reduced ? 'none' : `translate3d(${transX}px, ${transY}px, 0) scale(${initScale})`,
            opacity: 0,
            transition: 'transform 260ms cubic-bezier(.2,.8,.3,1), opacity 180ms cubic-bezier(.2,.8,.3,1)',
        }
        : isDragging || dragY !== 0
            ? {
                transform: `translate3d(0, ${dragY}px, 0) scale(${Math.max(0.8, 1 - Math.abs(dragY) / 1000)})`,
                opacity: Math.max(0.4, 1 - Math.abs(dragY) / 500),
                transition: isDragging ? 'none' : 'transform 260ms cubic-bezier(.2,.8,.3,1), opacity 260ms cubic-bezier(.2,.8,.3,1)',
            }
            : {
                transform: 'translate3d(0, 0, 0) scale(1)',
                opacity: 1,
                transition: 'transform 260ms cubic-bezier(.2,.8,.3,1), opacity 260ms cubic-bezier(.2,.8,.3,1)',
            };

    // Swipe gesture handlers (phones): sideways moves, down closes; not while zoomed in.
    const handleTouchStart = (e: React.TouchEvent) => {
        if (e.targetTouches[0] && zoomLevel === 1) {
            touchStartX.current = e.targetTouches[0].clientX;
            touchEndX.current = e.targetTouches[0].clientX;
            touchStartY.current = e.targetTouches[0].clientY;
            setIsDragging(true);
        }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (e.targetTouches[0] && isDragging) {
            touchEndX.current = e.targetTouches[0].clientX;
            setDragY(e.targetTouches[0].clientY - touchStartY.current);
        }
    };

    const handleTouchEnd = () => {
        if (!isDragging) return;
        setIsDragging(false);
        const deltaX = touchStartX.current - touchEndX.current;
        if (Math.abs(dragY) > 100) {
            handleClose();
        } else if (Math.abs(deltaX) > 75) {
            if (deltaX > 0) moveNext();
            else movePrevious();
            setDragY(0);
        } else {
            setDragY(0);
        }
    };

    const colors = parsePreview(currentAttachment.preview);
    const placeholderUrl = currentAttachment.type === 'image'
        ? currentAttachment.localUrl || currentAttachment.thumbnailUrl
        : currentAttachment.thumbnailUrl;
    const meta = viewerMeta({ index: currentIndex, count: attachments.length, name: currentAttachment.filename, size: currentAttachment.sizeBytes, width: currentAttachment.width, height: currentAttachment.height, formatSize: formatFileSize });
    const context = currentAttachment.context;
    const when = context?.at ? new Date(context.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;

    return createPortal(
        <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={viewerLabel(currentAttachment.filename, currentIndex, attachments.length)}
            className={cn('nbm nbm-viewer', (isEntering || isExiting) ? 'opacity-0' : 'opacity-100')}
            style={isDragging || dragY !== 0 ? { opacity: Math.max(0.3, 1 - Math.abs(dragY) / 400) } : undefined}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        >
            {/* Top bar: who and when (chat), the file and its mono line, then the cells. */}
            <div className="nbm-viewer-bar">
                <div className="nbm-viewer-who">
                    {context?.sender ? <span className="block truncate text-[13px] font-medium">{context.sender}</span> : null}
                    {when ? <span className="nbm-viewer-mono block truncate">{when}</span> : null}
                </div>
                <div className="nbm-viewer-file">
                    <span className="block truncate text-[13px] font-medium">{currentAttachment.filename}</span>
                    {meta ? <span className="nbm-viewer-mono block truncate">{meta}</span> : null}
                </div>
                <div className="nbm-viewer-cells">
                    {isImage ? (
                        <>
                            <button type="button" className="nbm-viewer-cell" onClick={() => zoomTo(zoomLevel - 0.25)} aria-label="Zoom out"><Minus className="h-4 w-4" /></button>
                            <span className="nbm-viewer-mono w-12 text-center">{Math.round(zoomLevel * 100)}%</span>
                            <button type="button" className="nbm-viewer-cell" onClick={() => zoomTo(zoomLevel + 0.25)} aria-label="Zoom in"><Plus className="h-4 w-4" /></button>
                            <button type="button" className="nbm-viewer-cell is-text" onClick={() => zoomTo(1)} aria-pressed={zoomLevel === 1}>Fit</button>
                            <button type="button" className="nbm-viewer-cell is-text" onClick={() => zoomTo(currentAttachment.width && currentAttachment.width > window.innerWidth ? currentAttachment.width / window.innerWidth : 2)}>1:1</button>
                        </>
                    ) : null}
                    <DownloadLink href={currentAttachment.url} filename={currentAttachment.filename} className="nbm-viewer-cell" aria-label="Download">
                        <Download className="h-4 w-4" />
                    </DownloadLink>
                    {context?.href ? (
                        <>
                            <button type="button" className="nbm-viewer-cell" onClick={() => void copyWithToast(`${window.location.origin}${context.href}`, 'Link copied')} aria-label="Copy link"><Link2 className="h-4 w-4" /></button>
                            <Link href={context.href} className="nbm-viewer-cell" onClick={handleClose} aria-label="Jump to message"><SquareArrowOutUpRight className="h-4 w-4" /></Link>
                        </>
                    ) : null}
                    <button type="button" className="nbm-viewer-cell" onClick={() => setInfoOpen(!infoOpen)} aria-pressed={infoOpen} aria-label="Info"><Info className="h-4 w-4" /></button>
                    <button ref={closeRef} type="button" className="nbm-viewer-cell" onClick={handleClose} aria-label="Close"><X className="h-4 w-4" /></button>
                </div>
            </div>

            <div className="nbm-viewer-body">
                {/* A click on the ink around the media closes, as before. */}
                <div style={animationStyle} className="nbm-viewer-stage" onClick={(event) => { if (event.target === event.currentTarget) handleClose(); }}>
                    {/* Loading: the pixel preview scaled up, else a soft blur of the thumbnail. */}
                    {!isMediaLoaded && !failed && currentAttachment.type !== 'file' ? (
                        colors ? (
                            <canvas aria-hidden="true" {...previewCanvasSize(currentAttachment.width, currentAttachment.height)} className="nbm-viewer-pixels" ref={(canvas) => paintPreview(canvas, colors)} />
                        ) : placeholderUrl ? (
                            <img src={placeholderUrl} alt="" aria-hidden="true" className="nbm-viewer-blur" />
                        ) : null
                    ) : null}
                    {(slow || (!colors && !placeholderUrl)) && !isMediaLoaded && !failed ? <span className="nbm-viewer-loading"><PixelBeat />Loading</span> : null}

                    {currentAttachment.type === 'video' ? (
                        <div data-player-host className="relative flex max-h-full max-w-full flex-col items-center">
                            <ResolvedVideoPlayer
                                key={currentAttachment.id}
                                url={currentAttachment.localUrl || currentAttachment.url}
                                controls={false}
                                autoPlay={true}
                                muted={viewerMuted}
                                playsInline={true}
                                preload="auto"
                                elementRef={viewerVideoRef}
                                initialTime={currentIndex === initialIndex ? initialVideoTime : undefined}
                                onVolumeChange={() => setViewerMuted(viewerVideoRef.current?.muted ?? true)}
                                onCanPlay={() => setIsMediaLoaded(true)}
                                onError={() => setIsMediaLoaded(true)}
                                className="lightbox-video h-auto max-h-[70vh] w-auto max-w-full object-contain"
                            />
                            <MixPlayerBar key={currentAttachment.id} videoRef={viewerVideoRef} keys onNext={hasMultiple ? moveNext : undefined} />
                        </div>
                    ) : currentAttachment.filename.toLowerCase().endsWith('.pdf') ? (
                        <div className="nbm-viewer-sheet">
                            <PdfViewerV2 key={currentAttachment.id} attachment={currentAttachment} />
                        </div>
                    ) : failed ? (
                        <div className="nbm-viewer-error" role="alert">
                            <ImageOff className="h-6 w-6" aria-hidden="true" />
                            <p>This image didn’t load.</p>
                            <div className="flex gap-2">
                                <button type="button" className="nbm-viewer-cell is-text" onClick={() => { setFailed(false); setIsMediaLoaded(false); setAttempt((n) => n + 1); }}><RotateCw className="h-4 w-4" aria-hidden="true" /> Retry</button>
                                <DownloadLink href={currentAttachment.url} filename={currentAttachment.filename} className="nbm-viewer-cell is-text"><Download className="h-4 w-4" aria-hidden="true" /> Download</DownloadLink>
                            </div>
                        </div>
                    ) : (
                        <div
                            className={cn('nbm-viewer-imgbox', zoomLevel > 1 ? 'is-zoomed' : '')}
                            onWheel={(event) => { if (event.ctrlKey || event.metaKey || zoomLevel > 1 || Math.abs(event.deltaY) > 0) zoomTo(zoomLevel - event.deltaY / 400); }}
                            onDoubleClick={() => zoomTo(zoomLevel > 1 ? 1 : 2)}
                            onPointerDown={(event) => { if (zoomLevel > 1) { panStart.current = { x: event.clientX, y: event.clientY, px: pan.x, py: pan.y }; event.currentTarget.setPointerCapture(event.pointerId); } }}
                            onPointerMove={(event) => { const start = panStart.current; if (start) setPan({ x: start.px + event.clientX - start.x, y: start.py + event.clientY - start.y }); }}
                            onPointerUp={() => { panStart.current = null; }}
                        >
                            <img
                                key={`${currentAttachment.id}:${attempt}`}
                                src={currentAttachment.localUrl || currentAttachment.url || undefined}
                                alt={currentAttachment.filename || ''}
                                onLoad={() => setIsMediaLoaded(true)}
                                onError={() => setFailed(true)}
                                draggable={false}
                                className="h-full w-full select-none object-contain"
                                style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoomLevel})`, transformOrigin: 'center center' }}
                            />
                        </div>
                    )}

                    {hasMultiple ? (
                        <>
                            <button type="button" onClick={movePrevious} className="nbm-viewer-nav is-prev" aria-label="Previous media"><ChevronLeft className="h-5 w-5" /></button>
                            <button type="button" onClick={moveNext} className="nbm-viewer-nav is-next" aria-label="Next media"><ChevronRight className="h-5 w-5" /></button>
                        </>
                    ) : null}
                </div>

                {infoOpen ? (
                    <aside className="nbm-viewer-info" aria-label="Info">
                        <dl>
                            {context?.sender ? <><dt>Sent by</dt><dd>{context.sender}</dd></> : null}
                            {when ? <><dt>When</dt><dd>{when}</dd></> : null}
                            <dt>File</dt><dd className="break-all">{currentAttachment.filename}</dd>
                            {currentAttachment.sizeBytes ? <><dt>Size</dt><dd>{formatFileSize(currentAttachment.sizeBytes)}</dd></> : null}
                            {currentAttachment.width && currentAttachment.height ? <><dt>Dimensions</dt><dd>{currentAttachment.width} × {currentAttachment.height}</dd></> : null}
                            {currentAttachment.durationMs ? <><dt>Length</dt><dd>{formatDuration(currentAttachment.durationMs)}</dd></> : null}
                        </dl>
                        <div className="mt-3 grid gap-1.5">
                            {context?.href ? <Link href={context.href} onClick={handleClose} className="nbm-viewer-cell is-text">Open in conversation</Link> : null}
                            <DownloadLink href={currentAttachment.url} filename={currentAttachment.filename} className="nbm-viewer-cell is-text">Download</DownloadLink>
                        </div>
                    </aside>
                ) : null}
            </div>

            {/* Filmstrip: square thumbs; the current one at full strength with its mono index; no ring. */}
            {hasMultiple ? (
                <div className="nbm-viewer-strip">
                    {attachments.map((att, idx) => (
                        <button
                            key={att.id}
                            type="button"
                            onClick={() => setCurrentIndex(idx)}
                            aria-label={`View ${att.filename}`}
                            aria-current={currentIndex === idx ? 'true' : undefined}
                            className="nbm-viewer-thumb"
                        >
                            {att.localUrl || att.thumbnailUrl ? (
                                <img src={att.localUrl || att.thumbnailUrl || undefined} alt="" className="h-full w-full object-cover" />
                            ) : (
                                <span className="grid h-full w-full place-items-center"><ImageIcon className="h-4 w-4" aria-hidden="true" /></span>
                            )}
                            {att.type === 'video' && att.durationMs ? <span className="nbm-viewer-thumb-dur">{formatDuration(att.durationMs)}</span> : null}
                            {currentIndex === idx ? <span className="nbm-viewer-thumb-idx">{idx + 1}</span> : null}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>,
        document.body,
    );
}
