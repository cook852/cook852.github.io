import {test} from 'node:test';
import assert from 'node:assert/strict';
import matter from 'gray-matter';
import {checkRecipe} from './check-recipes.mjs';
import {loadVocabulary} from './sync-extraction.mjs';
import {normalizeDraft, validateDraft, renderRecipe, renderReview, dictGaps} from './import-recipe.mjs';

const DRAFT = {
  source: {url: 'https://www.youtube.com/watch?v=abc123', title: '蒸肉餅教學', channel: '阿媽廚房'},
  slug: 'steamed-minced-pork',
  category: 'home-style',
  title: '蒸肉餅',
  description: '滑嫩惹味嘅家常蒸肉餅。',
  servings: 2,
  prep_time: '15 分鐘',
  cook_time: '12 分鐘',
  difficulty: '易',
  tags: ['home-style', 'pork', 'steamed'],
  suggested_new_tags: [{key: 'minced-meat', label: '免治肉'}],
  ingredients: [
    {name: '免治豬肉', amount: '300 克', note: '', timestamp: '00:30'},
    {name: '薑', amount: '3 片', note: '切絲', timestamp: '00:45'},
  ],
  seasonings: [{name: '生抽', amount: '1 湯匙', note: '', timestamp: '01:10'}],
  steps: [
    {text: '豬肉加調味料，順一個方向攪至起膠。', timestamp: '01:23'},
    {text: '攤平放碟，大火蒸 12 分鐘。', timestamp: '03:40'},
  ],
  tips: ['肉餅中間壓薄少少，會熟得均勻啲。'],
  uncertain: [{field: 'seasonings[0].amount', issue: '影片冇講清楚份量', timestamp: '01:10'}],
};

const VOCAB = loadVocabulary();
const draft = (overrides = {}) => ({...structuredClone(DRAFT), ...overrides});
const matches = (errors, re) => errors.some((e) => re.test(e));

test('validateDraft_validDraft_returnsNoErrors', () => {
  assert.deepEqual(validateDraft(draft(), VOCAB), []);
});

test('validateDraft_pinyinLikeOrNonAsciiSlug_reportsSlug', () => {
  assert.ok(matches(validateDraft(draft({slug: '蒸肉餅'}), VOCAB), /slug/));
});

test('validateDraft_unknownCategory_reportsCategory', () => {
  assert.ok(matches(validateDraft(draft({category: 'bbq'}), VOCAB), /category/));
});

test('validateDraft_unknownTag_reportsTagAndTagsYml', () => {
  const errors = validateDraft(draft({tags: ['bbq']}), VOCAB);
  assert.ok(errors.some((e) => /bbq/.test(e) && /tags\.yml/.test(e)));
});

test('validateDraft_emptyAmount_tellsToUseShiLiang', () => {
  const d = draft();
  d.ingredients[0].amount = '';
  assert.ok(matches(validateDraft(d, VOCAB), /適量/));
});

test('validateDraft_missingRequiredField_reportsField', () => {
  const d = draft();
  delete d.cook_time;
  assert.ok(matches(validateDraft(d, VOCAB), /cook_time/));
});

test('validateDraft_badDifficulty_reportsDifficulty', () => {
  assert.ok(matches(validateDraft(draft({difficulty: 'easy'}), VOCAB), /difficulty/));
});

test('renderRecipe_fullDraft_passesCheckRecipe', () => {
  assert.deepEqual(checkRecipe('home-style/x.md', renderRecipe(draft())), []);
});

test('renderRecipe_fullDraft_hasDraftAndNoSource', () => {
  const out = renderRecipe(draft());
  const {data} = matter(out);
  assert.equal(data.draft, true);
  assert.deepEqual(data.tags, DRAFT.tags);
  assert.equal('source_url' in data, false);
  assert.ok(!out.includes(DRAFT.source.url));
});

test('renderRecipe_yamlSpecialTitle_roundTrips', () => {
  const title = '蒸肉餅: #1 "家常"';
  assert.equal(matter(renderRecipe(draft({title}))).data.title, title);
});

test('renderRecipe_noSeasoningsOrTips_omitsThoseSections', () => {
  const d = draft();
  delete d.seasonings;
  delete d.tips;
  const out = renderRecipe(normalizeDraft(d));
  assert.ok(!out.includes('## 調味料'));
  assert.ok(!out.includes('## 小貼士'));
  assert.deepEqual(checkRecipe('home-style/x.md', out), []);
});

test('renderRecipe_ingredientWithNote_rendersFullWidthParens', () => {
  assert.ok(renderRecipe(draft()).includes('- 薑 3 片（切絲）'));
});

test('renderRecipe_anyDraft_containsNoTimestamps', () => {
  assert.ok(!renderRecipe(draft()).includes('01:23'));
});

test('renderReview_missingTimestamps_neverPrintsUndefined', () => {
  const d = draft();
  for (const item of [...d.ingredients, ...d.seasonings, ...d.steps, ...d.uncertain]) {
    delete item.timestamp;
    delete item.note;
  }
  const out = renderReview(normalizeDraft(d));
  assert.ok(!out.includes('undefined'));
  assert.ok(out.includes('- [ ] seasonings[0].amount：影片冇講清楚份量（—）'));
});

test('dictGaps_duplicateIngredient_reportsOnce', () => {
  const d = draft({
    ingredients: [{name: '薑', amount: '3 片'}],
    seasonings: [{name: '薑', amount: '1 片'}],
  });
  assert.deepEqual(dictGaps(d, '排骨 1000 n\n'), ['薑 1000 n']);
});

test('dictGaps_knownWord_skipped', () => {
  const d = draft({ingredients: [{name: '排骨', amount: '500 克'}], seasonings: []});
  assert.deepEqual(dictGaps(d, '排骨 1000 n\n'), []);
});
