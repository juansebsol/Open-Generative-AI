"use client";

import { useEffect, useState } from "react";
import { IconArrowRight } from "@tabler/icons-react";

// Shared empty state for the studios: a headline with the selected model as
// the accent, optional starter prompts, and a slow wall of showcase outputs
// loaded from /assets/showcase/manifest.json (see public/assets/showcase).
// Hovering a tile shows the prompt behind it; clicking loads that prompt.

const MANIFEST_URL = "/assets/showcase/manifest.json";
const RATIO_CLASS = { "3:4": "aspect-[3/4]", "1:1": "aspect-square", "4:5": "aspect-[4/5]", "4:3": "aspect-[4/3]", "16:9": "aspect-video" };

let manifestPromise = null;
function loadManifest() {
  manifestPromise ||= fetch(MANIFEST_URL)
    .then((response) => (response.ok ? response.json() : { items: [] }))
    .then((data) => (Array.isArray(data?.items) ? data.items : []))
    .catch(() => []);
  return manifestPromise;
}

function ShowcaseWall({ kind, onPick, copy }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    loadManifest().then((all) => {
      if (cancelled) return;
      const matching = all.filter((item) => !kind || !item.kind || item.kind === kind);
      setItems(matching.length >= 6 ? matching : all);
    });
    return () => { cancelled = true; };
  }, [kind]);

  if (items.length < 6) return null;
  const columns = [0, 1, 2].map((column) => items.filter((_, index) => index % 3 === column));

  return (
    <div className="relative h-full min-h-0" aria-hidden="true">
      <div
        className="absolute inset-0 grid grid-cols-3 gap-2.5 oga-wall"
        style={{ WebkitMaskImage: "linear-gradient(180deg, transparent, #000 14%, #000 86%, transparent)", maskImage: "linear-gradient(180deg, transparent, #000 14%, #000 86%, transparent)" }}
      >
        <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-r from-app-bg via-transparent to-transparent" style={{ backgroundImage: "linear-gradient(90deg, #09090b, transparent 22%)" }} />
        {columns.map((column, index) => (
          <div key={index} className={`flex flex-col gap-2.5 ${index === 1 ? "oga-wall-down" : "oga-wall-up"} ${index === 2 ? "oga-wall-slow" : ""}`}>
            {[...column, ...column].map((item, itemIndex) => (
              <button
                key={`${item.src}-${itemIndex}`}
                type="button"
                tabIndex={-1}
                title={item.prompt}
                onClick={() => item.prompt && onPick?.(item.prompt)}
                className={`group relative shrink-0 overflow-hidden rounded-[10px] border border-white/[0.07] bg-[#111114] text-left transition-transform duration-300 hover:scale-[1.02] ${RATIO_CLASS[item.ratio] || "aspect-[3/4]"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.src} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                {item.prompt && (
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#09090b]/95 to-transparent px-2.5 pb-2.5 pt-8 text-[11.5px] leading-snug text-white/90 opacity-0 transition-opacity group-hover:opacity-100">
                    {item.prompt}
                    {copy?.usePrompt && <span className="mt-1 block text-[10.5px] text-primary">{copy.usePrompt}</span>}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {string} props.heading      "Start creating with"
 * @param {string} props.accent       The model or studio name shown in cyan.
 * @param {string} [props.subtitle]
 * @param {{label: string, prompt: string}[]} [props.starters]
 * @param {(prompt: string) => void} [props.onStarter]
 * @param {"image"|"video"|null} [props.showcase]  Which outputs to show on the wall; null hides it.
 * @param {{usePrompt?: string}} [props.copy]
 */
export default function StudioEmptyState({ heading, accent, subtitle, starters = [], onStarter, showcase = "image", copy }) {
  const withWall = Boolean(showcase);
  return (
    <div className={`h-full w-full ${withWall ? "grid grid-cols-1 md:grid-cols-[5fr_7fr] md:grid-rows-[minmax(0,1fr)] md:items-center gap-6 md:gap-12 px-6 md:px-14" : "flex items-center px-6 md:px-16"} mx-auto max-w-[1280px] py-6`}>
      <div className="min-w-0 max-w-[460px]">
        <h1 className="text-[28px] md:text-[36px] font-semibold tracking-[-0.025em] leading-[1.1] text-white/[0.92]">
          {heading} <em className="not-italic text-primary whitespace-nowrap">{accent}</em>
        </h1>
        {subtitle && <p className="mt-3.5 max-w-[40ch] text-[15px] leading-relaxed text-white/55">{subtitle}</p>}
        {starters.length > 0 && (
          <nav className="mt-6 max-w-[420px]">
            {starters.map((starter) => (
              <button
                key={starter.prompt}
                type="button"
                onClick={() => onStarter?.(starter.prompt)}
                className="group flex w-full items-center justify-between gap-4 border-t border-white/[0.08] py-3 text-left text-[14px] leading-snug text-white/70 transition-colors last:border-b hover:text-white"
              >
                <span>{starter.label}</span>
                <IconArrowRight size={14} stroke={1.75} className="shrink-0 text-white/35 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-primary" />
              </button>
            ))}
          </nav>
        )}
      </div>
      {withWall && (
        <div className="hidden md:block h-full min-h-0">
          <ShowcaseWall kind={showcase} onPick={onStarter} copy={copy} />
        </div>
      )}
    </div>
  );
}
