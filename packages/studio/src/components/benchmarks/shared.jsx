"use client";

// Shared by the Benchmarks page and the helper bubble: the batched quote
// hook and the price and score cells, so both show the same numbers in the
// same words.

import { useEffect, useState } from "react";
import { IconStarFilled } from "@tabler/icons-react";
import { benchmarkPayload, getEditorsPick, isEditorsPick } from "../../benchmarks.js";
import { resolveCopy } from "../../i18nUtils";
import benchmarksEn from "../../messages/en/benchmarks.json";
import benchmarksZh from "../../messages/zh/benchmarks.json";
import { describeQuote, providerName, quoteRuns } from "../../providers/pricing.js";
import { subscribeProviderSettings } from "../../providers/keys.js";

// Quotes go to /api/price in one batch per provider; a 429 from a provider's
// pricing API is retried with backoff instead of shown as an error.
const RETRY_MS = [2000, 5000, 10000, 20000];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const fill = (template, values) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), String(template || ""));

/**
 * Quotes every entry of a category, and again when the visitor's provider
 * keys change. Entries nobody keyed fall back to a published list price when
 * the model has one. Nothing is asked for while `enabled` is false.
 * @returns {Record<string, { status: 'loading'|'ready'|'error', quote: object|null }>}
 */
export function useCategoryQuotes(entries, categoryId, { enabled = true } = {}) {
  const [quotes, setQuotes] = useState({});
  const [settingsVersion, setSettingsVersion] = useState(0);
  useEffect(() => subscribeProviderSettings(() => setSettingsVersion((v) => v + 1)), []);

  useEffect(() => {
    if (!enabled) {
      setQuotes({});
      return undefined;
    }
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
  }, [entries, categoryId, settingsVersion, enabled]);

  return quotes;
}

/** True once every entry has a quote or an error, so picks can be made. */
export const quotesSettled = (entries, quotes) => entries.length > 0 && entries.every((entry) => ["ready", "error"].includes(quotes[entry.id]?.status));

export const TONE = { muted: "text-white/55", ok: "text-emerald-300/85", warn: "text-amber-300/85" };

// Provider and price text for one row, in the price chip's vocabulary.
export function describePriceCell(entry, state, copy, pricingCopy, locale) {
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

export function PriceText({ view, className = "", size = "text-[12px]" }) {
  if (!view) return null;
  return (
    <span title={view.title} className={`inline-flex min-w-0 items-center gap-1 ${size} font-semibold tabular-nums ${TONE[view.tone] || TONE.muted} ${className}`}>
      {view.provider ? <span className="truncate font-medium opacity-75">{view.provider}</span> : null}
      {view.provider ? <span aria-hidden="true" className="opacity-40">·</span> : null}
      <span className="truncate">{view.label}</span>
      {view.tag ? <span className="ml-0.5 rounded-full border border-white/[0.1] px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-white/45">{view.tag}</span> : null}
    </span>
  );
}

export function ScoreText({ row, copy, className = "", size = "text-[12px]" }) {
  if (!Number.isFinite(row.score)) {
    return <span title={copy.unscoredTitle} className={`${size} text-white/35 ${className}`}>{copy.unscored}</span>;
  }
  const title = [fill(copy.scoreTitle, { name: row.leaderboardName, source: row.source?.name, date: row.asOf }), row.note].filter(Boolean).join(" ");
  return (
    <span title={title} className={`${size} font-semibold tabular-nums text-white/85 ${className}`}>
      {fill(copy.score, { score: row.score })}
    </span>
  );
}

/** "Editor's pick · <note>" for tooltips, or '' when the category has no pick. */
export function editorsPickTitle(categoryId, locale = "en") {
  const pick = getEditorsPick(categoryId);
  if (!pick) return "";
  return fill(resolveCopy(benchmarksEn, benchmarksZh, locale).editorsPickTitle, { note: pick.note });
}

/**
 * A small filled star after a price when `modelId` is the editor's pick of
 * `categoryId`, with "Editor's pick · <note>" as its tooltip. Nothing else.
 * @param {{ categoryId: string|null, modelId: string, locale?: string, size?: number, className?: string }} props
 */
export function EditorsPickStar({ categoryId, modelId, locale = "en", size = 11, className = "" }) {
  if (!categoryId || !isEditorsPick(categoryId, modelId)) return null;
  const title = editorsPickTitle(categoryId, locale);
  return (
    <span title={title} aria-label={title} role="img" data-editors-pick={modelId} className={`inline-flex shrink-0 items-center text-primary ${className}`}>
      <IconStarFilled size={size} aria-hidden="true" />
    </span>
  );
}

export const formatValue = (value, locale) => {
  if (value === null || value === undefined) return null;
  if (value === Infinity) return "∞";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
};
