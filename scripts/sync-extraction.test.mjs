import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadVocabulary, syncSchema, syncPrompt} from './sync-extraction.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('loadVocabulary_repo_returnsCategoriesAndTags', () => {
  const v = loadVocabulary();
  assert.ok(v.categories.includes('home-style') && v.categories.includes('soup'));
  assert.deepEqual(v.tags.slice(0, 3), ['home-style', 'egg', 'quick']);
});

test('syncSchema_vocab_replacesEnumsWithoutMutatingInput', () => {
  const schema = {properties: {category: {enum: []}, tags: {items: {enum: []}}}};
  const out = syncSchema(schema, {categories: ['soup'], tags: ['pork']});
  assert.deepEqual(out.properties.category.enum, ['soup']);
  assert.deepEqual(out.properties.tags.items.enum, ['pork']);
  assert.deepEqual(schema.properties.category.enum, []);
});

test('syncPrompt_markers_replacesOnlyBetweenMarkers', () => {
  const text = 'A\n<!-- vocab:start -->\nold\n<!-- vocab:end -->\nB';
  const out = syncPrompt(text, {categories: ['soup'], tags: ['pork', 'egg']});
  assert.match(out, /^A\n<!-- vocab:start -->\n/);
  assert.match(out, /標籤（tags）只可以揀：pork, egg/);
  assert.match(out, /<!-- vocab:end -->\nB$/);
});

test('syncPrompt_missingMarkers_throws', () => {
  assert.throws(() => syncPrompt('no markers', {categories: [], tags: []}), /vocab:start/);
});

test('committedExtractionFiles_matchRepoVocabulary', () => {
  // Fails in CI when someone adds a tag or category without re-syncing.
  const vocab = loadVocabulary();
  const schema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'extraction/recipe.schema.json'), 'utf8'));
  const prompt = fs.readFileSync(path.join(REPO_ROOT, 'extraction/prompt.md'), 'utf8');
  assert.deepEqual(syncSchema(schema, vocab), schema);
  assert.equal(syncPrompt(prompt, vocab), prompt);
});
