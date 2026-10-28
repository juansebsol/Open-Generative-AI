"use client";

// The rail model picker ("Option A"), the same shape as the Image and Video
// pickers: a left rail (All, one entry per group, then the vendors with
// counts and a monogram badge) and a right pane with a search box and the
// rows. Rows show the model's initial, name, the provider line from the
// route the price chip resolves, the price and the Elo. Prices come from
// one batched /api/price request per provider when the picker opens, scores
// from benchmarks.js. Used by the Text to Logo and Icon Set pages; the
// Image and Video pickers can adopt it by passing their own groups.

import { useEffect, useMemo, useRef, useState } from "react";
import { IconSearch, IconStar } from "@tabler/icons-react";
import { PromptPopover, PromptPopoverHeader } from "./PromptComposer.jsx";
import { categoryEntries } from "../../benchmarks.js";
import { ALL_ID, isVendorId, providerLine, railEntries, railSections } from "../../modelRailPicker.js";
import { getRoutes } from "../../providers/catalog/index.js";
import { getProvider } from "../../providers/directProviders.js";
import { subscribeProviderSettings } from "../../providers/keys.js";
import { quoteRuns, routeFor } from "../../providers/pricing.js";
import { describePriceCell, fill } from "../benchmarks/shared.jsx";
import { resolveCopy } from "../../i18nUtils";
import en from "../../messages/en/modelRailPicker.json";
import zh from "../../messages/zh/modelRailPicker.json";
import benchmarksEn from "../../messages/en/benchmarks.json";
import benchmarksZh from "../../messages/zh/benchmarks.json";
import pricingEn from "../../messages/en/pricing.json";
import pricingZh from "../../messages/zh/pricing.json";

const RETRY_MS = [2000, 5000, 10000, 20000];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Badge and avatar colours per group tone.
const TONE = {
  cyan: { badge: "text-[#67e8f9]", avatar: "border-primary/[0.12] bg-primary/10 text-[#67e8f9]" },
  violet: { badge: "text-[#c4b5fd]", avatar: "border-[#a78bfa]/[0.14] bg-[#a78bfa]/10 text-[#c4b5fd]" },
};

// One batch per provider for every row, retried on a provider's 429, and
// again when the visitor's keys change. Nothing is asked while closed.
function usePickerQuotes(models, payloadFor, enabled) {
  const [quotes, setQuotes] = useState({});
  const [settingsVersion, setSettingsVersion] = useState(0);
  useEffect(() => subscribeProviderSettings(() => setSettingsVersion((v) => v + 1)), []);
  // Ids, endpoints and payloads decide the quotes; a new object with the
  // same content must not re-quote.
  const batchKey = JSON.stringify(models.map((model) => [model.id, model.endpoint || model.id, payloadFor(model)]));

  useEffect(() => {
    if (!enabled) {
      setQuotes({});
      return undefined;
    }
    let cancelled = false;
    const items = JSON.parse(batchKey).map(([id, endpoint, payload]) => ({ id, endpoint, payload }));
    setQuotes(Object.fromEntries(items.map((item) => [item.id, { status: "loading", quote: null }])));
    const set = (id, state) => {
      if (!cancelled) setQuotes((previous) => ({ ...previous, [id]: state }));
    };
    (async () => {
      let pending = items;
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
  }, [batchKey, enabled, settingsVersion]);

  return quotes;
}

function RailItem({ id, label, count, mono, tone, selected, isAll = false, onSelect }) {
  const colour = isAll ? (selected ? "text-yellow-400" : "text-white/55") : TONE[tone]?.badge || TONE.cyan.badge;
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-pressed={selected}
      title={label}
      data-rail-item={id}
      className={`flex h-9 w-full shrink-0 items-center gap-2.5 rounded-[9px] px-1 text-left transition-colors ${selected ? "bg-primary/[0.08] text-white" : "text-white/55 hover:bg-white/[0.05] hover:text-white"}`}
    >
      <span className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border text-[10px] font-bold ${selected ? "border-primary/40 bg-primary/10" : "border-white/[0.07] bg-white/[0.04]"} ${colour}`}>
        {isAll ? <IconStar size={14} stroke={2} fill={selected ? "currentColor" : "none"} aria-hidden="true" /> : mono}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{label}</span>
      <span className="pr-1 text-[11px] tabular-nums text-white/35">{count}</span>
    </button>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.open  render nothing while closed
 * @param {() => void} props.onClose
 * @param {Array<{ id: string, label: string, railLabel?: string, tone?: 'cyan'|'violet', mono?: string, models: object[] }>} props.groups
 *   catalog models (`id`, `endpoint`, `name`, `provider_name`) per group; `label` is the section header, `railLabel` the rail entry
 * @param {string} props.selectedId
 * @param {(model: object) => void} props.onSelect
 * @param {(model: object) => object} props.pricePayload  the payload a run of that model is quoted on
 * @param {string} [props.benchmarksCategory]  benchmarks.js category for the Elo on each row
 * @param {string} [props.locale]
 */
export default function ModelRailPicker({ open, onClose, groups, selectedId, onSelect, pricePayload, benchmarksCategory = null, locale = "en", className = "" }) {
  const copy = resolveCopy(en, zh, locale);
  const benchmarksCopy = resolveCopy(benchmarksEn, benchmarksZh, locale);
  const pricingCopy = resolveCopy(pricingEn, pricingZh, locale);

  const [railId, setRailId] = useState(ALL_ID);
  const [query, setQuery] = useState("");
  const selectedRef = useRef(null);

  const rail = useMemo(() => railEntries(groups, { allLabel: copy.all }), [groups, copy.all]);
  const toneOf = useMemo(() => {
    const map = {};
    for (const group of groups || []) for (const model of group.models || []) map[model.id] ||= group.tone || "cyan";
    return map;
  }, [groups]);
  // Provider line from the route the price chip resolves (first route when
  // the visitor has no key for any), attached so the search covers it.
  const lined = useMemo(() => (groups || []).map((group) => ({
    ...group,
    models: (group.models || []).map((model) => {
      const route = routeFor(model.endpoint || model.id) || getRoutes(model.endpoint || model.id)[0] || null;
      return { ...model, providerLine: providerLine(model.provider_name, route?.provider || null, route ? getProvider(route.provider)?.label : "") };
    }),
  })), [groups]);
  const allModels = useMemo(() => lined.flatMap((group) => group.models), [lined]);
  const sections = useMemo(() => railSections(lined, { railId, query }), [lined, railId, query]);
  const quotes = usePickerQuotes(allModels, pricePayload, open);
  const entryById = useMemo(() => Object.fromEntries((benchmarksCategory ? categoryEntries(benchmarksCategory) : []).map((entry) => [entry.id, entry])), [benchmarksCategory]);

  // On open: fresh search, the selected row scrolled into view and focused
  // so Escape works at once.
  useEffect(() => {
    if (!open) return undefined;
    setQuery("");
    const timer = requestAnimationFrame(() => {
      selectedRef.current?.scrollIntoView({ block: "nearest" });
      selectedRef.current?.focus();
    });
    return () => cancelAnimationFrame(timer);
  }, [open]);

  // Escape closes the picker wherever focus is (the search box, the rail, the page).
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
  const scoreFor = (model) => {
    const entry = entryById[model.id];
    const score = Number.isFinite(entry?.score) ? entry.score : null;
    const title = score === null ? copy.unscoredTitle : [fill(copy.scoreTitle, { score, source: entry.source?.name || "", date: entry.asOf || "" }), entry.note].filter(Boolean).join(" ");
    return { score, title };
  };
  const vendorActive = isVendorId(railId);

  return (
    <PromptPopover className={`w-[calc(100vw-2rem)] md:w-[480px] max-w-[calc(100vw-2rem)] max-h-[70vh] ${className}`} role="dialog" aria-label={copy.label} data-model-rail-picker={railId} onClick={(event) => event.stopPropagation()}>
      <PromptPopoverHeader>{copy.label}</PromptPopoverHeader>
      <div className="flex h-full max-h-[60vh] min-h-[320px] gap-4 overflow-x-hidden">
        <div className="flex w-[150px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-white/[0.06] pr-2 scrollbar-none sm:w-[170px]" aria-label={copy.rail}>
          <RailItem id={rail.all.id} label={rail.all.label} count={rail.all.count} isAll selected={railId === ALL_ID} onSelect={setRailId} />
          {rail.kinds.map((kind) => <RailItem key={kind.id} {...kind} selected={railId === kind.id} onSelect={setRailId} />)}
          {rail.vendors.length > 0 && <div className="my-1.5 border-t border-white/[0.06]" role="separator" />}
          {rail.vendors.map((vendor) => <RailItem key={vendor.id} id={vendor.id} label={vendor.name} count={vendor.count} mono={vendor.mono} tone={vendor.tone} selected={railId === vendor.id} onSelect={setRailId} />)}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <label className="flex h-[34px] shrink-0 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-white/40 transition-colors focus-within:border-primary/50" title={copy.searchTitle}>
            <IconSearch size={13} stroke={2} aria-hidden="true" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} aria-label={copy.searchTitle} data-picker-search="" className="h-full w-full min-w-0 bg-transparent text-xs text-white placeholder:text-white/35 focus:outline-none" />
          </label>

          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-2 pr-1 custom-scrollbar" role="listbox" aria-label={copy.label}>
            {sections.length === 0 ? (
              <div className="py-6 text-center text-xs text-white/30">{copy.noModelsFound}</div>
            ) : sections.map((section) => (
              <div key={section.id} data-rail-section={section.id}>
                {section.label && !vendorActive && <div className="px-2.5 pb-1 pt-2.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-white/40">{section.label}</div>}
                {section.models.map((model) => {
                  const selected = model.id === selectedId;
                  const price = priceFor(model);
                  const { score, title: scoreTitle } = scoreFor(model);
                  const tone = TONE[toneOf[model.id]] || TONE.cyan;
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
                      className={`grid w-full grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border px-2.5 py-[9px] text-left transition-colors focus:outline-none focus-visible:border-white/20 ${selected ? "border-white/[0.06] bg-white/5" : "border-transparent hover:border-white/5 hover:bg-white/5"}`}
                    >
                      <span className={`flex h-8 w-8 items-center justify-center rounded-full border text-[11px] font-bold uppercase shadow-inner ${tone.avatar}`}>{String(model.name || "?").charAt(0)}</span>
                      <span className="min-w-0">
                        <span title={model.name} className="block truncate text-xs font-bold tracking-tight text-white">{model.name}</span>
                        <span className="mt-px block truncate text-[9.5px] text-white/55">{model.providerLine}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2.5">
                        <span className="text-right tabular-nums">
                          <span data-picker-price={quotes[model.id]?.status || "idle"} title={price?.title} className={`block whitespace-nowrap text-[11px] font-semibold ${price?.tone === "warn" ? "text-amber-300/85" : price?.tone === "ok" ? "text-emerald-300/85" : "text-white/60"}`}>
                            {price?.label || ""}
                            {price?.tag ? <span className="ml-1 rounded-full border border-white/[0.1] px-1 py-px text-[8.5px] font-medium uppercase tracking-wide text-white/45">{price.tag}</span> : null}
                          </span>
                          <span title={scoreTitle} className="block text-[9.5px] uppercase tracking-[0.04em] text-white/40">{score === null ? copy.unscored : fill(copy.elo, { score })}</span>
                        </span>
                        {selected && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="4" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </PromptPopover>
  );
}
