"use client";

// Remix's track slot before a track is in: a small round button that pulses
// until you add one, and the picker it opens (upload a file, or pick a track
// from your library with a play preview). While a file uploads, the button
// becomes a progress ring with the file's name.

import { useEffect, useRef, useState } from "react";
import { IconMusicPlus, IconPlayerPauseFilled, IconPlayerPlayFilled, IconSearch, IconUpload } from "@tabler/icons-react";
import { PromptPopover } from "../prompt/PromptComposer.jsx";
import { useAudio } from "./AudioPlayer.jsx";

const RING = 2 * Math.PI * 15;

/**
 * @param {object} props
 * @param {boolean} props.open  the picker is showing
 * @param {{ progress?: number, name?: string } | null} props.uploading
 * @param {() => void} props.onClick
 * @param {{ add: string, hint: string, uploading: string }} props.labels  `uploading` holds "{progress}"
 */
export function AddTrackButton({ open, uploading, onClick, labels }) {
  if (uploading) {
    const progress = Math.max(0, Math.min(100, Math.round(uploading.progress || 0)));
    const status = labels.uploading.replace("{progress}", progress);
    return (
      <div className="flex h-10 min-w-0 items-center gap-2.5" role="status" aria-label={`${uploading.name || ""} ${status}`.trim()} data-audio-uploading>
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/35 bg-primary/[0.05]">
          <svg viewBox="0 0 34 34" className="absolute left-[2px] top-[2px] h-[34px] w-[34px] -rotate-90" aria-hidden="true">
            <circle cx="17" cy="17" r="15" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
            <circle cx="17" cy="17" r="15" fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeDasharray={RING} strokeDashoffset={RING * (1 - progress / 100)} className="transition-[stroke-dashoffset] duration-300" />
          </svg>
          <span className="font-mono text-[9.5px] font-semibold text-primary">{progress}%</span>
        </span>
        <span className="flex min-w-0 flex-col gap-px" aria-hidden="true">
          {uploading.name && <span className="truncate text-[13px] font-medium text-white">{uploading.name}</span>}
          <span className="text-[11.5px] text-white/50">{status}</span>
        </span>
      </div>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-expanded={open} aria-haspopup="dialog" className="group flex h-10 min-w-0 items-center gap-2.5 rounded-full pr-3.5 text-left focus:outline-none" data-audio-add-track>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-primary transition-colors group-focus-visible:outline group-focus-visible:outline-1 group-focus-visible:outline-offset-2 group-focus-visible:outline-primary/60 ${open ? "border-primary/70 bg-primary/[0.12]" : "oga-pulse-ring border-primary/60 bg-primary/[0.06] group-hover:bg-primary/[0.12]"}`}>
        <IconMusicPlus size={17} stroke={1.75} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-col gap-px">
        <span className="text-[13px] font-medium text-white">{labels.add}</span>
        <span className="truncate text-[11.5px] text-white/50 transition-colors group-hover:text-white/65">{labels.hint}</span>
      </span>
    </button>
  );
}

/**
 * The picker: an Upload button with the accepted files, then your library.
 * Each row plays a preview; picking a row uses that track.
 *
 * @param {object} props
 * @param {{ value: string, url: string, label: string, description?: string, length?: string }[]} props.tracks
 * @param {string | null} [props.value]  the track in use
 * @param {(value: string) => void} props.onPick
 * @param {() => void} props.onUpload
 * @param {string} [props.positionClassName]
 * @param {{ title: string, upload: string, hint: string, library: string, search: string, empty: string, noMatch: string, play: string, pause: string }} props.labels
 *   `play` and `pause` hold "{name}"
 */
export function TrackPicker({ tracks, value = null, onPick, onUpload, positionClassName, labels }) {
  const [query, setQuery] = useState("");
  const [previewUrl, setPreviewUrl] = useState(null);
  const player = useAudio(previewUrl);
  const startPreview = useRef(false);
  const { play } = player;
  // useAudio swaps its element in its own effect, which runs before this one.
  useEffect(() => {
    if (!startPreview.current) return;
    startPreview.current = false;
    play();
  }, [previewUrl, play]);

  const preview = (url) => {
    if (url === previewUrl) return player.toggle();
    startPreview.current = true;
    setPreviewUrl(url);
    return undefined;
  };
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length ? tracks.filter((track) => words.every((word) => `${track.label} ${track.description || ""}`.toLowerCase().includes(word))) : tracks;

  return (
    <PromptPopover role="dialog" aria-label={labels.title} className="w-[360px] max-w-[calc(100vw-2rem)]" positionClassName={positionClassName} fitViewport solid data-audio-track-picker>
      <div className="flex items-center justify-between gap-3 px-1.5 pt-0.5">
        <span className="text-[12px] font-semibold text-white/75">{labels.title}</span>
        <button type="button" onClick={onUpload} className="flex h-7 items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 text-[12px] font-semibold text-primary transition-colors hover:bg-primary/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/60" data-audio-upload>
          <IconUpload size={12} stroke={2.25} aria-hidden="true" />{labels.upload}
        </button>
      </div>
      <p className="px-1.5 pb-2.5 pt-1.5 text-[11.5px] leading-snug text-white/50">{labels.hint}</p>
      {tracks.length === 0 ? (
        <p className="mx-1.5 mb-1 rounded-[10px] border border-dashed border-white/10 px-3 py-3 text-[12px] leading-snug text-white/45">{labels.empty}</p>
      ) : (
        <>
          <label className="mb-2 flex h-[34px] items-center gap-2 rounded-[10px] border border-white/[0.07] bg-white/[0.04] px-2.5 text-white/45 focus-within:border-primary/50">
            <IconSearch size={13} stroke={2} aria-hidden="true" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={labels.search} aria-label={labels.search} className="h-full w-full min-w-0 bg-transparent text-[12.5px] text-white placeholder:text-white/35 focus:outline-none" />
          </label>
          <div className="px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/45">{labels.library}</div>
          <div className="flex max-h-[28vh] flex-col gap-0.5 overflow-y-auto pr-0.5 custom-scrollbar">
            {shown.length === 0 && <div className="py-4 text-center text-[12px] text-white/35">{labels.noMatch}</div>}
            {shown.map((track) => {
              const sounding = track.url === previewUrl && player.playing;
              const selected = track.value === value;
              const action = (sounding ? labels.pause : labels.play).replace("{name}", track.label);
              return (
                <div key={track.value} className={`flex h-[46px] shrink-0 items-center gap-2.5 rounded-[10px] px-1.5 transition-colors hover:bg-white/[0.05] ${selected ? "bg-white/[0.05]" : ""}`}>
                  <button type="button" onClick={() => preview(track.url)} aria-label={action} title={action} className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 ${sounding ? "bg-primary text-[#04202a]" : "bg-white/[0.08] text-white hover:bg-white/[0.14]"}`} data-audio-track-preview>
                    {sounding ? <IconPlayerPauseFilled size={11} aria-hidden="true" /> : <IconPlayerPlayFilled size={11} className="ml-px" aria-hidden="true" />}
                  </button>
                  <button type="button" onClick={() => onPick(track.value)} aria-current={selected || undefined} className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-md text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50" data-audio-track={track.value}>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[13px] font-medium text-white">{track.label}</span>
                      {track.description && <span className="truncate text-[11.5px] text-white/50">{track.description}</span>}
                    </span>
                    {track.length && <span className="shrink-0 pr-1 font-mono text-[11px] tabular-nums text-white/55">{track.length}</span>}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </PromptPopover>
  );
}
