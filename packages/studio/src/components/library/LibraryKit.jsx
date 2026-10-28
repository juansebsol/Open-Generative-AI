"use client";

// The shared look of a studio library: the hover action column on a card,
// the details strip under it (prompt, model, size, cost, date) and the
// full-screen viewer with its tool rail on the left. Image Studio set the
// style; Vector Studio and any new studio build their cards from these so
// every library reads the same way.

import { useEffect, useState } from "react";
import { IconX } from "@tabler/icons-react";
import { formatMoney } from "../../providers/pricing.js";

const ACTION_CLASS = "flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white backdrop-blur-md transition-all hover:bg-primary hover:text-black";
const DANGER_CLASS = "flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/60 text-red-400 backdrop-blur-md transition-all hover:bg-red-500 hover:text-white";
const TOOL_CLASS = "group/tool relative flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.08] text-white backdrop-blur-md transition-all hover:bg-primary hover:text-black";
const TOOL_DANGER_CLASS = "group/tool relative flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.08] text-red-300 backdrop-blur-md transition-all hover:bg-red-500 hover:text-white";

/**
 * One hover action: { key, label, icon, onSelect, danger?, node? }. A
 * `node` is rendered as is (the copy buttons bring their own markup).
 */
export function LibraryActions({ actions = [], className = "" }) {
  const list = actions.filter(Boolean);
  if (list.length === 0) return null;
  return (
    <div className={`absolute right-2 top-2 hidden flex-col gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 md:flex ${className}`} onClick={(event) => event.stopPropagation()}>
      {list.map((action) => action.node ? <span key={action.key} className="contents">{action.node}</span> : (
        <button
          key={action.key}
          type="button"
          title={action.label}
          aria-label={action.label}
          onClick={(event) => { event.stopPropagation(); action.onSelect?.(); }}
          className={action.danger ? DANGER_CLASS : ACTION_CLASS}
        >
          {action.icon}
        </button>
      ))}
    </div>
  );
}

/** The strip under a card: the prompt, then the model chip and small facts. */
export function LibraryDetails({ prompt, fallback, model, facts = [], trailing = null }) {
  const items = facts.filter((fact) => fact && fact.value);
  return (
    <div className="flex flex-1 flex-col justify-between gap-2 border-t border-white/5 bg-black/80 p-3 backdrop-blur-sm">
      <p className="line-clamp-3 text-xs leading-relaxed text-white/70" title={prompt}>{prompt || fallback}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        {model && <span className="rounded border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-bold capitalize text-primary">{model}</span>}
        {items.map((fact) => <span key={fact.key || fact.value} className="text-[10px] text-white/40" title={fact.title}>{fact.value}</span>)}
        {trailing?.value && <span className="ml-auto text-[10px] text-white/30" title={trailing.title}>{trailing.value}</span>}
      </div>
    </div>
  );
}

/** "$0.04" for a stored cost, or null. */
export function formatCost(cost, locale = "en") {
  if (!cost || typeof cost.amount !== "number") return null;
  if (cost.amount === 0) return null;
  return formatMoney(cost.amount, cost.currency || "USD", locale);
}

/** "28 Oct, 14:02" for an ISO timestamp, or null. */
export function formatWhen(timestamp, locale = "en") {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

/** "1024 × 1024" for a size, or null. */
export function formatSize(width, height) {
  if (!(width > 0 && height > 0)) return null;
  return `${Math.round(width)} × ${Math.round(height)}`;
}

const sizeCache = new Map();
/** The natural pixel size of an image URL, cached across cards. */
export function useImageSize(url) {
  const [size, setSize] = useState(() => (url && sizeCache.get(url)) || null);
  useEffect(() => {
    if (!url) return undefined;
    const hit = sizeCache.get(url);
    if (hit) {
      setSize(hit);
      return undefined;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      const next = { width: image.naturalWidth, height: image.naturalHeight };
      sizeCache.set(url, next);
      if (!cancelled) setSize(next);
    };
    image.src = url;
    return () => { cancelled = true; };
  }, [url]);
  return size;
}

/**
 * The full-screen viewer. `tools` is a list of { key, label, icon, onSelect,
 * danger?, active?, node? } drawn as a rail down the left edge, the same
 * buttons the card shows on hover; `caption` sits under the media.
 */
export function Lightbox({ onClose, tools = [], caption = null, closeLabel = "Close", children }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const list = tools.filter(Boolean);
  return (
    <div className="oga-backdrop-in fixed inset-0 z-[120] flex items-center justify-center bg-black/95 backdrop-blur-sm" onClick={onClose} role="presentation" data-library-lightbox>
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onClose(); }}
        aria-label={closeLabel}
        title={closeLabel}
        className="oga-enter absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white transition-colors hover:bg-white/20 md:right-6 md:top-6"
      >
        <IconX size={20} stroke={2} aria-hidden="true" />
      </button>

      {list.length > 0 && (
        <div className="absolute left-3 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-2 md:left-6" onClick={(event) => event.stopPropagation()} role="toolbar" aria-orientation="vertical">
          {list.map((tool, index) => tool.node ? (
            <span key={tool.key} className="oga-enter contents" style={{ "--i": index }}>{tool.node}</span>
          ) : (
            <button
              key={tool.key}
              type="button"
              title={tool.label}
              aria-label={tool.label}
              aria-pressed={tool.active === undefined ? undefined : tool.active}
              onClick={(event) => { event.stopPropagation(); tool.onSelect?.(); }}
              style={{ "--i": index }}
              className={`oga-enter ${tool.danger ? TOOL_DANGER_CLASS : TOOL_CLASS} ${tool.active ? "!bg-primary !text-black" : ""}`}
            >
              {tool.icon}
              <span className="pointer-events-none absolute left-full top-1/2 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-white/10 bg-black/80 px-2 py-1 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover/tool:opacity-100 md:block">{tool.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="oga-dialog-in flex max-h-[95vh] max-w-[95vw] flex-col items-center gap-3 pl-14 pr-14 md:pl-20 md:pr-20" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        {children}
        {caption && <div className="max-w-[min(90vw,720px)] text-center text-[12px] text-white/60">{caption}</div>}
      </div>
    </div>
  );
}
