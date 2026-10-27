"use client";

// The price chip next to every Generate button: what this run is expected
// to cost on the provider it will go to. Quotes come from /api/price through
// quoteRun() and refresh when the model or a priced option changes.

import { useEffect, useMemo, useState } from "react";
import { describeQuote, quoteRun, routeFor } from "../../providers/pricing.js";
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
      setState({ status: "ready", quote: { kind: "noProvider", endpoint } });
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

  let view = null;
  if (status === "error") view = { label: copy.error, title: copy.error, tone: "warn" };
  else if (quote) view = describeQuote(multiply(quote, runs), copy, locale);
  if (!view && status === "loading") view = { label: copy.loading, title: copy.loading, tone: "muted" };
  if (!view) return null;

  return (
    <span
      title={view.title}
      aria-label={view.title}
      data-price-status={status}
      className={`inline-flex h-7 max-w-[200px] items-center gap-1 truncate rounded-full border px-2.5 text-[11.5px] font-semibold tabular-nums whitespace-nowrap transition-opacity ${TONE[view.tone] || TONE.muted} ${status === "loading" && quote ? "opacity-60" : ""} ${className}`}
    >
      {view.label}
    </span>
  );
}
