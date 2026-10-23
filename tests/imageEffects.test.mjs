import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_EFFECTS, applyPromptPresets } from '../packages/studio/src/imageEffects.js';

test('image effect presets expand into the edit prompt', () => {
  const out = applyPromptPresets('image-effects', { effect: '1980s', prompt: '', images_list: ['https://x/a.png'] });
  assert.equal(out.prompt, IMAGE_EFFECTS.find((effect) => effect.id === '1980s').prompt);
  assert.equal(out.effect, undefined);
  assert.deepEqual(out.images_list, ['https://x/a.png']);
  assert.match(applyPromptPresets('image-effects', { effect: 'snow', prompt: 'keep the car red' }).prompt, /Additional direction: keep the car red$/);
});

test('other endpoints are left untouched', () => {
  const payload = { effect: 'x', prompt: 'p' };
  assert.equal(applyPromptPresets('nano-banana-2-edit', payload), payload);
});

test('preset ids are unique', () => {
  assert.equal(new Set(IMAGE_EFFECTS.map((effect) => effect.id)).size, IMAGE_EFFECTS.length);
});
