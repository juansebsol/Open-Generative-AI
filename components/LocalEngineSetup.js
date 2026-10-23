'use client';

import { useEffect, useState } from 'react';

// Guided setup for the browser-direct local engines: copyable install steps,
// a default URL and a connection test that runs from this page, so it checks
// exactly what generation will need (reachability and CORS).

const ENGINES = {
  comfyui: {
    defaultUrl: 'http://127.0.0.1:8188',
    async test(baseUrl) {
      const response = await fetch(`${baseUrl}/system_stats`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const stats = await response.json();
      return { ready: true, detail: stats?.devices?.[0]?.name || stats?.system?.os || '' };
    },
    steps: (origin) => [
      { key: 'comfyInstall', commands: ['git clone https://github.com/Comfy-Org/ComfyUI', 'cd ComfyUI', 'pip install -r requirements.txt'], link: 'https://www.comfy.org/download' },
      { key: 'comfyModel' },
      { key: 'comfyStart', commands: [`python main.py --enable-cors-header ${origin}`] },
      { key: 'connect' },
    ],
  },
  sdserver: {
    defaultUrl: 'http://127.0.0.1:1234',
    async test(baseUrl) {
      const response = await fetch(`${baseUrl}/sdcpp/v1/models/status`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (response?.ok) {
        const status = await response.json();
        return { ready: status?.state === 'ready', state: status?.state || '' };
      }
      // Other OpenAI-compatible servers: a reachable /v1/models is enough.
      const fallback = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(5000) });
      if (!fallback.ok) throw new Error(`HTTP ${fallback.status}`);
      const models = await fallback.json();
      return { ready: (models?.data || []).length > 0, state: (models?.data || []).length > 0 ? 'ready' : 'empty' };
    },
    steps: () => [
      { key: 'sdDownload', link: 'https://github.com/leejet/stable-diffusion.cpp/releases' },
      { key: 'sdModel', commands: ['mkdir models && cd models', 'curl -L -O https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors', 'cd ..'] },
      { key: 'sdStart', commands: ['sd-server --model-dir ./models --listen-port 1234'] },
      { key: 'connect' },
    ],
  },
};

function CommandLine({ command, copy }) {
  const [copied, setCopied] = useState(false);
  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: the command is still selectable
    }
  };
  return (
    <div className="flex items-center gap-2 rounded-md bg-black/50 border border-white/[0.06] pl-2.5 pr-1 py-1">
      <code className="flex-1 min-w-0 overflow-x-auto whitespace-nowrap text-[11px] font-mono text-white/75">{command}</code>
      <button type="button" onClick={copyCommand} className="flex-shrink-0 h-6 px-2 rounded text-[10px] font-semibold text-white/50 hover:text-white hover:bg-white/10">
        {copied ? copy.copied : copy.copy}
      </button>
    </div>
  );
}

export default function LocalEngineSetup({ providerId, url, onUseDefault, copy }) {
  const engine = ENGINES[providerId];
  const [guideOpen, setGuideOpen] = useState(false);
  const [status, setStatus] = useState({ state: 'idle' });
  const [origin, setOrigin] = useState('http://localhost:3000');

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    setStatus({ state: 'idle' });
  }, [url]);

  if (!engine) return null;
  const baseUrl = (url || '').replace(/\/+$/, '');

  const test = async () => {
    if (!baseUrl) return;
    setStatus({ state: 'testing' });
    try {
      const result = await engine.test(baseUrl);
      setStatus({ state: result.ready ? 'ok' : 'noModel', ...result });
    } catch {
      setStatus({ state: 'error' });
    }
  };

  let message = null;
  if (status.state === 'testing') message = <span className="text-white/50">{copy.testing}</span>;
  if (status.state === 'ok') message = <span className="text-emerald-300">{copy.testOk}{status.detail ? ` · ${status.detail}` : ''}</span>;
  if (status.state === 'noModel') message = <span className="text-amber-300">{copy.testNoModel.replace('{state}', status.state || 'empty')}</span>;
  if (status.state === 'error') message = <span className="text-red-300">{providerId === 'comfyui' ? copy.testFailedComfy.replace('{origin}', origin) : copy.testFailedSd}</span>;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {!url && (
          <button type="button" onClick={() => onUseDefault(engine.defaultUrl)} className="h-7 px-2.5 rounded-md border border-white/10 bg-white/5 text-[11px] font-semibold text-white/70 hover:text-white">
            {copy.useDefault.replace('{url}', engine.defaultUrl)}
          </button>
        )}
        <button type="button" disabled={!baseUrl || status.state === 'testing'} onClick={test} className="h-7 px-2.5 rounded-md border border-white/10 bg-white/5 text-[11px] font-semibold text-white/70 hover:text-white disabled:opacity-40">
          {copy.testConnection}
        </button>
        <button type="button" onClick={() => setGuideOpen((open) => !open)} aria-expanded={guideOpen} className="h-7 px-2.5 rounded-md text-[11px] font-semibold text-[#22d3ee] hover:underline">
          {guideOpen ? copy.hideGuide : copy.showGuide}
        </button>
      </div>
      {message && <p className="text-[11px] leading-relaxed">{message}</p>}

      {guideOpen && (
        <ol className="space-y-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          {engine.steps(origin).map((step, index) => (
            <li key={step.key} className="space-y-1.5">
              <p className="text-[12px] text-white/70 leading-relaxed">
                <span className="font-bold text-white/40 mr-1.5">{index + 1}.</span>
                {copy.steps[step.key].replace('{origin}', origin).replace('{url}', engine.defaultUrl)}
                {step.link && (
                  <>
                    {' '}
                    <a href={step.link} target="_blank" rel="noopener noreferrer" className="text-[#22d3ee] hover:underline">{copy.stepLinks[step.key]} ↗</a>
                  </>
                )}
              </p>
              {step.commands?.map((command) => <CommandLine key={command} command={command} copy={copy} />)}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
