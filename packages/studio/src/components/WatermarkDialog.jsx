"use client";

import { useEffect, useRef, useState } from "react";
import { saveLocalBlob } from "../providers/mediaStore.js";
import {
  WATERMARK_POSITIONS,
  drawWatermark,
  loadImage,
  loadWatermarkSettings,
  saveWatermarkSettings,
  openMedia,
  watermarkImage,
  watermarkVideo,
} from "../watermark.js";

const PREVIEW_MAX = 520;

// Loads the image, or the video's first frame, as something a canvas can draw.
async function loadPreviewSource(url, kind) {
  const media = await openMedia(url);
  if (kind === "image") return { source: await loadImage(media.src), release: media.release };
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.src = media.src;
  await new Promise((resolve, reject) => {
    video.onloadeddata = resolve;
    video.onerror = () => reject(new Error("Could not load the video"));
  });
  video.currentTime = Math.min(0.1, video.duration || 0);
  await new Promise((resolve) => { video.onseeked = resolve; });
  return { source: video, release: media.release };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function WatermarkDialog({ mediaUrl, kind = "image", copy, onClose, onDone }) {
  const [settings, setSettings] = useState(() => loadWatermarkSettings());
  const [preview, setPreview] = useState(null);
  const [logo, setLogo] = useState(null);
  const [status, setStatus] = useState({ state: "idle" });
  const canvasRef = useRef(null);
  const abortRef = useRef(null);
  const logoInputRef = useRef(null);

  const update = (changes) => setSettings((current) => ({ ...current, ...changes }));
  const busy = status.state === "working";
  const hasContent = Boolean(settings.text.trim() || settings.logoUrl);

  useEffect(() => {
    let cancelled = false;
    let release = null;
    loadPreviewSource(mediaUrl, kind)
      .then((result) => {
        release = result.release;
        if (!cancelled) setPreview(result.source);
      })
      .catch(() => !cancelled && setStatus({ state: "error", message: copy.previewFailed }));
    return () => {
      cancelled = true;
      release?.();
    };
  }, [mediaUrl, kind, copy.previewFailed]);

  useEffect(() => {
    let cancelled = false;
    if (!settings.logoUrl) {
      setLogo(null);
      return undefined;
    }
    loadImage(settings.logoUrl).then((image) => !cancelled && setLogo(image)).catch(() => !cancelled && setLogo(null));
    return () => { cancelled = true; };
  }, [settings.logoUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !preview) return;
    const width = preview.naturalWidth || preview.videoWidth;
    const height = preview.naturalHeight || preview.videoHeight;
    const scale = Math.min(1, PREVIEW_MAX / Math.max(width, height));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(preview, 0, 0, canvas.width, canvas.height);
    drawWatermark(ctx, canvas.width, canvas.height, settings, logo);
  }, [preview, settings, logo]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const chooseLogo = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    update({ logoUrl: await readFileAsDataUrl(file) });
  };

  const apply = async () => {
    if (!hasContent || busy) return;
    saveWatermarkSettings(settings);
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus({ state: "working", progress: 0 });
    try {
      const blob = kind === "image"
        ? await watermarkImage(mediaUrl, settings)
        : await watermarkVideo(mediaUrl, settings, {
          signal: controller.signal,
          onProgress: (progress) => setStatus({ state: "working", progress }),
        });
      const extension = blob.type.includes("png") ? "png" : blob.type.includes("jpeg") ? "jpg" : blob.type.includes("mp4") ? "mp4" : "webm";
      const url = await saveLocalBlob(blob, { name: `watermarked.${extension}` });
      onDone(url);
    } catch (error) {
      if (error?.name === "AbortError") {
        setStatus({ state: "idle" });
        return;
      }
      setStatus({ state: "error", message: error?.message || copy.failed });
    } finally {
      abortRef.current = null;
    }
  };

  const cancel = () => {
    if (busy) abortRef.current?.abort();
    else onClose();
  };

  const label = "block text-[11px] font-semibold text-white/50 mb-1";
  const field = "w-full h-9 rounded-md bg-black/40 border border-white/10 px-3 text-[13px] text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50";

  return (
    <div className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="watermark-title" onClick={(event) => event.stopPropagation()}>
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto bg-[#0a0a0a] border border-white/10 rounded-xl shadow-2xl p-5 md:p-6">
        <h2 id="watermark-title" className="text-white font-bold text-lg mb-4">{copy.title}</h2>
        <div className="flex flex-col md:flex-row gap-5">
          <div className="flex-1 min-w-0 flex items-center justify-center rounded-lg bg-black/50 border border-white/5 min-h-[200px] p-2">
            {preview
              ? <canvas ref={canvasRef} className="max-w-full h-auto rounded" />
              : <span className="text-[12px] text-white/40">{status.state === "error" ? status.message : copy.loadingPreview}</span>}
          </div>

          <div className="w-full md:w-64 flex-shrink-0 space-y-3">
            <div>
              <label className={label} htmlFor="watermark-text">{copy.text}</label>
              <input id="watermark-text" type="text" value={settings.text} maxLength={80} disabled={busy} onChange={(event) => update({ text: event.target.value })} placeholder={copy.textPlaceholder} className={field} />
            </div>
            <div>
              <span className={label}>{copy.logo}</span>
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => logoInputRef.current?.click()} className="flex-1 h-9 rounded-md border border-white/10 bg-white/5 text-[12px] font-semibold text-white/70 hover:text-white disabled:opacity-40">
                  {settings.logoUrl ? copy.replaceLogo : copy.uploadLogo}
                </button>
                {settings.logoUrl && (
                  <button type="button" disabled={busy} onClick={() => update({ logoUrl: "" })} className="h-9 px-3 rounded-md border border-red-500/20 bg-red-500/10 text-[12px] font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-40">
                    {copy.removeLogo}
                  </button>
                )}
              </div>
              <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={chooseLogo} />
            </div>
            <div>
              <label className={label} htmlFor="watermark-position">{copy.position}</label>
              <select id="watermark-position" value={settings.position} disabled={busy} onChange={(event) => update({ position: event.target.value })} className={field}>
                {WATERMARK_POSITIONS.map((position) => <option key={position} value={position}>{copy.positions[position]}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="watermark-size">{copy.size}</label>
              <input id="watermark-size" type="range" min="2" max="20" step="0.5" value={settings.size} disabled={busy} onChange={(event) => update({ size: Number(event.target.value) })} className="w-full accent-primary" />
            </div>
            <div>
              <label className={label} htmlFor="watermark-opacity">{copy.opacity}</label>
              <input id="watermark-opacity" type="range" min="0.1" max="1" step="0.05" value={settings.opacity} disabled={busy} onChange={(event) => update({ opacity: Number(event.target.value) })} className="w-full accent-primary" />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-white/50" htmlFor="watermark-color">{copy.color}</label>
              <input id="watermark-color" type="color" value={settings.color} disabled={busy} onChange={(event) => update({ color: event.target.value })} className="w-10 h-7 rounded border border-white/10 bg-transparent" />
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:items-center gap-3 sm:justify-end">
          {status.state === "working" && kind === "video" && (
            <span className="text-[12px] text-white/50 sm:mr-auto">{copy.recording.replace("{percent}", Math.round((status.progress || 0) * 100))}</span>
          )}
          {status.state === "error" && preview && <span className="text-[12px] text-red-300 sm:mr-auto">{status.message}</span>}
          {!hasContent && status.state === "idle" && <span className="text-[12px] text-white/35 sm:mr-auto">{copy.needsContent}</span>}
          <button type="button" onClick={cancel} className="h-10 px-5 rounded-md border border-white/10 bg-white/5 text-[13px] font-semibold text-white/70 hover:text-white">
            {copy.cancel}
          </button>
          <button type="button" onClick={apply} disabled={!hasContent || busy || !preview} className="h-10 px-6 rounded-md bg-primary text-black text-[13px] font-bold hover:opacity-90 disabled:opacity-40">
            {busy ? copy.applying : copy.apply}
          </button>
        </div>
      </div>
    </div>
  );
}
