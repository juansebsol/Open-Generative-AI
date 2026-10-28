"use client";

// A card model picker for the prompt bar ("Option C"): a search box, pill
// tabs per model group with counts, a hint line per tab, and a two-column
// grid of cards showing each model's provider line, price, score bar, Elo
// and Benchmarks marks. Prices come from the same batched /api/price quotes
// the Benchmarks page uses (one request per provider per opening), scores
// and picks from benchmarks.js. Used by the Text to Logo and Icon Set pages;
// any studio can adopt it by passing its own groups.

import { useEffect, useMemo, useRef, useState } from "react";
import { IconArrowRight, IconCoins, IconSearch, IconTag, IconTrophy } from "@tabler/icons-react";
import { PromptPopover } from "./PromptComposer.jsx";
import { categoryEntries, priceOf, rankEntries } from "../../benchmarks.js";
import { benchmarksHref } from "../../benchmarksHelper.js";
import { ALL_TAB_ID, filterModels, pickKindsById, pickerTabs, providerLine, scoreWidth } from "../../modelCardPicker.js";
import { getRoutes } from "../../providers/catalog/index.js";
import { getProvider } from "../../providers/directProviders.js";
import { subscribeProviderSettings } from "../../providers/keys.js";
import { quoteRuns, routeFor } from "../../providers/pricing.js";
import { describePriceCell, fill } from "../benchmarks/shared.jsx";
import { resolveCopy } from "../../i18nUtils";
import en from "../../messages/en/modelCardPicker.json";
import zh from "../../messages/zh/modelCardPicker.json";
import benchmarksEn from "../../messages/en/benchmarks.json";
import benchmarksZh from "../../messages/zh/benchmarks.json";
import pricingEn from "../../messages/en/pricing.json";
import pricingZh from "../../messages/zh/pricing.json";

const KIND_ICON = { best: IconTrophy, bestValue: IconCoins, cheapestDecent: IconTag };
const RETRY_MS = [2000, 5000, 10000, 20000];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One batch per provider for every card, retried on a provider's 429, and
// again when the visitor's keys change. Nothing is asked while closed.
function usePickerQuotes(models, payloadFor, enabled) {
  const [quotes, setQuotes] = useState({});
  const [settingsVersion, setSettingsVersion] = useState(0);
  useEffect(() => subscribeProviderSettings(() => setSettingsVersion((v) => v + 1)), []);
  // The payloads decide the quotes; a new payload object with the same
  // content must not re-quote.
  const payloadKey = JSON.stringify(models.map((model) => [model.id, payloadFor(model)]));

  useEffect(() => {
    if (!enabled) {
      setQuotes({});
      return undefined;
    }
    let cancelled = false;
    const items = JSON.parse(payloadKey);
    setQuotes(Object.fromEntries(items.map(([id]) => [id, { status: "loading", quote: null }])));
    const set = (id, state) => {
      if (!cancelled) setQuotes((previous) => ({ ...previous, [id]: state }));
    };
    (async () => {
      let pending = items.map(([id, payload]) => ({ id, endpoint: models.find((model) => model.id === id)?.endpoint || id, payload }));
      for (let attempt = 0; pending.length > 0 && !cancelled; attempt += 1) {
        let results;
        try {
          results = await quoteRuns(pending.map(({ endpoint, payload }) => ({ endpoint, payload })), { listPrices: true });
        } catch {
          results = pending.map(() => ({ kind: "error" }));
        }
        const retry = [];
        results.forEach((quote, index) => {
          if (quote?.kind === "error" && quote.status === 429 && attempt < RETRY_MS.length) retry.push(pending[index]);
          else if (quote?.kind === "error") set(pending[index].id, { status: "error", quote: null });
          else set(pending[index].id, { status: "ready", quote });
        });
        pending = retry;
        if (pending.length > 0) await sleep(RETRY_MS[attempt]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `models` is covered by payloadKey (ids and payloads).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadKey, enabled, settingsVersion]);

  return quotes;
}

/**
 * @param {object} props
 * @param {boolean} props.open  render nothing while closed
 * @param {() => void} props.onClose
 * @param {Array<{ id: string, label: string, hint?: string, models: object[] }>} props.groups
 *   catalog models (`id`, `endpoint`, `name`, `provider_name`) per group
 * @param {string} props.selectedId
 * @param {(model: object) => void} props.onSelect
 * @param {(model: object) => object} props.pricePayload  the payload a run of that model is quoted on
 * @param {string} [props.benchmarksCategory]  benchmarks.js category for scores and picks
 * @param {string} [props.allHint]  hint line under the All tab
 * @param {string} [props.locale]
 * @param {string} [props.benchmarksPath]  localized path of the Benchmarks page
 */
export default function ModelCardPicker({ open, onClose, groups, selectedId, onSelect, pricePayload, benchmarksCategory = null, allHint = "", locale = "en", benchmarksPath = "/studio/benchmarks", className = "" }) {
  const copy = resolveCopy(en, zh, locale);
  const benchmarksCopy = resolveCopy(benchmarksEn, benchmarksZh, locale);
  const pricingCopy = resolveCopy(pricingEn, pricingZh, locale);

  const tabs = useMemo(() => pickerTabs(groups, { allLabel: copy.all, allHint }), [groups, copy.all, allHint]);
  const [tabId, setTabId] = useState(tabs[0]?.id || ALL_TAB_ID);
  const [query, setQuery] = useState("");
  const selectedRef = useRef(null);
  const searchRef = useRef(null);

  const allModels = tabs[0]?.models || [];
  const quotes = usePickerQuotes(allModels, pricePayload, open);

  // Scores and the Benchmarks marks for this category.
  const entries = useMemo(() => (benchmarksCategory ? categoryEntries(benchmarksCategory) : []), [benchmarksCategory]);
  const entryById = useMemo(() => Object.fromEntries(entries.map((entry) => [entry.id, entry])), [entries]);
  const settled = entries.length > 0 && entries.every((entry) => ["ready", "error"].includes(quotes[entry.id]?.status));
  const topScore = useMemo(() => Math.max(0, ...entries.map((entry) => (Number.isFinite(entry.score) ? entry.score : 0))), [entries]);
  const kindsById = useMemo(() => {
    if (!settled) return {};
    const ranking = rankEntries(entries.map((entry) => ({ ...entry, price: priceOf(quotes[entry.id]?.quote) })));
    return pickKindsById(ranking);
  }, [entries, quotes, settled]);

  // Provider line from the route the price chip resolves (first route when
  // the visitor has no key for any).
  const lineFor = (model) => {
    const route = routeFor(model.endpoint) || getRoutes(model.endpoint)[0] || null;
    return providerLine(model.provider_name, route?.provider || null, route ? getProvider(route.provider)?.label : "");
  };
  const tab = tabs.find((entry) => entry.id === tabId) || tabs[0];
  const visible = useMemo(() => filterModels((tab?.models || []).map((model) => ({ ...model, providerLine: lineFor(model) })), query), [tab, query]);

  // The selected card takes focus when the picker opens, so arrows and
  // Escape work at once; the search box is a click away.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    const timer = requestAnimationFrame(() => (selectedRef.current || searchRef.current)?.focus());
    return () => cancelAnimationFrame(timer);
  }, [open]);

  // Escape closes the picker wherever focus is (the search box, a tab, the page).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose?.();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const priceFor = (model) => describePriceCell(model, quotes[model.id], benchmarksCopy, pricingCopy, locale);
  const href = benchmarksCategory ? benchmarksHref(benchmarksPath, benchmarksCategory) : null;
  const openBenchmarks = (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onClose?.();
    window.dispatchEvent(new CustomEvent("oga:open-studio", { detail: { tabId: "benchmarks", categoryId: benchmarksCategory } }));
  };

  return (
    <PromptPopover
      className={`w-[calc(100vw-2rem)] md:w-[536px] max-w-[calc(100vw-2rem)] max-h-[min(70vh,640px)] flex flex-col gap-2.5 overflow-hidden ${className}`}
      solid
      role="dialog"
      aria-label={copy.label}
      data-model-card-picker={tabId}
    >
      <div className="flex items-center justify-between gap-3 px-1">
        <span className="text-[11px] font-medium text-white/45">{copy.label}</span>
        <label className="flex h-7 w-[150px] items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 text-white/40 focus-within:border-white/20" title={copy.searchTitle}>
          <IconSearch size={12} stroke={2} aria-hidden="true" />
          <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} aria-label={copy.searchTitle} data-picker-search="" className="h-full w-full min-w-0 bg-transparent text-[11px] text-white/85 placeholder:text-white/35 focus:outline-none" />
        </label>
      </div>

      {tabs.length > 1 && (
        <div className="flex flex-wrap gap-1.5 px-0.5" role="tablist">
          {tabs.map((entry) => {
            const active = entry.id === tab?.id;
            return (
              <button key={entry.id} type="button" role="tab" aria-selected={active} data-picker-tab={entry.id} onClick={() => setTabId(entry.id)} className={`inline-flex h-[30px] items-center gap-1.5 rounded-full border px-3.5 text-[11.5px] font-semibold transition-colors ${active ? "border-primary/30 bg-primary/[0.08] text-primary" : "border-white/[0.08] bg-white/[0.03] text-white/60 hover:text-white"}`}>
                {entry.label}
                <span className={`font-medium ${active ? "text-primary/60" : "text-white/35"}`}>{entry.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {tab?.hint && <p className="px-1 text-[11px] leading-[1.45] text-white/50">{tab.hint}</p>}

      <div className="min-h-0 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-1 py-4 text-center text-[12px] text-white/45">{fill(copy.noMatch, { query })}</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="listbox" aria-label={copy.label}>
            {visible.map((model) => {
              const selected = model.id === selectedId;
              const entry = entryById[model.id];
              const score = Number.isFinite(entry?.score) ? entry.score : null;
              const kinds = kindsById[model.id] || [];
              const price = priceFor(model);
              const scoreTitle = score === null ? copy.unscoredTitle : [fill(copy.scoreTitle, { score, source: entry.source?.name || "", date: entry.asOf || "" }), entry.note].filter(Boolean).join(" ");
              return (
                <button
                  key={model.id}
                  ref={selected ? selectedRef : null}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-picker-model={model.id}
                  data-picker-score={score ?? "none"}
                  onClick={() => { onSelect?.(model); onClose?.(); }}
                  className={`flex min-w-0 flex-col gap-2 rounded-[14px] border px-[13px] py-3 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${selected ? "border-primary/45 bg-primary/[0.06] shadow-[inset_0_0_0_1px_rgba(34,211,238,0.25)]" : "border-white/[0.08] bg-white/[0.025] hover:border-white/[0.14] hover:bg-white/[0.05]"}`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-bold leading-[1.25] tracking-[-0.01em] text-white/[0.92]">{model.name}</span>
                      <span className="mt-0.5 block truncate text-[10px] font-medium text-white/50">{model.providerLine}</span>
                    </span>
                    <span data-picker-price={quotes[model.id]?.status || "idle"} title={price?.title} className={`whitespace-nowrap text-[11.5px] font-semibold tabular-nums ${price?.tone === "warn" ? "text-amber-300/85" : price?.tone === "ok" ? "text-emerald-300/85" : "text-white/70"}`}>
                      {price?.label || ""}
                      {price?.tag ? <span className="ml-1 rounded-full border border-white/[0.1] px-1 py-px text-[9px] font-medium uppercase tracking-wide text-white/45">{price.tag}</span> : null}
                    </span>
                  </span>
                  <span className="block h-[3px] overflow-hidden rounded-full bg-white/[0.07]" aria-hidden="true">
                    <span className="block h-full rounded-full bg-primary/70" style={{ width: `${scoreWidth(score, topScore)}%` }} />
                  </span>
                  <span className="flex items-center justify-between text-[10px] tabular-nums text-white/45">
                    <span title={scoreTitle}>{score === null ? copy.unscored : fill(copy.elo, { score })}</span>
                    {kinds.length > 0 ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-[#67e8f9]" title={kinds.map((kind) => benchmarksCopy.picks[kind]).join(" · ")} data-picker-marks={kinds.join(" ")}>
                        {kinds.slice(0, 1).map((kind) => {
                          const Icon = KIND_ICON[kind] || IconTrophy;
                          return <Icon key={kind} size={10} stroke={2.5} aria-hidden="true" />;
                        })}
                        {benchmarksCopy.picks[kinds[0]]}
                        {kinds.length > 1 ? <span className="font-medium text-[#67e8f9]/70">+{kinds.length - 1}</span> : null}
                      </span>
                    ) : <span />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {href && (
        <div className="flex items-center justify-end px-1 pt-0.5">
          <a href={href} onClick={openBenchmarks} className="inline-flex h-7 items-center gap-1.5 rounded-lg px-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10">
            {copy.openBenchmarks}
            <IconArrowRight size={12} stroke={2.5} aria-hidden="true" />
          </a>
        </div>
      )}
    </PromptPopover>
  );
}
