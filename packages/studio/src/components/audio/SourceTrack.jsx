"use client";

// The Remix page's source track once it is in. Restyle shows it as a slim
// pill: play, a small waveform, the name (click it to swap the track) and
// remove. Extend shows a one-line strip whose waveform carries the join
// marker: drag it, click the wave or use the arrow keys; playback jumps
// there so you hear the join. The part that gets replaced is dimmed, and a
// dashed block on the new part's side says where it starts.

import { useEffect, useMemo, useRef } from "react";
import { IconArrowsExchange, IconPlayerPauseFilled, IconPlayerPlayFilled, IconPlus, IconX } from "@tabler/icons-react";
import { useAudio, useAudioPeaks } from "./AudioPlayer.jsx";
import { PromptChevronIcon } from "../prompt/PromptComposer.jsx";
import { formatDuration } from "../../audioPages.js";

const PILL_BARS = 36;
const STRIP_BARS = 96;

// Peaks are decoded once per URL at whatever count asked first; draw them at ours.
function resample(peaks, count) {
  if (!peaks?.length) return Array(count).fill(0.04);
  if (peaks.length === count) return peaks;
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor((index * peaks.length) / count);
    const end = Math.max(start + 1, Math.floor(((index + 1) * peaks.length) / count));
    let top = 0;
    for (let at = start; at < end && at < peaks.length; at += 1) top = Math.max(top, peaks[at]);
    return top;
  });
}

/**
 * @param {object} props
 * @param {string} props.url
 * @param {string} props.name
 * @param {string} [props.meta]  shown beside the pill ("Lyria 3 · from your library")
 * @param {"restyle"|"extend"} [props.mode]
 * @param {number} [props.extendAt]  seconds; where the new part joins
 * @param {"tail"|"head"} [props.direction]  after the marker, or before it
 * @param {(seconds: number) => void} [props.onExtendAt]
 * @param {(seconds: number) => void} [props.onDuration]
 * @param {() => void} [props.onSwap]
 * @param {() => void} [props.onRemove]
 * @param {boolean} [props.swapOpen]
 * @param {import("react").ReactNode} [props.swapMenu]  the track picker, anchored to the track
 * @param {{ play: string, pause: string, swap: string, remove: string, position: string, hint: string, newPartFrom: string, newPartBefore: string }} props.labels
 */
export default function SourceTrack({ url, name, meta = "", mode = "restyle", extendAt = 0, direction = "tail", onExtendAt, onDuration, onSwap, onRemove, swapOpen = false, swapMenu = null, labels }) {
  const audio = useAudio(url);
  const { peaks: decoded, duration: decodedDuration } = useAudioPeaks(url);
  const extend = mode === "extend";
  const peaks = useMemo(() => resample(decoded, extend ? STRIP_BARS : PILL_BARS), [decoded, extend]);
  const duration = audio.duration ?? decodedDuration ?? null;
  const marker = extend && duration ? Math.min(1, Math.max(0, extendAt / duration)) : null;
  const progress = duration ? Math.min(1, audio.time / duration) : 0;
  const waveRef = useRef(null);
  const dragging = useRef(false);

  const reported = useRef(null);
  useEffect(() => {
    if (!onDuration || !Number.isFinite(duration) || reported.current === duration) return;
    reported.current = duration;
    onDuration(duration);
  }, [duration, onDuration]);

  const fractionAt = (event) => {
    const bounds = waveRef.current?.getBoundingClientRect();
    if (!bounds) return 0;
    return Math.min(1, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
  };
  const placeAt = (fraction) => {
    if (extend && duration && onExtendAt) onExtendAt(Math.round(fraction * duration));
    audio.seek(fraction);
  };
  const pointer = {
    onPointerDown: (event) => { dragging.current = true; event.currentTarget.setPointerCapture?.(event.pointerId); placeAt(fractionAt(event)); },
    onPointerMove: (event) => { if (dragging.current) placeAt(fractionAt(event)); },
    onPointerUp: () => { dragging.current = false; },
    onPointerCancel: () => { dragging.current = false; },
  };
  const onKeyDown = (event) => {
    if (!extend || !duration || !onExtendAt) return;
    const step = event.shiftKey ? 5 : 1;
    let next = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = extendAt - step;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") next = extendAt + step;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = duration;
    if (next === null) return;
    event.preventDefault();
    const clamped = Math.max(0, Math.min(Math.floor(duration), Math.round(next)));
    onExtendAt(clamped);
    audio.seek(clamped / duration);
  };

  const bars = (
    <svg viewBox={`0 0 ${peaks.length} 100`} preserveAspectRatio="none" className="block h-full w-full" aria-hidden="true">
      {peaks.map((peak, index) => {
        const at = (index + 0.5) / peaks.length;
        const replaced = marker !== null && (direction === "head" ? at < marker : at > marker);
        const played = at <= progress;
        const height = Math.max(6, peak * 100);
        const fill = replaced ? "fill-white/10" : played ? "fill-[#22d3ee]" : extend ? "fill-white/40" : "fill-white/35";
        return <rect key={index} x={index + 0.2} y={(100 - height) / 2} width={0.6} height={height} rx={0.3} className={fill} />;
      })}
    </svg>
  );
  const playButton = (
    <button type="button" onClick={audio.toggle} aria-label={audio.playing ? labels.pause : labels.play} title={audio.playing ? labels.pause : labels.play} className={`flex shrink-0 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 ${extend ? "h-[34px] w-[34px]" : "h-8 w-8"} ${audio.playing ? "bg-primary text-[#04202a]" : "bg-white/[0.09] text-white hover:bg-white/[0.16]"}`} data-audio-toggle>
      {audio.playing ? <IconPlayerPauseFilled size={12} aria-hidden="true" /> : <IconPlayerPlayFilled size={12} className="ml-0.5" aria-hidden="true" />}
    </button>
  );
  const removeButton = (
    <button type="button" onClick={onRemove} aria-label={labels.remove} title={labels.remove} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/60" data-audio-remove>
      <IconX size={13} stroke={2} aria-hidden="true" />
    </button>
  );

  if (!extend) {
    const time = audio.playing || audio.time > 0 ? `${formatDuration(audio.time) || "0:00"} / ${formatDuration(duration) || "–:––"}` : formatDuration(duration) || "–:––";
    return (
      <div className="flex min-w-0 items-center gap-3" data-audio-source="restyle">
        <div className="relative flex h-10 min-w-0 items-center gap-2 rounded-full border border-primary/35 bg-primary/[0.05] px-1 sm:gap-2.5">
          {playButton}
          <div ref={waveRef} {...pointer} className="hidden h-[22px] w-[112px] shrink-0 cursor-pointer touch-none sm:block" aria-hidden="true" data-audio-source-wave>{bars}</div>
          <button type="button" onClick={onSwap} aria-expanded={swapOpen} aria-haspopup="dialog" aria-label={`${name}: ${labels.swap}`} title={labels.swap} className="flex h-[30px] min-w-0 max-w-[150px] items-center gap-1.5 rounded-md px-0.5 text-[13px] font-medium text-white transition-colors hover:text-[#67e8f9] focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 sm:max-w-[240px]" data-audio-swap>
            <span className="truncate">{name}</span>
            <PromptChevronIcon />
          </button>
          <span className="hidden shrink-0 font-mono text-[11px] tabular-nums text-white/55 sm:inline">{time}</span>
          {removeButton}
          {swapMenu}
        </div>
        {meta && <span className="hidden min-w-0 truncate text-[11.5px] text-white/50 md:block">{meta}</span>}
      </div>
    );
  }

  const markerTime = duration ? formatDuration(extendAt) || "0:00" : "–:––";
  const ghost = (
    <div className="flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-[9px] border-[1.5px] border-dashed border-primary/55 bg-primary/[0.06] px-2 text-[11.5px] font-medium text-[#67e8f9] sm:gap-1.5 sm:px-2.5" data-audio-new-part={direction}>
      <IconPlus size={12} stroke={2.25} aria-hidden="true" />
      <span className="hidden sm:inline">{direction === "head" ? labels.newPartBefore : labels.newPartFrom}</span>
      <span className="font-mono font-semibold tabular-nums" data-audio-marker-time>{markerTime}</span>
    </div>
  );
  return (
    <div className="relative flex h-[52px] min-w-0 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-1.5 sm:gap-2.5" data-audio-source="extend">
      {playButton}
      <button type="button" onClick={onSwap} aria-expanded={swapOpen} aria-haspopup="dialog" aria-label={`${name}: ${labels.swap}`} title={labels.swap} className="flex h-[30px] shrink-0 items-center justify-center gap-1.5 rounded-md text-white/70 transition-colors hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 max-sm:w-7 sm:text-white" data-audio-swap>
        <IconArrowsExchange size={15} stroke={1.75} className="sm:hidden" aria-hidden="true" />
        <span className="hidden max-w-[124px] truncate text-[13px] font-medium sm:block">{name}</span>
        <PromptChevronIcon className="hidden sm:block" />
      </button>
      {direction === "head" && ghost}
      <div
        ref={waveRef}
        role="slider"
        tabIndex={0}
        aria-label={labels.position}
        aria-valuemin={0}
        aria-valuemax={duration ? Math.floor(duration) : 0}
        aria-valuenow={extendAt}
        aria-valuetext={formatDuration(extendAt) || "0:00"}
        title={labels.hint}
        onKeyDown={onKeyDown}
        {...pointer}
        className="relative h-8 min-w-0 flex-1 cursor-pointer touch-none rounded-md outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
        data-audio-source-wave
      >
        {bars}
        {marker !== null && (
          <>
            <span className="pointer-events-none absolute -bottom-[7px] -top-[7px] w-0.5 -translate-x-1/2 rounded-full bg-primary" style={{ left: `${marker * 100}%` }} aria-hidden="true" />
            <span className="pointer-events-none absolute top-1/2 h-[22px] w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-[5px] bg-primary shadow-[0_0_0_3px_rgba(34,211,238,0.22)]" style={{ left: `${marker * 100}%` }} aria-hidden="true" data-audio-marker />
          </>
        )}
      </div>
      {direction !== "head" && ghost}
      {removeButton}
      {swapMenu}
    </div>
  );
}
