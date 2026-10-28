'use client';

// Usage: what this browser has sent to each provider this calendar month,
// from the spend ledger (price quotes, or the provider's reported charge).

import { useMemo, useSyncExternalStore } from 'react';
import { PROVIDERS, clearSpend, formatMoney, getSpend, monthlySpend, subscribeSpend } from 'studio';
import { BUTTON, Group, fill } from './ui';

const EMPTY_SPEND = { entries: [] };

export default function UsageSection({ locale, copy }) {
  const spend = useSyncExternalStore(subscribeSpend, getSpend, () => EMPTY_SPEND);
  const totals = useMemo(() => (spend.entries.length ? monthlySpend() : {}), [spend]);
  const number = (value) => new Intl.NumberFormat(locale).format(value ?? 0);

  const rows = PROVIDERS.filter((provider) => totals[provider.id]).map((provider) => ({ provider, bucket: totals[provider.id] }));
  const sums = rows.reduce((acc, { bucket }) => {
    if (bucket.priced === 0) return acc;
    const currency = bucket.currency || 'USD';
    acc[currency] = (acc[currency] || 0) + bucket.amount;
    return acc;
  }, {});
  const estimated = rows.some(({ bucket }) => bucket.estimated > 0);
  const month = (() => {
    try { return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date()); } catch { return ''; }
  })();

  const spent = (bucket) => {
    if (bucket.priced === 0 && bucket.characters > 0) return fill(copy.characters, { count: number(bucket.characters) });
    if (bucket.priced === 0) return '—';
    return `${bucket.estimated > 0 ? '≈ ' : ''}${formatMoney(bucket.amount, bucket.currency, locale)}`;
  };

  return (
    <>
      <Group
        title={`${copy.month} · ${month}`}
        hint={copy.hint}
        action={rows.length > 0 && (
          <button type="button" onClick={() => { if (window.confirm(copy.resetConfirm)) clearSpend(); }} className={BUTTON.replace('h-9', 'h-8')} data-usage-reset>
            {copy.reset}
          </button>
        )}
      >
        {rows.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-white/40">{copy.empty}</p>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white/35">
              <span>{copy.provider}</span>
              <span className="text-right">{copy.runs}</span>
              <span className="text-right">{copy.spent}</span>
            </div>
            {rows.map(({ provider, bucket }) => (
              <div key={provider.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 py-3 text-[13px]" data-usage-row={provider.id}>
                <span className="font-medium text-white/90">{provider.label}</span>
                <span className="text-right tabular-nums text-white/55">{number(bucket.runs)}</span>
                <span className="text-right tabular-nums text-white/90">{spent(bucket)}</span>
              </div>
            ))}
            <div className="grid grid-cols-[1fr_auto] items-center gap-x-6 py-3 text-[13px]">
              <span className="font-semibold text-white">
                {copy.total}
                {estimated && <span className="ml-2 text-[11px] font-normal text-white/35">{copy.estimated}</span>}
              </span>
              <span className="text-right font-semibold tabular-nums text-white">
                {Object.keys(sums).length === 0 ? '—' : Object.entries(sums).map(([currency, amount]) => formatMoney(amount, currency, locale)).join(' + ')}
              </span>
            </div>
          </>
        )}
      </Group>
    </>
  );
}
