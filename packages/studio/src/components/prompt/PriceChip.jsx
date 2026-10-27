"use client";

// The chip next to every Generate button: which provider (API) this run
// will go to and what it is expected to cost there. Quotes come from
// /api/price through quoteRun() and refresh when the model or a priced
// option changes; clicking the chip opens the Providers panel.

import { useEffect, useMemo, useState } from "react";
import { describeQuote, providerName, quoteRun, routeFor } from "../../providers/pricing.js";
import { subscribeProviderSettings } from "../../providers/keys.js";
import { resolveCopy } from "../../i18nUtils";
import en from "../../messages/en/pricing.json";
import zh from "../../messages/zh/pricing.json";

const DEBOUNCE_MS = 350;

/**
 * Quotes `endpoint` with `payload` (only price-relevant keys are sent).
 * @returns {{ status: 'idle'|'loading'|'ready'|'error', quote: object|null }}
 */
export function usePriceQuote(endpoint, payload, { enabled = true } = {}) {
  const inputs = useMemo(() => JSON.stringify(payload || {}), [payload]);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [state, setState] = useState({ status: "idle", quote: null });

  useEffect(() => subscribeProviderSettings(() => setSettingsVersion((v) => v + 1)), []);

  useEffect(() => {
    if (!enabled || !endpoint) {
      setState({ status: "idle", quote: null });
      return undefined;
    }
    if (!routeFor(endpoint)) {
      quoteRun(endpoint, {}).then((quote) => setState({ status: "ready", quote }));
      return undefined;
    }
    let cancelled = false;
    setState((previous) => ({ status: "loading", quote: previous.quote }));
    const timer = setTimeout(() => {
      quoteRun(endpoint, JSON.parse(inputs))
        .then((quote) => { if (!cancelled) setState({ status: "ready", quote }); })
        .catch(() => { if (!cancelled) setState({ status: "error", quote: null }); });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [endpoint, inputs, enabled, settingsVersion]);

  return state;
}

// A studio that fires several runs at once (image batches) shows the total.
function multiply(quote, runs) {
  const count = Math.max(1, Math.round(Number(runs) || 1));
  if (count === 1 || quote.kind !== "total") return quote;
  return { ...quote, amount: Math.round(quote.amount * count * 10000) / 10000, quantity: (quote.quantity || 1) * count };
}

const TONE = {
  muted: "text-white/55 border-white/[0.08] bg-white/[0.03]",
  ok: "text-emerald-300/90 border-emerald-400/15 bg-emerald-400/[0.06]",
  warn: "text-amber-300/90 border-amber-400/15 bg-amber-400/[0.06]",
};

/**
 * @param {{ endpoint?: string, payload?: object, enabled?: boolean, runs?: number, locale?: string, className?: string }} props
 */
export default function PriceChip({ endpoint, payload, enabled = true, runs = 1, locale = "en", className = "" }) {
  const copy = resolveCopy(en, zh, locale);
  const { status, quote } = usePriceQuote(endpoint, payload, { enabled });

  const provider = providerName(routeFor(endpoint)?.provider);
  let view = null;
  if (status === "error") view = { provider, label: copy.error, title: copy.error, tone: "warn" };
  else if (quote) view = describeQuote(multiply(quote, runs), copy, locale);
  if (!view && status === "loading") view = { provider, label: copy.loading, title: copy.loading, tone: "muted" };
  if (!view) return null;

  const openProviders = () => window.dispatchEvent(new CustomEvent("oga:provider-setup-needed"));

  return (
    <button
      type="button"
      onClick={openProviders}
      title={view.title}
      aria-label={view.title}
      data-price-status={status}
      data-provider={view.provider || undefined}
      className={`inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-semibold tabular-nums whitespace-nowrap transition-[opacity,background-color] hover:bg-white/[0.06] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${TONE[view.tone] || TONE.muted} ${status === "loading" && quote ? "opacity-60" : ""} ${className}`}
    >
      {view.provider ? (
        <>
          <span className="truncate font-medium opacity-75">{view.provider}</span>
          <span aria-hidden="true" className="opacity-40">·</span>
        </>
      ) : null}
      <span className="truncate">{view.label}</span>
    </button>
  );
}

/**
 * A quiet price for one row of a model picker. It only asks for a quote
 * while `hovered` is true, so opening the picker costs nothing, and it reads
 * "fal.ai · ≈ $0.21" so the visitor sees the provider and the price before
 * choosing. Renders nothing while not hovered.
 * @param {{ endpoint?: string, payload?: object, hovered: boolean, locale?: string, className?: string }} props
 */
export function PriceHint({ endpoint, payload, hovered, locale = "en", className = "" }) {
  const copy = resolveCopy(en, zh, locale);
  const { status, quote } = usePriceQuote(endpoint, payload, { enabled: hovered && Boolean(endpoint) });
  if (!hovered || !endpoint) return null;

  let view = null;
  const provider = providerName(routeFor(endpoint)?.provider);
  if (status === "error") view = { provider, label: copy.error, title: copy.error, tone: "warn" };
  else if (quote) view = describeQuote(quote, copy, locale);
  if (!view && status === "loading") view = { provider, label: copy.loading, title: copy.loading, tone: "muted" };
  if (!view) return null;

  const tone = view.tone === "warn" ? "text-amber-300/80" : view.tone === "ok" ? "text-emerald-300/80" : "text-white/55";
  return (
    <span
      title={view.title}
      data-price-hint={status}
      className={`inline-flex shrink-0 items-center gap-1 text-[10.5px] font-semibold tabular-nums whitespace-nowrap ${tone} ${status === "loading" && quote ? "opacity-60" : ""} ${className}`}
    >
      {view.provider ? <span className="font-medium opacity-75">{view.provider}</span> : null}
      {view.provider ? <span aria-hidden="true" className="opacity-40">·</span> : null}
      <span>{view.label}</span>
    </span>
  );
}
