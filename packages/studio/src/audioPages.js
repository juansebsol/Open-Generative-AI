// The Audio pages, the pure part. Four tabs share components/AudioStudio.jsx
// the way the Vector pages share VectorStudio: Text to Speech (one voice
// reads a text), Dialogue (several speakers read a script), Music (songs,
// instrumentals and sound effects from a prompt) and Remix (a track in, a
// track out). This module decides which page a catalog model belongs to,
// how its inputs are laid out in the composer, and what the request looks
// like, so all of it is unit-tested without a browser.

export const AUDIO_PAGES = ['speech', 'dialogue', 'music', 'remix'];

export const audioTabId = (page) => `audio-${page}`;

/** The page a catalog model lives on, or null when no page shows it. */
export function audioPageOf(model) {
  if (!model?.id) return null;
  const inputs = model.inputs || {};
  if (inputs.dialogue || inputs.dialogue_turns) return 'dialogue';
  if (inputs.audio_url && (model.family === 'stable-audio' || model.family === 'mureka')) return 'remix';
  if (['minimax-music', 'lyria', 'mureka', 'elevenlabs-music', 'stable-audio', 'mmaudio'].includes(model.family)) return 'music';
  if (['minimax-2.3', 'minimax-2.6', 'audio-generation', 'gemini-tts'].includes(model.family)) return 'speech';
  return null;
}

/** True for the voice-cloning tool, which the Speech page offers from its voice picker, not its model list. */
export const isVoiceClone = (model) => Boolean(model?.inputs?.custom_voice_id && model?.inputs?.audio_url);

/** True for a Music-page model that makes sound effects rather than music. */
export const isSoundEffect = (model) => model?.family === 'mmaudio';

/** The models a page lists in its picker, in catalog order. */
export function audioModelsFor(page, models) {
  return (models || []).filter((model) => audioPageOf(model) === page && !isVoiceClone(model));
}

/** The voice-cloning tool, when the catalog has one. */
export const voiceCloneModel = (models) => (models || []).find(isVoiceClone) || null;

// Inputs the page itself owns: they are drawn as the composer's body (the
// text, the lyrics, the script, the source track), never as a control.
const BODY_KEYS = new Set(['prompt', 'text', 'lyrics', 'dialogue', 'dialogue_turns', 'speakers', 'audio_url', 'scene', 'sample_context', 'negative_prompt', 'custom_voice_id', 'extend_at']);

// Inputs that show as a control in the footer; everything else waits
// behind "More".
const PRIMARY_KEYS = new Set(['voice_id', 'voice', 'emotion', 'language_boost', 'language_code', 'speed', 'gender', 'is_instrumental', 'force_instrumental', 'music_length_ms', 'duration', 'extend_type', 'init_noise_level', 'temperature']);

/** The numeric range of an input, from either schema spelling the catalog uses. */
export function numericRange(input) {
  const min = input?.minimum ?? input?.minValue;
  const max = input?.maximum ?? input?.maxValue;
  const step = input?.step ?? (input?.type === 'integer' || (input?.type === 'int' && Number.isInteger(min) && Number.isInteger(max) && Number.isInteger(input?.default)) ? 1 : 0.1);
  return { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 100, step };
}

const isEnum = (input) => Array.isArray(input?.enum) && input.enum.length > 0;
const isBoolean = (input) => input?.type === 'boolean';
const isNumber = (input) => ['integer', 'number', 'int', 'float'].includes(input?.type) && !isEnum(input);

/**
 * Splits a model's inputs into what the footer shows (`primary`) and what
 * "More" reveals (`advanced`); body inputs are left out of both. Each item
 * is { key, input, kind: 'enum'|'number'|'boolean'|'text' }.
 */
export function layoutInputs(model) {
  const primary = [];
  const advanced = [];
  for (const [key, input] of Object.entries(model?.inputs || {})) {
    if (BODY_KEYS.has(key) || key === 'model') continue;
    const kind = isEnum(input) ? 'enum' : isBoolean(input) ? 'boolean' : isNumber(input) ? 'number' : 'text';
    (PRIMARY_KEYS.has(key) ? primary : advanced).push({ key, input, kind });
  }
  return { primary, advanced };
}

/** The default value of every input that has one. */
export function defaultOptions(model) {
  const options = {};
  for (const [key, input] of Object.entries(model?.inputs || {})) {
    if (BODY_KEYS.has(key) || key === 'model') continue;
    if (input?.default !== undefined) options[key] = input.default;
  }
  return options;
}

/**
 * Keeps the options that still apply when the model changes (an enum value
 * the new model offers, a number or boolean of the same type) over the new
 * model's defaults.
 */
export function carryOptions(previous, model) {
  const next = defaultOptions(model);
  for (const [key, value] of Object.entries(previous || {})) {
    const input = model?.inputs?.[key];
    if (!input || BODY_KEYS.has(key)) continue;
    if (isEnum(input)) {
      if (enumOptions(input).some((option) => option.value === value)) next[key] = value;
    } else if (isBoolean(input)) {
      if (typeof value === 'boolean') next[key] = value;
    } else if (isNumber(input)) {
      if (typeof value === 'number') next[key] = value;
    } else if (typeof value === 'string') {
      next[key] = value;
    }
  }
  return next;
}

/** An enum's choices as { value, label }, whether the catalog lists strings or objects. */
export function enumOptions(input) {
  if (!isEnum(input)) return [];
  return input.enum.map((option) => (option && typeof option === 'object'
    ? { value: option.value, label: String(option.label ?? option.value) }
    : { value: option, label: input.optionLabels?.[option] ?? String(option).replace(/_/g, ' ') }));
}

/** The label of an enum value, or the value itself when it is not listed (a cloned voice id). */
export function optionLabel(input, value) {
  const found = enumOptions(input).find((option) => option.value === value);
  if (found) return found.label;
  return value === undefined || value === null ? '' : String(value);
}

/** A voice input's key on a speech model: `voice_id` or `voice`. */
export const voiceKey = (model) => (model?.inputs?.voice_id ? 'voice_id' : model?.inputs?.voice ? 'voice' : null);

/** Cloned voices are usable by the models of the same vendor family. */
export const acceptsClonedVoices = (model) => /^minimax/.test(model?.family || '') && Boolean(model?.inputs?.voice_id?.typing);

// ── Dialogue ────────────────────────────────────────────────────────────

/** How a dialogue model takes its script: ElevenLabs lines carry a voice each; Gemini names a cast first. */
export function dialogueShape(model) {
  if (model?.inputs?.dialogue_turns) return 'cast';
  if (model?.inputs?.dialogue) return 'lines';
  return null;
}

/** The voice choices for a dialogue model's speakers, as { value, label }. */
export function dialogueVoices(model) {
  const shape = dialogueShape(model);
  if (shape === 'cast') return enumOptions(model.inputs.speakers?.items?.properties?.voice_name || {});
  if (shape === 'lines') return enumOptions(model.inputs.dialogue?.items?.properties?.voice_id || {});
  return [];
}

const SPEAKER_ID = (index) => `Speaker ${index + 1}`;

/** A starting script: two speakers with the model's first voices and the example lines when it has them. */
export function defaultScript(model) {
  const voices = dialogueVoices(model);
  const voiceAt = (index) => voices[index % Math.max(1, voices.length)]?.value ?? '';
  const example = (model?.inputs?.dialogue_turns || model?.inputs?.dialogue)?.examples?.[0];
  const exampleSpeakers = model?.inputs?.speakers?.examples?.[0];
  if (Array.isArray(example) && example.length > 0) {
    if (dialogueShape(model) === 'cast' && Array.isArray(exampleSpeakers)) {
      const cast = exampleSpeakers.map((speaker, index) => ({ id: speaker.speaker_id || SPEAKER_ID(index), name: speaker.speaker_id || SPEAKER_ID(index), voice: speaker.voice_name || voiceAt(index), profile: speaker.audio_profile || '' }));
      const lines = example.map((turn) => ({ speaker: turn.speaker_id || cast[0]?.id, text: turn.text || '' }));
      return { cast, lines };
    }
    if (dialogueShape(model) === 'lines') {
      const byVoice = new Map();
      const lines = example.map((turn) => {
        if (!byVoice.has(turn.voice_id)) byVoice.set(turn.voice_id, { id: SPEAKER_ID(byVoice.size), name: SPEAKER_ID(byVoice.size), voice: turn.voice_id, profile: '' });
        return { speaker: byVoice.get(turn.voice_id).id, text: turn.text || '' };
      });
      return { cast: [...byVoice.values()], lines };
    }
  }
  const cast = [0, 1].map((index) => ({ id: SPEAKER_ID(index), name: SPEAKER_ID(index), voice: voiceAt(index), profile: '' }));
  return { cast, lines: [{ speaker: cast[0].id, text: '' }, { speaker: cast[1].id, text: '' }] };
}

/** A script carried to another model: speakers keep their place, voices the new model lacks fall back to its first. */
export function carryScript(script, model) {
  const voices = dialogueVoices(model);
  const valid = new Set(voices.map((voice) => voice.value));
  const cast = (script?.cast || []).map((speaker, index) => ({ ...speaker, voice: valid.has(speaker.voice) ? speaker.voice : voices[index % Math.max(1, voices.length)]?.value ?? '' }));
  if (cast.length === 0) return defaultScript(model);
  const ids = new Set(cast.map((speaker) => speaker.id));
  const lines = (script?.lines || []).map((line) => ({ speaker: ids.has(line.speaker) ? line.speaker : cast[0].id, text: line.text || '' }));
  return { cast, lines: lines.length ? lines : [{ speaker: cast[0].id, text: '' }] };
}

/** The script's spoken lines, in order, with their speaker's name: what the library shows. */
export const scriptText = (script) => (script?.lines || []).filter((line) => line.text.trim()).map((line) => {
  const speaker = (script.cast || []).find((member) => member.id === line.speaker);
  return `${speaker?.name || line.speaker}: ${line.text.trim()}`;
}).join('\n');

/** Characters a dialogue is priced and limited on. */
export const scriptCharacters = (script) => (script?.lines || []).reduce((sum, line) => sum + (line.text || '').trim().length, 0);

/**
 * The request for a dialogue model from the cast and lines. Lines without
 * text are dropped; a cast member no line uses is left out of a Gemini
 * request, which rejects unused speakers.
 */
export function dialoguePayload(model, script, options = {}) {
  const shape = dialogueShape(model);
  const lines = (script?.lines || []).filter((line) => line.text.trim());
  const cast = script?.cast || [];
  const speaker = (id) => cast.find((member) => member.id === id) || cast[0];
  if (shape === 'lines') {
    return { ...options, dialogue: lines.map((line) => ({ text: line.text.trim(), voice_id: speaker(line.speaker)?.voice })) };
  }
  if (shape === 'cast') {
    const used = new Set(lines.map((line) => speaker(line.speaker)?.id));
    const speakers = cast.filter((member) => used.has(member.id)).map((member) => {
      const entry = { speaker_id: member.id, voice_name: member.voice };
      if (member.profile?.trim()) entry.audio_profile = member.profile.trim();
      return entry;
    });
    return { ...options, speakers, dialogue_turns: lines.map((line) => ({ speaker_id: speaker(line.speaker)?.id, text: line.text.trim() })) };
  }
  return { ...options };
}

// ── Requests ────────────────────────────────────────────────────────────

/** The request for a speech model: the text under the key the model reads it from, plus the options. */
export function speechPayload(model, text, options = {}) {
  const key = model?.inputs?.text ? 'text' : 'prompt';
  return { ...options, [key]: text };
}

/**
 * The request for a music model. Lyrics go only to models that take them,
 * and not when the track is instrumental; an instrumental toggle the model
 * lacks is dropped.
 */
export function musicPayload(model, { prompt = '', lyrics = '' } = {}, options = {}) {
  const inputs = model?.inputs || {};
  const payload = {};
  for (const [key, value] of Object.entries(options)) if (inputs[key]) payload[key] = value;
  const instrumental = Boolean(payload.is_instrumental || payload.force_instrumental);
  if (inputs.prompt) payload.prompt = prompt.trim();
  if (inputs.lyrics && !instrumental) payload.lyrics = lyrics.trim();
  return payload;
}

/** The request for a remix model: the source track plus whatever else it reads. */
export function remixPayload(model, { sourceUrl, prompt = '', lyrics = '', extendAtSeconds = 0 } = {}, options = {}) {
  const inputs = model?.inputs || {};
  const payload = { audio_url: sourceUrl };
  for (const [key, value] of Object.entries(options)) if (inputs[key]) payload[key] = value;
  if (inputs.prompt) payload.prompt = prompt.trim();
  if (inputs.lyrics) payload.lyrics = lyrics.trim();
  if (inputs.extend_at) payload.extend_at = Math.max(0, Math.round(Number(extendAtSeconds) * 1000));
  return payload;
}

/** What a page needs before it can run, as an error code or null. */
export function missingInput(page, { model, text = '', script = null, prompt = '', lyrics = '', sourceUrl = null, options = {} } = {}) {
  if (!model) return 'model';
  const inputs = model.inputs || {};
  if (page === 'speech') return text.trim() ? null : 'text';
  if (page === 'dialogue') return scriptCharacters(script) > 0 ? null : 'script';
  if (page === 'music') {
    if (inputs.prompt && !prompt.trim() && (model.required || []).includes('prompt')) return 'prompt';
    const instrumental = Boolean(options.is_instrumental || options.force_instrumental);
    if (inputs.lyrics && (model.required || []).includes('lyrics') && !instrumental && !lyrics.trim()) return 'lyrics';
    if (!inputs.prompt && !inputs.lyrics) return null;
    if (!prompt.trim() && !(inputs.lyrics && lyrics.trim())) return 'prompt';
    return null;
  }
  if (page === 'remix') {
    if (!sourceUrl) return 'source';
    if (inputs.prompt && (model.required || []).includes('prompt') && !prompt.trim()) return 'prompt';
    if (inputs.lyrics && (model.required || []).includes('lyrics') && !lyrics.trim()) return 'lyrics';
    return null;
  }
  return null;
}

/** "1:23" for a length in seconds. */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** A library entry's title: the text, the lyrics or the prompt, cut to one line. */
export function entryTitle(entry, fallback = '') {
  const source = entry?.title || entry?.prompt || entry?.text || fallback;
  const line = (String(source || '').split('\n').find((part) => part.trim()) || '').trim();
  return line.length > 90 ? `${line.slice(0, 89).trimEnd()}…` : line;
}
