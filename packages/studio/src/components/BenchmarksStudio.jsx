"use client";

// Benchmarks: per task category, the best model, the best value and the
// cheapest decent one, with a sortable table underneath so the picks are
// explainable. Scores are curated in providers/catalog/benchmarks.js; prices
// are the same /api/price quotes the price chip shows, asked for the active
// category only and a few at a time. Nothing here generates anything.

import { useEffect, useMemo, useState } from "react";
import { IconArrowRight, IconArrowDown, IconArrowUp, IconExternalLink, IconSelector, IconStarFilled } from "@tabler/icons-react";
import {
  BENCHMARKS_UPDATED, CATEGORIES, DECENT_GAP, SVG_PROMPT_CHARACTERS, TTS_SAMPLE_CHARACTERS, VALUE_FLOOR_GAP,
  categoryEntries, compareRows, editorsPickRow, priceOf, rankEntries,
} from "../benchmarks.js";
import { providerName, routeFor } from "../providers/pricing.js";
import { PriceText, ScoreText, describePriceCell, fill, formatValue, quotesSettled, useCategoryQuotes } from "./benchmarks/shared.jsx";
import { resolveCopy } from "../i18nUtils";
import en from "../messages/en/benchmarks.json";
import zh from "../messages/zh/benchmarks.json";
import pricingEn from "../messages/en/pricing.json";
import pricingZh from "../messages/zh/pricing.json";

function openStudio(row) {
  window.dispatchEvent(new CustomEvent("oga:open-studio", { detail: { tabId: row.studio, modelId: row.id } }));
}

// `kind` "editorsPick" is the curated card: a star, a thin cyan outline and
// the pick's note as its hint; the three computed cards are unchanged.
function PickCard({ kind, row, hint, copy, pricingCopy, locale, quotes, settled, sameAs }) {
  const state = row ? quotes[row.id] : null;
  const price = row ? describePriceCell(row, settled ? state : null, copy, pricingCopy, locale) : null;
  const curated = kind === "editorsPick";
  return (
    <section className={`flex min-w-0 flex-col gap-3 rounded-[14px] border bg-[#111114] p-4 ${curated ? "border-primary/40 shadow-[0_0_0_1px_rgba(34,211,238,0.12)]" : "border-white/[0.08]"}`} data-pick={kind}>
      <div>
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary/90">
          {curated ? <IconStarFilled size={12} aria-hidden="true" /> : null}
          {copy.picks[kind]}
        </h3>
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

  // The helper bubble's "See all" lands here with its category, as
  // ?category= in the URL or through the open-studio event.
  useEffect(() => {
    const valid = (id) => categories.some((category) => category.id === id);
    const fromUrl = new URLSearchParams(window.location.search).get("category");
    if (valid(fromUrl)) setCategoryId(fromUrl);
    const onOpen = (event) => {
      const { tabId, categoryId: wanted } = event.detail || {};
      if (tabId === "benchmarks" && valid(wanted)) setCategoryId(wanted);
    };
    window.addEventListener("oga:open-studio", onOpen);
    return () => window.removeEventListener("oga:open-studio", onOpen);
  }, [categories]);

  const entries = useMemo(() => categoryEntries(categoryId), [categoryId]);
  const quotes = useCategoryQuotes(entries, categoryId);
  const settled = quotesSettled(entries, quotes);

  const ranking = useMemo(() => rankEntries(entries.map((entry) => {
    const state = quotes[entry.id];
    const quote = state?.status === "ready" ? state.quote : null;
    const provider = quote && quote.kind !== "noProvider" ? quote.provider : routeFor(entry.endpoint)?.provider;
    return { ...entry, price: settled ? priceOf(quote) : null, providerLabel: provider ? providerName(provider) : "" };
  })), [entries, quotes, settled]);

  const sortedRows = useMemo(() => [...ranking.rows].sort(compareRows(sort.key, sort.direction)), [ranking.rows, sort]);
  const editorsPick = useMemo(() => editorsPickRow(categoryId, ranking.rows), [categoryId, ranking.rows]);
  const editorsPickTitle = editorsPick ? fill(copy.editorsPickTitle, { note: editorsPick.editorsPick.note }) : "";
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
        <header className="oga-enter flex flex-col gap-2">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">{copy.title}</h1>
          <p className="max-w-[760px] text-[13.5px] leading-relaxed text-white/50">{copy.subtitle}</p>
        </header>

        <nav aria-label={copy.title} style={{ "--i": 1 }} className="oga-enter -mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
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
          <p key={categoryId} style={{ "--i": 2 }} className="oga-enter rounded-[14px] border border-dashed border-white/[0.08] px-4 py-6 text-center text-[13px] text-white/45">{copy.empty}</p>
        ) : (
          <>
            <div key={categoryId} style={{ "--i": 2 }} className={`oga-enter grid gap-3 ${editorsPick ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-3"}`}>
              {editorsPick ? <PickCard kind="editorsPick" row={editorsPick} hint={editorsPick.editorsPick.note} copy={copy} pricingCopy={pricingCopy} locale={locale} quotes={quotes} settled={settled} /> : null}
              <PickCard kind="best" row={best} hint={copy.picks.bestHint} copy={copy} pricingCopy={pricingCopy} locale={locale} quotes={quotes} settled={settled} />
              <PickCard kind="bestValue" row={bestValue} hint={copy.picks.bestValueHint} copy={copy} pricingCopy={pricingCopy} locale={locale} quotes={quotes} settled={settled} sameAs={bestValue && best && bestValue.id === best.id ? "best" : null} />
              <PickCard kind="cheapestDecent" row={cheapestDecent} hint={fill(copy.picks.cheapestDecentHint, { gap: number(DECENT_GAP) })} copy={copy} pricingCopy={pricingCopy} locale={locale} quotes={quotes} settled={settled} sameAs={cheapestDecent && bestValue && cheapestDecent.id === bestValue.id ? "bestValue" : cheapestDecent && best && cheapestDecent.id === best.id ? "best" : null} />
            </div>

            <div key={`table-${categoryId}`} style={{ "--i": 3 }} className="oga-enter overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0e0e11]">
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
                      const picked = [editorsPick, best, bestValue, cheapestDecent].some((pick) => pick?.id === row.id);
                      return (
                        <tr key={row.id} data-model={row.id} className={`border-b border-white/[0.05] last:border-b-0 ${picked ? "bg-primary/[0.04]" : "hover:bg-white/[0.02]"}`}>
                          <td className="max-w-[320px] px-3 py-2 align-middle">
                            <div className="flex min-w-0 items-center gap-1.5 font-medium text-white/90">
                              <span className="truncate" title={row.name}>{row.name}</span>
                              {editorsPick && editorsPick.id === row.id ? <span title={editorsPickTitle} aria-label={editorsPickTitle} role="img" data-editors-pick={row.id} className="inline-flex shrink-0 text-primary"><IconStarFilled size={11} aria-hidden="true" /></span> : null}
                            </div>
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

            <footer style={{ "--i": 4 }} className="oga-enter-fade flex flex-col gap-2 text-[12px] leading-relaxed text-white/40">
              {decentNote ? <p>{decentNote}</p> : null}
              {categoryId === "text-to-speech" ? <p>{fill(copy.perCharacters, { count: number(TTS_SAMPLE_CHARACTERS) })}</p> : null}
              {categoryId === "vector" ? <p>{fill(copy.svgPrompt, { count: number(SVG_PROMPT_CHARACTERS) })}</p> : null}
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
