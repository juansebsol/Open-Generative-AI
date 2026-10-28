'use client';

// Settings: every setting that applies to the whole studio, in one dialog
// with a section list on the left and the open section on the right. A
// tool's own options stay with that tool; what lands here is global:
// language, provider keys and order, local engines, spend, the watermark
// defaults and the library file. It is a dialog rather than a page so the
// studios behind it keep whatever is in progress.

import { useEffect, useMemo, useState } from 'react';
import { IconAdjustmentsHorizontal, IconArchive, IconCoins, IconKey, IconServer, IconSettings, IconTypography, IconX } from '@tabler/icons-react';
import { PROVIDERS, loadProviderSettings, subscribeProviderSettings } from 'studio';
import { getCommonCopy } from '@/lib/locales';
import GeneralSection from './GeneralSection';
import ProvidersSection from './ProvidersSection';
import LocalEnginesSection from './LocalEnginesSection';
import UsageSection from './UsageSection';
import WatermarkSection from './WatermarkSection';
import LibrarySection from './LibrarySection';
import { fill } from './ui';
import pkg from '../../package.json';

export const SETTINGS_SECTIONS = ['general', 'providers', 'local', 'usage', 'watermark', 'library'];

const ICONS = {
  general: IconAdjustmentsHorizontal,
  providers: IconKey,
  local: IconServer,
  usage: IconCoins,
  watermark: IconTypography,
  library: IconArchive,
};

const countConfigured = (kind) => {
  const settings = loadProviderSettings();
  return PROVIDERS.filter((provider) => provider.kind === kind && (kind === 'local' ? settings.urls?.[provider.id] : settings.keys?.[provider.id])).length;
};

export default function SettingsDialog({ locale = 'en', section = 'general', libraryAction = null, languagePath, onClose }) {
  const common = getCommonCopy(locale);
  const copy = common.settings;
  const providerCopy = common.providersModal;
  const [active, setActive] = useState(SETTINGS_SECTIONS.includes(section) ? section : 'general');
  const [counts, setCounts] = useState(() => ({ cloud: countConfigured('cloud'), local: countConfigured('local') }));

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => subscribeProviderSettings(() => setCounts({ cloud: countConfigured('cloud'), local: countConfigured('local') })), []);

  const meta = useMemo(() => ({
    providers: counts.cloud > 0 ? { tone: 'ok', text: fill(copy.status.connected, { count: counts.cloud }) } : { tone: 'warn', text: copy.status.none },
    local: counts.local > 0 ? { tone: 'ok', text: fill(copy.status.connected, { count: counts.local }) } : null,
  }), [counts, copy.status]);

  const body = {
    general: <GeneralSection locale={locale} copy={copy.general} version={pkg.version} languagePath={languagePath} />,
    providers: <ProvidersSection locale={locale} copy={providerCopy} />,
    local: <LocalEnginesSection copy={providerCopy} />,
    usage: <UsageSection locale={locale} copy={copy.usage} />,
    watermark: <WatermarkSection copy={copy.watermark} />,
    library: <LibrarySection locale={locale} copy={providerCopy.library} initialAction={libraryAction} />,
  }[active];

  return (
    <div
      className="oga-backdrop-in fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm md:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      role="presentation"
      data-settings-dialog
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="oga-dialog-in flex h-full w-full max-w-[1040px] flex-col overflow-hidden bg-[#0c0c0f] shadow-[0_40px_120px_rgba(0,0,0,0.7)] md:h-[min(760px,92vh)] md:flex-row md:rounded-[18px] md:border md:border-white/[0.1]"
      >
        <aside className="flex shrink-0 flex-col border-b border-white/[0.07] bg-[#0a0a0d] md:w-[236px] md:border-b-0 md:border-r">
          <div className="flex items-center justify-between gap-2.5 px-4 pb-2 pt-4 md:px-5 md:pb-4 md:pt-5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-[8px] border border-white/[0.07] bg-white/[0.04] text-white/70">
                <IconSettings size={15} stroke={1.75} aria-hidden="true" />
              </span>
              <h2 id="settings-title" className="text-[15px] font-semibold tracking-[-0.01em] text-white">{copy.title}</h2>
            </div>
            <button type="button" onClick={onClose} aria-label={copy.close} className="flex h-8 w-8 items-center justify-center rounded-[8px] text-white/45 hover:bg-white/[0.06] hover:text-white md:hidden">
              <IconX size={16} stroke={1.75} aria-hidden="true" />
            </button>
          </div>
          <nav aria-label={copy.title} className="oga-scroll-hide flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:pb-4">
            {SETTINGS_SECTIONS.map((id, index) => {
              const Icon = ICONS[id];
              const isActive = id === active;
              const status = meta[id];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActive(id)}
                  aria-current={isActive ? 'page' : undefined}
                  style={{ '--i': index }}
                  className={`oga-enter group flex shrink-0 items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13px] font-medium transition-colors ${isActive ? 'bg-white/[0.07] text-white' : 'text-white/55 hover:bg-white/[0.04] hover:text-white'}`}
                  data-settings-nav={id}
                >
                  <Icon size={16} stroke={1.75} className={isActive ? 'text-primary' : 'text-white/40 group-hover:text-white/70'} aria-hidden="true" />
                  <span className="whitespace-nowrap">{copy.sections[id].label}</span>
                  {status && (
                    <span className={`ml-auto hidden items-center gap-1.5 text-[10.5px] font-semibold md:flex ${status.tone === 'ok' ? 'text-white/35' : 'text-red-300'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${status.tone === 'ok' ? 'bg-emerald-400' : 'bg-red-500'}`} aria-hidden="true" />
                      {status.text}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
          <p className="mt-auto hidden px-5 pb-5 text-[11px] leading-relaxed text-white/30 md:block">{copy.footer}</p>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-start justify-between gap-4 px-5 pb-4 pt-5 md:px-8 md:pt-7">
            <div key={active} className="oga-enter min-w-0">
              <h3 className="text-[20px] font-semibold tracking-[-0.02em] text-white">{copy.sections[active].label}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-white/45">{copy.sections[active].description}</p>
            </div>
            <button type="button" onClick={onClose} aria-label={copy.close} title={copy.close} className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-white/[0.07] text-white/50 transition-colors hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-white md:flex">
              <IconX size={17} stroke={1.75} aria-hidden="true" />
            </button>
          </header>
          <div key={`${active}-body`} className="custom-scrollbar flex-1 space-y-6 overflow-y-auto px-5 pb-8 md:px-8" data-settings-body={active}>
            {body}
          </div>
        </div>
      </div>
    </div>
  );
}
