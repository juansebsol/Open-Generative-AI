// Tells SVG results from raster ones. Ideogram's vector endpoints document
// SVG output but their published example response carries a PNG, so every
// output is classified from what actually came back: the provider's
// content type when it sent one, else the URL's extension, else the first
// bytes of the file.

const SVG_HEAD = /^\s*(?:<\?xml[^>]*>\s*)?(?:<!DOCTYPE[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:[\s>/]|$)/i;
const RASTER_TYPES = /^image\/(?:png|jpe?g|webp|gif|bmp|avif)/i;
const RASTER_EXTENSION = /\.(?:png|jpe?g|webp|gif|bmp|avif)(?:[?#]|$)/i;
const SVG_EXTENSION = /\.svgz?(?:[?#]|$)/i;

/**
 * @param {{ url?: string, contentType?: string, head?: string|Uint8Array }} output
 * @returns {'svg'|'raster'|'unknown'}
 */
export function classifyVectorOutput({ url = '', contentType = '', head = null } = {}) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('svg')) return 'svg';
  if (RASTER_TYPES.test(type)) return 'raster';
  const path = String(url || '');
  if (path.startsWith('data:image/svg')) return 'svg';
  if (/^data:image\//.test(path)) return 'raster';
  if (SVG_EXTENSION.test(path)) return 'svg';
  if (RASTER_EXTENSION.test(path)) return 'raster';
  if (head) {
    const text = typeof head === 'string' ? head : String.fromCharCode(...head.subarray(0, 64));
    if (SVG_HEAD.test(text)) return 'svg';
    if (text.charCodeAt(0) === 0x89 && text.slice(1, 4) === 'PNG') return 'raster';
    if (text.charCodeAt(0) === 0xff && text.charCodeAt(1) === 0xd8) return 'raster';
    if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') return 'raster';
  }
  return 'unknown';
}

/**
 * Pairs the runner's saved outputs with the provider's reported content
 * types (`raw.images[i].content_type`, or `raw.image` for Recraft
 * Vectorize), since the saved local URL carries only a guessed extension.
 * @param {{ media?: {url:string,type:string,remoteUrl?:string}[], outputs?: string[], raw?: object }} result
 * @returns {{ url: string, remoteUrl: string|null, contentType: string, kind: 'svg'|'raster'|'unknown' }[]}
 */
export function describeVectorOutputs(result) {
  const media = Array.isArray(result?.media) && result.media.length
    ? result.media
    : (result?.outputs || []).map((url) => ({ url, type: 'file' }));
  const reported = [];
  const raw = result?.raw;
  if (raw && typeof raw === 'object') {
    const list = Array.isArray(raw.images) ? raw.images : raw.image ? [raw.image] : [];
    for (const item of list) if (item && typeof item === 'object') reported.push(item);
  }
  return media.map((item, index) => {
    const remote = item.remoteUrl || (/^https?:/.test(item.url) ? item.url : null);
    const match = reported.find((entry) => entry.url && (entry.url === remote || entry.url === item.url)) || reported[index] || null;
    const contentType = match?.content_type || match?.mime_type || '';
    return { url: item.url, remoteUrl: remote, contentType, kind: classifyVectorOutput({ url: remote || item.url, contentType }) };
  });
}
