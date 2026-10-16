import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wordingWarnings} from './hk-wording.mjs';

test('wordingWarnings_simplifiedChar_warnsWithChar', () => {
  assert.ok(wordingWarnings('鸡蛋三只').some((w) => w.includes('鸡')));
});

test('wordingWarnings_mainlandTerm_suggestsHkTerm', () => {
  assert.ok(wordingWarnings('土豆一個').some((w) => w.includes('土豆') && w.includes('薯仔')));
});

test('wordingWarnings_hkText_returnsEmpty', () => {
  assert.deepEqual(wordingWarnings('薯仔切粒，加生抽同粟粉水。'), []);
});
