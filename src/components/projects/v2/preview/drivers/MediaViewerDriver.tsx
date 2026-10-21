"use client";

import * as React from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  RotateCcw,
  RotateCw,
  Download,
  ExternalLink,
  AlertTriangle,
  Music,
  Video as VideoIcon,
  Repeat,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProjectNode } from "@/lib/db/schema";
import { formatBytes } from "../../files-tab/folder/format";
import { cn } from "@/lib/utils";

interface MediaViewerDriverProps {
  node: ProjectNode;
  signedUrl: string;
  type: "video" | "audio";
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function MediaViewerDriver({
  node,
  signedUrl,
  type,
}: MediaViewerDriverProps): React.JSX.Element {
  const mediaRef = React.useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [volume, setVolume] = React.useState(1);
  const [isMuted, setIsMuted] = React.useState(false);
  const [speed, setSpeed] = React.useState(1);
  const [isLooping, setIsLooping] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [controlsVisible, setControlsVisible] = React.useState(true);

  const hideControlsTimer = React.useRef<NodeJS.Timeout | null>(null);

  const togglePlay = React.useCallback(() => {
    if (!mediaRef.current) return;
    if (mediaRef.current.paused) {
      mediaRef.current.play().catch(() => setError(true));
      setIsPlaying(true);
    } else {
      mediaRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  const seekRelative = React.useCallback((deltaSeconds: number) => {
    if (!mediaRef.current) return;
    mediaRef.current.currentTime = Math.max(
      0,
      Math.min(mediaRef.current.duration || 0, mediaRef.current.currentTime + deltaSeconds),
    );
  }, []);

  const toggleMute = React.useCallback(() => {
    if (!mediaRef.current) return;
    mediaRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  }, [isMuted]);

  const handleVolumeChange = React.useCallback((newVol: number) => {
    if (!mediaRef.current) return;
    mediaRef.current.volume = newVol;
    setVolume(newVol);
    setIsMuted(newVol === 0);
  }, []);

  const handleSpeedChange = React.useCallback((newSpeed: number) => {
    if (!mediaRef.current) return;
    mediaRef.current.playbackRate = newSpeed;
    setSpeed(newSpeed);
  }, []);

  const toggleFullscreen = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  // Keyboard accessibility
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        seekRelative(-5);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        seekRelative(5);
      } else if (e.code === "KeyM") {
        e.preventDefault();
        toggleMute();
      } else if (e.code === "KeyF" && type === "video") {
        e.preventDefault();
        toggleFullscreen();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [seekRelative, toggleFullscreen, toggleMute, togglePlay, type]);

  const onMouseMove = React.useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(() => {
      if (isPlaying) setControlsVisible(false);
    }, 2500);
  }, [isPlaying]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center bg-background">
        <AlertTriangle className="h-8 w-8 text-amber-500" />
        <p className="text-sm font-semibold text-foreground">
          Unable to play {type} preview
        </p>
        <p className="max-w-md text-xs text-muted-foreground">
          This browser may not support the audio/video codec used in this file.
        </p>
        <div className="flex items-center gap-2 pt-2">
          <Button asChild size="sm" variant="default">
            <a href={signedUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1.5 h-4 w-4" />
              Open in new tab
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={signedUrl} download={node.name}>
              <Download className="mr-1.5 h-4 w-4" />
              Download
            </a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onMouseMove={type === "video" ? onMouseMove : undefined}
      className={cn(
        "relative flex h-full w-full flex-col items-center justify-center overflow-hidden select-none",
        type === "video" ? "bg-black" : "bg-gradient-to-b from-muted/30 to-background p-6",
      )}
    >
      {type === "video" ? (
        /* Video Player */
        <>
          <video
            ref={mediaRef as React.RefObject<HTMLVideoElement>}
            src={signedUrl}
            loop={isLooping}
            onClick={togglePlay}
            onTimeUpdate={() => {
              if (mediaRef.current) setCurrentTime(mediaRef.current.currentTime);
            }}
            onLoadedMetadata={() => {
              if (mediaRef.current) setDuration(mediaRef.current.duration);
            }}
            onEnded={() => setIsPlaying(false)}
            onError={() => setError(true)}
            playsInline
            className="h-full w-full object-contain cursor-pointer"
          />

          {/* Overlay Video Controls */}
          <div
            className={cn(
              "absolute bottom-0 left-0 right-0 z-20 flex flex-col gap-2 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 transition-opacity duration-300",
              controlsVisible ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            {/* Scrubber Bar */}
            <div className="flex items-center gap-3">
              <span className="w-12 text-right font-mono text-[11px] text-zinc-300">
                {formatTime(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.1}
                value={currentTime}
                onChange={(e) => {
                  const targetTime = Number(e.target.value);
                  if (mediaRef.current) mediaRef.current.currentTime = targetTime;
                  setCurrentTime(targetTime);
                }}
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-lg bg-zinc-700 accent-primary"
              />
              <span className="w-12 font-mono text-[11px] text-zinc-400">
                {formatTime(duration)}
              </span>
            </div>

            {/* Bottom Buttons */}
            <div className="flex items-center justify-between text-white">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={togglePlay}
                  className="h-8 w-8 p-0 text-white hover:bg-white/20"
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => seekRelative(-5)}
                  className="h-8 w-8 p-0 text-white hover:bg-white/20"
                  title="Rewind 5s"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => seekRelative(5)}
                  className="h-8 w-8 p-0 text-white hover:bg-white/20"
                  title="Forward 5s"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                </Button>

                <div className="flex items-center gap-1.5 ml-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={toggleMute}
                    className="h-8 w-8 p-0 text-white hover:bg-white/20"
                  >
                    {isMuted || volume === 0 ? (
                      <VolumeX className="h-4 w-4" />
                    ) : (
                      <Volume2 className="h-4 w-4" />
                    )}
                  </Button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={(e) => handleVolumeChange(Number(e.target.value))}
                    className="w-16 h-1 cursor-pointer accent-white"
                  />
                </div>
              </div>

              <div className="flex items-center gap-1">
                {/* Speed Selector */}
                <select
                  value={speed}
                  onChange={(e) => handleSpeedChange(Number(e.target.value))}
                  className="h-7 rounded bg-black/40 px-1.5 text-xs text-zinc-300 border border-white/20"
                >
                  {SPEED_OPTIONS.map((s) => (
                    <option key={s} value={s} className="bg-zinc-900 text-white">
                      {s}x
                    </option>
                  ))}
                </select>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setIsLooping(!isLooping)}
                  className={cn(
                    "h-8 w-8 p-0 text-white hover:bg-white/20",
                    isLooping && "text-primary",
                  )}
                  title="Toggle loop"
                >
                  <Repeat className="h-3.5 w-3.5" />
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={toggleFullscreen}
                  className="h-8 w-8 p-0 text-white hover:bg-white/20"
                  title="Fullscreen (F)"
                >
                  {isFullscreen ? (
                    <Minimize className="h-4 w-4" />
                  ) : (
                    <Maximize className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </>
      ) : (
        /* Audio Player Card */
        <div className="flex w-full max-w-lg flex-col items-center rounded-2xl border border-border bg-card p-8 shadow-lg">
          <audio
            ref={mediaRef as React.RefObject<HTMLAudioElement>}
            src={signedUrl}
            loop={isLooping}
            onTimeUpdate={() => {
              if (mediaRef.current) setCurrentTime(mediaRef.current.currentTime);
            }}
            onLoadedMetadata={() => {
              if (mediaRef.current) setDuration(mediaRef.current.duration);
            }}
            onEnded={() => setIsPlaying(false)}
            onError={() => setError(true)}
          />

          {/* Animated Album Art / Wave Placeholder */}
          <div className="relative mb-6 flex h-32 w-32 items-center justify-center rounded-full bg-primary/10 border-2 border-primary/20 shadow-inner">
            <Music className={cn("h-12 w-12 text-primary", isPlaying && "animate-pulse")} />
            {isPlaying && (
              <span className="absolute -inset-1 rounded-full border border-primary/30 animate-ping opacity-25" />
            )}
          </div>

          <h3 className="max-w-xs truncate text-center text-sm font-semibold text-foreground">
            {node.name}
          </h3>
          <span className="mt-1 text-xs text-muted-foreground">{formatBytes(node.size)}</span>

          {/* Timeline Scrubber */}
          <div className="mt-6 flex w-full items-center gap-3">
            <span className="w-10 text-right font-mono text-[11px] text-muted-foreground">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={(e) => {
                const targetTime = Number(e.target.value);
                if (mediaRef.current) mediaRef.current.currentTime = targetTime;
                setCurrentTime(targetTime);
              }}
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
            />
            <span className="w-10 font-mono text-[11px] text-muted-foreground">
              {formatTime(duration)}
            </span>
          </div>

          {/* Audio Controls */}
          <div className="mt-6 flex w-full items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={toggleMute}
                className="h-8 w-8 p-0"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </Button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => handleVolumeChange(Number(e.target.value))}
                className="w-16 h-1 cursor-pointer accent-primary"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => seekRelative(-5)}
                className="h-8 w-8 p-0"
                title="Rewind 5s"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>

              <Button
                size="lg"
                variant="default"
                onClick={togglePlay}
                className="h-12 w-12 rounded-full p-0 shadow-md"
              >
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onClick={() => seekRelative(5)}
                className="h-8 w-8 p-0"
                title="Forward 5s"
              >
                <RotateCw className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex items-center gap-1.5">
              <select
                value={speed}
                onChange={(e) => handleSpeedChange(Number(e.target.value))}
                className="h-7 rounded bg-muted px-1.5 text-xs text-foreground border border-border"
              >
                {SPEED_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}x
                  </option>
                ))}
              </select>

              <Button
                size="sm"
                variant="ghost"
                onClick={() => setIsLooping(!isLooping)}
                className={cn("h-8 w-8 p-0", isLooping && "text-primary")}
                title="Toggle loop"
              >
                <Repeat className="h-4 w-4" />
              </Button>

              <Button asChild size="sm" variant="ghost" className="h-8 w-8 p-0">
                <a href={signedUrl} download={node.name} title="Download Audio">
                  <Download className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}
