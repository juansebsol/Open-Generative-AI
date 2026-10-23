// Adds a text or logo watermark to an image or video entirely in the browser.
// Images are redrawn on a canvas; videos are played once into a canvas and
// recorded with MediaRecorder, keeping the original audio track.

import { fetchMediaBlob } from './providers/mediaStore.js';

export const WATERMARK_POSITIONS = ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center', 'tile'];

export const DEFAULT_WATERMARK = {
  text: '',
  logoUrl: '',
  position: 'bottom-right',
  size: 6, // % of the shorter side
  opacity: 0.7,
  color: '#ffffff',
};

const SETTINGS_KEY = 'oga_watermark_v1';
const MAX_SAVED_LOGO_CHARS = 300_000;

export function loadWatermarkSettings() {
  try {
    return { ...DEFAULT_WATERMARK, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_WATERMARK };
  }
}

export function saveWatermarkSettings(settings) {
  try {
    const { logoUrl, ...rest } = settings;
    const keepLogo = logoUrl?.startsWith('data:') && logoUrl.length <= MAX_SAVED_LOGO_CHARS;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...rest, logoUrl: keepLogo ? logoUrl : '' }));
  } catch {
    // storage full or blocked: settings just aren't remembered
  }
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load the image'));
    image.src = src;
  });
}

/**
 * Opens a media URL as a canvas-safe source. Local, blob: and data: URLs are
 * used as they are (the CSP blocks fetching blob: URLs); provider links are
 * copied into a blob first so the canvas stays readable.
 */
export async function openMedia(url) {
  const direct = /^(blob:|data:|\/(?!\/))/.test(url) || url.startsWith(`${globalThis.location?.origin}/`);
  if (direct) return { src: url, release() {} };
  const objectUrl = URL.createObjectURL(await fetchMediaBlob(url));
  return { src: objectUrl, release: () => URL.revokeObjectURL(objectUrl) };
}

const keepsAlpha = (url) => /^data:image\/(png|webp)|\.(png|webp)(\?|$)/i.test(url);

// Draws the watermark over a frame already on the canvas.
export function drawWatermark(ctx, width, height, settings, logo) {
  const { text, position, opacity, color } = settings;
  if (!text && !logo) return;
  const unit = Math.min(width, height) * (Number(settings.size) || DEFAULT_WATERMARK.size) / 100;
  const margin = unit * 0.6;

  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, Number(opacity)));
  ctx.font = `600 ${unit}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color || DEFAULT_WATERMARK.color;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = unit * 0.15;

  const logoHeight = logo ? unit * 1.6 : 0;
  const logoWidth = logo ? logoHeight * (logo.naturalWidth || logo.width) / (logo.naturalHeight || logo.height) : 0;
  const gap = logo && text ? unit * 0.4 : 0;
  const textWidth = text ? ctx.measureText(text).width : 0;
  const blockWidth = logoWidth + gap + textWidth;
  const blockHeight = Math.max(logoHeight, text ? unit * 1.2 : 0);

  const drawAt = (x, y) => {
    if (logo) ctx.drawImage(logo, x, y + (blockHeight - logoHeight) / 2, logoWidth, logoHeight);
    if (text) ctx.fillText(text, x + logoWidth + gap, y + blockHeight / 2);
  };

  if (position === 'tile') {
    ctx.translate(width / 2, height / 2);
    ctx.rotate(-Math.PI / 6);
    const stepX = blockWidth + unit * 4;
    const stepY = blockHeight + unit * 3;
    const reach = Math.hypot(width, height);
    for (let y = -reach; y < reach; y += stepY) {
      for (let x = -reach + ((y / stepY) % 2 ? stepX / 2 : 0); x < reach; x += stepX) drawAt(x, y);
    }
  } else {
    const left = position.endsWith('left') ? margin : position === 'center' ? (width - blockWidth) / 2 : width - margin - blockWidth;
    const top = position.startsWith('top') ? margin : position === 'center' ? (height - blockHeight) / 2 : height - margin - blockHeight;
    drawAt(left, top);
  }
  ctx.restore();
}

async function loadLogo(settings) {
  return settings.logoUrl ? loadImage(settings.logoUrl) : null;
}

/** Returns a watermarked copy of an image as a Blob (PNG for PNG/WebP sources, else JPEG). */
export async function watermarkImage(url, settings) {
  const media = await openMedia(url);
  try {
    const [image, logo] = await Promise.all([loadImage(media.src), loadLogo(settings)]);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    drawWatermark(ctx, canvas.width, canvas.height, settings, logo);
    const type = keepsAlpha(url) ? 'image/png' : 'image/jpeg';
    return await new Promise((resolve, reject) => canvas.toBlob((out) => (out ? resolve(out) : reject(new Error('Could not encode the image'))), type, 0.95));
  } finally {
    media.release();
  }
}

function pickVideoMimeType() {
  const candidates = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return candidates.find((type) => globalThis.MediaRecorder?.isTypeSupported?.(type)) || '';
}

/**
 * Plays the video once into a canvas with the watermark and records it.
 * Runs in real time, so the tab should stay open until it finishes.
 */
export async function watermarkVideo(url, settings, { onProgress, signal } = {}) {
  if (!globalThis.MediaRecorder) throw new Error('This browser cannot record video.');
  const media = await openMedia(url);
  const video = document.createElement('video');
  video.src = media.src;
  video.playsInline = true;
  video.preload = 'auto';
  let audioContext = null;
  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('Could not load the video'));
    });
    const logo = await loadLogo(settings);
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');

    const stream = canvas.captureStream(30);
    // Route the soundtrack into the recording without playing it aloud.
    try {
      audioContext = new AudioContext();
      const source = audioContext.createMediaElementSource(video);
      const destination = audioContext.createMediaStreamDestination();
      source.connect(destination);
      destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
    } catch {
      // no audio track or no Web Audio: record video only
    }

    const mimeType = pickVideoMimeType();
    const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });

    let frameHandle = null;
    const draw = () => {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      drawWatermark(ctx, canvas.width, canvas.height, settings, logo);
      if (video.duration) onProgress?.(Math.min(1, video.currentTime / video.duration));
      frameHandle = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(draw) : requestAnimationFrame(draw);
    };

    const abort = () => video.pause();
    signal?.addEventListener('abort', abort);
    draw();
    recorder.start(1000);
    await video.play();
    await new Promise((resolve) => {
      video.onended = resolve;
      video.onpause = () => video.ended || signal?.aborted ? resolve() : null;
    });
    if (video.cancelVideoFrameCallback && frameHandle) video.cancelVideoFrameCallback(frameHandle);
    else cancelAnimationFrame(frameHandle);
    recorder.stop();
    await stopped;
    signal?.removeEventListener('abort', abort);
    if (signal?.aborted) throw new DOMException('Watermarking was cancelled', 'AbortError');
    onProgress?.(1);
    return new Blob(chunks, { type: (mimeType || 'video/webm').split(';')[0] });
  } finally {
    audioContext?.close().catch(() => {});
    video.removeAttribute('src');
    media.release();
  }
}
