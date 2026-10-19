'use client';

import { attachmentRetryUrl } from '@/lib/messaging/attachment-ttl';
import { useEffect, useRef, useState, type RefObject } from 'react';

export default function ResolvedVideoPlayer({
    url,
    className,
    muted,
    autoPlay,
    controls,
    loop,
    playsInline,
    paused,
    initialTime,
    playbackRate = 1,
    preload = 'metadata',
    elementRef,
    onVolumeChange,
    onCanPlay,
    onError,
}: {
    url: string;
    className?: string;
    muted?: boolean;
    autoPlay?: boolean;
    controls?: boolean;
    loop?: boolean;
    playsInline?: boolean;
    paused?: boolean;
    initialTime?: number;
    playbackRate?: number;
    preload?: 'none' | 'metadata' | 'auto';
    elementRef?: RefObject<HTMLVideoElement | null>;
    onVolumeChange?: () => void;
    onCanPlay?: () => void;
    onError?: () => void;
}) {
    const internalRef = useRef<HTMLVideoElement>(null);
    const videoRef = elementRef ?? internalRef;

    const [recovery, setRecovery] = useState<{ original: string; source: string; failed: boolean } | null>(null);
    const position = useRef(0);
    const resume = useRef(false);
    const current = recovery?.original === url ? recovery : null;
    const source = current?.source ?? url;

    // Apply initial time on mount
    useEffect(() => {
        const video = videoRef.current;
        if (video && initialTime !== undefined && initialTime > 0) {
            video.currentTime = initialTime;
        }
    }, [initialTime, videoRef]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (paused) {
            video.pause();
        } else if (autoPlay) {
            void video.play().catch(() => undefined);
        }
    }, [paused, autoPlay, videoRef]);

    useEffect(() => {
        const video = videoRef.current;
        if (video && muted !== undefined) {
            video.muted = muted;
        }
    }, [muted, videoRef]);

    useEffect(() => {
        if (videoRef.current) videoRef.current.playbackRate = playbackRate;
    }, [playbackRate, videoRef]);

    if (current?.failed) return <p role="alert" className="p-4 text-sm text-muted-foreground">Media unavailable. Close and reopen to retry.</p>;

    return (
        <video
            ref={videoRef}
            src={source}
            className={className}
            controls={controls}
            autoPlay={autoPlay}
            muted={muted}
            loop={loop}
            playsInline={playsInline}
            preload={preload}
            onVolumeChange={onVolumeChange ? () => onVolumeChange() : undefined}
            onCanPlay={onCanPlay}
            onLoadedMetadata={(event) => {
                if (current) {
                    event.currentTarget.currentTime = position.current;
                    event.currentTarget.playbackRate = playbackRate;
                    if (resume.current && !paused) void event.currentTarget.play().catch(() => undefined);
                    else event.currentTarget.pause();
                }
            }}
            onError={() => {
                const next = attachmentRetryUrl(url, current ? 1 : 0);
                if (next) {
                    position.current = videoRef.current?.currentTime ?? 0;
                    resume.current = !videoRef.current?.paused;
                    setRecovery({ original: url, source: next, failed: false });
                } else {
                    setRecovery({ original: url, source, failed: true });
                    onError?.();
                }
            }}
        />
    );
}
