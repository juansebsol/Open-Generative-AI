// Helpers for the browser-direct local engines.

const MEGAPIXEL_EDGE = 1024;

// "16:9" -> { width, height } around one megapixel, multiples of 64.
export function dimensionsFor(aspectRatio, base = MEGAPIXEL_EDGE) {
  const [w, h] = String(aspectRatio || '1:1').split(':').map(Number);
  const ratio = w > 0 && h > 0 ? w / h : 1;
  const height = Math.max(256, Math.round(Math.sqrt((base * base) / ratio) / 64) * 64);
  const width = Math.max(256, Math.round((height * ratio) / 64) * 64);
  return { width, height };
}

export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 32);
}

export async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function localError(provider, url, error) {
  const message = error?.message || String(error);
  const hint = provider === 'comfyui'
    ? 'Is ComfyUI running with --enable-cors-header, and did you allow local network access in the browser?'
    : 'Is the server running and does it allow cross-origin requests from this page?';
  return new Error(`Could not reach ${provider === 'comfyui' ? 'ComfyUI' : 'the local image server'} at ${url}: ${message}. ${hint}`);
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
