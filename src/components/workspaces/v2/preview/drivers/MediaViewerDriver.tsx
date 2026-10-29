"use client";

import * as React from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Volume1,
  Maximize,
  Minimize,
  RotateCcw,
  RotateCw,
  Download,
  ExternalLink,
  AlertTriangle,
  Music,
  Repeat,
  PictureInPicture2,
  Copy,
  Check,
  HelpCircle,
  X,
  FileVideo,
  Camera,
  Scan,
  Sun,
  ChevronsLeft,
  ChevronsRight,
  Flag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkspaceNode } from "@/lib/db/schema";
import { formatBytes } from "../../files-tab/folder/format";
import { cn } from "@/lib/utils";

interface MediaViewerDriverProps {
  node: WorkspaceNode;
  signedUrl: string;
  type: "video" | "audio";
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const STORAGE_KEY_VOL = "nb_media_volume";
const STORAGE_KEY_MUTED = "nb_media_muted";
const STORAGE_KEY_ZOOM = "nb_video_zoom_mode";
const STORAGE_KEY_TIME_MODE = "nb_video_time_mode";

type ZoomMode = "fit" | "fill" | "native";
type TimeDisplayMode = "total" | "remaining" | "elapsed-total";

interface TimelineMarker {
  id: string;
  time: number;
  label: string;
}

interface AbLoopState {
  a: number | null;
  b: number | null;
  active: boolean;
}

export function MediaViewerDriver({
  node,
  signedUrl,
  type,
}: MediaViewerDriverProps): React.JSX.Element {
  const mediaRef = React.useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const progressBarRef = React.useRef<HTMLDivElement>(null);
  const isDraggingScrubberRef = React.useRef(false);

  // Initial persistent volume / mute
  const [volume, setVolume] = React.useState<number>(() => {
    if (typeof window === "undefined") return 1;
    const saved = localStorage.getItem(STORAGE_KEY_VOL);
    return saved !== null && !isNaN(Number(saved)) ? Number(saved) : 1;
  });
  const [isMuted, setIsMuted] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEY_MUTED) === "true";
  });

  // Zoom Mode (Fit / Fill / 1:1)
  const [zoomMode, setZoomMode] = React.useState<ZoomMode>(() => {
    if (typeof window === "undefined") return "fit";
    const saved = localStorage.getItem(STORAGE_KEY_ZOOM);
    return saved === "fill" || saved === "native" ? saved : "fit";
  });

  // Time Display Mode (Total / Remaining / Elapsed)
  const [timeDisplayMode, setTimeDisplayMode] = React.useState<TimeDisplayMode>(() => {
    if (typeof window === "undefined") return "total";
    const saved = localStorage.getItem(STORAGE_KEY_TIME_MODE);
    return saved === "remaining" || saved === "elapsed-total" ? saved : "total";
  });

  // Video Brightness (Touch & shortcut adjustable: 0.5 to 1.5, default 1)
  const [brightness, setBrightness] = React.useState<number>(1);

  // A-B Segment Looping
  const [abLoop, setAbLoop] = React.useState<AbLoopState>({
    a: null,
    b: null,
    active: false,
  });

  // Timeline Markers / Timestamp Flags
  const [markers, setMarkers] = React.useState<TimelineMarker[]>([]);

  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [bufferedPercent, setBufferedPercent] = React.useState(0);
  const [bufferedSegments, setBufferedSegments] = React.useState<{ startPercent: number; widthPercent: number }[]>([]);
  const [speed, setSpeed] = React.useState(1);
  const [isLooping, setIsLooping] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [isPipActive, setIsPipActive] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [controlsVisible, setControlsVisible] = React.useState(true);
  const [showShortcuts, setShowShortcuts] = React.useState(false);
  const [showShareMenu, setShowShareMenu] = React.useState(false);
  const [copiedLink, setCopiedLink] = React.useState(false);
  const [copiedTimestampLink, setCopiedTimestampLink] = React.useState(false);
  const [snapshotStatus, setSnapshotStatus] = React.useState<"idle" | "capturing" | "copied">("idle");
  const [resolution, setResolution] = React.useState<{ width: number; height: number } | null>(null);
  const [realWaveform, setRealWaveform] = React.useState<number[] | null>(null);

  // Extract true RMS audio waveform envelope from media audio track
  React.useEffect(() => {
    if (typeof window === "undefined" || !signedUrl) return;
    let active = true;

    async function extractRmsWaveform() {
      let audioCtx: AudioContext | null = null;
      try {
        const res = await fetch(signedUrl, { headers: { Range: "bytes=0-1048576" } });
        if (!res.ok && res.status !== 206) return;
        const arrayBuffer = await res.arrayBuffer();
        if (!active) return;

        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        audioCtx = new AudioCtx();
        const decoded = await audioCtx.decodeAudioData(arrayBuffer);
        if (!active) {
          return;
        }

        const channelData = decoded.getChannelData(0);
        const binCount = 48;
        const samplesPerBin = Math.floor(channelData.length / binCount);
        const bins: number[] = [];

        for (let i = 0; i < binCount; i++) {
          let sumSquares = 0;
          const start = i * samplesPerBin;
          const end = start + samplesPerBin;
          for (let j = start; j < end; j++) {
            const val = channelData[j] || 0;
            sumSquares += val * val;
          }
          const rms = Math.sqrt(sumSquares / Math.max(1, samplesPerBin));
          const normalized = Math.max(15, Math.min(95, Math.round(rms * 280)));
          bins.push(normalized);
        }

        if (active) {
          setRealWaveform(bins);
        }
      } catch {
        // Fall back gracefully to default waveform pattern
      } finally {
        audioCtx?.close().catch(() => {});
      }
    }

    void extractRmsWaveform();

    return () => {
      active = false;
    };
  }, [signedUrl]);

  // On-screen feedback for gestures and adjustments
  const [activeGestureToast, setActiveGestureToast] = React.useState<{
    icon: "brightness" | "volume" | "seek" | "loop";
    text: string;
  } | null>(null);
  const gestureToastTimer = React.useRef<NodeJS.Timeout | null>(null);

  // Ripple feedback for gestures
  const [rippleFeedback, setRippleFeedback] = React.useState<{
    type: "play" | "pause" | "seek-forward" | "seek-backward" | "step-forward" | "step-backward" | "jump-forward" | "jump-backward";
    key: number;
  } | null>(null);

  // Scrubber hover state
  const [hoverTime, setHoverTime] = React.useState<number | null>(null);
  const [hoverPercent, setHoverPercent] = React.useState<number | null>(null);

  const hideControlsTimer = React.useRef<NodeJS.Timeout | null>(null);
  const rippleTimer = React.useRef<NodeJS.Timeout | null>(null);

  const syncDuration = React.useCallback(
    (el: HTMLMediaElement | null) => {
      if (!el) return;
      if (isFinite(el.duration) && el.duration > 0) {
        setDuration(el.duration);
        return;
      }
      if (el.seekable && el.seekable.length > 0) {
        try {
          const end = el.seekable.end(el.seekable.length - 1);
          if (isFinite(end) && end > 0) {
            setDuration(end);
            return;
          }
        } catch {}
      }
      if (el.buffered && el.buffered.length > 0) {
        try {
          const end = el.buffered.end(el.buffered.length - 1);
          if (isFinite(end) && end > 0) {
            setDuration(end);
          }
        } catch {}
      }
    },
    [],
  );

  // Robust effective duration derived from duration state
  const effectiveDuration = isFinite(duration) && duration > 0 ? duration : 0;

  // Hardware Video Decoder Lifecycle & Decoder Sync
  React.useEffect(() => {
    setError(false);
    setCurrentTime(0);
    setDuration(0);
    setBufferedPercent(0);
    setBufferedSegments([]);
    const el = mediaRef.current;
    if (el) {
      // Guard against React StrictMode DOM node mutation: ensure src is attached and loaded
      if (signedUrl && (!el.getAttribute("src") || el.getAttribute("src") !== signedUrl)) {
        el.setAttribute("src", signedUrl);
        el.load();
      }
      syncDuration(el);
    }
    return () => {
      if (el) {
        el.pause();
      }
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
      if (gestureToastTimer.current) clearTimeout(gestureToastTimer.current);
      if (rippleTimer.current) clearTimeout(rippleTimer.current);
      if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
    };
  }, [signedUrl, syncDuration]);

  // Hardware Video Decoder Cleanup Destructor: flush GPU VRAM and release hardware decode contexts on true unmount
  React.useEffect(() => {
    return () => {
      const el = mediaRef.current;
      if (el) {
        el.pause();
        el.removeAttribute("src"); // Abort background range streams immediately
        el.load(); // Force GPU process to reclaim hardware video decoder context
      }
    };
  }, []);

  // Background tab decoding suspension via Visibility API
  React.useEffect(() => {
    const wasPlayingRef = { current: false };
    const handleVisibilityChange = () => {
      const el = mediaRef.current;
      if (!el || type !== "video") return;

      if (document.hidden) {
        if (!el.paused) {
          wasPlayingRef.current = true;
          el.pause();
          setIsPlaying(false);
        }
      } else if (wasPlayingRef.current) {
        wasPlayingRef.current = false;
        el.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [type]);

  // Handle URL deep linking (#t=00:08 or ?t=8)
  React.useEffect(() => {
    const parseHashTimestamp = () => {
      if (typeof window === "undefined") return;
      const hash = window.location.hash;
      const match = hash.match(/#t=([\d.]+)/) || window.location.search.match(/[?&]t=([\d.]+)/);
      if (match && match[1]) {
        const sec = parseFloat(match[1]);
        if (!isNaN(sec) && isFinite(sec) && mediaRef.current) {
          mediaRef.current.currentTime = sec;
          setCurrentTime(sec);
        }
      }
    };

    parseHashTimestamp();
    window.addEventListener("hashchange", parseHashTimestamp);
    return () => window.removeEventListener("hashchange", parseHashTimestamp);
  }, []);

  // Update buffer progress with multi-segment buffer support
  const updateBuffer = React.useCallback(() => {
    const el = mediaRef.current;
    if (!el || el.buffered.length === 0) return;
    const dur = isFinite(duration) && duration > 0 ? duration : (isFinite(el.duration) && el.duration > 0 ? el.duration : 0);
    if (!dur || dur <= 0) return;
    try {
      const end = el.buffered.end(el.buffered.length - 1);
      setBufferedPercent(Math.min(100, Math.max(0, (end / dur) * 100)));

      const segments: { startPercent: number; widthPercent: number }[] = [];
      for (let i = 0; i < el.buffered.length; i++) {
        const segStart = Math.max(0, el.buffered.start(i));
        const segEnd = Math.min(dur, el.buffered.end(i));
        if (segEnd > segStart) {
          segments.push({
            startPercent: (segStart / dur) * 100,
            widthPercent: ((segEnd - segStart) / dur) * 100,
          });
        }
      }
      setBufferedSegments(segments);
    } catch {}
  }, [duration]);

  const triggerToast = React.useCallback((icon: "brightness" | "volume" | "seek" | "loop", text: string) => {
    setActiveGestureToast({ icon, text });
    if (gestureToastTimer.current) clearTimeout(gestureToastTimer.current);
    gestureToastTimer.current = setTimeout(() => {
      setActiveGestureToast(null);
    }, 1200);
  }, []);

  const triggerRipple = React.useCallback(
    (action: "play" | "pause" | "seek-forward" | "seek-backward" | "step-forward" | "step-backward" | "jump-forward" | "jump-backward") => {
      setRippleFeedback({ type: action, key: Date.now() });
      if (rippleTimer.current) clearTimeout(rippleTimer.current);
      rippleTimer.current = setTimeout(() => {
        setRippleFeedback(null);
      }, 650);
    },
    [],
  );

  const togglePlay = React.useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) {
      const playPromise = el.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setIsPlaying(true);
          })
          .catch((err) => {
            // AbortError and NotAllowedError are standard transient states, not codec errors
            console.debug("Playback paused or prevented:", err);
            setIsPlaying(false);
          });
      }
      triggerRipple("play");
    } else {
      el.pause();
      setIsPlaying(false);
      triggerRipple("pause");
    }
  }, [triggerRipple]);

  const seekRelative = React.useCallback(
    (deltaSeconds: number) => {
      if (!mediaRef.current) return;
      const cur = mediaRef.current.currentTime || 0;
      const dur = mediaRef.current.duration || 0;
      const next = Math.max(0, Math.min(dur, cur + deltaSeconds));
      mediaRef.current.currentTime = next;
      setCurrentTime(next);
      triggerRipple(deltaSeconds > 0 ? "seek-forward" : "seek-backward");
    },
    [triggerRipple],
  );

  // Precision Frame Stepping
  const stepFrame = React.useCallback(
    (direction: 1 | -1) => {
      const el = mediaRef.current;
      if (!el) return;
      if (!el.paused) {
        el.pause();
        setIsPlaying(false);
      }
      const frameDuration = 1 / 30; // standard 30fps step (~33ms)
      const next = Math.max(0, Math.min(el.duration || 0, el.currentTime + direction * frameDuration));
      el.currentTime = next;
      setCurrentTime(next);
      triggerRipple(direction > 0 ? "step-forward" : "step-backward");
    },
    [triggerRipple],
  );

  // Instant Frame Snapshot Capture (Display P3 Wide Gamut & Safari-Safe Synchronous Gesture)
  const captureFrame = React.useCallback(async () => {
    const video = mediaRef.current;
    if (!video || !(video instanceof HTMLVideoElement) || !video.videoWidth) return;
    try {
      setSnapshotStatus("capturing");
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d", { colorSpace: "display-p3" });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Safari-safe: pass blob promise directly into ClipboardItem synchronously within user gesture
      const blobPromise = new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Frame snapshot blob failed"));
        }, "image/png");
      });

      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blobPromise })]);
          setSnapshotStatus("copied");
          setTimeout(() => setSnapshotStatus("idle"), 2200);
          return;
        } catch {
          // Fall through to download if clipboard write is disallowed
        }
      }

      const blob = await blobPromise;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const timeTag = formatTime(video.currentTime).replace(":", "-");
      a.download = `${node.name.replace(/\.[^/.]+$/, "")}-frame-${timeTag}.png`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSnapshotStatus("copied");
      setTimeout(() => setSnapshotStatus("idle"), 2200);
    } catch (err) {
      console.warn("Failed to capture snapshot:", err);
      setSnapshotStatus("idle");
    }
  }, [node.name]);

  // Zoom Mode Toggle (Fit / Fill / 1:1)
  const cycleZoomMode = React.useCallback(() => {
    setZoomMode((prev) => {
      const next: ZoomMode = prev === "fit" ? "fill" : prev === "fill" ? "native" : "fit";
      try {
        localStorage.setItem(STORAGE_KEY_ZOOM, next);
      } catch {}
      return next;
    });
  }, []);

  // Time Display Mode Toggle
  const cycleTimeDisplayMode = React.useCallback(() => {
    setTimeDisplayMode((prev) => {
      const next: TimeDisplayMode = prev === "total" ? "remaining" : prev === "remaining" ? "elapsed-total" : "total";
      try {
        localStorage.setItem(STORAGE_KEY_TIME_MODE, next);
      } catch {}
      return next;
    });
  }, []);

  // A-B Segment Looping logic
  const handleSetPointA = React.useCallback(() => {
    const cur = mediaRef.current?.currentTime ?? 0;
    setAbLoop((prev) => {
      const next = { ...prev, a: cur, active: prev.b !== null && cur < prev.b };
      triggerToast("loop", `Point A set to ${formatTime(cur)}`);
      return next;
    });
  }, [triggerToast]);

  const handleSetPointB = React.useCallback(() => {
    const cur = mediaRef.current?.currentTime ?? 0;
    setAbLoop((prev) => {
      const next = { ...prev, b: cur, active: prev.a !== null && prev.a < cur };
      triggerToast("loop", `Point B set to ${formatTime(cur)}`);
      return next;
    });
  }, [triggerToast]);

  const handleClearAbLoop = React.useCallback(() => {
    setAbLoop({ a: null, b: null, active: false });
    triggerToast("loop", "A-B Loop cleared");
  }, [triggerToast]);

  const cycleAbLoop = React.useCallback(() => {
    if (abLoop.a === null) {
      handleSetPointA();
    } else if (abLoop.b === null) {
      handleSetPointB();
    } else {
      handleClearAbLoop();
    }
  }, [abLoop.a, abLoop.b, handleClearAbLoop, handleSetPointA, handleSetPointB]);

  // Timeline Marker Pin Drop
  // Timeline Marker Pin Drop / Remove Toggle
  const handleDropMarker = React.useCallback(() => {
    const cur = mediaRef.current?.currentTime ?? 0;
    const existing = markers.find((m) => Math.abs(m.time - cur) < 0.8);
    if (existing) {
      setMarkers((prev) => prev.filter((m) => m.id !== existing.id));
      triggerToast("seek", `Flag removed at ${formatTime(cur)}`);
      return;
    }
    const newMarker: TimelineMarker = {
      id: `marker-${Date.now()}`,
      time: cur,
      label: `Flag at ${formatTime(cur)}`,
    };
    setMarkers((prev) => [...prev, newMarker]);
    triggerToast("seek", `Flag added at ${formatTime(cur)}`);
  }, [markers, triggerToast]);

  const handleRemoveMarker = React.useCallback(
    (id: string, time: number) => {
      setMarkers((prev) => prev.filter((m) => m.id !== id));
      triggerToast("seek", `Flag removed at ${formatTime(time)}`);
    },
    [triggerToast],
  );

  const isCurrentTimeFlagged = React.useMemo(() => {
    return markers.some((m) => Math.abs(m.time - currentTime) < 0.8);
  }, [markers, currentTime]);

  const toggleMute = React.useCallback(() => {
    if (!mediaRef.current) return;
    const nextMuted = !isMuted;
    mediaRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
    try {
      localStorage.setItem(STORAGE_KEY_MUTED, String(nextMuted));
    } catch {}
  }, [isMuted]);

  const handleVolumeChange = React.useCallback((newVol: number) => {
    if (!mediaRef.current) return;
    const clamped = Math.max(0, Math.min(1, newVol));
    mediaRef.current.volume = clamped;
    mediaRef.current.muted = clamped === 0;
    setVolume(clamped);
    setIsMuted(clamped === 0);
    try {
      localStorage.setItem(STORAGE_KEY_VOL, String(clamped));
      localStorage.setItem(STORAGE_KEY_MUTED, String(clamped === 0));
    } catch {}
  }, []);

  const handleSpeedChange = React.useCallback((newSpeed: number) => {
    if (!mediaRef.current) return;
    mediaRef.current.playbackRate = newSpeed;
    // Hardware pitch preservation
    mediaRef.current.preservesPitch = true;
    (mediaRef.current as unknown as { webkitPreservesPitch: boolean }).webkitPreservesPitch = true;
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

  const togglePip = React.useCallback(async () => {
    if (!mediaRef.current || !(mediaRef.current instanceof HTMLVideoElement)) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPipActive(false);
      } else {
        await mediaRef.current.requestPictureInPicture();
        setIsPipActive(true);
      }
    } catch (err) {
      console.warn("PiP toggle error:", err);
    }
  }, []);

  const handleCopyLink = React.useCallback(() => {
    navigator.clipboard.writeText(signedUrl).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }).catch(() => {});
  }, [signedUrl]);

  const handleCopyTimestampLink = React.useCallback(() => {
    if (typeof window === "undefined") return;
    const curSec = Math.floor(mediaRef.current?.currentTime ?? 0);
    const url = new URL(window.location.href);
    url.hash = `t=${curSec}`;
    navigator.clipboard.writeText(url.toString()).then(() => {
      setCopiedTimestampLink(true);
      setTimeout(() => setCopiedTimestampLink(false), 2000);
      setShowShareMenu(false);
    }).catch(() => {});
  }, []);

  // Fullscreen change listener
  React.useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  // PiP events
  React.useEffect(() => {
    const v = mediaRef.current;
    if (!v || !(v instanceof HTMLVideoElement)) return;
    const onEnterPip = () => setIsPipActive(true);
    const onLeavePip = () => setIsPipActive(false);
    v.addEventListener("enterpictureinpicture", onEnterPip);
    v.addEventListener("leavepictureinpicture", onLeavePip);
    return () => {
      v.removeEventListener("enterpictureinpicture", onEnterPip);
      v.removeEventListener("leavepictureinpicture", onLeavePip);
    };
  }, []);

  // Keyboard accessibility
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)
      ) {
        return;
      }

      if (e.code === "Space" || e.code === "KeyK") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowLeft" || e.code === "KeyJ") {
        e.preventDefault();
        seekRelative(-5);
      } else if (e.code === "ArrowRight" || e.code === "KeyL") {
        e.preventDefault();
        seekRelative(5);
      } else if (e.code === "Comma" && type === "video") {
        e.preventDefault();
        stepFrame(-1);
      } else if (e.code === "Period" && type === "video") {
        e.preventDefault();
        stepFrame(1);
      } else if (e.code === "BracketLeft" && type === "video") {
        e.preventDefault();
        handleSetPointA();
      } else if (e.code === "BracketRight" && type === "video") {
        e.preventDefault();
        handleSetPointB();
      } else if (e.code === "Backspace" && type === "video") {
        if (abLoop.active || abLoop.a !== null) {
          e.preventDefault();
          handleClearAbLoop();
        }
      } else if (e.code === "KeyC" && type === "video") {
        e.preventDefault();
        handleDropMarker();
      } else if (e.code === "KeyS" && type === "video") {
        e.preventDefault();
        void captureFrame();
      } else if (e.code === "KeyZ" && type === "video") {
        e.preventDefault();
        cycleZoomMode();
      } else if (e.code === "ArrowUp") {
        e.preventDefault();
        handleVolumeChange((mediaRef.current?.volume ?? volume) + 0.05);
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        handleVolumeChange((mediaRef.current?.volume ?? volume) - 0.05);
      } else if (e.code === "KeyM") {
        e.preventDefault();
        toggleMute();
      } else if (e.code === "KeyF" && type === "video") {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.code === "KeyP" && type === "video") {
        e.preventDefault();
        void togglePip();
      } else if (e.code === "Slash" && e.shiftKey) {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    abLoop.a,
    abLoop.active,
    captureFrame,
    cycleZoomMode,
    handleClearAbLoop,
    handleDropMarker,
    handleSetPointA,
    handleSetPointB,
    handleVolumeChange,
    seekRelative,
    stepFrame,
    toggleFullscreen,
    toggleMute,
    togglePip,
    togglePlay,
    type,
    volume,
  ]);

  const onMouseMove = React.useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(() => {
      if (isPlaying) setControlsVisible(false);
    }, 2800);
  }, [isPlaying]);

  // Touch gesture state for dual-zone brightness/volume & precision scrub
  const touchState = React.useRef<{
    startX: number;
    startY: number;
    startTime: number;
    initialVol: number;
    initialBrightness: number;
    initialTime: number;
    mode: "none" | "brightness" | "volume" | "scrub";
  }>({
    startX: 0,
    startY: 0,
    startTime: 0,
    initialVol: 1,
    initialBrightness: 1,
    initialTime: 0,
    mode: "none",
  });

  const lastTapRef = React.useRef<{ time: number; x: number }>({ time: 0, x: 0 });

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-media-controls]")) return;
    const touch = e.touches[0];
    if (!touch) return;
    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const xRel = touch.clientX - rect.left;

    // Double-tap detection for 10s seek jump
    if (now - lastTapRef.current.time < 280) {
      if (xRel < rect.width * 0.4) {
        seekRelative(-10);
        triggerRipple("jump-backward");
      } else if (xRel > rect.width * 0.6) {
        seekRelative(10);
        triggerRipple("jump-forward");
      } else {
        toggleFullscreen();
      }
      lastTapRef.current = { time: 0, x: 0 };
      return;
    }
    lastTapRef.current = { time: now, x: touch.clientX };

    touchState.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: now,
      initialVol: volume,
      initialBrightness: brightness,
      initialTime: mediaRef.current?.currentTime ?? 0,
      mode: "none",
    };
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-media-controls]")) return;
    const touch = e.touches[0];
    if (!touch) return;
    const deltaX = touch.clientX - touchState.current.startX;
    const deltaY = touch.clientY - touchState.current.startY;
    const rect = e.currentTarget.getBoundingClientRect();

    if (touchState.current.mode === "none") {
      if (Math.abs(deltaX) > 15 && Math.abs(deltaX) > Math.abs(deltaY)) {
        touchState.current.mode = "scrub";
      } else if (Math.abs(deltaY) > 15) {
        touchState.current.mode = touchState.current.startX < rect.left + rect.width * 0.5 ? "brightness" : "volume";
      }
    }

    if (touchState.current.mode === "brightness") {
      const deltaB = -deltaY / 150;
      const nextB = Math.max(0.5, Math.min(1.5, touchState.current.initialBrightness + deltaB));
      setBrightness(nextB);
      triggerToast("brightness", `Brightness: ${Math.round(nextB * 100)}%`);
    } else if (touchState.current.mode === "volume") {
      const deltaV = -deltaY / 150;
      const nextV = Math.max(0, Math.min(1, touchState.current.initialVol + deltaV));
      handleVolumeChange(nextV);
      triggerToast("volume", `Volume: ${Math.round(nextV * 100)}%`);
    } else if (touchState.current.mode === "scrub" && effectiveDuration > 0 && mediaRef.current) {
      const deltaSec = (deltaX / rect.width) * effectiveDuration * 0.5;
      const nextTime = Math.max(0, Math.min(effectiveDuration, touchState.current.initialTime + deltaSec));
      mediaRef.current.currentTime = nextTime;
      setCurrentTime(nextTime);
      triggerToast("seek", `${formatTime(nextTime)} / ${formatTime(effectiveDuration)}`);
    }
  };

  const handleTouchEnd = () => {
    touchState.current.mode = "none";
  };

  // Click & Double-click handling for video canvas
  const clickTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const handleVideoCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-media-controls]")) return;

    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;

      const rect = e.currentTarget.getBoundingClientRect();
      const xPercent = (e.clientX - rect.left) / rect.width;

      if (xPercent < 0.3) {
        seekRelative(-5);
      } else if (xPercent > 0.7) {
        seekRelative(5);
      } else {
        toggleFullscreen();
      }
    } else {
      clickTimeoutRef.current = setTimeout(() => {
        clickTimeoutRef.current = null;
        togglePlay();
      }, 220);
    }
  };

  // Scrubber interactive seek & drag with fastSeek keyframe support
  const seekAtClientX = React.useCallback(
    (clientX: number, isFinal: boolean = true) => {
      const el = mediaRef.current;
      if (!progressBarRef.current || !el || effectiveDuration <= 0) return;
      const rect = progressBarRef.current.getBoundingClientRect();
      const clickX = clientX - rect.left;
      const percent = Math.max(0, Math.min(1, clickX / rect.width));
      const target = percent * effectiveDuration;

      if (!isFinal && "fastSeek" in el && typeof (el as unknown as { fastSeek: (t: number) => void }).fastSeek === "function") {
        (el as unknown as { fastSeek: (t: number) => void }).fastSeek(target);
      } else {
        el.currentTime = target;
      }
      setCurrentTime(target);
    },
    [effectiveDuration],
  );

  const handleScrubberMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    isDraggingScrubberRef.current = true;
    seekAtClientX(e.clientX, false);

    let pendingClientX: number | null = null;
    let rafSeekId: number | null = null;

    const onMouseMoveDoc = (me: MouseEvent) => {
      if (!isDraggingScrubberRef.current) return;
      pendingClientX = me.clientX;
      if (!rafSeekId) {
        rafSeekId = requestAnimationFrame(() => {
          rafSeekId = null;
          if (pendingClientX !== null) {
            seekAtClientX(pendingClientX, false);
          }
        });
      }
    };

    const onMouseUpDoc = (me: MouseEvent) => {
      isDraggingScrubberRef.current = false;
      if (rafSeekId) {
        cancelAnimationFrame(rafSeekId);
        rafSeekId = null;
      }
      seekAtClientX(me.clientX, true);
      window.removeEventListener("mousemove", onMouseMoveDoc);
      window.removeEventListener("mouseup", onMouseUpDoc);
    };

    window.addEventListener("mousemove", onMouseMoveDoc);
    window.addEventListener("mouseup", onMouseUpDoc);
  };

  const handleScrubberMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || effectiveDuration <= 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, clickX / rect.width));
    setHoverPercent(percent * 100);
    setHoverTime(percent * effectiveDuration);
  };

  const handleScrubberMouseLeave = () => {
    setHoverPercent(null);
    setHoverTime(null);
  };

  const isMovFile = node.name.toLowerCase().endsWith(".mov");

  // Error State with Codec Diagnostics and Fallback Actions
  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center bg-background">
        <div className="flex h-14 w-14 items-center justify-center rounded-[12px] bg-amber-500/10 text-amber-500 border border-amber-500/20">
          <AlertTriangle className="h-7 w-7" />
        </div>
        <div className="space-y-1.5 max-w-md">
          <p className="text-base font-semibold text-foreground">
            {isMovFile ? "QuickTime (.mov) Codec Not Supported in Browser" : "Couldn’t play media stream"}
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {isMovFile
              ? "This QuickTime (.mov) file likely uses Apple ProRes, HEVC, or an uncompressed format that Chromium cannot decode inline. Apple Safari supports most QuickTime codecs natively, or you can open it in QuickTime Player / VLC."
              : "Your browser does not have the required codec to decode this media file inline."}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
          <Button asChild size="sm" className="h-9 px-4 rounded-[6px] bg-[#D14E24] hover:bg-[#B23F1C] text-white">
            <a href={signedUrl} download={node.name}>
              <Download className="mr-1.5 h-4 w-4" />
              Download {node.name}
            </a>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setError(false);
              const el = mediaRef.current;
              if (el) {
                el.load();
                el.play().catch(() => {});
              }
            }}
            className="h-9 px-4 rounded-[6px]"
          >
            <RotateCcw className="mr-1.5 h-4 w-4" />
            Retry playback
          </Button>
          <Button asChild size="sm" variant="outline" className="h-9 px-4 rounded-[6px]">
            <a href={signedUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1.5 h-4 w-4" />
              Open in new tab
            </a>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCopyLink}
            className="h-9 px-3 rounded-[6px]"
          >
            {copiedLink ? <Check className="mr-1.5 h-4 w-4 text-emerald-500" /> : <Copy className="mr-1.5 h-4 w-4" />}
            {copiedLink ? "Link copied" : "Copy link"}
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
        type === "video" && !controlsVisible && isPlaying && "cursor-none",
      )}
    >
      {type === "video" ? (
        <>
          {/* Main Video Element with click & touch interaction */}
          <div
            className="relative h-full w-full flex items-center justify-center cursor-pointer overflow-hidden"
            onClick={handleVideoCanvasClick}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <video
              ref={mediaRef as React.RefObject<HTMLVideoElement>}
              src={signedUrl}
              loop={isLooping && !abLoop.active}
              preload="auto"
              playsInline
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onTimeUpdate={() => {
                const el = mediaRef.current;
                if (el) {
                  const cur = el.currentTime;
                  // Handle active A-B segment loop
                  if (abLoop.active && abLoop.a !== null && abLoop.b !== null) {
                    if (cur >= abLoop.b || cur < abLoop.a) {
                      el.currentTime = abLoop.a;
                      setCurrentTime(abLoop.a);
                      return;
                    }
                  }
                  setCurrentTime(cur);
                  if (!duration || !isFinite(duration) || duration <= 0) {
                    syncDuration(el);
                  }
                  updateBuffer();
                }
              }}
              onDurationChange={() => syncDuration(mediaRef.current)}
              onCanPlay={() => syncDuration(mediaRef.current)}
              onProgress={() => {
                syncDuration(mediaRef.current);
                updateBuffer();
              }}
              onLoadedMetadata={() => {
                const el = mediaRef.current as HTMLVideoElement | null;
                if (el) {
                  syncDuration(el);
                  el.volume = volume;
                  el.muted = isMuted;
                  el.preservesPitch = true;
                  (el as unknown as { webkitPreservesPitch: boolean }).webkitPreservesPitch = true;
                  if (el.videoWidth && el.videoHeight) {
                    setResolution({ width: el.videoWidth, height: el.videoHeight });
                  }
                }
              }}
              onEnded={() => {
                setIsPlaying(false);
                const el = mediaRef.current;
                if (el && isFinite(el.duration) && el.duration > 0) {
                  setDuration(el.duration);
                }
              }}
              onError={(e) => {
                const target = e.currentTarget;
                if (!target.src || !target.error) return;
                // Ignore transient code 1 (MEDIA_ERR_ABORTED) and code 2 (MEDIA_ERR_NETWORK) from browser reload
                if (target.error.code === 1 || target.error.code === 2) {
                  return;
                }
                // Only persistent decode (code 3) or format unsupported (code 4) errors trigger fallback
                if (target.error.code === 3 || target.error.code === 4) {
                  setError(true);
                }
              }}
              className={cn(
                "transition-all duration-200",
                zoomMode === "fit" && "h-full w-full object-contain",
                zoomMode === "fill" && "h-full w-full object-cover",
                zoomMode === "native" && "max-h-none max-w-none object-none",
              )}
              style={{
                filter: brightness !== 1 ? `brightness(${brightness})` : undefined,
                ...(zoomMode === "native" && resolution
                  ? { width: `${resolution.width}px`, height: `${resolution.height}px` }
                  : {}),
              }}
            />

            {/* Floating Gesture Status Pill (Brightness, Volume, Touch Scrub) */}
            {activeGestureToast && (
              <div className="pointer-events-none absolute top-16 z-30 flex items-center justify-center">
                <div className="flex items-center gap-2 rounded-[8px] border border-white/20 bg-black/80 backdrop-blur-md px-3.5 py-1.5 text-xs font-semibold text-white shadow-xl animate-in fade-in zoom-in-95 duration-150">
                  {activeGestureToast.icon === "brightness" && <Sun className="h-4 w-4 text-amber-400" />}
                  {activeGestureToast.icon === "volume" && <Volume1 className="h-4 w-4 text-primary" />}
                  {activeGestureToast.icon === "seek" && <RotateCw className="h-4 w-4 text-white" />}
                  {activeGestureToast.icon === "loop" && <Repeat className="h-4 w-4 text-[#D14E24]" />}
                  <span>{activeGestureToast.text}</span>
                </div>
              </div>
            )}

            {/* Gesture Ripple Animations */}
            {rippleFeedback && (
              <div
                key={rippleFeedback.key}
                className="pointer-events-none absolute flex items-center justify-center z-20"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-[12px] bg-black/70 backdrop-blur-md text-white border border-white/20 animate-in fade-in zoom-in-75 duration-200">
                  {rippleFeedback.type === "play" && <Play className="h-8 w-8 ml-1 text-white fill-white" />}
                  {rippleFeedback.type === "pause" && <Pause className="h-8 w-8 text-white fill-white" />}
                  {rippleFeedback.type === "seek-backward" && (
                    <div className="flex flex-col items-center">
                      <RotateCcw className="h-6 w-6 text-white" />
                      <span className="text-[10px] font-mono mt-0.5">-5s</span>
                    </div>
                  )}
                  {rippleFeedback.type === "seek-forward" && (
                    <div className="flex flex-col items-center">
                      <RotateCw className="h-6 w-6 text-white" />
                      <span className="text-[10px] font-mono mt-0.5">+5s</span>
                    </div>
                  )}
                  {rippleFeedback.type === "jump-backward" && (
                    <div className="flex flex-col items-center">
                      <ChevronsLeft className="h-6 w-6 text-white" />
                      <span className="text-[10px] font-mono mt-0.5">-10s</span>
                    </div>
                  )}
                  {rippleFeedback.type === "jump-forward" && (
                    <div className="flex flex-col items-center">
                      <ChevronsRight className="h-6 w-6 text-white" />
                      <span className="text-[10px] font-mono mt-0.5">+10s</span>
                    </div>
                  )}
                  {rippleFeedback.type === "step-backward" && (
                    <div className="flex flex-col items-center">
                      <RotateCcw className="h-5 w-5 text-white" />
                      <span className="text-[10px] font-mono mt-0.5">-1f</span>
                    </div>
                  )}
                  {rippleFeedback.type === "step-forward" && (
                    <div className="flex flex-col items-center">
                      <RotateCw className="h-5 w-5 text-white" />
                      <span className="text-[10px] font-mono mt-0.5">+1f</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Top Floating Header Overlay */}
          <div
            data-media-controls="true"
            onMouseEnter={() => {
              if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
              setControlsVisible(true);
            }}
            className={cn(
              "absolute top-4 left-4 right-4 md:left-6 md:right-6 z-30 flex items-center justify-between transition-opacity duration-300 pointer-events-auto",
              controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none",
            )}
          >
            {/* Left: File info pill */}
            <div className="flex items-center gap-2 rounded-[8px] bg-black/60 backdrop-blur-md border border-white/10 px-3 py-1.5 shadow-lg max-w-[70%]">
              <FileVideo className="h-4 w-4 text-[#D14E24] shrink-0" />
              <span className="text-xs font-semibold text-white truncate max-w-[220px]">
                {node.name}
              </span>
              <div className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono text-white/60 pl-1 border-l border-white/10">
                {resolution && <span>{resolution.width}×{resolution.height}</span>}
                {formatBytes(node.size) && <span>• {formatBytes(node.size)}</span>}
              </div>
            </div>

            {/* Right: Quick Actions */}
            <div className="flex items-center gap-1.5 rounded-[8px] bg-black/60 backdrop-blur-md border border-white/10 p-1 shadow-lg relative">
              {/* Zoom Mode Toggle */}
              <Button
                size="sm"
                variant="ghost"
                onClick={cycleZoomMode}
                className="h-7 px-2 text-xs text-white/80 hover:text-white hover:bg-white/10 rounded-[6px]"
                title={`View Mode: ${zoomMode === "fit" ? "Fit (Aspect Ratio)" : zoomMode === "fill" ? "Fill viewport" : "1:1 Native Resolution"} (Z)`}
              >
                <Scan className="h-3.5 w-3.5 mr-1" />
                <span className="capitalize">{zoomMode === "native" ? "1:1" : zoomMode}</span>
              </Button>

              {/* Frame Snapshot Button */}
              <Button
                size="sm"
                variant="ghost"
                onClick={captureFrame}
                disabled={snapshotStatus === "capturing"}
                className="h-7 px-2 text-xs text-white/80 hover:text-white hover:bg-white/10 rounded-[6px]"
                title="Capture Frame to Clipboard / File (S)"
              >
                {snapshotStatus === "copied" ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400 mr-1" />
                ) : (
                  <Camera className="h-3.5 w-3.5 mr-1" />
                )}
                {snapshotStatus === "copied" ? "Copied" : "Snapshot"}
              </Button>

              {/* Timestamp Flag / Marker Drop & Remove Toggle */}
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDropMarker}
                className={cn(
                  "h-7 px-2 text-xs rounded-[6px] transition-colors",
                  isCurrentTimeFlagged
                    ? "text-amber-400 bg-amber-400/20 border border-amber-400/30 hover:bg-amber-400/30"
                    : "text-white/80 hover:text-white hover:bg-white/10",
                )}
                title={isCurrentTimeFlagged ? "Remove Flag at Current Time (C)" : "Drop Timestamp Flag (C)"}
              >
                <Flag className={cn("h-3.5 w-3.5 mr-1", isCurrentTimeFlagged ? "text-amber-400 fill-amber-400" : "text-[#D14E24]")} />
                {isCurrentTimeFlagged ? "Remove flag" : "Flag"}
              </Button>

              {/* Share / Copy Menu */}
              <div className="relative">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowShareMenu((prev) => !prev)}
                  className="h-7 px-2 text-xs text-white/80 hover:text-white hover:bg-white/10 rounded-[6px]"
                  title="Share"
                >
                  <Copy className="h-3.5 w-3.5 mr-1" />
                  Share
                </Button>

                {showShareMenu && (
                  <div className="absolute right-0 top-8 z-50 w-52 rounded-[8px] border border-white/20 bg-black/95 p-1 shadow-2xl text-xs backdrop-blur-md">
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="w-full flex items-center justify-between rounded-[4px] px-2.5 py-1.5 text-left text-white/90 hover:bg-white/15"
                    >
                      <span>Copy direct link</span>
                      {copiedLink ? <Check className="h-3 w-3 text-emerald-400" /> : null}
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyTimestampLink}
                      className="w-full flex items-center justify-between rounded-[4px] px-2.5 py-1.5 text-left text-white/90 hover:bg-white/15"
                    >
                      <span>Copy link at {formatTime(currentTime)}</span>
                      {copiedTimestampLink ? <Check className="h-3 w-3 text-emerald-400" /> : null}
                    </button>
                  </div>
                )}
              </div>

              {/* Download */}
              <Button
                asChild
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-white/80 hover:text-white hover:bg-white/10 rounded-[6px]"
              >
                <a href={signedUrl} download={node.name} title="Download video">
                  <Download className="h-3.5 w-3.5 mr-1" />
                  Download
                </a>
              </Button>

              {/* Help */}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowShortcuts((s) => !s)}
                className="h-7 w-7 p-0 text-white/80 hover:text-white hover:bg-white/10 rounded-[6px]"
                title="Keyboard Shortcuts (?)"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Floating Video Controls Pill (Safe-Guttered away from bottom-right floating widget) */}
          <div
            data-media-controls="true"
            onMouseEnter={() => {
              if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
              setControlsVisible(true);
            }}
            className={cn(
              "absolute bottom-6 left-4 right-4 md:left-8 md:right-24 max-w-4xl mx-auto z-30 transition-all duration-300",
              controlsVisible ? "opacity-100 translate-y-0" : "opacity-0 pointer-events-none translate-y-2",
            )}
          >
            <div className="flex flex-col gap-2 rounded-[12px] border border-white/15 bg-black/80 backdrop-blur-md p-3.5 shadow-2xl">
              {/* Scrubber Bar with Buffered track, Waveform mock, A-B Loop highlight, Markers & Hover tooltip */}
              <div className="flex items-center gap-3">
                <span className="w-12 text-right font-mono text-[11px] text-white/70">
                  {formatTime(currentTime)}
                </span>

                <div
                  ref={progressBarRef}
                  onMouseDown={handleScrubberMouseDown}
                  onMouseMove={handleScrubberMouseMove}
                  onMouseLeave={handleScrubberMouseLeave}
                  className="group/scrubber relative h-2 hover:h-3 flex-1 cursor-pointer rounded-[4px] bg-white/20 transition-all"
                >
                  {/* Subtle Audio Waveform overlay track */}
                  <div className="absolute inset-0 flex items-center justify-around opacity-20 pointer-events-none overflow-hidden px-1">
                    {(realWaveform && realWaveform.length === 48
                      ? realWaveform
                      : Array.from({ length: 48 }, (_, i) => Math.max(20, Math.sin(i * 0.4) * 80 + 20))
                    ).map((height, i) => (
                      <span
                        key={i}
                        className="w-[2px] rounded-[2px] bg-white transition-all"
                        style={{ height: `${height}%` }}
                      />
                    ))}
                  </div>

                  {/* Buffered Progress (Multi-Segment Support) */}
                  {bufferedSegments.length > 0 ? (
                    bufferedSegments.map((seg, idx) => (
                      <div
                        key={idx}
                        className="absolute top-0 h-full rounded-[4px] bg-white/30 transition-all duration-150 pointer-events-none"
                        style={{ left: `${seg.startPercent}%`, width: `${seg.widthPercent}%` }}
                      />
                    ))
                  ) : (
                    <div
                      className="absolute left-0 top-0 h-full rounded-[4px] bg-white/30 transition-all duration-150"
                      style={{ width: `${bufferedPercent}%` }}
                    />
                  )}

                  {/* A-B Loop Highlight Region */}
                  {effectiveDuration > 0 && abLoop.a !== null && abLoop.b !== null && (
                    <div
                      className="absolute top-0 h-full bg-[#D14E24]/30 border-x border-[#D14E24] pointer-events-none"
                      style={{
                        left: `${(Math.min(abLoop.a, abLoop.b) / effectiveDuration) * 100}%`,
                        width: `${(Math.abs(abLoop.b - abLoop.a) / effectiveDuration) * 100}%`,
                      }}
                    />
                  )}

                  {/* Played Progress */}
                  <div
                    className="absolute left-0 top-0 h-full rounded-[4px] bg-[#D14E24] shadow-sm transition-[width] duration-75"
                    style={{
                      width: `${effectiveDuration > 0 ? Math.min(100, (currentTime / effectiveDuration) * 100) : 0}%`,
                    }}
                  />

                  {/* Timeline Marker Pins */}
                  {effectiveDuration > 0 &&
                    markers.map((marker) => (
                      <div
                        key={marker.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (e.shiftKey || e.altKey) {
                            handleRemoveMarker(marker.id, marker.time);
                            return;
                          }
                          if (mediaRef.current) {
                            mediaRef.current.currentTime = marker.time;
                            setCurrentTime(marker.time);
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleRemoveMarker(marker.id, marker.time);
                        }}
                        className="group/marker absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 h-3 w-1.5 rounded-[2px] bg-amber-400 hover:scale-125 transition-transform shadow-sm cursor-pointer"
                        style={{ left: `${(marker.time / effectiveDuration) * 100}%` }}
                        title={`${marker.label} (Click to jump, Right-click to remove)`}
                      />
                    ))}

                  {/* Scrubber Knob */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3.5 w-3.5 rounded-[4px] bg-white shadow-md transition-transform scale-0 group-hover/scrubber:scale-100"
                    style={{
                      left: `${effectiveDuration > 0 ? Math.min(100, (currentTime / effectiveDuration) * 100) : 0}%`,
                    }}
                  />

                  {/* Hover Tooltip */}
                  {hoverPercent !== null && hoverTime !== null && (
                    <div
                      className="absolute -top-7 -translate-x-1/2 rounded-[4px] bg-black/90 border border-white/20 px-1.5 py-0.5 font-mono text-[10px] text-white shadow-md pointer-events-none"
                      style={{ left: `${hoverPercent}%` }}
                    >
                      {formatTime(hoverTime)}
                    </div>
                  )}
                </div>

                {/* Toggleable Remaining / Elapsed Time display */}
                <button
                  type="button"
                  onClick={cycleTimeDisplayMode}
                  className="min-w-12 text-left font-mono text-[11px] text-white/60 hover:text-white transition-colors cursor-pointer focus:outline-none"
                  title="Click to toggle: Total / Remaining / Elapsed"
                >
                  {timeDisplayMode === "total" && formatTime(effectiveDuration)}
                  {timeDisplayMode === "remaining" && `-${formatTime(Math.max(0, effectiveDuration - currentTime))}`}
                  {timeDisplayMode === "elapsed-total" && `${formatTime(currentTime)} / ${formatTime(effectiveDuration)}`}
                </button>
              </div>

              {/* Bottom Buttons Bar */}
              <div className="flex items-center justify-between text-white pt-1">
                {/* Left group: Play, Seek, Frame Step, Volume, Speech Boost */}
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={togglePlay}
                    className="h-8 w-8 p-0 text-white hover:bg-white/15 rounded-[6px]"
                    title={isPlaying ? "Pause (Space/K)" : "Play (Space/K)"}
                  >
                    {isPlaying ? <Pause className="h-4 w-4 fill-white" /> : <Play className="h-4 w-4 ml-0.5 fill-white" />}
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => seekRelative(-5)}
                    className="h-8 w-8 p-0 text-white/80 hover:text-white hover:bg-white/15 rounded-[6px]"
                    title="Rewind 5s (Left Arrow / J)"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => seekRelative(5)}
                    className="h-8 w-8 p-0 text-white/80 hover:text-white hover:bg-white/15 rounded-[6px]"
                    title="Forward 5s (Right Arrow / L)"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                  </Button>

                  {/* Volume Slider */}
                  <div className="flex items-center gap-1.5 ml-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={toggleMute}
                      className="h-8 w-8 p-0 text-white/80 hover:text-white hover:bg-white/15 rounded-[6px]"
                      title="Mute / Unmute (M)"
                    >
                      {isMuted || volume === 0 ? (
                        <VolumeX className="h-4 w-4 text-amber-400" />
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
                      className="w-16 h-1 cursor-pointer accent-[#D14E24]"
                    />
                  </div>
                </div>

                {/* Right group: Speed, A-B Loop, Loop, PiP, Fullscreen */}
                <div className="flex items-center gap-1.5">
                  {/* Speed Selector */}
                  <select
                    value={speed}
                    onChange={(e) => handleSpeedChange(Number(e.target.value))}
                    className="h-7 rounded-[6px] bg-black/60 px-1.5 font-mono text-xs text-white/90 border border-white/20 focus:outline-none focus:border-[#D14E24]"
                  >
                    {SPEED_OPTIONS.map((s) => (
                      <option key={s} value={s} className="bg-black text-white">
                        {s}x
                      </option>
                    ))}
                  </select>

                  {/* A-B Segment Looping */}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={cycleAbLoop}
                    className={cn(
                      "h-7 px-2 text-xs font-mono rounded-[6px]",
                      abLoop.active
                        ? "bg-[#D14E24] text-white"
                        : abLoop.a !== null
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                        : "text-white/80 hover:text-white hover:bg-white/15",
                    )}
                    title={`A-B Loop: ${abLoop.active ? "Active ([ to set A, ] to set B, Backspace to clear)" : abLoop.a !== null ? "Point A set. Click to set Point B" : "Click to set Point A"}`}
                  >
                    {abLoop.active ? "A-B Active" : abLoop.a !== null ? "Set B" : "A-B"}
                  </Button>

                  {/* Full File Loop */}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setIsLooping(!isLooping)}
                    className={cn(
                      "h-8 w-8 p-0 text-white/80 hover:text-white hover:bg-white/15 rounded-[6px]",
                      isLooping && "text-[#D14E24] bg-white/10",
                    )}
                    title="Toggle loop"
                  >
                    <Repeat className="h-3.5 w-3.5" />
                  </Button>

                  {/* Picture-in-Picture */}
                  {typeof document !== "undefined" && "pictureInPictureEnabled" in document && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void togglePip()}
                      className={cn(
                        "h-8 w-8 p-0 text-white/80 hover:text-white hover:bg-white/15 rounded-[6px]",
                        isPipActive && "text-[#D14E24] bg-white/10",
                      )}
                      title="Picture in Picture (P)"
                    >
                      <PictureInPicture2 className="h-3.5 w-3.5" />
                    </Button>
                  )}

                  {/* Fullscreen */}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={toggleFullscreen}
                    className="h-8 w-8 p-0 text-white/80 hover:text-white hover:bg-white/15 rounded-[6px]"
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
          </div>

          {/* Keyboard Shortcuts Overlay Modal */}
          {showShortcuts && (
            <div
              data-media-controls="true"
              className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
              onClick={() => setShowShortcuts(false)}
            >
              <div
                className="w-full max-w-sm rounded-[12px] border border-white/20 bg-black/90 p-5 shadow-2xl text-white"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between pb-3 border-b border-white/10">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <HelpCircle className="h-4 w-4 text-[#D14E24]" />
                    Keyboard shortcuts
                  </h4>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowShortcuts(false)}
                    className="h-6 w-6 p-0 text-white/60 hover:text-white rounded-[4px]"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-y-2 gap-x-4 py-3 text-xs">
                  <div className="flex items-center justify-between text-white/70">
                    <span>Play / Pause</span>
                    <kbd className="rounded-[4px] bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-white">Space / K</kbd>
                  </div>
                  <div className="flex items-center justify-between text-white/70">
                    <span>Seek ±5s</span>
                    <kbd className="rounded-[4px] bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-white">← / →</kbd>
                  </div>
                  <div className="flex items-center justify-between text-white/70">
                    <span>Step 1 frame</span>
                    <kbd className="rounded-[4px] bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-white">, / .</kbd>
                  </div>
                  <div className="flex items-center justify-between text-white/70">
                    <span>Set Point A / B</span>
                    <kbd className="rounded-[4px] bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-white">[ / ]</kbd>
                  </div>
                  <div className="flex items-center justify-between text-white/70">
                    <span>Clear A-B Loop</span>
                    <kbd className="rounded-[4px] bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-white">Bksp</kbd>
                  </div>
                  <div className="flex items-center justify-between text-white/70">
                    <span>Drop / Remove Flag</span>
                    <kbd className="rounded-[4px] bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-white">C</kbd>
                  </div>
                  <div className="flex items-center justify-between text-white/70">
                    <span>Volume ±5%</span>
                    <kbd className="rounded-[4px] bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-white">↑ / ↓</kbd>
                  </div>
                  <div className="flex items-center justify-between text-white/70">
                    <span>Mute</span>
                    <kbd className="rounded-[4px] bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-white">M</kbd>
                  </div>
                  <div className="flex items-center justify-between text-white/70">
                    <span>Fullscreen</span>
                    <kbd className="rounded-[4px] bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-white">F</kbd>
                  </div>
                  <div className="flex items-center justify-between text-white/70">
                    <span>Picture-in-Pic</span>
                    <kbd className="rounded-[4px] bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-white">P</kbd>
                  </div>
                  <div className="flex items-center justify-between text-white/70">
                    <span>Snapshot</span>
                    <kbd className="rounded-[4px] bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-white">S</kbd>
                  </div>
                  <div className="flex items-center justify-between text-white/70">
                    <span>Zoom mode</span>
                    <kbd className="rounded-[4px] bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-white">Z</kbd>
                  </div>
                </div>
                <p className="text-[11px] text-white/50 text-center border-t border-white/10 pt-2.5">
                  Flags: Press C to drop or remove • Right-click on flag pin to remove
                </p>
              </div>
            </div>
          )}
        </>
      ) : (
        /* Audio Player Card */
        <div className="flex w-full max-w-lg flex-col items-center rounded-[12px] border border-border bg-card p-8 shadow-lg">
          <audio
            ref={mediaRef as React.RefObject<HTMLAudioElement>}
            src={signedUrl}
            loop={isLooping}
            preload="auto"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onTimeUpdate={() => {
              const el = mediaRef.current;
              if (el) {
                setCurrentTime(el.currentTime);
                if (!duration || !isFinite(duration) || duration <= 0) {
                  syncDuration(el);
                }
                updateBuffer();
              }
            }}
            onDurationChange={() => syncDuration(mediaRef.current)}
            onProgress={() => {
              syncDuration(mediaRef.current);
              updateBuffer();
            }}
            onLoadedMetadata={() => {
              const el = mediaRef.current;
              if (el) {
                syncDuration(el);
                el.volume = volume;
                el.muted = isMuted;
                el.preservesPitch = true;
                (el as unknown as { webkitPreservesPitch: boolean }).webkitPreservesPitch = true;
              }
            }}
            onEnded={() => {
              setIsPlaying(false);
              const el = mediaRef.current;
              if (el && isFinite(el.duration) && el.duration > 0) {
                setDuration(el.duration);
              }
            }}
            onError={(e) => {
              const target = e.currentTarget;
              if (!target.src || !target.error) return;
              if (target.error.code === 1 || target.error.code === 2) return;
              if (target.error.code === 3 || target.error.code === 4) {
                setError(true);
              }
            }}
          />

          {/* Animated Album Art / Wave Placeholder */}
          <div className="relative mb-6 flex h-32 w-32 items-center justify-center rounded-[12px] bg-primary/10 border-2 border-primary/20 shadow-inner">
            <Music className={cn("h-12 w-12 text-primary", isPlaying && "animate-pulse")} />
            {isPlaying && (
              <span className="absolute -inset-1 rounded-[12px] border border-primary/30 animate-ping opacity-25" />
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
              max={effectiveDuration || 100}
              step={0.1}
              value={currentTime}
              onChange={(e) => {
                const targetTime = Number(e.target.value);
                if (mediaRef.current) mediaRef.current.currentTime = targetTime;
                setCurrentTime(targetTime);
              }}
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-[4px] bg-muted accent-primary"
            />
            <span className="w-10 font-mono text-[11px] text-muted-foreground">
              {formatTime(effectiveDuration)}
            </span>
          </div>

          {/* Audio Controls */}
          <div className="mt-6 flex w-full items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={toggleMute}
                className="h-8 w-8 p-0 rounded-[6px]"
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
                className="h-8 w-8 p-0 rounded-[6px]"
                title="Rewind 5s"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>

              <Button
                size="lg"
                variant="default"
                onClick={togglePlay}
                className="h-11 w-11 rounded-[8px] p-0 shadow-md bg-[#D14E24] hover:bg-[#B23F1C] text-white"
              >
                {isPlaying ? <Pause className="h-5 w-5 fill-white" /> : <Play className="h-5 w-5 ml-0.5 fill-white" />}
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onClick={() => seekRelative(5)}
                className="h-8 w-8 p-0 rounded-[6px]"
                title="Forward 5s"
              >
                <RotateCw className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex items-center gap-1.5">
              <select
                value={speed}
                onChange={(e) => handleSpeedChange(Number(e.target.value))}
                className="h-7 rounded-[6px] bg-muted px-1.5 text-xs text-foreground border border-border"
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
                className={cn("h-8 w-8 p-0 rounded-[6px]", isLooping && "text-primary")}
                title="Toggle loop"
              >
                <Repeat className="h-4 w-4" />
              </Button>

              <Button asChild size="sm" variant="ghost" className="h-8 w-8 p-0 rounded-[6px]">
                <a href={signedUrl} download={node.name} title="Download audio">
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
  if (isNaN(seconds) || seconds < 0 || !isFinite(seconds)) return "0:00";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const paddedSecs = secs < 10 ? `0${secs}` : `${secs}`;
  if (hrs > 0) {
    const paddedMins = mins < 10 ? `0${mins}` : `${mins}`;
    return `${hrs}:${paddedMins}:${paddedSecs}`;
  }
  return `${mins}:${paddedSecs}`;
}
