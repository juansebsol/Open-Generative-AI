import test from 'node:test';
import assert from 'node:assert/strict';
import { audioModels } from '../packages/studio/src/models.js';
import {
  AUDIO_PAGES, acceptsClonedVoices, audioModelsFor, audioPageOf, carryOptions, carryScript, defaultOptions, defaultScript,
  dialoguePayload, dialogueShape, dialogueVoices, entryTitle, enumOptions, formatDuration, isSoundEffect, isVoiceClone,
  layoutInputs, missingInput, musicPayload, numericRange, optionLabel, remixPayload, scriptCharacters, scriptText, speechPayload,
  voiceCloneModel, voiceKey,
} from '../packages/studio/src/audioPages.js';

const byId = (id) => audioModels.find((model) => model.id === id);

test('every audio model lands on exactly one page, and the clone tool on none of the lists', () => {
  const pages = new Map(AUDIO_PAGES.map((page) => [page, audioModelsFor(page, audioModels).map((model) => model.id)]));
  const listed = [...pages.values()].flat();
  assert.equal(new Set(listed).size, listed.length, 'no model is listed twice');
  for (const model of audioModels) {
    if (isVoiceClone(model)) assert.ok(!listed.includes(model.id), `${model.id} is offered from the voice picker, not a page`);
    else assert.ok(listed.includes(model.id), `${model.id} has a page`);
  }
  assert.deepEqual(pages.get('dialogue'), ['elevenlabs-text-to-dialogue-v3', 'gemini-3-1-flash-tts', 'gemini-2-5-pro-tts']);
  assert.deepEqual(pages.get('remix'), ['mureka-extend-song', 'stable-audio-3-music-remix']);
  assert.ok(pages.get('music').includes('mmaudio-v2-text-to-audio'), 'sound effects sit on the Music page');
  assert.ok(pages.get('speech').includes('minimax-speech-2.6-hd'));
  assert.equal(audioPageOf(byId('minimax-voice-clone')), 'speech');
  assert.equal(voiceCloneModel(audioModels)?.id, 'minimax-voice-clone');
  assert.equal(audioPageOf({ id: 'x', family: 'unknown' }), null);
  assert.ok(isSoundEffect(byId('mmaudio-v2-text-to-audio')));
});

test('inputs the page draws itself stay out of the controls; the common knobs are primary', () => {
  const speech = layoutInputs(byId('minimax-speech-2.6-hd'));
  assert.deepEqual(speech.primary.map((item) => item.key), ['voice_id', 'speed', 'emotion', 'language_boost']);
  assert.ok(speech.advanced.map((item) => item.key).includes('pitch'));
  assert.ok(!speech.primary.concat(speech.advanced).some((item) => item.key === 'prompt'));
  const remix = layoutInputs(byId('stable-audio-3-music-remix'));
  assert.ok(!remix.primary.concat(remix.advanced).some((item) => ['audio_url', 'negative_prompt'].includes(item.key)));
  assert.equal(speech.primary.find((item) => item.key === 'speed').kind, 'number');
  assert.equal(speech.primary.find((item) => item.key === 'voice_id').kind, 'enum');
  assert.deepEqual(numericRange(byId('minimax-speech-2.6-hd').inputs.speed), { min: 0.5, max: 2, step: 0.01 });
});

test('options carry over between models only where they still fit', () => {
  const hd = byId('minimax-speech-2.6-hd');
  const defaults = defaultOptions(hd);
  assert.equal(defaults.voice_id, 'Friendly_Person');
  assert.equal(defaults.speed, 1);
  assert.equal(defaults.prompt, undefined);
  const carried = carryOptions({ voice_id: 'Wise_Woman', speed: 1.4, pitch: 3, nonsense: 'x', emotion: 'not-a-feeling' }, byId('minimax-speech-2.6-turbo'));
  assert.equal(carried.voice_id, 'Wise_Woman');
  assert.equal(carried.speed, 1.4);
  assert.equal(carried.pitch, 3);
  assert.equal(carried.emotion, byId('minimax-speech-2.6-turbo').inputs.emotion.default, 'an unknown enum value falls back to the default');
  assert.equal(carried.nonsense, undefined);
  const eleven = carryOptions({ voice_id: 'Wise_Woman' }, byId('elevenlabs-tts-turbo-2-5'));
  assert.equal(eleven.voice_id, byId('elevenlabs-tts-turbo-2-5').inputs.voice_id.default, 'a MiniMax voice is not an ElevenLabs voice');
});

test('enum choices read the same whether the catalog lists strings or label/value pairs', () => {
  const minimax = enumOptions(byId('minimax-speech-2.6-hd').inputs.voice_id);
  assert.deepEqual(minimax[0], { value: 'Wise_Woman', label: 'Wise Woman' });
  const eleven = enumOptions(byId('elevenlabs-tts-turbo-2-5').inputs.voice_id);
  assert.equal(eleven[0].value, 'ZQe5CZNOzWyzPSCn5a3c');
  assert.match(eleven[0].label, /^James/);
  assert.equal(optionLabel(byId('minimax-speech-2.6-hd').inputs.voice_id, 'my-cloned-voice'), 'my-cloned-voice');
  assert.equal(voiceKey(byId('elevenlabs-v4')), 'voice_id');
  assert.equal(voiceKey(byId('lyria-3')), null);
  assert.ok(acceptsClonedVoices(byId('minimax-speech-2.6-hd')));
  assert.ok(!acceptsClonedVoices(byId('elevenlabs-tts-turbo-2-5')));
});

test('speech requests put the text under the key the model reads', () => {
  assert.deepEqual(speechPayload(byId('minimax-speech-2.6-hd'), 'Hello', { voice_id: 'Wise_Woman' }), { voice_id: 'Wise_Woman', prompt: 'Hello' });
});

test('dialogue scripts start from the catalog examples and turn into each model\'s request shape', () => {
  const gemini = byId('gemini-3-1-flash-tts');
  const eleven = byId('elevenlabs-text-to-dialogue-v3');
  assert.equal(dialogueShape(gemini), 'cast');
  assert.equal(dialogueShape(eleven), 'lines');
  assert.ok(dialogueVoices(gemini).some((voice) => voice.value === 'Puck'));
  assert.ok(dialogueVoices(eleven).length > 5);

  const script = defaultScript(gemini);
  assert.equal(script.cast.length, 2);
  assert.equal(script.cast[0].id, 'Speaker 1');
  assert.ok(script.lines.length >= 2);
  assert.ok(scriptCharacters(script) > 0);
  assert.match(scriptText(script), /^Speaker 1: /);

  const payload = dialoguePayload(gemini, { cast: [...script.cast, { id: 'Speaker 3', name: 'Narrator', voice: 'Kore', profile: '' }], lines: [{ speaker: 'Speaker 1', text: ' Hi ' }, { speaker: 'Speaker 2', text: '' }] }, { temperature: 1 });
  assert.deepEqual(payload.dialogue_turns, [{ speaker_id: 'Speaker 1', text: 'Hi' }]);
  assert.deepEqual(payload.speakers.map((speaker) => speaker.speaker_id), ['Speaker 1'], 'speakers with no line are left out');
  assert.equal(payload.speakers[0].audio_profile, script.cast[0].profile, 'the example profile is kept');
  assert.equal(payload.temperature, 1);

  const carried = carryScript(script, eleven);
  assert.equal(carried.cast.length, 2);
  assert.ok(dialogueVoices(eleven).some((voice) => voice.value === carried.cast[0].voice), 'a Gemini voice becomes an ElevenLabs one');
  const lines = dialoguePayload(eleven, carried);
  assert.equal(lines.dialogue.length, carried.lines.filter((line) => line.text.trim()).length);
  assert.equal(lines.dialogue[0].voice_id, carried.cast.find((member) => member.id === carried.lines[0].speaker).voice);
});

test('music requests send lyrics only to models that sing them', () => {
  const minimax = byId('minimax-music-3.0');
  assert.deepEqual(musicPayload(minimax, { prompt: ' pop ', lyrics: 'la la' }, { is_instrumental: false, bitrate: 256000 }), { is_instrumental: false, bitrate: 256000, prompt: 'pop', lyrics: 'la la' });
  assert.equal(musicPayload(minimax, { prompt: 'pop', lyrics: 'la la' }, { is_instrumental: true }).lyrics, undefined);
  assert.deepEqual(musicPayload(byId('lyria-3'), { prompt: 'jazz', lyrics: 'ignored' }, { is_instrumental: true }), { prompt: 'jazz' });
  assert.deepEqual(musicPayload(byId('mmaudio-v2-text-to-audio'), { prompt: 'rain' }, { duration: 8 }), { duration: 8, prompt: 'rain' });
});

test('remix requests carry the source and convert the extend position to milliseconds', () => {
  const extend = remixPayload(byId('mureka-extend-song'), { sourceUrl: '/oga-media/a.mp3', lyrics: 'more', extendAtSeconds: 42.5 }, { extend_type: 'tail', prompt: 'dropped' });
  assert.deepEqual(extend, { audio_url: '/oga-media/a.mp3', extend_type: 'tail', lyrics: 'more', extend_at: 42500 });
  const remix = remixPayload(byId('stable-audio-3-music-remix'), { sourceUrl: '/oga-media/a.mp3', prompt: 'lo-fi' }, { init_noise_level: 0.5, duration: 30 });
  assert.deepEqual(remix, { audio_url: '/oga-media/a.mp3', init_noise_level: 0.5, duration: 30, prompt: 'lo-fi' });
});

test('each page knows what is missing before a run', () => {
  assert.equal(missingInput('speech', { model: byId('elevenlabs-v4'), text: '  ' }), 'text');
  assert.equal(missingInput('speech', { model: byId('elevenlabs-v4'), text: 'hi' }), null);
  assert.equal(missingInput('dialogue', { model: byId('gemini-3-1-flash-tts'), script: { cast: [], lines: [] } }), 'script');
  assert.equal(missingInput('music', { model: byId('mureka-song'), prompt: 'pop', lyrics: '' }), 'lyrics');
  assert.equal(missingInput('music', { model: byId('minimax-music-3.0'), prompt: 'pop', lyrics: '', options: { is_instrumental: true } }), null);
  assert.equal(missingInput('music', { model: byId('lyria-3'), prompt: '' }), 'prompt');
  assert.equal(missingInput('remix', { model: byId('stable-audio-3-music-remix'), prompt: 'x', sourceUrl: null }), 'source');
  assert.equal(missingInput('remix', { model: byId('mureka-extend-song'), sourceUrl: '/a', lyrics: '' }), 'lyrics');
  assert.equal(missingInput('speech', {}), 'model');
});

test('durations and titles read like a player', () => {
  assert.equal(formatDuration(83.4), '1:23');
  assert.equal(formatDuration(5), '0:05');
  assert.equal(formatDuration(NaN), null);
  assert.equal(entryTitle({ prompt: '\n  first line\nsecond' }), 'first line');
  assert.equal(entryTitle({ text: 'x'.repeat(120) }).length, 90);
  assert.equal(entryTitle({}, 'Fallback'), 'Fallback');
});
