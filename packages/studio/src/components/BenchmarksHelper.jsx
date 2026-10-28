"use client";

// The Benchmarks helper bubble: a small closable card in the corner of every
// studio page that shows the Benchmarks picks for what that page does (best
// quality, best value, cheapest decent) so the visitor can select a
// recommended model without leaving the page. It follows the active tab,
// the studio's mode (text or image input, speech or music) and the
// visitor's provider keys. Which page shows which category is decided in
// benchmarksHelper.js; prices come from the same batched /api/price quotes
// the Benchmarks page uses. Nothing here generates anything.

import { useEffect, useMemo, useRef, useState } from "react";
import { IconArrowRight, IconCheck, IconChartBar, IconChevronDown, IconX } from "@tabler/icons-react";
import { priceOf, rankEntries } from "../benchmarks.js";
import {
  STUDIO_MODE_EVENT, benchmarksHref, getStudioMode, helperCategoryFor, helperEntries, helperRows, loadHelperOpen, saveHelperOpen,
} from "../benchmarksHelper.js";
import { providerName, routeFor } from "../providers/pricing.js";
import { PriceText, ScoreText, describePriceCell, fill, quotesSettled, useCategoryQuotes } from "./benchmarks/shared.jsx";
import { resolveCopy } from "../i18nUtils";
import en from "../messages/en/benchmarksHelper.json";
import zh from "../messages/zh/benchmarksHelper.json";
import benchmarksEn from "../messages/en/benchmarks.json";
import benchmarksZh from "../messages/zh/benchmarks.json";
import pricingEn from "../messages/en/pricing.json";
import pricingZh from "../messages/zh/pricing.json";

const USED_MS = 1500;

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

function PickRow({ item, kinds, price, copy, benchmarksCopy, used, onUse, compact = false }) {
  const { row } = item;
  return (
    <li className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0" data-helper-model={row.id}>
      {kinds.length > 0 ? (
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-primary/90">{kinds.map((kind) => benchmarksCopy.picks[kind]).join(" · ")}</p>
      ) : null}
      <div className="flex items-center gap-2">
        <p className={`min-w-0 flex-1 truncate ${compact ? "text-[12.5px]" : "text-[13px]"} font-semibold leading-tight text-white/90`} title={row.name}>{row.name}</p>
        <button
          type="button"
          onClick={() => onUse(row.id)}
          title={fill(copy.useTitle, { model: row.name })}
          aria-label={fill(copy.useTitle, { model: row.name })}
          data-helper-use={row.id}
          className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-[7px] border px-2 text-[11px] font-medium transition-colors ${used ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"}`}
        >
          {used ? <IconCheck size={12} stroke={2} aria-hidden="true" /> : null}
          {used ? copy.used : copy.use}
        </button>
      </div>
      <div className="flex items-center justify-between gap-2 text-[11.5px]">
        <PriceText view={price} size="text-[11.5px]" className="min-w-0" />
        <ScoreText row={row} copy={benchmarksCopy} size="text-[11.5px]" className="shrink-0" />
      </div>
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
  const { picks, more } = useMemo(() => helperRows(ranking), [ranking]);

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
        className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.12] bg-[#111114] text-white/60 shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-colors hover:border-primary/40 hover:text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
      >
        <IconChartBar size={16} stroke={1.75} aria-hidden="true" />
      </button>
    );
  }

  const priceFor = (row) => describePriceCell(row, settled ? quotes[row.id] : null, benchmarksCopy, pricingCopy, locale);

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
      className="flex max-h-[calc(100vh-88px)] w-[300px] max-w-[calc(100vw-32px)] flex-col overflow-y-auto rounded-[14px] border border-white/[0.12] bg-[#111114] text-white shadow-[0_16px_40px_rgba(0,0,0,0.5)] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/25"
    >
      <header className="flex items-start gap-2.5 px-3.5 pb-2 pt-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04] text-primary">
          <IconChartBar size={15} stroke={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold leading-5 text-white/90">{fill(copy.title, { category: categoryName })}</h2>
          <p className="text-[11px] leading-4 text-white/40">{copy.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label={copy.close}
          title={copy.close}
          className="-mr-1 -mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/35 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          <IconX size={14} stroke={1.75} aria-hidden="true" />
        </button>
      </header>

      <div className="border-t border-white/[0.07] px-3.5 py-2.5">
        {picks.length > 0 ? (
          <ul className="divide-y divide-white/[0.06]">
            {picks.map((item) => (
              <PickRow key={item.row.id} item={item} kinds={item.kinds} price={priceFor(item.row)} copy={copy} benchmarksCopy={benchmarksCopy} used={usedId === item.row.id} onUse={onUse} />
            ))}
          </ul>
        ) : (
          <p className="py-1 text-[12px] leading-snug text-white/45">{settled ? copy.noneHint : copy.pricing}</p>
        )}
        {picks.length > 0 && !settled ? <p className="pt-2 text-[11px] text-white/35">{copy.pricing}</p> : null}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-white/[0.07] px-3.5 py-2">
        {more.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowMore((value) => !value)}
            aria-expanded={showMore}
            data-helper-more={showMore ? "open" : "closed"}
            className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            {showMore ? copy.less : copy.more}
            <IconChevronDown size={13} stroke={1.75} aria-hidden="true" className={`transition-transform ${showMore ? "rotate-180" : ""}`} />
          </button>
        ) : <span />}
        <a
          href={href}
          onClick={openBenchmarks}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium text-primary transition-colors hover:bg-primary/10"
        >
          {copy.seeAll}
          <IconArrowRight size={13} stroke={1.75} aria-hidden="true" />
        </a>
      </footer>

      {showMore && more.length > 0 ? (
        <div className="border-t border-white/[0.07] px-3.5 py-2.5" data-helper-more-list>
          <ul className="divide-y divide-white/[0.06]">
            {more.map((row) => (
              <PickRow key={row.id} item={{ row }} kinds={[]} price={priceFor(row)} copy={copy} benchmarksCopy={benchmarksCopy} used={usedId === row.id} onUse={onUse} compact />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
