'use client';

// Local engines: ComfyUI and sd.cpp, called straight from the browser, each
// with its server address, a connection test and a setup guide.

import { PROVIDERS, listCheckpoints } from 'studio';
import { useState } from 'react';
import { useProviderSettings } from './providerSettings';
import LocalEngineSetup from './LocalEngineSetup';
import { BUTTON_SMALL, FIELD, FIELD_MONO, Pill, SELECT } from './ui';

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
    <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-3">
      <div>
        <label className="mb-1 block text-[11.5px] font-semibold text-white/45" htmlFor="comfy-checkpoint">{copy.checkpoint}</label>
        <div className="flex gap-2">
          <select id="comfy-checkpoint" value={options.checkpoint || ''} onChange={(event) => onChange({ ...options, checkpoint: event.target.value })} className={`${SELECT} flex-1`}>
            <option value="">{copy.checkpointAuto}</option>
            {choices.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <button type="button" disabled={!url || status === 'loading'} onClick={load} className={`${BUTTON_SMALL} h-9`}>
            {status === 'loading' ? copy.loadingCheckpoints : copy.loadCheckpoints}
          </button>
        </div>
        {status === 'error' && <p className="mt-1 text-[11.5px] text-red-300">{copy.checkpointsError}</p>}
      </div>
      <div>
        <label className="mb-1 block text-[11.5px] font-semibold text-white/45" htmlFor="comfy-workflow">{copy.customWorkflow}</label>
        <textarea
          id="comfy-workflow"
          value={options.workflow || ''}
          onChange={(event) => onChange({ ...options, workflow: event.target.value })}
          rows={3}
          spellCheck={false}
          className={`${FIELD_MONO} h-auto py-2 text-[12px]`}
          placeholder='{"3": {"class_type": "KSampler", ...}}'
        />
        <p className="mt-1 text-[11.5px] text-white/35">{copy.customWorkflowHint}</p>
      </div>
    </div>
  );
}

export default function LocalEnginesSection({ copy }) {
  const { settings, setUrl, setOptions, isConfigured } = useProviderSettings();
  const local = settings.order.map((id) => PROVIDERS.find((provider) => provider.id === id)).filter((provider) => provider?.kind === 'local');

  return (
    <>
      <p className="oga-enter -mt-2 text-[12px] leading-relaxed text-white/40">{copy.localHint}</p>
      <div className="space-y-3">
        {local.map((provider, index) => (
          <div key={provider.id} className="oga-enter rounded-[14px] border border-white/[0.07] bg-white/[0.02] p-4 md:p-5" style={{ '--i': index }} data-provider-card={provider.id}>
            <div className="mb-3 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-semibold text-white">{provider.label}</span>
                <Pill on={isConfigured(provider)}>{isConfigured(provider) ? copy.configured : copy.notConfigured}</Pill>
              </div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-white/45">{provider.description}</p>
            </div>
            <label className="mb-1 block text-[11.5px] font-semibold text-white/45" htmlFor={`url-${provider.id}`}>{copy.serverUrl}</label>
            <input
              id={`url-${provider.id}`}
              type="url"
              value={settings.urls[provider.id] || ''}
              onChange={(event) => setUrl(provider.id, event.target.value)}
              placeholder={provider.urlPlaceholder}
              spellCheck={false}
              className={FIELD_MONO}
            />
            <LocalEngineSetup providerId={provider.id} url={settings.urls[provider.id] || ''} onUseDefault={(value) => setUrl(provider.id, value)} copy={copy.localSetup} />
            {provider.id === 'comfyui' && settings.urls.comfyui && (
              <ComfyOptions url={settings.urls.comfyui} options={settings.options.comfyui || {}} onChange={(value) => setOptions('comfyui', value)} copy={copy} />
            )}
          </div>
        ))}
      </div>
    </>
  );
}
