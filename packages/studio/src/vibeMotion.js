// Vibe Motion: a chat model writes one self-contained HTML document that
// draws a motion graphic on a <canvas>. The document only ever runs inside a
// sandboxed iframe (allow-scripts, no same-origin) with a CSP that blocks all
// network access; the harness below plays it and records it to video.
// Pure module (no React) so it can be unit tested.

export const VIBE_MOTION_FPS = 30;
export const MIN_DURATION = 3;
export const MAX_DURATION = 15;
export const DEFAULT_DURATION = 6;

export const ASPECT_RATIOS = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

export const STYLE_PRESETS = {
  minimal: 'Minimal: generous whitespace, one accent colour on a near-white or near-black background, thin geometric sans-serif type, restrained precise motion with smooth eases.',
  bold: 'Bold: heavy condensed uppercase type at large sizes, high-contrast saturated colour blocks, punchy snappy timing with overshoot (easeOutBack), hard cuts between beats.',
  neon: 'Neon: dark background, glowing neon strokes and text (cyan, magenta, electric purple), additive glow via a few blurred layers, subtle scanlines or grid, pulsing light.',
  corporate: 'Corporate: clean professional layout, navy/blue/teal palette with white, modern sans-serif, tidy grid alignment, calm confident slides and fades, clear hierarchy.',
  playful: 'Playful: bright candy colours, rounded shapes, bouncy springy motion, squash and stretch, wobbles and confetti-like accents, friendly rounded type.',
};

export const STYLE_IDS = Object.keys(STYLE_PRESETS);

export const CONTENT_SECURITY_POLICY =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'";

// Marks messages exchanged between the studio and the preview frame.
export const FRAME_MESSAGE_SOURCE = 'oga-vibe-motion';
export const HOST_MESSAGE_SOURCE = 'oga-vibe-motion-host';

export function clampDuration(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return DEFAULT_DURATION;
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, number));
}

export function frameSize(aspect) {
  return ASPECT_RATIOS[aspect] || ASPECT_RATIOS['16:9'];
}

function formatRules({ aspect, duration, style, image }) {
  const { width, height } = frameSize(aspect);
  const seconds = clampDuration(duration);
  const imageRule = image
    ? `The user attached an image (for example a logo or product shot). It is available as \`window.__assets.image\`, an HTMLImageElement of ${image.width}x${image.height} px that loads from an inline data URL. Draw it with ctx.drawImage only when \`img.complete && img.naturalWidth > 0\`, keep its aspect ratio, and never change its src or load any other image.`
    : 'No images are available: draw everything with canvas shapes, paths, gradients and text.';
  return `Technical rules (all mandatory):
1. Exactly one <canvas id="stage" width="${width}" height="${height}"> (${aspect}, ${width}x${height} px). Draw every visible thing into it with the 2D context. Do not animate DOM elements, CSS or SVG.
2. Define \`window.__render = function (t) { ... }\` that draws the complete frame for time t in seconds (0 <= t <= ${seconds}). It must be a pure function of t: clear and redraw the whole frame on every call, keep no state between calls, never call Math.random(), Date.now() or performance.now() while drawing. For randomness use a seeded PRNG (e.g. mulberry32 with a fixed seed) and pre-generate particles and layouts once at setup.
3. Do not start your own requestAnimationFrame, setInterval or setTimeout loop and do not call __render yourself. The host calls __render(t) every frame at ${VIBE_MOTION_FPS} fps; the preview loops and the export records t from 0 to ${seconds}.
4. The animation lasts exactly ${seconds} seconds. Plan a clear timeline (intro, main beats, ending) and end on a clean, held final frame during the last ~0.5 s, unless a seamless loop is requested.
5. Fully offline: no network access of any kind. No fetch, XMLHttpRequest, WebSocket, import(), <script src>, <link>, @import, @font-face, web fonts or external images. Use system font stacks only, e.g. "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", "Georgia, 'Times New Roman', serif" or "ui-monospace, Menlo, Consolas, monospace".
6. No localStorage, sessionStorage, cookies, alert/confirm/prompt, window.open, audio or user interaction.
7. Each frame must render in well under 16 ms: avoid shadowBlur on hundreds of shapes and per-pixel loops (getImageData/putImageData) every frame.
8. Use easing (easeOutCubic, easeInOutQuad, easeOutBack, springs) and staggered timing for polished motion. Keep text inside a safe margin of at least 6% of the frame, large and legible. Fill the whole frame every frame (no transparent background).
9. Keep the code under about 400 lines with short comments per section.
${imageRule}`;
}

const OUTPUT_RULES = `Output format: reply with the complete HTML document only, starting with <!DOCTYPE html> and ending with </html>. Put a short descriptive title (at most 6 words) in <title>. No explanations before or after the document.`;

export function buildSystemPrompt({ aspect, duration, style, image = null }) {
  const preset = STYLE_PRESETS[style] || STYLE_PRESETS.bold;
  return `You are a senior motion designer and creative coder. You write ONE self-contained HTML document that plays a polished, deterministic motion graphic drawn on an HTML canvas with JavaScript.

${formatRules({ aspect, duration, style, image })}

Visual style preset: ${preset}
Follow the user's request first; use the preset for anything they leave open (palette, type, motion feel).

${OUTPUT_RULES}`;
}

export function buildGenerateMessages({ prompt, aspect, duration, style, image = null }) {
  const { width, height } = frameSize(aspect);
  return [
    { role: 'system', content: buildSystemPrompt({ aspect, duration, style, image }) },
    {
      role: 'user',
      content: `Create this motion graphic: ${prompt.trim()}\n\nFormat: ${width}x${height} (${aspect}), ${clampDuration(duration)} seconds.`,
    },
  ];
}

export function buildEditMessages({ html, instruction, aspect, duration, style, image = null, formatChanged = false }) {
  const { width, height } = frameSize(aspect);
  const formatNote = formatChanged
    ? `\n\nThe target format changed: the canvas must now be ${width}x${height} (${aspect}) and the animation must last ${clampDuration(duration)} seconds. Re-layout and re-time everything to fit.`
    : '';
  return [
    {
      role: 'system',
      content: `${buildSystemPrompt({ aspect, duration, style, image })}

You are revising an existing animation. Apply the requested change precisely and keep everything else (content, layout, timing, palette) as it is unless the change requires otherwise. Return the complete updated document, never a diff.`,
    },
    {
      role: 'user',
      content: `Current document:\n\`\`\`html\n${html}\n\`\`\`\n\nRequested change: ${instruction.trim()}${formatNote}`,
    },
  ];
}

export class VibeMotionOutputError extends Error {
  constructor(message = 'The model did not return a usable animation. Try again or rephrase the prompt.') {
    super(message);
    this.name = 'VibeMotionOutputError';
  }
}

/** Pulls the HTML document out of a model reply (tolerates ``` fences and chatter). */
export function extractHtml(content) {
  let text = String(content || '').trim();
  const fenced = /```(?:html|HTML)?\s*([\s\S]*?)```/.exec(text);
  if (fenced && /<(?:!doctype|html|canvas|script)/i.test(fenced[1])) text = fenced[1].trim();
  const start = text.search(/<!doctype html|<html[\s>]/i);
  if (start > 0) text = text.slice(start);
  const end = text.toLowerCase().lastIndexOf('</html>');
  if (end >= 0) text = text.slice(0, end + '</html>'.length);
  if (!/<canvas[\s>]/i.test(text) && !/<svg[\s>]/i.test(text)) throw new VibeMotionOutputError();
  if (!/<script[\s>]/i.test(text)) throw new VibeMotionOutputError();
  return text;
}

export function extractTitle(html, fallback = '') {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ''));
  const title = match ? match[1].replace(/\s+/g, ' ').trim() : '';
  return (title || fallback).slice(0, 80);
}

// Safe inside an inline <script>: JSON with "<" escaped so "</script>" can't end it.
function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

// Runs inside the sandboxed frame. Plain ES5-ish string (no template syntax)
// so bundlers can't rewrite it. Talks to the studio only via postMessage.
const HARNESS = `(function () {
  var C = window.__VM || {};
  var SRC = '${FRAME_MESSAGE_SOURCE}';
  var HOST = '${HOST_MESSAGE_SOURCE}';
  var duration = C.duration || 6;
  var fps = C.fps || 30;
  var playing = true;
  var recording = false;
  var startAt = performance.now();
  var current = 0;
  var lastReport = 0;
  var failed = false;

  function send(message) {
    message.source = SRC;
    try { window.parent.postMessage(message, '*'); } catch (e) { /* parent gone */ }
  }
  function reportError(error) {
    var text = error && error.message ? error.message : String(error || 'Unknown error');
    send({ type: 'error', message: text.slice(0, 500) });
  }
  window.addEventListener('error', function (event) { reportError(event.error || event.message); });
  window.addEventListener('unhandledrejection', function (event) { reportError(event.reason); });

  function renderer() { return typeof window.__render === 'function' ? window.__render : null; }
  function stage() { return document.getElementById('stage') || document.querySelector('canvas'); }
  function draw(t) {
    var render = renderer();
    if (!render || failed) return;
    try { render(t); } catch (error) { failed = true; reportError(error); }
  }
  function elapsed() { return (performance.now() - startAt) / 1000; }

  function tick() {
    if (!recording && renderer()) {
      if (playing) {
        current = elapsed() % duration;
        draw(current);
      }
      var now = performance.now();
      if (now - lastReport > 120) { lastReport = now; send({ type: 'time', t: current, playing: playing }); }
    }
    requestAnimationFrame(tick);
  }

  function pickMimeType() {
    var types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    if (typeof MediaRecorder === 'undefined') return null;
    for (var i = 0; i < types.length; i++) {
      if (MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return '';
  }

  // SVG-only documents: rasterize the live <svg> onto a canvas each frame.
  function svgSource() {
    var svg = document.querySelector('svg');
    if (!svg) return null;
    var canvas = document.createElement('canvas');
    canvas.width = C.width; canvas.height = C.height;
    var ctx = canvas.getContext('2d');
    var busy = false;
    return {
      canvas: canvas,
      frame: function () {
        if (busy) return;
        busy = true;
        var clone = svg.cloneNode(true);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('width', C.width);
        clone.setAttribute('height', C.height);
        var url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
        var img = new Image();
        img.onload = function () { ctx.clearRect(0, 0, C.width, C.height); ctx.drawImage(img, 0, 0, C.width, C.height); URL.revokeObjectURL(url); busy = false; };
        img.onerror = function () { URL.revokeObjectURL(url); busy = false; };
        img.src = url;
      }
    };
  }

  function whenAssetsReady() {
    var waits = [];
    var image = window.__assets && window.__assets.image;
    if (image && image.decode) waits.push(image.decode().catch(function () {}));
    if (document.fonts && document.fonts.ready) waits.push(document.fonts.ready.catch(function () {}));
    return Promise.all(waits);
  }

  function startExport() {
    if (recording) return;
    var mimeType = pickMimeType();
    if (mimeType === null) { send({ type: 'export-error', message: 'This browser cannot record video (MediaRecorder is missing).' }); return; }
    var useRender = Boolean(renderer());
    var canvas = stage();
    var svg = !canvas ? svgSource() : null;
    var source = canvas || (svg && svg.canvas);
    if (!source || !source.captureStream) { send({ type: 'export-error', message: 'Nothing to record: the animation has no canvas.' }); return; }
    recording = true;
    whenAssetsReady().then(function () {
      var stream = source.captureStream(fps);
      var chunks = [];
      var recorder;
      try {
        recorder = new MediaRecorder(stream, mimeType ? { mimeType: mimeType, videoBitsPerSecond: 8000000 } : { videoBitsPerSecond: 8000000 });
      } catch (error) {
        recording = false;
        send({ type: 'export-error', message: 'Could not start the recorder: ' + (error && error.message) });
        return;
      }
      recorder.ondataavailable = function (event) { if (event.data && event.data.size) chunks.push(event.data); };
      recorder.onerror = function (event) { recording = false; send({ type: 'export-error', message: String((event.error && event.error.message) || 'Recording failed') }); };
      recorder.onstop = function () {
        recording = false;
        stream.getTracks().forEach(function (track) { track.stop(); });
        var type = (recorder.mimeType || mimeType || 'video/webm').split(';')[0];
        send({ type: 'exported', blob: new Blob(chunks, { type: type }), mimeType: type });
        startAt = performance.now();
      };
      if (useRender) draw(0);
      if (svg) svg.frame();
      recorder.start(250);
      var began = performance.now();
      var lastProgress = 0;
      function step() {
        var t = (performance.now() - began) / 1000;
        if (t >= duration) {
          if (useRender) draw(duration);
          if (svg) svg.frame();
          setTimeout(function () { if (recorder.state !== 'inactive') recorder.stop(); }, 120);
          send({ type: 'export-progress', progress: 1 });
          return;
        }
        if (useRender) draw(t);
        if (svg) svg.frame();
        if (t - lastProgress > 0.2) { lastProgress = t; send({ type: 'export-progress', progress: t / duration }); }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event.data || {};
    if (data.source !== HOST) return;
    if (data.type === 'play') { playing = true; startAt = performance.now() - current * 1000; }
    else if (data.type === 'pause') { playing = false; }
    else if (data.type === 'seek') {
      current = Math.max(0, Math.min(duration, Number(data.t) || 0));
      startAt = performance.now() - current * 1000;
      draw(current);
      send({ type: 'time', t: current, playing: playing });
    }
    else if (data.type === 'export') { startExport(); }
  });

  function ready() {
    send({ type: 'ready', hasRender: Boolean(renderer()), hasCanvas: Boolean(stage()), hasSvg: Boolean(document.querySelector('svg')) });
    if (C.autoExport) startExport();
    requestAnimationFrame(tick);
  }
  if (document.readyState === 'complete') ready(); else window.addEventListener('load', ready);
})();`;

const FRAME_STYLE = `html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000}
body{display:flex;align-items:center;justify-content:center}
#stage,body>canvas{display:block!important;width:auto!important;height:auto!important;max-width:100vw!important;max-height:100vh!important;margin:auto!important}`;

/**
 * Wraps model-written HTML for the preview frame: a CSP meta tag that blocks
 * all network access comes first, then a prelude with the frame config and
 * attached image, and the playback/export harness at the end.
 * @param {string} html
 * @param {{ aspect: string, duration: number, imageDataUrl?: string|null, autoExport?: boolean }} options
 */
export function prepareDocument(html, { aspect, duration, imageDataUrl = null, autoExport = false }) {
  const { width, height } = frameSize(aspect);
  const config = { width, height, duration: clampDuration(duration), fps: VIBE_MOTION_FPS, autoExport: Boolean(autoExport) };
  // Drop any CSP the model added (it can't loosen ours, but keep one source of truth)
  // and anything that would point the document elsewhere.
  const body = String(html || '')
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<meta[^>]+http-equiv\s*=\s*["']?(?:content-security-policy|refresh)["']?[^>]*>/gi, '')
    .replace(/<base\b[^>]*>/gi, '');
  const prelude = `window.__VM=${scriptJson(config)};window.__assets={image:null};`
    + (imageDataUrl ? `(function(){var i=new Image();i.src=${scriptJson(imageDataUrl)};window.__assets.image=i;})();` : '');
  // A <meta> right after the doctype opens <head> implicitly, so the policy
  // applies before any of the model's markup is parsed.
  const head = `<!DOCTYPE html>\n<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">\n<style>${FRAME_STYLE}</style>\n<script>${prelude}</script>\n`;
  const harness = `\n<script>${HARNESS}</script>\n`;
  const closing = body.toLowerCase().lastIndexOf('</body>');
  return closing >= 0
    ? head + body.slice(0, closing) + harness + body.slice(closing)
    : head + body + harness;
}
