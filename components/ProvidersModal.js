'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CHAT_PROVIDER_IDS, DEFAULT_CHAT_MODELS, PROVIDERS, NO_BALANCE_PROVIDER_IDS, listCheckpoints, loadProviderSettings, saveProviderSettings, clearSpend, formatMoney, getSpend, monthlySpend, subscribeSpend } from 'studio';
import { getCommonCopy } from '@/lib/locales';
import LocalEngineSetup from './LocalEngineSetup';
import LibrarySection from './LibrarySection';

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
        className="flex-1 min-w-0 h-9 rounded-md bg-black/40 border border-white/10 px-3 text-[13px] font-mono text-white placeholder:text-white/25 focus:outline-none focus:border-[#22d3ee]/50"
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        className="h-9 px-2.5 rounded-md border border-white/10 bg-white/5 text-[11px] font-semibold text-white/60 hover:text-white"
      >
        {visible ? copy.hide : copy.show}
      </button>
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="h-9 px-2.5 rounded-md border border-red-500/20 bg-red-500/10 text-[11px] font-semibold text-red-300 hover:bg-red-500/20"
        >
          {copy.clear}
        </button>
      )}
    </div>
  );
}

// Providers whose balance /api/balance can read.
const BALANCE_PROVIDERS = new Set(['fal', 'wavespeed', 'openrouter', 'elevenlabs']);

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
      text = copy.balanceCharacters.replace('{remaining}', number(state.remaining)).replace('{limit}', number(state.limit));
      tone = state.remaining > 0 ? 'text-emerald-300' : 'text-amber-300';
    } else {
      const template = { balance: copy.balance, keyLimit: copy.balanceKeyLimit, usage: copy.balanceUsage }[state.kind] || copy.balance;
      text = template.replace('{amount}', money(state.amount, state.currency));
      if (state.kind !== 'usage') tone = 'text-emerald-300';
    }
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      {text && <span className={`text-[11px] font-semibold truncate ${tone}`}>{text}</span>}
      {state.kind === 'needsAdminKey' && (
        <a href="https://fal.ai/dashboard/billing" target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold text-[#22d3ee] hover:underline flex-shrink-0">
          {copy.balanceOpenDashboard} ↗
        </a>
      )}
      <button
        type="button"
        onClick={check}
        disabled={state.status === 'loading'}
        className="text-[11px] font-semibold text-white/45 hover:text-white disabled:opacity-40 flex-shrink-0"
      >
        {state.status === 'idle' ? copy.balanceCheck : copy.balanceRefresh}
      </button>
    </div>
  );
}

const EMPTY_SPEND = { entries: [] };

// What this browser has sent to one provider this calendar month, from the
// price quotes (or the provider's own charge when it reports one).
function SpendLine({ providerId, locale, copy }) {
  const spend = useSyncExternalStore(subscribeSpend, getSpend, () => EMPTY_SPEND);
  const totals = useMemo(() => (spend.entries.length ? monthlySpend() : {}), [spend]);
  const bucket = totals[providerId];
  if (!bucket) return <span className="text-[11px] text-white/30">{copy.spentNone}</span>;
  const number = (value) => new Intl.NumberFormat(locale).format(value ?? 0);
  const runs = (bucket.runs === 1 ? copy.runsOne : copy.runs).replace('{runs}', number(bucket.runs));
  const text = bucket.priced === 0 && bucket.characters > 0
    ? copy.spentMonthCharacters.replace('{characters}', number(bucket.characters)).replace('{runs}', runs)
    : copy.spentMonth.replace('{amount}', `${bucket.estimated > 0 ? '≈ ' : ''}${formatMoney(bucket.amount, bucket.currency, locale)}`).replace('{runs}', runs);
  return (
    <span className="text-[11px] text-white/45" title={copy.spendHint}>
      {text}
      {bucket.estimated > 0 && <span className="text-white/25"> · {copy.spentEstimated}</span>}
    </span>
  );
}

function ComfyOptions({ url, options, onChange, copy }) {
  const [checkpoints, setCheckpoints] = useState([]);
  const [status, setStatus] = useState('idle');

  const load = async () => {
    setStatus('loading');
    try {
      setCheckpoints(await listCheckpoints(url.replace(/\/+$/, '')));
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  };

  const choices = [...new Set([...(options.checkpoint ? [options.checkpoint] : []), ...checkpoints])];

  return (
    <div className="mt-3 space-y-3">
      <div>
        <label className="block text-[11px] font-semibold text-white/40 mb-1">{copy.checkpoint}</label>
        <div className="flex gap-2">
          <select
            value={options.checkpoint || ''}
            onChange={(event) => onChange({ ...options, checkpoint: event.target.value })}
            className="flex-1 min-w-0 h-9 rounded-md bg-black/40 border border-white/10 px-2 text-[13px] text-white focus:outline-none"
          >
            <option value="">{copy.checkpointAuto}</option>
            {choices.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <button
            type="button"
            disabled={!url || status === 'loading'}
            onClick={load}
            className="h-9 px-3 rounded-md border border-white/10 bg-white/5 text-[11px] font-semibold text-white/70 hover:text-white disabled:opacity-40"
          >
            {status === 'loading' ? copy.loadingCheckpoints : copy.loadCheckpoints}
          </button>
        </div>
        {status === 'error' && <p className="mt-1 text-[11px] text-red-300">{copy.checkpointsError}</p>}
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-white/40 mb-1">{copy.customWorkflow}</label>
        <textarea
          value={options.workflow || ''}
          onChange={(event) => onChange({ ...options, workflow: event.target.value })}
          rows={3}
          spellCheck={false}
          className="w-full rounded-md bg-black/40 border border-white/10 p-2 text-[12px] font-mono text-white placeholder:text-white/25 focus:outline-none focus:border-[#22d3ee]/50"
          placeholder='{"3": {"class_type": "KSampler", ...}}'
        />
        <p className="mt-1 text-[11px] text-white/35">{copy.customWorkflowHint}</p>
      </div>
    </div>
  );
}

export default function ProvidersModal({ onClose, locale = 'en', libraryAction = null }) {
  const copy = getCommonCopy(locale).providersModal;
  const [settings, setSettings] = useState(() => loadProviderSettings());
  const [savedKeys] = useState(() => settings.keys);
  const settingsRef = useRef(settings);

  // Saving notifies every studio, so it must not run inside a state updater
  // (React would see other components update while this one renders).
  const update = useCallback((updater) => {
    const next = saveProviderSettings(updater(settingsRef.current));
    settingsRef.current = next;
    setSettings(next);
  }, []);

  const setKey = (id, value) => update((current) => ({ ...current, keys: { ...current.keys, [id]: value.trim() } }));
  const setUrl = (id, value) => update((current) => ({ ...current, urls: { ...current.urls, [id]: value.trim() } }));
  const setOptions = (id, value) => update((current) => ({ ...current, options: { ...current.options, [id]: value } }));
  const move = (id, delta) => update((current) => {
    const order = [...current.order];
    const index = order.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= order.length) return current;
    [order[index], order[target]] = [order[target], order[index]];
    return { ...current, order };
  });

  const ordered = settings.order.map((id) => PROVIDERS.find((provider) => provider.id === id)).filter(Boolean);
  const isConfigured = (provider) => Boolean(provider.kind === 'local' ? settings.urls[provider.id] : settings.keys[provider.id]);

  const renderProvider = (provider) => {
    const rank = settings.order.indexOf(provider.id);
    return (
      <div key={provider.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold text-white">{provider.label}</span>
              <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${isConfigured(provider) ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-white/35'}`}>
                {isConfigured(provider) ? copy.configured : copy.notConfigured}
              </span>
            </div>
            <p className="text-[12px] text-white/45 mt-0.5">{provider.description}</p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0" aria-label={copy.order}>
            <button type="button" aria-label={copy.moveUp} title={copy.moveUp} disabled={rank === 0} onClick={() => move(provider.id, -1)} className="w-7 h-7 rounded-md text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-20">↑</button>
            <button type="button" aria-label={copy.moveDown} title={copy.moveDown} disabled={rank === settings.order.length - 1} onClick={() => move(provider.id, 1)} className="w-7 h-7 rounded-md text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-20">↓</button>
          </div>
        </div>

        {provider.kind === 'cloud' ? (
          <>
            <KeyField provider={provider} value={settings.keys[provider.id] || ''} onChange={(value) => setKey(provider.id, value)} copy={copy} />
            <div className="mt-2 flex items-center justify-between gap-3">
              <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold text-[#22d3ee] hover:underline flex-shrink-0">
                {copy.getKey} ↗
              </a>
              {BALANCE_PROVIDERS.has(provider.id) && settings.keys[provider.id] && (
                <BalanceLine
                  key={settings.keys[provider.id]}
                  providerId={provider.id}
                  apiKey={settings.keys[provider.id]}
                  autoCheck={settings.keys[provider.id] === savedKeys[provider.id]}
                  locale={locale}
                  copy={copy}
                />
              )}
              {NO_BALANCE_PROVIDER_IDS.includes(provider.id) && settings.keys[provider.id] && (
                <span className="flex items-start gap-2 min-w-0 text-[11px] font-semibold text-white/45 text-right">
                  <span>{copy.balanceUnavailable.replace('{provider}', provider.label)}</span>
                  {provider.usageUrl && (
                    <a href={provider.usageUrl} target="_blank" rel="noopener noreferrer" className="text-[#22d3ee] hover:underline flex-shrink-0">
                      {copy.viewUsage} ↗
                    </a>
                  )}
                </span>
              )}
            </div>
            {settings.keys[provider.id] && (
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <SpendLine providerId={provider.id} locale={locale} copy={copy} />
                {provider.usageUrl && !NO_BALANCE_PROVIDER_IDS.includes(provider.id) && (
                  <a href={provider.usageUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold text-white/35 hover:text-white flex-shrink-0">
                    {copy.viewUsage} ↗
                  </a>
                )}
              </div>
            )}
            {CHAT_PROVIDER_IDS.includes(provider.id) && (
              <div className="mt-3">
                <label className="block text-[11px] font-semibold text-white/40 mb-1">{copy.chatModel}</label>
                <input
                  type="text"
                  value={settings.options[provider.id]?.chatModel || ''}
                  onChange={(event) => setOptions(provider.id, { ...(settings.options[provider.id] || {}), chatModel: event.target.value })}
                  placeholder={DEFAULT_CHAT_MODELS[provider.id]}
                  spellCheck={false}
                  className="w-full h-9 rounded-md bg-black/40 border border-white/10 px-3 text-[13px] font-mono text-white placeholder:text-white/25 focus:outline-none focus:border-[#22d3ee]/50"
                />
                <p className="mt-1 text-[11px] text-white/30">{copy.chatModelHint}</p>
              </div>
            )}
          </>
        ) : (
          <>
            <label className="block text-[11px] font-semibold text-white/40 mb-1">{copy.serverUrl}</label>
            <input
              type="url"
              value={settings.urls[provider.id] || ''}
              onChange={(event) => setUrl(provider.id, event.target.value)}
              placeholder={provider.urlPlaceholder}
              spellCheck={false}
              className="w-full h-9 rounded-md bg-black/40 border border-white/10 px-3 text-[13px] font-mono text-white placeholder:text-white/25 focus:outline-none focus:border-[#22d3ee]/50"
            />
            <LocalEngineSetup providerId={provider.id} url={settings.urls[provider.id] || ''} onUseDefault={(value) => setUrl(provider.id, value)} copy={copy.localSetup} />
            {provider.id === 'comfyui' && settings.urls.comfyui && (
              <ComfyOptions url={settings.urls.comfyui} options={settings.options.comfyui || {}} onChange={(value) => setOptions('comfyui', value)} copy={copy} />
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="oga-backdrop-in fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="providers-title">
      <div className="oga-dialog-in w-full max-w-2xl max-h-[90vh] flex flex-col bg-[#0a0a0a] border border-white/10 rounded-xl shadow-2xl">
        <div className="px-6 pt-6 pb-4 border-b border-white/[0.06]">
          <h2 id="providers-title" className="text-white font-bold text-lg">{copy.title}</h2>
          <p className="text-white/45 text-[13px] mt-1">{copy.subtitle}</p>
          <p className="text-white/35 text-[12px] mt-2 flex gap-2">
            <span aria-hidden="true">🔒</span>
            <span>{copy.privacy}</span>
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <section>
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-white/40 mb-3">{copy.cloudSection}</h3>
            <div className="space-y-3">{ordered.filter((provider) => provider.kind === 'cloud').map(renderProvider)}</div>
            <p className="text-[11px] text-white/30 mt-2">{copy.orderHint}</p>
            <p className="text-[11px] text-white/30 mt-1 flex items-start justify-between gap-3">
              <span>{copy.spendHint}</span>
              <button
                type="button"
                onClick={() => { if (window.confirm(copy.spendResetConfirm)) clearSpend(); }}
                className="font-semibold text-white/40 hover:text-white flex-shrink-0"
              >
                {copy.spendReset}
              </button>
            </p>
          </section>
          <section>
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-white/40 mb-1">{copy.localSection}</h3>
            <p className="text-[11px] text-white/30 mb-3">{copy.localHint}</p>
            <div className="space-y-3">{ordered.filter((provider) => provider.kind === 'local').map(renderProvider)}</div>
          </section>
          <LibrarySection locale={locale} copy={copy.library} initialAction={libraryAction} />
        </div>

        <div className="px-6 py-4 border-t border-white/[0.06] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-6 rounded-md bg-[#22d3ee] text-black text-[13px] font-bold hover:bg-[#06b6d4] transition-colors"
          >
            {copy.done}
          </button>
        </div>
      </div>
    </div>
  );
}
