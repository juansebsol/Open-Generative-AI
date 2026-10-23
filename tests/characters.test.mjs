import test from 'node:test';
import assert from 'node:assert/strict';
import { characterHandle, expandCharacterMentions } from '../packages/studio/src/characters.js';

const characters = [
  { id: '1', name: 'Maya Lee', description: 'short red hair', images: ['a', 'b'], kind: 'character' },
  { id: '2', name: 'Rex', description: '', images: ['c'], kind: 'avatar' },
];

test('handles replace spaces with underscores', () => {
  assert.equal(characterHandle('  Maya Lee '), 'Maya_Lee');
});

test('mentions of saved characters become plain descriptions', () => {
  assert.equal(
    expandCharacterMentions('@maya_lee waves at @Rex near @unknown', characters),
    'Maya Lee (the character shown in the reference images: short red hair) waves at Rex (the person shown in the reference image) near @unknown',
  );
  assert.equal(expandCharacterMentions('no mentions here', characters), 'no mentions here');
});
