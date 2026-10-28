'use client';

// Providers: one card per cloud provider with its key, balance and chat
// model, in the visitor's priority order.

import { useCallback, useEffect, useState } from 'react';
import { IconChevronDown, IconChevronUp, IconExternalLink, IconEye, IconEyeOff } from '@tabler/icons-react';
import { CHAT_PROVIDER_IDS, DEFAULT_CHAT_MODELS, NO_BALANCE_PROVIDER_IDS, PROVIDERS } from 'studio';
import { useProviderSettings } from './providerSettings';
import { BUTTON_SMALL, FIELD_MONO, LINK, Pill, fill } from './ui';

// Providers whose balance /api/balance can read.
const BALANCE_PROVIDERS = new Set(['fal', 'wavespeed', 'openrouter', 'elevenlabs']);

function KeyField({ provider, value, onChange, copy }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex gap-2">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={provider.keyPlaceholder}
        autoComplete="off"
        spellCheck={false}
        aria-label={`${provider.label} ${copy.apiKey}`}
        className={`${FIELD_MONO} flex-1`}
        data-provider-key={provider.id}
      />
      <button type="button" onClick={() => setVisible((current) => !current)} className={`${BUTTON_SMALL} h-9 w-9 px-0`} aria-label={visible ? copy.hide : copy.show} title={visible ? copy.hide : copy.show}>
        {visible ? <IconEyeOff size={15} stroke={1.75} aria-hidden="true" /> : <IconEye size={15} stroke={1.75} aria-hidden="true" />}
      </button>
      {value && (
        <button type="button" onClick={() => onChange('')} className={`${BUTTON_SMALL} h-9 border-red-500/20 bg-red-500/10 text-red-300 hover:bg-red-500/20`}>
          {copy.clear}
        </button>
      )}
    </div>
  );
}

function BalanceLine({ providerId, apiKey, autoCheck, locale, copy }) {
  const [state, setState] = useState({ status: 'idle' });

  const check = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const response = await fetch('/api/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-provider-key': apiKey },
        body: JSON.stringify({ provider: providerId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || copy.balanceError);
      setState({ status: 'done', ...data });
    } catch (error) {
      setState({ status: 'error', message: error.message || copy.balanceError });
    }
  }, [apiKey, providerId, copy.balanceError]);

  useEffect(() => {
    if (autoCheck) check();
    // Only on mount: typing a new key waits for the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const money = (amount, currency = 'USD') => {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount ?? 0);
    } catch {
      return `${Number(amount ?? 0).toFixed(2)} ${currency}`;
    }
  };

  let text = null;
  let tone = 'text-white/50';
  if (state.status === 'loading') text = copy.balanceLoading;
  if (state.status === 'error') {
    text = state.message;
    tone = 'text-red-300';
  }
  if (state.status === 'done') {
    if (state.kind === 'needsAdminKey') text = copy.balanceNeedsAdmin;
    else if (state.kind === 'characters') {
      const number = (value) => new Intl.NumberFormat(locale).format(value ?? 0);
      text = fill(copy.balanceCharacters, { remaining: number(state.remaining), limit: number(state.limit) });
      tone = state.remaining > 0 ? 'text-emerald-300' : 'text-amber-300';
    } else {
      const template = { balance: copy.balance, keyLimit: copy.balanceKeyLimit, usage: copy.balanceUsage }[state.kind] || copy.balance;
      text = fill(template, { amount: money(state.amount, state.currency) });
      if (state.kind !== 'usage') tone = 'text-emerald-300';
    }
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      {text && <span className={`truncate text-[11.5px] font-semibold ${tone}`}>{text}</span>}
      {state.kind === 'needsAdminKey' && (
        <a href="https://fal.ai/dashboard/billing" target="_blank" rel="noopener noreferrer" className={`${LINK} shrink-0 text-[11.5px]`}>
          {copy.balanceOpenDashboard}
          <IconExternalLink size={11} stroke={2} aria-hidden="true" />
        </a>
      )}
      <button type="button" onClick={check} disabled={state.status === 'loading'} className="shrink-0 text-[11.5px] font-semibold text-white/45 hover:text-white disabled:opacity-40">
        {state.status === 'idle' ? copy.balanceCheck : copy.balanceRefresh}
      </button>
    </span>
  );
}

function ProviderCard({ provider, rank, count, settings, savedKeys, configured, locale, copy, onKey, onOptions, onMove }) {
  const key = settings.keys[provider.id] || '';
  const noBalance = NO_BALANCE_PROVIDER_IDS.includes(provider.id);
  return (
    <div className="oga-enter rounded-[14px] border border-white/[0.07] bg-white/[0.02] p-4 md:p-5" style={{ '--i': rank }} data-provider-card={provider.id}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-white/[0.07] bg-white/[0.04] font-mono text-[11px] text-white/45" title={copy.order} aria-label={`${copy.order} ${rank + 1}`}>{rank + 1}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold text-white">{provider.label}</span>
              <Pill on={configured}>{configured ? copy.configured : copy.notConfigured}</Pill>
            </div>
            <p className="mt-0.5 text-[12px] leading-relaxed text-white/45">{provider.description}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5" aria-label={copy.order}>
          <button type="button" aria-label={copy.moveUp} title={copy.moveUp} disabled={rank === 0} onClick={() => onMove(provider.id, -1)} className="flex h-7 w-7 items-center justify-center rounded-[7px] text-white/45 hover:bg-white/[0.07] hover:text-white disabled:opacity-20 disabled:hover:bg-transparent">
            <IconChevronUp size={15} stroke={2} aria-hidden="true" />
          </button>
          <button type="button" aria-label={copy.moveDown} title={copy.moveDown} disabled={rank === count - 1} onClick={() => onMove(provider.id, 1)} className="flex h-7 w-7 items-center justify-center rounded-[7px] text-white/45 hover:bg-white/[0.07] hover:text-white disabled:opacity-20 disabled:hover:bg-transparent">
            <IconChevronDown size={15} stroke={2} aria-hidden="true" />
          </button>
        </div>
      </div>

      <KeyField provider={provider} value={key} onChange={(value) => onKey(provider.id, value)} copy={copy} />

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer" className={LINK}>
          {copy.getKey}
          <IconExternalLink size={11} stroke={2} aria-hidden="true" />
        </a>
        {key && BALANCE_PROVIDERS.has(provider.id) && (
          <BalanceLine key={key} providerId={provider.id} apiKey={key} autoCheck={key === savedKeys[provider.id]} locale={locale} copy={copy} />
        )}
        {key && noBalance && (
          <span className="flex min-w-0 items-center gap-2 text-[11.5px] font-semibold text-white/45">
            <span className="truncate">{fill(copy.balanceUnavailable, { provider: provider.label })}</span>
            {provider.usageUrl && (
              <a href={provider.usageUrl} target="_blank" rel="noopener noreferrer" className={`${LINK} shrink-0 text-[11.5px]`}>
                {copy.viewUsage}
                <IconExternalLink size={11} stroke={2} aria-hidden="true" />
              </a>
            )}
          </span>
        )}
        {key && !noBalance && provider.usageUrl && (
          <a href={provider.usageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-white/35 hover:text-white">
            {copy.viewUsage}
            <IconExternalLink size={11} stroke={2} aria-hidden="true" />
          </a>
        )}
      </div>

      {CHAT_PROVIDER_IDS.includes(provider.id) && (
        <div className="mt-4 border-t border-white/[0.06] pt-3">
          <label className="mb-1 block text-[11.5px] font-semibold text-white/45" htmlFor={`chat-model-${provider.id}`}>{copy.chatModel}</label>
          <input
            id={`chat-model-${provider.id}`}
            type="text"
            value={settings.options[provider.id]?.chatModel || ''}
            onChange={(event) => onOptions(provider.id, { ...(settings.options[provider.id] || {}), chatModel: event.target.value })}
            placeholder={DEFAULT_CHAT_MODELS[provider.id]}
            spellCheck={false}
            className={FIELD_MONO}
          />
          <p className="mt-1 text-[11.5px] text-white/35">{copy.chatModelHint}</p>
        </div>
      )}
    </div>
  );
}

export default function ProvidersSection({ locale, copy }) {
  const { settings, setKey, setOptions, move, isConfigured } = useProviderSettings();
  // Balances are checked on open only for keys that were already saved.
  const [savedKeys] = useState(() => settings.keys);
  const cloud = settings.order.map((id) => PROVIDERS.find((provider) => provider.id === id)).filter((provider) => provider?.kind === 'cloud');

  return (
    <>
      <p className="oga-enter -mt-2 text-[12px] leading-relaxed text-white/40">{copy.orderHint}</p>
      <div className="space-y-3">
        {cloud.map((provider, rank) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            rank={rank}
            count={cloud.length}
            settings={settings}
            savedKeys={savedKeys}
            configured={isConfigured(provider)}
            locale={locale}
            copy={copy}
            onKey={setKey}
            onOptions={setOptions}
            onMove={move}
          />
        ))}
      </div>
    </>
  );
}
