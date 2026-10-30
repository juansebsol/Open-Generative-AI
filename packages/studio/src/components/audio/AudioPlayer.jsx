"use client";

// The player the Audio pages share: a waveform drawn from the decoded file
// (peaks are computed once per URL and cached), a play button, the time,
// and a click or drag on the wave to seek. Only one player sounds at a
// time: starting one pauses whichever was playing. Cards use the compact
// strip; the full-screen viewer the tall one.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconPlayerPauseFilled, IconPlayerPlayFilled } from "@tabler/icons-react";
import { fetchMediaBlob } from "../../providers/mediaStore.js";
import { formatDuration } from "../../audioPages.js";

const BARS = 96;
const peaksCache = new Map();

// A quiet stand-in while the file decodes, or when it cannot be decoded:
// bars from a hash of the URL, so a card keeps the same shape across renders.
function placeholderPeaks(url, bars = BARS) {
  let seed = 2166136261;
  for (const char of String(url || "")) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  const peaks = [];
  for (let index = 0; index < bars; index += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    peaks.push(0.15 + (seed % 1000) / 1000 * 0.45);
  }
  return peaks;
}

/** Peaks (0..1 per bar) and the duration of an audio URL, decoded once per URL. */
export function loadPeaks(url, bars = BARS) {
  if (!url) return Promise.resolve(null);
  if (!peaksCache.has(url)) {
    peaksCache.set(url, (async () => {
      const Context = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
      if (!Context) return null;
      const blob = await fetchMediaBlob(url);
      const buffer = await blob.arrayBuffer();
      const context = new Context(1, 1, 44100);
      const audio = await context.decodeAudioData(buffer);
      const data = audio.getChannelData(0);
      const size = Math.max(1, Math.floor(data.length / bars));
      const peaks = [];
      let top = 0;
      for (let bar = 0; bar < bars; bar += 1) {
        let sum = 0;
        const start = bar * size;
        const step = Math.max(1, Math.floor(size / 64));
        let count = 0;
        for (let index = start; index < start + size && index < data.length; index += step) {
          sum += data[index] * data[index];
          count += 1;
        }
        const rms = count ? Math.sqrt(sum / count) : 0;
        peaks.push(rms);
        top = Math.max(top, rms);
      }
      return { peaks: peaks.map((value) => (top ? Math.max(0.04, value / top) : 0.04)), duration: audio.duration };
    })().catch((error) => {
      console.warn("[audio] no waveform for", String(url).slice(0, 80), error?.message || error);
      return null;
    }));
  }
  return peaksCache.get(url);
}

/** The decoded peaks of a URL, or the placeholder while they load. */
export function useAudioPeaks(url, bars = BARS) {
  const [decoded, setDecoded] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setDecoded(null);
    loadPeaks(url, bars).then((result) => { if (!cancelled) setDecoded(result); });
    return () => { cancelled = true; };
  }, [url, bars]);
  const placeholder = useMemo(() => placeholderPeaks(url, bars), [url, bars]);
  return { peaks: decoded?.peaks || placeholder, duration: decoded?.duration ?? null, decoded: Boolean(decoded) };
}

let playing = null;
/** Pauses whichever player is sounding (the viewer closing, a page change). */
export function stopAllAudio() {
  if (playing) playing.pause();
}

/** An <audio> element for a URL with its state, shared by both player sizes. */
export function useAudio(url) {
  const audioRef = useRef(null);
  const [state, setState] = useState({ playing: false, time: 0, duration: null, failed: false });

  useEffect(() => {
    if (!url || typeof Audio === "undefined") return undefined;
    const audio = new Audio();
    audio.preload = "metadata";
    audio.src = url;
    audioRef.current = audio;
    const update = () => setState({ playing: !audio.paused && !audio.ended, time: audio.currentTime, duration: Number.isFinite(audio.duration) ? audio.duration : null, failed: false });
    const onPlay = () => {
      if (playing && playing !== audio) playing.pause();
      playing = audio;
      update();
    };
    const onEnd = () => {
      if (playing === audio) playing = null;
      update();
    };
    const onError = () => setState((previous) => ({ ...previous, playing: false, failed: true }));
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onEnd);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("timeupdate", update);
    audio.addEventListener("loadedmetadata", update);
    audio.addEventListener("durationchange", update);
    audio.addEventListener("error", onError);
    return () => {
      audio.pause();
      if (playing === audio) playing = null;
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
    };
  }, [url]);

  const play = useCallback(() => { audioRef.current?.play().catch(() => setState((previous) => ({ ...previous, failed: true }))); }, []);
  const pause = useCallback(() => { audioRef.current?.pause(); }, []);
  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused || audio.ended) play();
    else pause();
  }, [play, pause]);
  const seek = useCallback((fraction) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, fraction * audio.duration));
    setState((previous) => ({ ...previous, time: audio.currentTime }));
  }, []);

  return { ...state, play, pause, toggle, seek };
}

/**
 * The bars. `progress` (0..1) colours the played part; `onSeek(fraction)`
 * makes the wave scrubbable.
 */
export function Waveform({ peaks, progress = 0, onSeek = null, className = "", barClassName = "" }) {
  const ref = useRef(null);
  const dragging = useRef(false);
  const seekAt = (event) => {
    const bounds = ref.current?.getBoundingClientRect();
    if (!bounds || !onSeek) return;
    onSeek((event.clientX - bounds.left) / Math.max(1, bounds.width));
  };
  const bars = peaks.length;
  const gap = 0.35;
  const played = Math.round(progress * bars);
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${bars} 100`}
      preserveAspectRatio="none"
      className={`block h-full w-full ${onSeek ? "cursor-pointer" : ""} ${className}`}
      aria-hidden="true"
      onPointerDown={onSeek ? (event) => { dragging.current = true; event.currentTarget.setPointerCapture?.(event.pointerId); seekAt(event); } : undefined}
      onPointerMove={onSeek ? (event) => { if (dragging.current) seekAt(event); } : undefined}
      onPointerUp={onSeek ? () => { dragging.current = false; } : undefined}
      onPointerCancel={onSeek ? () => { dragging.current = false; } : undefined}
    >
      {peaks.map((peak, index) => {
        const height = Math.max(4, peak * 100);
        return <rect key={index} x={index + gap / 2} y={(100 - height) / 2} width={1 - gap} height={height} rx={0.3} className={`${index < played ? "fill-[#22d3ee]" : "fill-white/25"} ${barClassName}`} />;
      })}
    </svg>
  );
}

/**
 * @param {object} props
 * @param {string} props.url
 * @param {"strip"|"full"} [props.size]  "strip" for cards, "full" for the viewer
 * @param {(duration: number) => void} [props.onDuration]  called once the file's length is known
 * @param {{ play: string, pause: string }} [props.labels]
 */
export default function AudioPlayer({ url, size = "strip", onDuration = null, labels = { play: "Play", pause: "Pause" }, className = "" }) {
  const audio = useAudio(url);
  const { peaks, duration: decodedDuration } = useAudioPeaks(url, size === "full" ? 160 : BARS);
  const duration = audio.duration ?? decodedDuration;
  const reported = useRef(null);
  useEffect(() => {
    if (!onDuration || !Number.isFinite(duration) || reported.current === duration) return;
    reported.current = duration;
    onDuration(duration);
  }, [duration, onDuration]);
  const progress = duration ? audio.time / duration : 0;
  const full = size === "full";
  const buttonClass = full
    ? "flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-[#04202a] shadow-[0_8px_30px_rgba(34,211,238,0.35)] transition-transform hover:scale-105 active:scale-95"
    : "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.08] text-white backdrop-blur-md transition-colors hover:bg-primary hover:text-black";
  return (
    <div className={`flex items-center ${full ? "gap-5" : "gap-3"} ${className}`} data-audio-player={size} data-audio-state={audio.playing ? "playing" : "paused"}>
      <button type="button" onClick={(event) => { event.stopPropagation(); audio.toggle(); }} aria-label={audio.playing ? labels.pause : labels.play} title={audio.playing ? labels.pause : labels.play} className={buttonClass} data-audio-toggle>
        {audio.playing ? <IconPlayerPauseFilled size={full ? 24 : 15} aria-hidden="true" /> : <IconPlayerPlayFilled size={full ? 24 : 15} className={full ? "ml-1" : "ml-0.5"} aria-hidden="true" />}
      </button>
      <div className={`min-w-0 flex-1 ${full ? "h-[120px]" : "h-10"}`} onClick={(event) => event.stopPropagation()}>
        <Waveform peaks={peaks} progress={progress} onSeek={audio.seek} />
      </div>
      <span className={`shrink-0 tabular-nums ${full ? "text-[13px] text-white/70" : "text-[11px] text-white/45"}`}>
        {audio.playing || audio.time > 0 ? `${formatDuration(audio.time)} / ` : ""}{formatDuration(duration) || "–:––"}
      </span>
    </div>
  );
}
