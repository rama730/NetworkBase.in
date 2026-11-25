"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCw } from "lucide-react";

import { PixelBeat } from "@/components/messages/mix/primitives";
import { formatDuration } from "@/lib/messaging/media-kind";
import { claimSound, nextSpeed } from "@/lib/messaging/one-sound";
import type { ChatAttachmentV2 } from "@/components/messages/parts/message-attachments";

/**
 * A voice note or audio file (the mix, Audio board): a play cell, its 48-bar waveform as the scrubber (played bars ink),
 * mono "0:12 / 1:04", a speed cell; one sound at a time across the page. Old audio without bars gets a flat track.
 */
export function AudioTile({ attachment }: { attachment: ChatAttachmentV2 }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(attachment.durationMs ?? 0);
  const [speed, setSpeed] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const peaks = attachment.peaks?.length ? attachment.peaks : null;
  const share = total ? Math.min(1, current / total) : 0;

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = speed;
  }, [speed]);

  const toggle = () => {
    const audio = ref.current;
    if (!audio) return;
    if (audio.paused) {
      claimSound(audio);
      void audio.play().catch(() => setFailed(true));
    } else audio.pause();
  };
  const seekTo = (ms: number) => {
    const audio = ref.current;
    if (!audio || !total) return;
    audio.currentTime = Math.max(0, Math.min(total, ms)) / 1000;
    setCurrent(audio.currentTime * 1000);
  };

  if (failed) {
    return (
      <div className="nbm-audio is-error" role="group" aria-label="Audio didn’t load">
        <span className="min-w-0 flex-1 truncate">Audio didn’t load</span>
        <button type="button" className="nbm-tile-err-act" onClick={() => { setFailed(false); setAttempt((n) => n + 1); }}><RotateCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry</button>
      </div>
    );
  }

  return (
    <div className="nbm-audio" role="group" aria-label={attachment.filename || "Audio"}>
      <audio
        key={attempt}
        ref={ref}
        src={attachment.url}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrent(0); }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime * 1000)}
        onLoadedMetadata={(event) => { if (Number.isFinite(event.currentTarget.duration)) setTotal(event.currentTarget.duration * 1000); }}
        onError={() => setFailed(true)}
      />
      <button type="button" className="nbm-audio-play" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
        {waiting ? <PixelBeat /> : playing ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="h-4 w-4" fill="currentColor" />}
      </button>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={Math.round(total / 1000)}
        aria-valuenow={Math.round(current / 1000)}
        aria-valuetext={`${formatDuration(current)} of ${formatDuration(total)}`}
        className="nbm-audio-wave"
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          seekTo(((event.clientX - box.left) / box.width) * total);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") { event.preventDefault(); seekTo(current + 5000); }
          if (event.key === "ArrowLeft") { event.preventDefault(); seekTo(current - 5000); }
          if (event.key === " " || event.key === "Enter") { event.preventDefault(); toggle(); }
        }}
      >
        {peaks ? peaks.map((peak, i) => (
          <span key={i} className="nbm-audio-bar" data-played={(i + 0.5) / peaks.length <= share ? "true" : undefined} style={{ height: `${Math.max(8, peak)}%` }} />
        )) : <span className="nbm-audio-track"><span style={{ width: `${share * 100}%` }} /></span>}
      </div>
      <span className="nbm-audio-time">{formatDuration(current)} / {formatDuration(total) || "–:––"}</span>
      <button type="button" className="nbm-audio-speed" onClick={() => setSpeed(nextSpeed(speed))} aria-label={`Speed ${speed}×`}>{speed}×</button>
    </div>
  );
}
