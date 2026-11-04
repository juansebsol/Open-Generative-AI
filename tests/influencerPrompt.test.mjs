import test from 'node:test';
import assert from 'node:assert/strict';

const { influencerPrompt } = await import('../packages/studio/src/influencerPrompt.js');

const trait = (sub, opt, value) => ({ sub, opt, value });

test('with no rendering style it is a candid creator photo, not a studio portrait', () => {
  const prompt = influencerPrompt({ traits: [trait('character_type', 'human', 'human features'), trait('gender', 'female', 'female'), trait('hair', 'hair_long', 'long flowing hair')] });
  assert.match(prompt, /^A photo of an AI influencer/);
  assert.match(prompt, /Their look: human features, female, long flowing hair\./);
  assert.match(prompt, /flattering natural light/);
  assert.match(prompt, /not a studio headshot/);
  assert.doesNotMatch(prompt, /8k|cinematic|Ultra-realistic/i);
});

test('the rendering style picks the look and is not repeated as a trait', () => {
  const anime = influencerPrompt({ traits: [trait('character_type', 'elf', 'elf with pointed ears'), trait('rendering_style', 'style_anime', 'anime art style')] });
  assert.match(anime, /^An anime-style portrait/);
  assert.doesNotMatch(anime, /anime art style/);
  assert.doesNotMatch(anime, /Real texture|social photo/);
  assert.match(influencerPrompt({ traits: [trait('rendering_style', 'style_hyper_realistic', 'realistic photo')] }), /^A photo of an AI influencer/);
  assert.match(influencerPrompt({ traits: [trait('rendering_style', 'style_2d', 'flat')] }), /^A flat 2D illustration/);
});

test('the visitor’s own words come after the traits, and wide frames leave room', () => {
  const prompt = influencerPrompt({ traits: [trait('gender', 'male', 'male')], custom: '  wearing a denim jacket ', aspect: '16:9' });
  assert.match(prompt, /Their look: male\. wearing a denim jacket\. Framed from the chest up, a little off-centre/);
  assert.doesNotMatch(influencerPrompt({ custom: 'Smiling!' }), /Smiling!\./);
});
