import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkRecipe, checkAll} from './check-recipes.mjs';

const VALID = `---
title: 番茄炒蛋
description: 十分鐘完成嘅家常菜。
servings: 2
prep_time: 5 分鐘
cook_time: 5 分鐘
difficulty: 易
tags: [jia-chang]
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

const PATH = 'jia-chang/fan-qie-chao-dan.md';

const matches = (errors, re) => errors.some((e) => re.test(e));

test('checkRecipe_validRecipe_returnsNoErrors', () => {
  assert.deepEqual(checkRecipe(PATH, VALID), []);
});

test('checkRecipe_nonAsciiPath_reportsFilename', () => {
  assert.ok(matches(checkRecipe('jia-chang/番茄炒蛋.md', VALID), /檔名/));
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
