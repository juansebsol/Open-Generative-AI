'use client';

// Watermark: the saved defaults that Add watermark starts from on any
// result. Changes save as you make them; the preview draws them over a
// neutral frame with the same routine the real watermark uses.

import { useEffect, useRef, useState } from 'react';
import { IconUpload, IconX } from '@tabler/icons-react';
import { DEFAULT_WATERMARK, WATERMARK_POSITIONS, drawWatermark, loadImage, loadWatermarkSettings, saveWatermarkSettings } from 'studio';
import { BUTTON, BUTTON_DANGER, BUTTON_SMALL, FIELD, Group, Row, SELECT } from './ui';

const PREVIEW = { width: 480, height: 300 };

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function WatermarkSection({ copy }) {
  const [settings, setSettings] = useState(() => loadWatermarkSettings());
  const [logo, setLogo] = useState(null);
  const canvasRef = useRef(null);
  const logoInputRef = useRef(null);
  const firstRender = useRef(true);

  const update = (changes) => setSettings((current) => ({ ...current, ...changes }));

  // Save shortly after the last change (a slider fires many).
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return undefined; }
    const timer = window.setTimeout(() => saveWatermarkSettings(settings), 150);
    return () => window.clearTimeout(timer);
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    if (!settings.logoUrl) { setLogo(null); return undefined; }
    loadImage(settings.logoUrl).then((image) => !cancelled && setLogo(image)).catch(() => !cancelled && setLogo(null));
    return () => { cancelled = true; };
  }, [settings.logoUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, PREVIEW.width, PREVIEW.height);
    gradient.addColorStop(0, '#1f2937');
    gradient.addColorStop(1, '#0b1220');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, PREVIEW.width, PREVIEW.height);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let x = 0; x < PREVIEW.width; x += 40) ctx.fillRect(x, 0, 1, PREVIEW.height);
    for (let y = 0; y < PREVIEW.height; y += 40) ctx.fillRect(0, y, PREVIEW.width, 1);
    drawWatermark(ctx, PREVIEW.width, PREVIEW.height, settings, logo);
  }, [settings, logo]);

  const chooseLogo = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) update({ logoUrl: await readFileAsDataUrl(file) });
  };

  const hasContent = Boolean(settings.text.trim() || settings.logoUrl);

  return (
    <>
      <div className="oga-enter overflow-hidden rounded-[14px] border border-white/[0.07] bg-black/40 p-3">
        <canvas ref={canvasRef} width={PREVIEW.width} height={PREVIEW.height} className="mx-auto block h-auto max-h-[240px] w-auto max-w-full" aria-label={copy.preview} data-watermark-preview />
        {!hasContent && <p className="px-1 pb-0.5 pt-3 text-center text-[12px] text-white/40">{copy.empty}</p>}
      </div>

      <Group
        title={copy.defaults}
        hint={copy.hint}
        action={(
          <button type="button" onClick={() => update({ ...DEFAULT_WATERMARK })} className={BUTTON_SMALL} data-watermark-reset>{copy.reset}</button>
        )}
      >
        <Row title={copy.text}>
          <input type="text" value={settings.text} maxLength={80} onChange={(event) => update({ text: event.target.value })} placeholder={copy.textPlaceholder} aria-label={copy.text} className={`${FIELD} sm:w-[260px]`} data-watermark-text />
        </Row>
        <Row title={copy.logo} hint={copy.logoHint}>
          {settings.logoUrl && (
            <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-[9px] border border-white/[0.1] bg-[conic-gradient(#2a2a2e_25%,#1a1a1d_0_50%,#2a2a2e_0_75%,#1a1a1d_0)] bg-[length:12px_12px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={settings.logoUrl} alt="" className="max-h-full max-w-full object-contain" />
            </span>
          )}
          <button type="button" onClick={() => logoInputRef.current?.click()} className={BUTTON}>
            <IconUpload size={14} stroke={2} aria-hidden="true" />
            {settings.logoUrl ? copy.replaceLogo : copy.uploadLogo}
          </button>
          {settings.logoUrl && (
            <button type="button" onClick={() => update({ logoUrl: '' })} className={BUTTON_DANGER} aria-label={copy.removeLogo} title={copy.removeLogo}>
              <IconX size={14} stroke={2} aria-hidden="true" />
            </button>
          )}
          <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={chooseLogo} />
        </Row>
        <Row title={copy.position}>
          <select value={settings.position} onChange={(event) => update({ position: event.target.value })} aria-label={copy.position} className={`${SELECT} w-[180px]`}>
            {WATERMARK_POSITIONS.map((position) => <option key={position} value={position}>{copy.positions[position]}</option>)}
          </select>
        </Row>
        <Row title={copy.size} hint={copy.sizeHint}>
          <input type="range" min="2" max="20" step="0.5" value={settings.size} onChange={(event) => update({ size: Number(event.target.value) })} aria-label={copy.size} className="w-[180px] accent-primary" />
          <span className="w-10 text-right font-mono text-[12px] tabular-nums text-white/55">{settings.size}%</span>
        </Row>
        <Row title={copy.opacity}>
          <input type="range" min="0.1" max="1" step="0.05" value={settings.opacity} onChange={(event) => update({ opacity: Number(event.target.value) })} aria-label={copy.opacity} className="w-[180px] accent-primary" />
          <span className="w-10 text-right font-mono text-[12px] tabular-nums text-white/55">{Math.round(settings.opacity * 100)}%</span>
        </Row>
        <Row title={copy.color}>
          <span className="font-mono text-[12px] text-white/55">{settings.color}</span>
          <input type="color" value={settings.color} onChange={(event) => update({ color: event.target.value })} aria-label={copy.color} className="h-9 w-12 cursor-pointer rounded-[9px] border border-white/[0.1] bg-transparent p-1" />
        </Row>
      </Group>
    </>
  );
}
