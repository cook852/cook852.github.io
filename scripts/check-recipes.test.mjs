import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {checkRecipe, checkCategory, checkAll, recipeWarnings} from './check-recipes.mjs';

const VALID = `---
title: 番茄炒蛋
description: 十分鐘完成嘅家常菜。
servings: 2
prep_time: 5 分鐘
cook_time: 5 分鐘
difficulty: 易
tags: [home-style]
---

## 材料

- 雞蛋 3 隻

## 調味料

- 鹽 少許

## 做法

1. 打蛋。
2. 炒蛋。

## 小貼士

蛋唔好炒得太老。
`;

const PATH = 'home-style/tomato-scrambled-eggs.md';

const matches = (errors, re) => errors.some((e) => re.test(e));

test('checkRecipe_validRecipe_returnsNoErrors', () => {
  assert.deepEqual(checkRecipe(PATH, VALID), []);
});

test('checkRecipe_nonAsciiPath_reportsFilename', () => {
  assert.ok(matches(checkRecipe('home-style/番茄炒蛋.md', VALID), /檔名/));
});

test('checkRecipe_missingServings_reportsField', () => {
  const source = VALID.replace('servings: 2\n', '');
  assert.ok(matches(checkRecipe(PATH, source), /servings/));
});

test('checkRecipe_badDifficulty_reportsAllowedValues', () => {
  const source = VALID.replace('difficulty: 易', 'difficulty: 普通');
  assert.ok(matches(checkRecipe(PATH, source), /易.*中.*難/));
});

test('checkRecipe_missingMethodHeading_reportsHeading', () => {
  const source = VALID.replace('## 做法', '## 步驟');
  assert.ok(matches(checkRecipe(PATH, source), /做法/));
});

test('checkRecipe_headingsOutOfOrder_reportsOrder', () => {
  const source = VALID.replace('## 材料', '## TMP')
    .replace('## 做法', '## 材料')
    .replace('## TMP', '## 做法');
  assert.ok(matches(checkRecipe(PATH, source), /次序/));
});

test('checkRecipe_methodNotOrderedList_reportsList', () => {
  const source = VALID.replace('1. 打蛋。\n2. 炒蛋。', '- 打蛋。\n- 炒蛋。');
  assert.ok(matches(checkRecipe(PATH, source), /步驟/));
});

test('checkAll_sampleRecipes_returnsNoErrors', () => {
  assert.deepEqual(checkAll(), []);
});

test('checkRecipe_nonAsciiSlug_reportsSlug', () => {
  const source = VALID.replace('difficulty: 易\n', 'difficulty: 易\nslug: /番茄炒蛋\n');
  assert.ok(matches(checkRecipe(PATH, source), /slug/));
});

test('checkRecipe_nonAsciiId_reportsId', () => {
  const source = VALID.replace('difficulty: 易\n', 'difficulty: 易\nid: 番茄炒蛋\n');
  assert.ok(matches(checkRecipe(PATH, source), /id/));
});

const category = (link) => JSON.stringify({label: '小食', position: 6, link});

test('checkCategory_validSlug_returnsNoErrors', () => {
  const source = category({type: 'generated-index', slug: '/category/xiao-shi'});
  assert.deepEqual(checkCategory('xiao-shi/_category_.json', source), []);
});

test('checkCategory_missingSlug_reportsSlug', () => {
  const source = category({type: 'generated-index'});
  assert.ok(matches(checkCategory('xiao-shi/_category_.json', source), /link\.slug/));
});

test('checkCategory_nonAsciiSlug_reportsSlug', () => {
  const source = category({type: 'generated-index', slug: '/category/小食'});
  assert.ok(matches(checkCategory('xiao-shi/_category_.json', source), /link\.slug/));
});

test('checkAll_chineseFolderAndIndex_reportsBoth', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recipes-'));
  fs.mkdirSync(path.join(root, '湯'));
  fs.writeFileSync(path.join(root, '湯', 'index.md'), '# 湯\n');
  fs.writeFileSync(path.join(root, '湯', '_category_.json'), category({type: 'generated-index'}));
  const errors = checkAll(root);
  assert.ok(matches(errors, /湯\/index\.md.*檔名/));
  assert.ok(matches(errors, /_category_\.json.*link\.slug/));
});

test('recipeWarnings_draftTrue_warnsDraft', () => {
  const source = VALID.replace('tags:', 'draft: true\ntags:');
  assert.ok(matches(recipeWarnings(PATH, source), /draft/));
});

test('recipeWarnings_noDraft_returnsEmpty', () => {
  assert.deepEqual(recipeWarnings(PATH, VALID), []);
});
