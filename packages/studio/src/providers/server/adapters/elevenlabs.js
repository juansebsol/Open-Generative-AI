// ElevenLabs direct: https://elevenlabs.io/docs/api-reference
// Text to speech and text to dialogue with the visitor's own key, so their
// account voices (cloned, library) work and their plan's characters are used.
// Audio comes back as bytes and is returned to the browser as a data URL.

import { ProviderError, toDataUrl } from '../http.js';

const API_HOST = 'https://api.elevenlabs.io';
const OUTPUT_FORMAT = 'mp3_44100_128';
const TIMEOUT_MS = 180_000;
const DIALOGUE_CHAR_LIMIT = 2000;
const VOICE_ID = /^[A-Za-z0-9]{20,}$/;

const headers = (key, json = true) => ({ 'xi-api-key': key, ...(json ? { 'Content-Type': 'application/json' } : {}) });

async function readError(response) {
  const text = await response.text();
  try {
    const body = JSON.parse(text);
    const detail = body?.detail;
    return (typeof detail === 'string' ? detail : detail?.message) || body?.message || text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

async function requestAudio(url, { key, body }) {
  let response;
  try {
    response = await fetch(url, { method: 'POST', headers: headers(key), body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new ProviderError(`ElevenLabs request failed: ${error.message}`, { provider: 'elevenlabs', status: 504 });
  }
  if (!response.ok) {
    throw new ProviderError(`ElevenLabs ${response.status}: ${await readError(response)}`, { provider: 'elevenlabs', status: response.status });
  }
  const mimeType = (response.headers.get('content-type') || 'audio/mpeg').split(';')[0];
  const base64 = Buffer.from(await response.arrayBuffer()).toString('base64');
  return toDataUrl(mimeType, base64);
}

// Catalog voice values are either real ids or names ("voice_daniel", "Rachel");
// names are looked up in the visitor's account.
async function resolveVoice(value, key) {
  const raw = String(value || '').trim();
  if (!raw) throw new ProviderError('Pick a voice.', { provider: 'elevenlabs', status: 400 });
  if (VOICE_ID.test(raw)) return raw;
  const name = raw.replace(/^voice[_-]/i, '').replace(/[_-]+/g, ' ').trim();
  const url = `${API_HOST}/v2/voices?search=${encodeURIComponent(name)}&page_size=25`;
  const response = await fetch(url, { headers: headers(key, false), redirect: 'error', signal: AbortSignal.timeout(30_000) }).catch((error) => {
    throw new ProviderError(`ElevenLabs request failed: ${error.message}`, { provider: 'elevenlabs', status: 504 });
  });
  if (!response.ok) throw new ProviderError(`ElevenLabs ${response.status}: ${await readError(response)}`, { provider: 'elevenlabs', status: response.status });
  const voices = (await response.json())?.voices || [];
  const exact = voices.find((voice) => String(voice.name || '').toLowerCase() === name.toLowerCase());
  const match = exact || voices[0];
  if (!match?.voice_id) {
    throw new ProviderError(`No voice named "${name}" in your ElevenLabs account. Pick a voice by its id or add it to your library.`, { provider: 'elevenlabs', status: 404 });
  }
  return match.voice_id;
}

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

function voiceSettings(payload) {
  return {
    stability: clamp(payload.stability, 0, 1, 0.5),
    similarity_boost: clamp(payload.similarity_boost ?? payload.similarity, 0, 1, 0.75),
    style: clamp(payload.style, 0, 1, 0),
    speed: clamp(payload.speed, 0.7, 1.2, 1),
    use_speaker_boost: payload.use_speaker_boost !== false,
  };
}

async function textToSpeech({ model, payload, key }) {
  const text = String(payload.prompt || payload.text || '').trim();
  if (!text) throw new ProviderError('ElevenLabs needs text to speak.', { provider: 'elevenlabs', status: 400 });
  const voiceId = await resolveVoice(payload.voice_id || payload.voice, key);
  const body = {
    text,
    model_id: model,
    voice_settings: voiceSettings(payload),
    ...(payload.language_code && !/multilingual_v2/.test(model) ? { language_code: payload.language_code } : {}),
  };
  return requestAudio(`${API_HOST}/v1/text-to-speech/${voiceId}?output_format=${OUTPUT_FORMAT}`, { key, body });
}

async function textToDialogue({ model, payload, key }) {
  const turns = (Array.isArray(payload.dialogue) ? payload.dialogue : []).filter((turn) => String(turn?.text || '').trim());
  if (turns.length === 0) throw new ProviderError('Add at least one dialogue line.', { provider: 'elevenlabs', status: 400 });
  const total = turns.reduce((sum, turn) => sum + String(turn.text).length, 0);
  if (total > DIALOGUE_CHAR_LIMIT) {
    throw new ProviderError(`ElevenLabs dialogue takes up to ${DIALOGUE_CHAR_LIMIT} characters per request (this one has ${total}).`, { provider: 'elevenlabs', status: 400 });
  }
  const voiceIds = new Map();
  for (const turn of turns) {
    const key_ = turn.voice_id || turn.voice;
    if (!voiceIds.has(key_)) voiceIds.set(key_, await resolveVoice(key_, key));
  }
  const body = {
    model_id: model,
    inputs: turns.map((turn) => ({ text: String(turn.text).trim(), voice_id: voiceIds.get(turn.voice_id || turn.voice) })),
    settings: { stability: clamp(payload.stability, 0, 1, 0.5), similarity: clamp(payload.similarity_boost ?? payload.similarity, 0, 1, 0.75) },
    ...(payload.language_code ? { language_code: payload.language_code } : {}),
  };
  return requestAudio(`${API_HOST}/v1/text-to-dialogue?output_format=${OUTPUT_FORMAT}`, { key, body });
}

/** @param {{ endpoint: string, input: object, key: string }} job endpoint is the ElevenLabs model id */
export async function submit({ endpoint, input: payload, key }) {
  const isDialogue = Array.isArray(payload?.dialogue);
  const url = isDialogue
    ? await textToDialogue({ model: endpoint, payload, key })
    : await textToSpeech({ model: endpoint, payload, key });
  return { handle: { provider: 'elevenlabs', id: `elevenlabs-${Date.now()}` }, state: 'succeeded', outputs: [{ url, type: 'audio' }] };
}
