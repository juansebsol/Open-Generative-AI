"use client";

// The Remix page's source track: the file you work from, playable, with its
// waveform. In extend mode the waveform carries a marker where the new part
// joins. Drag it, click the wave or use the arrow keys; playback jumps to the
// marker so you hear the join. The part that gets replaced is dimmed, and a
// dashed block shows which side the new part goes on.

import { useEffect, useRef } from "react";
import { IconArrowsExchange, IconPlayerPauseFilled, IconPlayerPlayFilled, IconPlus, IconX } from "@tabler/icons-react";
import { useAudio, useAudioPeaks } from "./AudioPlayer.jsx";
import { formatDuration } from "../../audioPages.js";

const BARS = 120;

/**
 * @param {object} props
 * @param {string} props.url
 * @param {string} props.name
 * @param {string} [props.meta]  the line under the name ("Lyria 3 · from your library")
 * @param {"restyle"|"extend"} [props.mode]
 * @param {number} [props.extendAt]  seconds; where the new part joins
 * @param {"tail"|"head"} [props.direction]  after the marker, or before it
 * @param {(seconds: number) => void} [props.onExtendAt]
 * @param {(seconds: number) => void} [props.onDuration]
 * @param {() => void} [props.onReplace]
 * @param {() => void} [props.onRemove]
 * @param {import("react").ReactNode} [props.replaceMenu]  rendered next to the replace button (a popover)
 * @param {{ play: string, pause: string, replace: string, remove: string, newPart: string, position: string, hint?: string }} props.labels
 */
export default function SourceTrack({ url, name, meta = "", mode = "restyle", extendAt = 0, direction = "tail", onExtendAt, onDuration, onReplace, onRemove, replaceMenu = null, labels }) {
  const audio = useAudio(url);
  const { peaks, duration: decodedDuration } = useAudioPeaks(url, BARS);
  const duration = audio.duration ?? decodedDuration ?? null;
  const extend = mode === "extend";
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

  const ghost = extend && (
    <div className={`hidden h-10 w-[96px] shrink-0 items-center justify-center gap-1 rounded-[9px] border-[1.5px] border-dashed border-primary/55 bg-primary/[0.06] text-[11.5px] font-medium text-[#67e8f9] sm:flex`} data-audio-new-part={direction}>
      <IconPlus size={12} stroke={2.25} aria-hidden="true" />{labels.newPart}
    </div>
  );
  const time = audio.playing || audio.time > 0 ? `${formatDuration(audio.time)} / ${formatDuration(duration) || "–:––"}` : formatDuration(duration) || "–:––";

  return (
    <div className={`flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] pl-2.5 pr-2 ${extend ? "h-[92px]" : "h-16"}`} data-audio-source={mode}>
      <button type="button" onClick={audio.toggle} aria-label={audio.playing ? labels.pause : labels.play} title={audio.playing ? labels.pause : labels.play} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.09] text-white transition-colors hover:bg-primary hover:text-black" data-audio-toggle>
        {audio.playing ? <IconPlayerPauseFilled size={15} aria-hidden="true" /> : <IconPlayerPlayFilled size={15} className="ml-0.5" aria-hidden="true" />}
      </button>
      <div className="hidden w-[150px] min-w-0 shrink-0 flex-col gap-0.5 md:flex">
        <span className="truncate text-[13px] font-medium text-white/90" title={name}>{name}</span>
        {meta && <span className="truncate text-[11.5px] text-white/40" title={meta}>{meta}</span>}
      </div>

      {extend && direction === "head" && ghost}
      <div className={`relative min-w-0 flex-1 ${extend ? "pt-4" : ""}`}>
        <div
          ref={waveRef}
          role={extend ? "slider" : undefined}
          tabIndex={extend ? 0 : -1}
          aria-label={extend ? labels.position : undefined}
          aria-valuemin={extend ? 0 : undefined}
          aria-valuemax={extend && duration ? Math.floor(duration) : undefined}
          aria-valuenow={extend ? extendAt : undefined}
          aria-valuetext={extend ? formatDuration(extendAt) || "0:00" : undefined}
          onKeyDown={onKeyDown}
          onPointerDown={(event) => { dragging.current = true; event.currentTarget.setPointerCapture?.(event.pointerId); placeAt(fractionAt(event)); }}
          onPointerMove={(event) => { if (dragging.current) placeAt(fractionAt(event)); }}
          onPointerUp={() => { dragging.current = false; }}
          onPointerCancel={() => { dragging.current = false; }}
          className="relative h-10 cursor-pointer touch-none rounded-md outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
          data-audio-source-wave
        >
          <svg viewBox={`0 0 ${peaks.length} 100`} preserveAspectRatio="none" className="block h-full w-full" aria-hidden="true">
            {peaks.map((peak, index) => {
              const at = (index + 0.5) / peaks.length;
              const replaced = marker !== null && (direction === "head" ? at < marker : at > marker);
              const played = at <= progress;
              const height = Math.max(4, peak * 100);
              const fill = replaced ? "fill-white/10" : played ? "fill-[#22d3ee]" : "fill-white/30";
              return <rect key={index} x={index + 0.2} y={(100 - height) / 2} width={0.6} height={height} rx={0.3} className={fill} />;
            })}
          </svg>
          {marker !== null && (
            <>
              <span className="pointer-events-none absolute -bottom-1 -top-1 w-0.5 -translate-x-1/2 rounded-full bg-primary shadow-[0_0_0_3px_rgba(34,211,238,0.15)]" style={{ left: `${marker * 100}%` }} aria-hidden="true" />
              <span className="pointer-events-none absolute -top-[26px] flex h-5 -translate-x-1/2 items-center rounded-full bg-primary px-2 font-mono text-[10.5px] font-semibold text-[#04202a]" style={{ left: `${Math.min(96, Math.max(4, marker * 100))}%` }} data-audio-marker>{formatDuration(extendAt) || "0:00"}</span>
            </>
          )}
        </div>
        {extend && labels.hint && <span className="mt-1 hidden truncate text-center text-[10.5px] text-white/35 sm:block" data-audio-marker-hint>{labels.hint}</span>}
      </div>
      {extend && direction !== "head" && ghost}

      <span className="hidden shrink-0 font-mono text-[11px] tabular-nums text-white/50 sm:inline">{time}</span>
      <div className="relative shrink-0">
        <button type="button" onClick={onReplace} aria-label={labels.replace} title={labels.replace} className="flex h-8 w-8 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white" data-audio-replace>
          <IconArrowsExchange size={15} stroke={1.75} aria-hidden="true" />
        </button>
        {replaceMenu}
      </div>
      <button type="button" onClick={onRemove} aria-label={labels.remove} title={labels.remove} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white" data-audio-remove>
        <IconX size={15} stroke={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}
