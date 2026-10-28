"use client";

// The Benchmarks helper: a small closable leaderboard card, top right under
// the header on every studio page, with the Benchmarks picks for what that
// page does (best quality, best value, cheapest decent) so the visitor can
// select a recommended model without leaving the page. Each row is the Use
// target. The card follows the active tab, the studio's mode (text or image
// input, speech or music) and the visitor's provider keys. Which page shows
// which category is decided in benchmarksHelper.js; prices come from the
// same batched /api/price quotes the Benchmarks page uses. Nothing here
// generates anything.

import { useEffect, useMemo, useRef, useState } from "react";
import { IconArrowRight, IconCheck, IconChartBar, IconChevronDown, IconCoins, IconStarFilled, IconTag, IconTrophy, IconX } from "@tabler/icons-react";
import { priceOf, rankEntries } from "../benchmarks.js";
import {
  STUDIO_MODE_EVENT, benchmarksHref, getStudioMode, helperCategoryFor, helperEntries, helperRows, loadHelperOpen, saveHelperOpen,
} from "../benchmarksHelper.js";
import { providerName, routeFor } from "../providers/pricing.js";
import { describePriceCell, editorsPickTitle, fill, quotesSettled, useCategoryQuotes } from "./benchmarks/shared.jsx";
import { resolveCopy } from "../i18nUtils";
import en from "../messages/en/benchmarksHelper.json";
import zh from "../messages/zh/benchmarksHelper.json";
import benchmarksEn from "../messages/en/benchmarks.json";
import benchmarksZh from "../messages/zh/benchmarks.json";
import pricingEn from "../messages/en/pricing.json";
import pricingZh from "../messages/zh/pricing.json";

const USED_MS = 1500;
const KIND_ICON = { best: IconTrophy, bestValue: IconCoins, cheapestDecent: IconTag };

// The mode of the active tab, kept current as studios announce changes.
function useStudioMode(tabId) {
  const [mode, setMode] = useState(() => getStudioMode(tabId));
  useEffect(() => {
    setMode(getStudioMode(tabId));
    const onMode = (event) => {
      if (event.detail?.tabId === tabId) setMode(event.detail.mode);
    };
    window.addEventListener(STUDIO_MODE_EVENT, onMode);
    return () => window.removeEventListener(STUDIO_MODE_EVENT, onMode);
  }, [tabId]);
  return mode;
}

function selectModel(tabId, modelId) {
  window.dispatchEvent(new CustomEvent("oga:open-studio", { detail: { tabId, modelId } }));
}

// The pick marks (best quality, best value, cheapest decent) are icons
// only, named in the tooltip, so the price beside them always has room.
function KindMarks({ kinds, benchmarksCopy, className = "" }) {
  const label = kinds.map((kind) => benchmarksCopy.picks[kind]).join(" · ");
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 ${className}`} title={label} aria-label={label} role="img">
      {kinds.map((kind) => {
        const Icon = KIND_ICON[kind] || IconTrophy;
        return <Icon key={kind} size={11} stroke={2} aria-hidden="true" />;
      })}
    </span>
  );
}

// One row of the rail: rank, name, score bar, price and pick marks, Elo.
// `rank` null is the editor's choice row under its own heading: no rank
// column. `starTitle` adds the editor's star to the marks of the chart row.
function RailRow({ item, rank, starTitle = "", used, price, copy, benchmarksCopy, width, onUse }) {
  const chosen = rank === null;
  return (
    <li data-helper-model={item.row.id} data-editors-pick={chosen ? "choice" : starTitle ? "chart" : undefined}>
      <button
        type="button"
        onClick={() => onUse(item.row.id)}
        title={fill(copy.useTitle, { model: item.row.name })}
        data-helper-use={item.row.id}
        className={`group grid w-full items-center gap-x-2.5 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-white/[0.05] focus:outline-none focus-visible:bg-white/[0.05] ${chosen ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[26px_minmax(0,1fr)_auto]"}`}
      >
        {chosen ? null : (
          <span className={`flex items-center text-[20px] font-semibold leading-none tabular-nums ${used ? "text-emerald-300" : "text-white/20 group-hover:text-primary"}`}>
            {used ? <IconCheck size={18} stroke={2.25} aria-hidden="true" /> : rank}
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-medium leading-5 text-white/90">{item.row.name}</span>
          <span className="mt-1.5 block h-[3px] w-full overflow-hidden rounded-full bg-white/[0.06]">
            <span className="block h-full rounded-full bg-primary/70 transition-[width]" style={{ width }} />
          </span>
          <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-white/45">
            <span className={`shrink-0 whitespace-nowrap ${price?.tone === "warn" ? "text-amber-300/80" : "text-white/60"}`} title={price?.title}>{used ? copy.used : price?.label || ""}</span>
            {item.kinds.length > 0 ? <KindMarks kinds={item.kinds} benchmarksCopy={benchmarksCopy} className="text-primary/70" /> : null}
            {starTitle ? <span title={starTitle} aria-label={starTitle} role="img" className="inline-flex shrink-0 text-primary"><IconStarFilled size={11} aria-hidden="true" /></span> : null}
          </span>
        </span>
        <span className="text-right">
          <span className="block text-[12.5px] font-semibold tabular-nums leading-4 text-white/80">{item.row.score}</span>
          <span className="text-[10px] uppercase tracking-wide text-white/30">Elo</span>
        </span>
      </button>
    </li>
  );
}

/**
 * @param {{ tabId: string, locale?: string, benchmarksPath?: string }} props
 *   `benchmarksPath` is the shell's localized path of the Benchmarks page.
 */
export default function BenchmarksHelper({ tabId, locale = "en", benchmarksPath = "/studio/benchmarks" }) {
  const copy = resolveCopy(en, zh, locale);
  const benchmarksCopy = resolveCopy(benchmarksEn, benchmarksZh, locale);
  const pricingCopy = resolveCopy(pricingEn, pricingZh, locale);

  const mode = useStudioMode(tabId);
  const categoryId = helperCategoryFor(tabId, mode);
  const entries = useMemo(() => helperEntries(tabId, mode), [tabId, mode]);

  const [open, setOpen] = useState(() => loadHelperOpen({ narrow: typeof window !== "undefined" && window.matchMedia?.("(max-width: 639px)")?.matches === true }));
  const [showMore, setShowMore] = useState(false);
  const [usedId, setUsedId] = useState(null);
  const cardRef = useRef(null);
  const reopenRef = useRef(null);
  const focusOnOpen = useRef(false);

  const visible = Boolean(categoryId) && entries.length > 0;
  const quotes = useCategoryQuotes(entries, categoryId, { enabled: visible && open });
  const settled = quotesSettled(entries, quotes);

  const ranking = useMemo(() => rankEntries(entries.map((entry) => {
    const state = quotes[entry.id];
    const quote = state?.status === "ready" ? state.quote : null;
    const provider = quote && quote.kind !== "noProvider" ? quote.provider : routeFor(entry.endpoint)?.provider;
    return { ...entry, price: settled ? priceOf(quote) : null, providerLabel: provider ? providerName(provider) : "" };
  })), [entries, quotes, settled]);
  const { editorsPick, picks, more } = useMemo(() => helperRows(ranking, undefined, { categoryId }), [ranking, categoryId]);

  // The card takes focus only when the visitor just opened it, so Escape
  // works at once; switching tabs never steals focus from the prompt.
  useEffect(() => {
    if (open && focusOnOpen.current) {
      focusOnOpen.current = false;
      cardRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!usedId) return undefined;
    const timer = setTimeout(() => setUsedId(null), USED_MS);
    return () => clearTimeout(timer);
  }, [usedId]);

  // A new page starts with the "More" list collapsed.
  useEffect(() => {
    setShowMore(false);
  }, [tabId, categoryId]);

  if (!visible) return null;

  const close = () => {
    setOpen(false);
    saveHelperOpen(false);
    requestAnimationFrame(() => reopenRef.current?.focus());
  };
  const reopen = () => {
    focusOnOpen.current = true;
    setOpen(true);
    saveHelperOpen(true);
  };
  const onUse = (modelId) => {
    selectModel(tabId, modelId);
    setUsedId(modelId);
  };
  const categoryName = benchmarksCopy.categories[categoryId] || categoryId;
  const href = benchmarksHref(benchmarksPath, categoryId);
  const openBenchmarks = (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.dispatchEvent(new CustomEvent("oga:open-studio", { detail: { tabId: "benchmarks", categoryId } }));
  };

  if (!open) {
    return (
      <button
        ref={reopenRef}
        type="button"
        onClick={reopen}
        title={copy.reopen}
        aria-label={copy.reopen}
        data-benchmarks-helper="closed"
        data-category={categoryId}
        className="fixed right-4 top-[68px] z-[95] flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.12] bg-[#121215] text-white/60 shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-colors hover:border-primary/40 hover:text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
      >
        <IconChartBar size={16} stroke={1.75} aria-hidden="true" />
      </button>
    );
  }

  const priceFor = (row) => describePriceCell(row, settled ? quotes[row.id] : null, benchmarksCopy, pricingCopy, locale);
  // Picks by score, then the "More" rows continue the numbering.
  const ranked = [...picks].sort((a, b) => b.row.score - a.row.score);
  const rows = showMore ? [...ranked, ...more.map((row) => ({ row, kinds: [] }))] : ranked;
  // The editor's choice has its own section above the chart; in the chart
  // it keeps its numbered place, marked with the star.
  const starTitle = editorsPick ? editorsPickTitle(categoryId, locale) : "";
  // The score bar is relative to the leader: 400 Elo below it is the floor.
  const top = Math.max(rows[0]?.row.score ?? 0, editorsPick?.row.score ?? 0);
  const floor = top - 400;
  const width = (score) => `${Math.round(30 + 70 * Math.max(0, Math.min(1, (score - floor) / (top - floor || 1))))}%`;

  return (
    <section
      ref={cardRef}
      tabIndex={-1}
      role="complementary"
      aria-label={fill(copy.title, { category: categoryName })}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
      data-benchmarks-helper="open"
      data-category={categoryId}
      data-settled={settled ? "true" : "false"}
      className="fixed right-4 top-[68px] z-[95] flex max-h-[calc(100vh-88px)] w-[288px] max-w-[calc(100vw-32px)] flex-col overflow-y-auto rounded-2xl border border-white/[0.1] bg-[#121215]/95 text-white shadow-[0_24px_60px_rgba(0,0,0,0.55)] backdrop-blur-md focus:outline-none"
    >
      <header className="flex items-start justify-between gap-2 px-4 pb-1 pt-3.5">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary/80">{copy.eyebrow}</p>
          <h2 className="mt-0.5 truncate text-[17px] font-semibold leading-6 tracking-[-0.01em] text-white">{categoryName}</h2>
        </div>
        <button type="button" onClick={close} aria-label={copy.close} title={copy.close} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/35 transition-colors hover:bg-white/[0.07] hover:text-white">
          <IconX size={14} stroke={1.75} aria-hidden="true" />
        </button>
      </header>

      {editorsPick ? (
        <div className="px-2" data-helper-editors-choice={editorsPick.row.id}>
          <p className="flex items-center gap-1.5 px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary/80" title={starTitle}>
            <IconStarFilled size={10} aria-hidden="true" />
            {copy.editorsChoice}
          </p>
          <ul>
            <RailRow item={{ row: editorsPick.row, kinds: [] }} rank={null} used={usedId === editorsPick.row.id} price={priceFor(editorsPick.row)} copy={copy} benchmarksCopy={benchmarksCopy} width={width(editorsPick.row.score)} onUse={onUse} />
          </ul>
          <div role="separator" className="mx-2 mt-1 border-t border-white/[0.08]" />
        </div>
      ) : null}
      {rows.length > 0 ? (
        <ol className={`px-2 pb-1 ${editorsPick ? "pt-1" : ""}`}>
          {rows.map((item, index) => (
            <RailRow key={item.row.id} item={item} rank={index + 1} starTitle={editorsPick && editorsPick.row.id === item.row.id ? starTitle : ""} used={usedId === item.row.id} price={priceFor(item.row)} copy={copy} benchmarksCopy={benchmarksCopy} width={width(item.row.score)} onUse={onUse} />
          ))}
        </ol>
      ) : (
        <p className="px-4 py-3 text-[12px] leading-snug text-white/45">{settled ? copy.noneHint : copy.pricing}</p>
      )}

      <footer className="mt-auto flex items-center justify-between gap-2 border-t border-white/[0.07] px-3 py-2">
        {more.length > 0 ? (
          <button type="button" onClick={() => setShowMore((value) => !value)} aria-expanded={showMore} data-helper-more={showMore ? "open" : "closed"} className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11.5px] font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white">
            {showMore ? copy.less : fill(copy.showMore, { count: more.length })}
            <IconChevronDown size={13} stroke={1.75} aria-hidden="true" className={`transition-transform ${showMore ? "rotate-180" : ""}`} />
          </button>
        ) : <span />}
        <a href={href} onClick={openBenchmarks} className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11.5px] font-medium text-primary transition-colors hover:bg-primary/10">
          {copy.openBenchmarks}
          <IconArrowRight size={13} stroke={1.75} aria-hidden="true" />
        </a>
      </footer>
    </section>
  );
}
