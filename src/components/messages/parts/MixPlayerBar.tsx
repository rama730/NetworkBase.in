"use client";

import { useEffect, useState, type RefObject } from "react";
import { Expand, Maximize, Minimize, PictureInPicture2, Play, Pause, Repeat, RotateCcw, RotateCw, Volume2, VolumeX } from "lucide-react";

import { PixelBeat, RadioCells } from "@/components/messages/mix/primitives";
import { formatDuration } from "@/lib/messaging/media-kind";
import { PLAYER_SPEEDS, readPlayerPrefs, writePlayerPrefs } from "@/lib/messaging/player-prefs";

const storage = () => (typeof window === "undefined" ? null : window.localStorage);

/**
 * The one mix player (§7.2): a big square play cell when paused, and a bar of cells under the video — play/pause, −5 / +5,
 * the scrubber (hairline track, buffered soft, played paper, a 10px square thumb), mono time (click: remaining), volume,
 * speed cells, loop, picture-in-picture, full screen. Buffering is the pixel beat; ended offers Replay (and Next).
 * `compact`: the slim inline bar in a tile (time · scrubber · mute · expand). `keys`: J / L / K / M / F / P while open.
 */
export function MixPlayerBar({ videoRef, compact = false, keys = false, onExpand, onNext }: {
  videoRef: RefObject<HTMLVideoElement | null>; compact?: boolean; keys?: boolean; onExpand?: (time: number) => void; onNext?: () => void;
}) {
  const [paused, setPaused] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [ended, setEnded] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const [remaining, setRemaining] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // Opened by a click: start with sound, at the device's volume and speed.
    const prefs = readPlayerPrefs(storage());
    video.volume = prefs.volume;
    video.playbackRate = prefs.speed;
    setVolume(prefs.volume);
    setSpeed(prefs.speed);
    const sync = () => {
      setPaused(video.paused);
      setTime(video.currentTime);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setMuted(video.muted);
      setEnded(video.ended);
      if (video.buffered.length) setBuffered(video.buffered.end(video.buffered.length - 1));
    };
    const events = ["play", "pause", "timeupdate", "durationchange", "loadedmetadata", "volumechange", "ended", "progress", "seeked"] as const;
    events.forEach((name) => video.addEventListener(name, sync));
    const onWait = () => setWaiting(true);
    const onPlaying = () => setWaiting(false);
    video.addEventListener("waiting", onWait);
    video.addEventListener("playing", onPlaying);
    const onFull = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFull);
    sync();
    return () => {
      events.forEach((name) => video.removeEventListener(name, sync));
      video.removeEventListener("waiting", onWait);
      video.removeEventListener("playing", onPlaying);
      document.removeEventListener("fullscreenchange", onFull);
    };
  }, [videoRef]);

  const video = () => videoRef.current;
  const toggle = () => { const v = video(); if (!v) return; if (v.paused) void v.play().catch(() => undefined); else v.pause(); };
  const seek = (to: number) => { const v = video(); if (v) v.currentTime = Math.max(0, Math.min(duration || v.duration || 0, to)); };
  const toggleMute = () => { const v = video(); if (v) v.muted = !v.muted; };
  const pickSpeed = (value: string) => {
    const next = Number(value);
    const v = video();
    if (v) v.playbackRate = next;
    setSpeed(next);
    writePlayerPrefs(storage(), { volume, speed: next });
  };
  const pickVolume = (next: number) => {
    const v = video();
    if (v) { v.volume = next; v.muted = next === 0; }
    setVolume(next);
    writePlayerPrefs(storage(), { volume: next, speed });
  };
  const toggleFull = () => {
    const v = video();
    const host = v?.closest("[data-player-host]") ?? v;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void (host as HTMLElement | null)?.requestFullscreen?.().catch(() => undefined);
  };
  const pip = () => {
    const v = video() as (HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> }) | null;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
    else void v?.requestPictureInPicture?.().catch(() => undefined);
  };

  useEffect(() => {
    if (!keys) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, [contenteditable=true]")) return;
      switch (event.key.toLowerCase()) {
        case "k": event.preventDefault(); toggle(); break;
        case "j": event.preventDefault(); seek(time - 5); break;
        case "l": event.preventDefault(); seek(time + 5); break;
        case "m": event.preventDefault(); toggleMute(); break;
        case "f": event.preventDefault(); toggleFull(); break;
        case "p": event.preventDefault(); pip(); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const share = duration ? time / duration : 0;
  const scrubber = (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={`${formatDuration(time * 1000)} of ${formatDuration(duration * 1000)}`}
      className="nbm-pbar-track"
      onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); seek(((event.clientX - box.left) / box.width) * duration); }}
      onKeyDown={(event) => {
        // ← → seek only while the scrubber has focus.
        if (event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); seek(time + 5); }
        if (event.key === "ArrowLeft") { event.preventDefault(); event.stopPropagation(); seek(time - 5); }
      }}
    >
      <span className="nbm-pbar-buffered" style={{ width: `${duration ? (buffered / duration) * 100 : 0}%` }} />
      <span className="nbm-pbar-played" style={{ width: `${share * 100}%` }} />
      <span className="nbm-pbar-thumb" style={{ left: `${share * 100}%` }} />
    </div>
  );
  const clock = (
    <button type="button" className="nbm-pbar-time" onClick={() => setRemaining(!remaining)} aria-label={remaining ? "Show elapsed time" : "Show remaining time"}>
      {remaining ? `−${formatDuration((duration - time) * 1000)}` : formatDuration(time * 1000)} / {formatDuration(duration * 1000) || "–:––"}
    </button>
  );

  if (compact) {
    return (
      <div className="nbm-pbar is-compact">
        <button type="button" className="nbm-pbar-cell" onClick={toggle} aria-label={paused ? "Play" : "Pause"}>{waiting ? <PixelBeat /> : paused ? <Play className="h-4 w-4" fill="currentColor" /> : <Pause className="h-4 w-4" fill="currentColor" />}</button>
        {clock}
        {scrubber}
        <button type="button" className="nbm-pbar-cell" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>{muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}</button>
        {onExpand ? <button type="button" className="nbm-pbar-cell" onClick={() => onExpand(time)} aria-label="Expand"><Expand className="h-4 w-4" /></button> : null}
      </div>
    );
  }

  return (
    <>
      {paused && !waiting ? (
        <div className="nbm-pbar-center">
          {ended ? (
            <div className="flex gap-2">
              <button type="button" className="nbm-pbar-big" onClick={() => { seek(0); toggle(); }} aria-label="Replay"><RotateCcw className="h-6 w-6" /></button>
              {onNext ? <button type="button" className="nbm-pbar-next" onClick={onNext}>Next ›</button> : null}
            </div>
          ) : <button type="button" className="nbm-pbar-big" onClick={toggle} aria-label="Play"><Play className="h-7 w-7" fill="currentColor" /></button>}
        </div>
      ) : null}
      {waiting ? <span className="nbm-pbar-center" aria-hidden="true"><PixelBeat /></span> : null}
      <div className="nbm-pbar">
        <button type="button" className="nbm-pbar-cell" onClick={toggle} aria-label={paused ? "Play" : "Pause"}>{paused ? <Play className="h-4 w-4" fill="currentColor" /> : <Pause className="h-4 w-4" fill="currentColor" />}</button>
        <button type="button" className="nbm-pbar-cell" onClick={() => seek(time - 5)} aria-label="Back 5 seconds"><RotateCcw className="h-4 w-4" /></button>
        <button type="button" className="nbm-pbar-cell" onClick={() => seek(time + 5)} aria-label="Forward 5 seconds"><RotateCw className="h-4 w-4" /></button>
        {scrubber}
        {clock}
        <button type="button" className="nbm-pbar-cell" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>{muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}</button>
        <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(event) => pickVolume(Number(event.target.value))} aria-label="Volume" className="nbm-pbar-volume" />
        <RadioCells label="Speed" value={String(speed)} onChange={pickSpeed} options={PLAYER_SPEEDS.map((s) => [String(s), `${s}×`] as const)} className="nbm-pbar-speed" />
        <button type="button" className="nbm-pbar-cell" aria-pressed={loop} onClick={() => { const v = video(); if (v) v.loop = !loop; setLoop(!loop); }} aria-label="Loop"><Repeat className="h-4 w-4" /></button>
        <button type="button" className="nbm-pbar-cell" onClick={pip} aria-label="Picture in picture"><PictureInPicture2 className="h-4 w-4" /></button>
        <button type="button" className="nbm-pbar-cell" onClick={toggleFull} aria-label={fullscreen ? "Exit full screen" : "Full screen"}>{fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}</button>
      </div>
    </>
  );
}
