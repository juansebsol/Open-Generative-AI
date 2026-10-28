"use client";

// Benchmarks: per task category, the best model, the best value and the
// cheapest decent one, with a sortable table underneath so the picks are
// explainable. Scores are curated in providers/catalog/benchmarks.js; prices
// are the same /api/price quotes the price chip shows, asked for the active
// category only and a few at a time. Nothing here generates anything.

import { useEffect, useMemo, useState } from "react";
import { IconArrowRight, IconArrowDown, IconArrowUp, IconExternalLink, IconSelector } from "@tabler/icons-react";
import {
  BENCHMARKS_UPDATED, CATEGORIES, DECENT_GAP, TTS_SAMPLE_CHARACTERS, VALUE_FLOOR_GAP,
  benchmarkPayload, categoryEntries, compareRows, priceOf, rankEntries,
} from "../benchmarks.js";
import { describeQuote, providerName, quoteRuns, routeFor } from "../providers/pricing.js";
import { subscribeProviderSettings } from "../providers/keys.js";
import { resolveCopy } from "../i18nUtils";
import en from "../messages/en/benchmarks.json";
import zh from "../messages/zh/benchmarks.json";
import pricingEn from "../messages/en/pricing.json";
import pricingZh from "../messages/zh/pricing.json";

// Quotes go to /api/price in one batch per provider; a 429 from a provider's
// pricing API is retried with backoff instead of shown as an error.
const RETRY_MS = [2000, 5000, 10000, 20000];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fill = (template, values) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), String(template || ""));

// Quotes every entry of the active category, and again when the visitor's
// provider keys change. Entries nobody keyed fall back to a published list
// price when the model has one.
function useCategoryQuotes(entries, categoryId) {
  const [quotes, setQuotes] = useState({});
  const [settingsVersion, setSettingsVersion] = useState(0);
  useEffect(() => subscribeProviderSettings(() => setSettingsVersion((v) => v + 1)), []);

  useEffect(() => {
    let cancelled = false;
    setQuotes(Object.fromEntries(entries.map((entry) => [entry.id, { status: "loading", quote: null }])));
    const set = (id, state) => {
      if (!cancelled) setQuotes((previous) => ({ ...previous, [id]: state }));
    };
    (async () => {
      let pending = entries.map((entry) => ({ entry, payload: benchmarkPayload(entry.model, categoryId) }));
      for (let attempt = 0; pending.length > 0 && !cancelled; attempt += 1) {
        let results;
        try {
          results = await quoteRuns(pending.map(({ entry, payload }) => ({ endpoint: entry.endpoint, payload })), { listPrices: true });
        } catch {
          results = pending.map(() => ({ kind: "error" }));
        }
        const retry = [];
        results.forEach((quote, index) => {
          if (quote?.kind === "error" && quote.status === 429 && attempt < RETRY_MS.length) retry.push(pending[index]);
          else if (quote?.kind === "error") set(pending[index].entry.id, { status: "error", quote: null });
          else set(pending[index].entry.id, { status: "ready", quote });
        });
        pending = retry;
        if (pending.length > 0) await sleep(RETRY_MS[attempt]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entries, categoryId, settingsVersion]);

  return quotes;
}

const TONE = { muted: "text-white/55", ok: "text-emerald-300/85", warn: "text-amber-300/85" };

// Provider and price text for one row, in the price chip's vocabulary.
function describePriceCell(entry, state, copy, pricingCopy, locale) {
  if (!state || state.status === "loading") return { provider: "", label: copy.pricing, title: copy.pricing, tone: "muted" };
  if (state.status === "error") return { provider: "", label: copy.priceError, title: copy.priceError, tone: "warn" };
  const quote = state.quote;
  if (!quote) return null;
  if (quote.kind === "noProvider") {
    const providers = (quote.providers || []).map(providerName).join(", ");
    return { provider: "", label: copy.needsKey, title: fill(copy.needsKeyTitle, { providers }), tone: "warn" };
  }
  const described = describeQuote(quote, pricingCopy, locale);
  if (!described) return null;
  if (quote.listOnly) {
    return { ...described, tag: copy.listPrice, title: `${fill(copy.listPriceTitle, { provider: providerName(quote.provider) })} ${described.title}` };
  }
  return described;
}

function PriceText({ view, className = "" }) {
  if (!view) return null;
  return (
    <span title={view.title} className={`inline-flex min-w-0 items-center gap-1 text-[12px] font-semibold tabular-nums ${TONE[view.tone] || TONE.muted} ${className}`}>
      {view.provider ? <span className="truncate font-medium opacity-75">{view.provider}</span> : null}
      {view.provider ? <span aria-hidden="true" className="opacity-40">·</span> : null}
      <span className="truncate">{view.label}</span>
      {view.tag ? <span className="ml-0.5 rounded-full border border-white/[0.1] px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-white/45">{view.tag}</span> : null}
    </span>
  );
}

function ScoreText({ row, copy, className = "" }) {
  if (!Number.isFinite(row.score)) {
    return <span title={copy.unscoredTitle} className={`text-[12px] text-white/35 ${className}`}>{copy.unscored}</span>;
  }
  const title = [fill(copy.scoreTitle, { name: row.leaderboardName, source: row.source?.name, date: row.asOf }), row.note].filter(Boolean).join(" ");
  return (
    <span title={title} className={`text-[12px] font-semibold tabular-nums text-white/85 ${className}`}>
      {fill(copy.score, { score: row.score })}
    </span>
  );
}

const formatValue = (value, locale) => {
  if (value === null || value === undefined) return null;
  if (value === Infinity) return "∞";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
};

function openStudio(row) {
  window.dispatchEvent(new CustomEvent("oga:open-studio", { detail: { tabId: row.studio, modelId: row.id } }));
}

function PickCard({ kind, row, hint, copy, pricingCopy, locale, quotes, settled, sameAs }) {
  const state = row ? quotes[row.id] : null;
  const price = row ? describePriceCell(row, settled ? state : null, copy, pricingCopy, locale) : null;
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-white/[0.08] bg-[#111114] p-4" data-pick={kind}>
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-primary/90">{copy.picks[kind]}</h3>
        <p className="mt-0.5 text-[12px] leading-snug text-white/40">{hint}</p>
      </div>
      {row ? (
        <>
          <div className="min-w-0">
            <p className="truncate text-[16px] font-semibold leading-tight text-white" title={row.name}>{row.name}</p>
            {sameAs ? <p className="mt-0.5 text-[11.5px] text-white/35">{fill(copy.sameAs, { pick: copy.picks[sameAs] })}</p> : null}
          </div>
          <dl className="flex flex-col gap-1.5 text-[12px]">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-white/40">{copy.columns.price}</dt>
              <dd className="min-w-0 text-right"><PriceText view={price} /></dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-white/40">{copy.columns.score}</dt>
              <dd className="min-w-0 text-right">
                <ScoreText row={row} copy={copy} />
                {row.source ? (
                  <a href={row.source.url} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] text-white/40 hover:text-white/70" title={row.source.name}>
                    <IconExternalLink size={12} stroke={1.75} aria-hidden="true" />
                    <span>{row.asOf}</span>
                  </a>
                ) : null}
              </dd>
            </div>
            {Number.isFinite(row.value) || row.value === Infinity ? (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-white/40">{copy.columns.value}</dt>
                <dd className="text-right text-[12px] font-semibold tabular-nums text-white/70">{formatValue(row.value, locale)}</dd>
              </div>
            ) : null}
          </dl>
          <button
            type="button"
            onClick={() => openStudio(row)}
            className="mt-auto inline-flex h-8 items-center justify-center gap-1.5 self-start rounded-[9px] border border-primary/30 bg-primary/10 px-3 text-[12.5px] font-medium text-primary transition-colors hover:bg-primary/20"
          >
            {fill(copy.open, { studio: copy.studios[row.studio] || row.studio })}
            <IconArrowRight size={14} stroke={1.75} aria-hidden="true" />
          </button>
        </>
      ) : (
        <div className="rounded-[10px] border border-dashed border-white/[0.08] px-3 py-4">
          <p className="text-[13px] font-medium text-white/60">{settled ? copy.none : copy.pricing}</p>
          {settled ? <p className="mt-1 text-[12px] leading-snug text-white/35">{copy.noneHint}</p> : null}
        </div>
      )}
    </section>
  );
}

const COLUMNS = ["model", "provider", "price", "score", "value"];
const SORT_KEYS = { model: "name", provider: "providerLabel", price: "price", score: "score", value: "value" };
const DEFAULT_DIRECTION = { name: "asc", providerLabel: "asc", price: "asc", score: "desc", value: "desc" };

/**
 * @param {{ locale?: string }} props
 */
export default function BenchmarksStudio({ locale = "en" }) {
  const copy = resolveCopy(en, zh, locale);
  const pricingCopy = resolveCopy(pricingEn, pricingZh, locale);
  const categories = useMemo(() => CATEGORIES.filter((category) => category.models().length > 0), []);
  const [categoryId, setCategoryId] = useState(categories[0]?.id || CATEGORIES[0].id);
  const [sort, setSort] = useState({ key: "score", direction: "desc" });

  const entries = useMemo(() => categoryEntries(categoryId), [categoryId]);
  const quotes = useCategoryQuotes(entries, categoryId);
  const settled = entries.length > 0 && entries.every((entry) => ["ready", "error"].includes(quotes[entry.id]?.status));

  const ranking = useMemo(() => rankEntries(entries.map((entry) => {
    const state = quotes[entry.id];
    const quote = state?.status === "ready" ? state.quote : null;
    const provider = quote && quote.kind !== "noProvider" ? quote.provider : routeFor(entry.endpoint)?.provider;
    return { ...entry, price: settled ? priceOf(quote) : null, providerLabel: provider ? providerName(provider) : "" };
  })), [entries, quotes, settled]);

  const sortedRows = useMemo(() => [...ranking.rows].sort(compareRows(sort.key, sort.direction)), [ranking.rows, sort]);
  const sources = useMemo(() => [...new Map(ranking.rows.filter((row) => row.source).map((row) => [row.source.url, row.source])).values()], [ranking.rows]);
  const { best, bestValue, cheapestDecent } = ranking.picks;

  const toggleSort = (column) => {
    const key = SORT_KEYS[column];
    setSort((current) => ({ key, direction: current.key === key ? (current.direction === "asc" ? "desc" : "asc") : DEFAULT_DIRECTION[key] }));
  };

  const number = (value) => new Intl.NumberFormat(locale).format(value);
  const decentNote = ranking.topScore === null ? null : fill(copy.decentNote, {
    gap: number(DECENT_GAP), floor: number(ranking.decentFloor), valueFloor: number(ranking.valueFloor), valueGap: number(VALUE_FLOOR_GAP),
  });

  return (
    <div className="h-full w-full overflow-y-auto bg-app-bg text-white">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">{copy.title}</h1>
          <p className="max-w-[760px] text-[13.5px] leading-relaxed text-white/50">{copy.subtitle}</p>
        </header>

        <nav aria-label={copy.title} className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          {categories.map((category) => {
            const active = category.id === categoryId;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => setCategoryId(category.id)}
                aria-pressed={active}
                className={`h-[32px] shrink-0 rounded-full border px-3.5 text-[13px] font-medium transition-colors ${active ? "border-primary/40 bg-primary/10 text-white" : "border-white/[0.08] bg-white/[0.02] text-white/55 hover:border-white/[0.14] hover:text-white"}`}
              >
                {copy.categories[category.id] || category.id}
              </button>
            );
          })}
        </nav>

        {entries.length === 0 ? (
          <p className="rounded-[14px] border border-dashed border-white/[0.08] px-4 py-6 text-center text-[13px] text-white/45">{copy.empty}</p>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <PickCard kind="best" row={best} hint={copy.picks.bestHint} copy={copy} pricingCopy={pricingCopy} locale={locale} quotes={quotes} settled={settled} />
              <PickCard kind="bestValue" row={bestValue} hint={copy.picks.bestValueHint} copy={copy} pricingCopy={pricingCopy} locale={locale} quotes={quotes} settled={settled} sameAs={bestValue && best && bestValue.id === best.id ? "best" : null} />
              <PickCard kind="cheapestDecent" row={cheapestDecent} hint={fill(copy.picks.cheapestDecentHint, { gap: number(DECENT_GAP) })} copy={copy} pricingCopy={pricingCopy} locale={locale} quotes={quotes} settled={settled} sameAs={cheapestDecent && bestValue && cheapestDecent.id === bestValue.id ? "bestValue" : cheapestDecent && best && cheapestDecent.id === best.id ? "best" : null} />
            </div>

            <div className="overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0e0e11]">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-left text-[12.5px]">
                  <thead>
                    <tr className="border-b border-white/[0.08] text-[11px] uppercase tracking-[0.06em] text-white/40">
                      {COLUMNS.map((column) => {
                        const key = SORT_KEYS[column];
                        const active = sort.key === key;
                        const Icon = !active ? IconSelector : sort.direction === "asc" ? IconArrowUp : IconArrowDown;
                        return (
                          <th key={column} scope="col" className={`px-3 py-2.5 font-semibold ${column === "model" ? "" : "text-right"}`} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
                            <button type="button" onClick={() => toggleSort(column)} title={fill(copy.sortBy, { column: copy.columns[column] })} className={`inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-white/80 ${active ? "text-white/80" : ""}`}>
                              {copy.columns[column]}
                              <Icon size={12} stroke={1.75} aria-hidden="true" className={active ? "text-primary" : "text-white/25"} />
                            </button>
                          </th>
                        );
                      })}
                      <th scope="col" className="px-3 py-2.5"><span className="sr-only">{copy.open}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row) => {
                      const price = describePriceCell(row, quotes[row.id], copy, pricingCopy, locale);
                      const value = formatValue(row.value, locale);
                      const picked = [best, bestValue, cheapestDecent].some((pick) => pick?.id === row.id);
                      return (
                        <tr key={row.id} data-model={row.id} className={`border-b border-white/[0.05] last:border-b-0 ${picked ? "bg-primary/[0.04]" : "hover:bg-white/[0.02]"}`}>
                          <td className="max-w-[320px] px-3 py-2 align-middle">
                            <div className="truncate font-medium text-white/90" title={row.name}>{row.name}</div>
                            <div className="truncate font-mono text-[10.5px] text-white/30">{row.id}{row.decent ? <span className="ml-1.5 font-sans text-[10px] font-medium uppercase tracking-wide text-emerald-300/60">{copy.decent}</span> : null}</div>
                          </td>
                          <td className="px-3 py-2 text-right align-middle text-[12px] text-white/55">{row.providerLabel || <span className="text-white/25">—</span>}</td>
                          <td className="px-3 py-2 text-right align-middle"><PriceText view={price ? { ...price, provider: "" } : null} className="justify-end" /></td>
                          <td className="px-3 py-2 text-right align-middle"><ScoreText row={row} copy={copy} /></td>
                          <td className="px-3 py-2 text-right align-middle tabular-nums text-[12px] text-white/70">
                            {value !== null ? value : Number.isFinite(row.score) && settled && row.price === null ? <span title={copy.noPriceTitle} className="text-white/25">—</span> : <span className="text-white/25">—</span>}
                          </td>
                          <td className="px-3 py-2 text-right align-middle">
                            <button type="button" onClick={() => openStudio(row)} className="inline-flex h-7 items-center gap-1 rounded-[8px] border border-white/[0.08] px-2 text-[11.5px] font-medium text-white/60 transition-colors hover:border-primary/35 hover:text-primary" title={fill(copy.open, { studio: copy.studios[row.studio] || row.studio })}>
                              <IconArrowRight size={13} stroke={1.75} aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <footer className="flex flex-col gap-2 text-[12px] leading-relaxed text-white/40">
              {decentNote ? <p>{decentNote}</p> : null}
              {categoryId === "text-to-speech" ? <p>{fill(copy.perCharacters, { count: number(TTS_SAMPLE_CHARACTERS) })}</p> : null}
              <p>
                <span className="font-medium text-white/55">{copy.sourcesTitle}:</span>{" "}
                {sources.map((source, index) => (
                  <span key={source.url}>
                    {index > 0 ? ", " : ""}
                    <a href={source.url} target="_blank" rel="noreferrer" className="text-white/60 underline decoration-white/20 underline-offset-2 hover:text-white">{source.name}</a>
                  </span>
                ))}
                {sources.length > 0 ? ". " : ""}
                {fill(copy.updated, { date: BENCHMARKS_UPDATED })}
              </p>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
