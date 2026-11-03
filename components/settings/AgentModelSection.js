'use client';

// Agent model: the one language model the assistants (Design Agent, Agents,
// Vibe Motion, the Workflow assistant) run on. The card on top says what is
// in use, which key pays for it and what a message costs; the list below
// compares the models with where each can run on the visitor's keys and its
// price, and any OpenRouter model can be typed in. The choice is saved with
// the provider settings, so every studio picks it up on its next message.

import { useEffect, useMemo, useState } from 'react';
import { IconAlertTriangle, IconKey, IconMessageChatbot, IconPlus, IconSearch } from '@tabler/icons-react';
import {
  AGENT_MODELS,
  CHAT_PROVIDER_IDS,
  CUSTOM_AGENT_MODEL,
  RECOMMENDED_AGENT_MODEL,
  agentModelForEndpoint,
  fetchAgentRates,
  findAgentModel,
  formatMoney,
  messageCost,
  rateIdFor,
  resolveAgentModel,
} from 'studio';
import { useProviderSettings } from './providerSettings';
import { BUTTON, FIELD, fill } from './ui';

// Vendor marks: the vendor's initial on a tint of its colour.
const VENDOR_TILES = {
  anthropic: { letter: 'A', className: 'bg-[#d97757]/15 text-[#f0a688]' },
  openai: { letter: 'O', className: 'bg-white/[0.08] text-white/85' },
  google: { letter: 'G', className: 'bg-[#4285f4]/15 text-[#8ab4f8]' },
  openrouter: { letter: 'R', className: 'bg-indigo-400/15 text-indigo-300' },
};

// A typed OpenRouter id names its vendor before the slash.
const vendorOfId = (id) => {
  const prefix = String(id || '').split('/')[0].toLowerCase();
  return VENDOR_TILES[prefix] ? prefix : prefix === 'gemini' ? 'google' : null;
};

function VendorTile({ vendor, label = '', size = 'md' }) {
  const tile = VENDOR_TILES[vendor] || { letter: (label.split('/')[0] || '?').slice(0, 1).toUpperCase(), className: 'bg-white/[0.06] text-white/60' };
  const box = size === 'lg' ? 'h-11 w-11 rounded-[12px] text-[18px]' : 'h-[30px] w-[30px] rounded-[8px] text-[13px]';
  return <span aria-hidden="true" className={`flex shrink-0 items-center justify-center font-bold ${box} ${tile.className}`}>{tile.letter}</span>;
}

function Tag({ tone = 'cyan', children }) {
  const tones = { cyan: 'bg-primary/[0.12] text-[#67e8f9]', green: 'bg-emerald-400/[0.12] text-emerald-300', muted: 'bg-white/[0.07] text-white/55' };
  return <span className={`inline-flex h-[18px] items-center rounded-[5px] px-1.5 text-[10.5px] font-semibold whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

// Where a model can run: a provider with a key (green dot), or one that needs a key.
function RoutePill({ label, keyed, active, title, onAdd }) {
  if (keyed) {
    return (
      <span className={`inline-flex h-[22px] items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap ${active ? 'border-primary/35 bg-primary/[0.08] text-[#a5f3fc]' : 'border-white/[0.1] bg-white/[0.04] text-white/75'}`}>
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onAdd();
      }}
      className="inline-flex h-[22px] items-center gap-1 rounded-full border border-dashed border-white/[0.14] px-2 text-[11px] font-medium whitespace-nowrap text-white/40 transition-colors hover:border-white/30 hover:text-white/75"
    >
      <IconPlus size={10} stroke={2.5} aria-hidden="true" />
      {label}
    </button>
  );
}

const ROW_GRID = 'grid grid-cols-[18px_30px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 md:grid-cols-[18px_30px_minmax(0,1fr)_168px_92px_112px]';

function ModelRow({ name, vendor, note, tag, routes, perMessage, perMillion, selected, suggested, usable, activeProvider, copy, onChoose, onRoute, onAddKey, children }) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onChoose}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onChoose();
        }
      }}
      className={`${ROW_GRID} cursor-pointer rounded-[12px] border px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 ${
        selected ? 'border-primary/40 bg-primary/[0.06]' : suggested ? 'border-primary/[0.22] bg-white/[0.025] hover:bg-white/[0.04]' : 'border-transparent hover:bg-white/[0.03]'
      } ${usable ? '' : 'opacity-60'}`}
      data-agent-model-row={name}
    >
      <span aria-hidden="true" className={`flex h-4 w-4 items-center justify-center rounded-full border-[1.5px] ${selected ? 'border-primary bg-primary' : 'border-white/25'}`}>
        {selected && <span className="h-2 w-2 rounded-full bg-[#04202a]" />}
      </span>
      {vendor}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={`flex min-w-0 items-center gap-1.5 text-[13.5px] font-medium ${selected ? 'text-white' : 'text-white/[0.88]'}`}>
          <span className="truncate">{name}</span>
          {tag && <span className="hidden shrink-0 sm:inline-flex">{tag}</span>}
        </span>
        {note && <span className="truncate text-[12px] text-white/45">{note}</span>}
      </span>
      <span className="col-start-3 col-end-5 row-start-2 flex flex-wrap gap-1.5 md:col-auto md:row-auto">
        {routes.map((route) => (
          <RoutePill
            key={route.provider}
            label={copy.providers[route.provider] || route.provider}
            keyed={route.keyed}
            active={selected && route.provider === activeProvider}
            title={fill(copy.addProviderKey, { provider: copy.providers[route.provider] || route.provider })}
            onAdd={onAddKey}
          />
        ))}
      </span>
      <span className={`col-start-4 row-start-1 text-right font-mono text-[13px] tabular-nums md:col-auto md:row-auto ${selected ? 'text-[#a5f3fc]' : 'text-white/80'}`}>{perMessage}</span>
      <span className="hidden text-right font-mono text-[11.5px] tabular-nums text-white/40 md:block">{perMillion}</span>
      {children}
      {selected && routes.length > 1 && (
        <div className="col-span-full flex flex-wrap items-center gap-x-2.5 gap-y-1.5 md:col-start-3" onClick={(event) => event.stopPropagation()}>
          <span className="text-[11.5px] whitespace-nowrap text-white/45">{copy.routeChoice}</span>
          <div role="radiogroup" aria-label={copy.routeChoice} className="flex gap-0.5 rounded-[10px] border border-white/[0.07] bg-white/[0.04] p-0.5">
            {routes.map((route) => {
              const on = route.provider === activeProvider;
              return (
                <button
                  key={route.provider}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!route.keyed}
                  title={route.keyed ? route.endpoint : fill(copy.addProviderKey, { provider: copy.providers[route.provider] })}
                  onClick={() => onRoute(route.provider)}
                  className={`h-7 rounded-[8px] px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${on ? 'bg-white/10 text-white' : 'text-white/55 hover:text-white'}`}
                >
                  {copy.providers[route.provider] || route.provider}
                </button>
              );
            })}
          </div>
          <span className="text-[11.5px] text-white/[0.38]">{copy.routeNote}</span>
        </div>
      )}
    </div>
  );
}

export default function AgentModelSection({ locale, copy, onNavigate }) {
  const { settings, setAgent } = useProviderSettings();
  const choice = settings.agent;
  const agent = resolveAgentModel(settings);
  const keyed = (provider) => Boolean(settings.keys[provider]);
  const [draft, setDraft] = useState(() => (choice?.model === CUSTOM_AGENT_MODEL ? choice.custom : ''));
  const typed = draft.trim();
  const typedEntry = typed ? agentModelForEndpoint(typed) : null;
  const customId = choice?.model === CUSTOM_AGENT_MODEL ? choice.custom : '';
  const showCustom = Boolean((typed && !typedEntry) || customId);
  const customRowId = typed && !typedEntry ? typed : customId;

  // Rates for the catalog and whatever OpenRouter id is typed in.
  const ids = useMemo(() => [...AGENT_MODELS.map((model) => model.openrouter), ...(customRowId ? [customRowId] : [])], [customRowId]);
  const [rates, setRates] = useState({ status: 'loading', rates: {}, checkedAt: null });
  const idsKey = ids.join('|');
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchAgentRates(ids)
        .then((result) => !cancelled && setRates({ status: 'ready', ...result }))
        .catch(() => !cancelled && setRates((current) => ({ ...current, status: 'error' })));
    }, customRowId ? 350 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // ids is derived from idsKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const providerName = (id) => copy.providers[id] || id;
  const money = (value) => formatMoney(value, 'USD', locale);
  const perMillion = (rate) => {
    const fixed = (value) => {
      try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
      } catch {
        return `$${value.toFixed(2)}`;
      }
    };
    return rate ? { input: fixed(rate.input * 1e6), output: fixed(rate.output * 1e6) } : null;
  };
  const priceFor = (rateId, variable = false) => {
    const rate = rateId ? rates.rates[rateId] : null;
    if (variable) return { perMessage: copy.varies, perMillion: copy.perModel, rate: null };
    if (!rate) return { perMessage: rates.status === 'loading' ? '…' : copy.noPrice, perMillion: rates.status === 'loading' ? '' : '—', rate: null };
    const million = perMillion(rate);
    return { perMessage: `≈ ${money(messageCost(rate))}`, perMillion: `${million.input} / ${million.output}`, rate };
  };

  const chooseModel = (entry, provider) => {
    const route = entry.routes.find((candidate) => candidate.provider === provider && keyed(candidate.provider))
      || entry.routes.find((candidate) => keyed(candidate.provider))
      || entry.routes[0];
    setAgent({ model: entry.id, provider: route.provider, custom: '' });
  };
  const chooseCustom = (id) => setAgent({ model: CUSTOM_AGENT_MODEL, provider: 'openrouter', custom: id });
  const openProviders = () => onNavigate?.('providers');

  const runnable = (entry) => entry.routes.some((route) => keyed(route.provider));
  const suggestion = [findAgentModel(RECOMMENDED_AGENT_MODEL), ...AGENT_MODELS].find((entry) => entry && !entry.variable && runnable(entry)) || null;
  const missingProviders = CHAT_PROVIDER_IDS.filter((id) => !keyed(id));
  const liveRates = Object.values(rates.rates).some((rate) => rate?.source === 'openrouter');
  const ratesHint = rates.status === 'loading' ? copy.ratesLoading : liveRates ? copy.ratesLive : copy.ratesTable;

  // ── The card on top ──
  let hero;
  if (agent?.chosen && !agent.blocked) {
    const price = priceFor(rateIdFor(agent.provider, agent.endpoint), agent.entry?.variable);
    const million = perMillion(price.rate);
    hero = (
      <section aria-label={copy.inUse} className="oga-enter flex flex-col gap-3 rounded-[14px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(34,211,238,0.06),rgba(255,255,255,0.02)_70%)] px-[18px] py-4" data-agent-hero="chosen">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3">
          <VendorTile vendor={agent.entry?.vendor || vendorOfId(agent.endpoint)} label={agent.endpoint} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[18px] font-semibold tracking-[-0.015em] text-white">{agent.name}</span>
              <Tag>{copy.inUse}</Tag>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-white/55">
              <IconKey size={13} stroke={1.75} className="shrink-0 text-white/45" aria-hidden="true" />
              <span>{fill(copy.runsOn, { provider: providerName(agent.provider) })}</span>
              {agent.name !== agent.endpoint && <span className="truncate font-mono text-[11px] text-white/35">{agent.endpoint}</span>}
            </div>
          </div>
          <div className="flex w-full items-baseline gap-2 pl-[58px] sm:block sm:w-auto sm:pl-0 sm:text-right">
            <div className="font-mono text-[22px] font-medium tracking-[-0.02em] text-[#a5f3fc] tabular-nums">{price.perMessage}</div>
            <div className="text-[11.5px] text-white/45 sm:mt-0.5">{copy.perMessage}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11.5px] text-white/40">{copy.usedBy}</span>
            {copy.usedByList.map((name) => <span key={name} className="inline-flex h-6 items-center rounded-[7px] bg-white/[0.05] px-2 text-[11.5px] whitespace-nowrap text-white/65">{name}</span>)}
          </div>
          {million && <span className="font-mono text-[11.5px] whitespace-nowrap text-white/45">{fill(copy.perMillion, million)}</span>}
        </div>
      </section>
    );
  } else {
    let title;
    let body;
    let action = null;
    if (!agent) {
      title = copy.noKeyTitle;
      body = copy.noKeyBody;
      action = <button type="button" onClick={openProviders} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[9px] bg-primary px-3.5 text-[12.5px] font-bold text-black hover:bg-primary-hover"><IconKey size={14} stroke={2} aria-hidden="true" />{copy.addKey}</button>;
    } else if (agent.blocked) {
      title = fill(copy.blockedTitle, { model: agent.blocked.name, providers: agent.blocked.providers.map(providerName).join(copy.or) });
      body = fill(copy.blockedBody, { fallback: agent.name, provider: providerName(agent.provider) });
      action = <button type="button" onClick={openProviders} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[9px] bg-primary px-3.5 text-[12.5px] font-bold text-black hover:bg-primary-hover"><IconKey size={14} stroke={2} aria-hidden="true" />{copy.addKey}</button>;
    } else {
      title = copy.unchosenTitle;
      body = agent.endpoint === 'openrouter/auto' ? copy.unchosenAuto : fill(copy.unchosenBody, { model: agent.name, provider: providerName(agent.provider) });
      if (suggestion) {
        action = <button type="button" onClick={() => chooseModel(suggestion)} className="inline-flex h-9 shrink-0 items-center rounded-[9px] bg-primary px-3.5 text-[12.5px] font-bold whitespace-nowrap text-black hover:bg-primary-hover" data-agent-use-suggested>{fill(copy.useRecommended, { model: suggestion.name })}</button>;
      }
    }
    hero = (
      <section aria-label={title} className="oga-enter flex flex-col gap-3 rounded-[14px] border border-amber-400/[0.22] bg-amber-400/[0.05] px-[18px] py-4 sm:flex-row sm:items-center sm:gap-3.5" data-agent-hero={!agent ? 'no-key' : agent.blocked ? 'blocked' : 'unchosen'}>
        <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-amber-400/[0.12] text-amber-300">
          {agent?.blocked ? <IconAlertTriangle size={21} stroke={1.75} /> : <IconMessageChatbot size={22} stroke={1.75} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold tracking-[-0.01em] text-white">{title}</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-white/55">{body}</p>
        </div>
        {action}
      </section>
    );
  }

  // ── The list ──
  const selectedId = choice?.model || null;
  const rows = AGENT_MODELS.map((entry) => {
    const selected = selectedId === entry.id;
    const price = priceFor(entry.openrouter, entry.variable);
    const tag = entry.tag === 'recommended' ? <Tag>{copy.tags.recommended}</Tag> : entry.tag === 'cheapest' ? <Tag tone="green">{copy.tags.cheapest}</Tag> : null;
    return (
      <ModelRow
        key={entry.id}
        name={entry.name}
        vendor={<VendorTile vendor={entry.vendor} />}
        note={copy.models[entry.id]}
        tag={tag}
        routes={entry.routes.map((route) => ({ ...route, keyed: keyed(route.provider) }))}
        perMessage={price.perMessage}
        perMillion={price.perMillion}
        selected={selected}
        suggested={!choice && suggestion?.id === entry.id}
        usable={runnable(entry)}
        activeProvider={selected ? (agent?.chosen && !agent.blocked ? agent.provider : choice.provider) : null}
        copy={copy}
        onChoose={() => (selected ? null : chooseModel(entry, typedEntry === entry ? 'openrouter' : undefined))}
        onRoute={(provider) => chooseModel(entry, provider)}
        onAddKey={openProviders}
      />
    );
  });

  if (showCustom) {
    const price = priceFor(customRowId);
    const selected = selectedId === CUSTOM_AGENT_MODEL && customId === customRowId;
    rows.unshift(
      <ModelRow
        key="custom"
        name={customRowId}
        vendor={<VendorTile vendor={vendorOfId(customRowId)} label={customRowId} />}
        note={keyed('openrouter') ? copy.customNote : copy.customNeedsKey}
        tag={<Tag tone="muted">{copy.tags.custom}</Tag>}
        routes={[{ provider: 'openrouter', endpoint: customRowId, keyed: keyed('openrouter') }]}
        perMessage={price.perMessage}
        perMillion={price.perMillion}
        selected={selected}
        usable={keyed('openrouter')}
        activeProvider={selected ? 'openrouter' : null}
        copy={copy}
        onChoose={() => chooseCustom(customRowId)}
        onRoute={() => chooseCustom(customRowId)}
        onAddKey={openProviders}
      />,
    );
  }

  return (
    <>
      {hero}
      <section aria-label={copy.chooseTitle} className="oga-enter" data-agent-models>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-3 px-0.5">
          <div className="min-w-0">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/35">{copy.chooseTitle}</h4>
            <p className="mt-1 text-[12px] leading-relaxed text-white/40">{ratesHint}</p>
          </div>
          <label className="relative block w-full sm:w-[230px]">
            <span className="sr-only">{copy.customLabel}</span>
            <IconSearch size={13} stroke={1.75} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" aria-hidden="true" />
            <input
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || !typed) return;
                if (typedEntry) chooseModel(typedEntry, 'openrouter');
                else chooseCustom(typed);
              }}
              placeholder={copy.customPlaceholder}
              spellCheck={false}
              autoComplete="off"
              className={`${FIELD} h-8 pl-8 font-mono text-[12px]`}
              data-agent-custom
            />
          </label>
        </div>
        <div className={`${ROW_GRID} hidden px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-white/30 md:grid`} aria-hidden="true">
          <span />
          <span />
          <span>{copy.columns.model}</span>
          <span>{copy.columns.runsOn}</span>
          <span className="text-right whitespace-nowrap">{copy.columns.perMessage}</span>
          <span className="text-right whitespace-nowrap">{copy.columns.perMillion}</span>
        </div>
        <div role="radiogroup" aria-label={copy.chooseTitle} className="flex flex-col gap-0.5">
          {rows}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-0.5 text-[11.5px] text-white/35">
          <span>{copy.applies}</span>
          {missingProviders.length > 0 && (
            <button type="button" onClick={openProviders} className={`${BUTTON} h-8 text-[12px]`}>
              <IconKey size={13} stroke={1.75} aria-hidden="true" />
              {fill(copy.connect, { providers: missingProviders.map(providerName).join(copy.or) })}
            </button>
          )}
        </div>
      </section>
    </>
  );
}
