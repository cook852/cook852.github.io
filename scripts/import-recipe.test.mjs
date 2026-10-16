import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import matter from 'gray-matter';
import {checkRecipe} from './check-recipes.mjs';
import {loadVocabulary} from './sync-extraction.mjs';
import {
  normalizeDraft,
  validateDraft,
  renderRecipe,
  renderReview,
  dictGaps,
  parseDraftText,
  importRecipe,
  REQUIRED_FIELDS,
} from './import-recipe.mjs';

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

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECIPE = 'recipes/home-style/steamed-minced-pork.md';

// A throwaway copy of the bits of the repo importRecipe reads and writes.
function tempRepo(draftValue = DRAFT, draftText = JSON.stringify(draftValue)) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cook852-'));
  fs.cpSync(path.join(REPO_ROOT, 'recipes'), path.join(root, 'recipes'), {recursive: true});
  fs.mkdirSync(path.join(root, 'search'));
  fs.copyFileSync(path.join(REPO_ROOT, 'search/zh-user-dict.txt'), path.join(root, 'search/zh-user-dict.txt'));
  fs.mkdirSync(path.join(root, 'drafts'));
  const draftPath = path.join(root, 'drafts/steamed-minced-pork.json');
  fs.writeFileSync(draftPath, draftText);
  return {root, draftPath};
}

test('parseDraftText_jsonCodeFence_parses', () => {
  assert.deepEqual(parseDraftText('```json\n{"a":1}\n```\n'), {a: 1});
});

test('parseDraftText_invalidJson_throwsCantonese', () => {
  assert.throws(() => parseDraftText('{nope'), /JSON 格式錯誤/);
});

test('importRecipe_validDraft_writesRecipeAndReview', () => {
  const {root, draftPath} = tempRepo();
  const result = importRecipe(draftPath, {repoRoot: root});
  assert.deepEqual(result.errors, []);
  const recipe = fs.readFileSync(path.join(root, RECIPE), 'utf8');
  assert.deepEqual(checkRecipe('home-style/steamed-minced-pork.md', recipe), []);
  assert.ok(fs.existsSync(path.join(root, 'drafts/steamed-minced-pork.review.md')));
});

test('importRecipe_existingRecipe_refusesAndLeavesFileUntouched', () => {
  const {root, draftPath} = tempRepo();
  fs.writeFileSync(path.join(root, RECIPE), 'sentinel');
  const result = importRecipe(draftPath, {repoRoot: root});
  assert.ok(matches(result.errors, /--force/));
  assert.equal(fs.readFileSync(path.join(root, RECIPE), 'utf8'), 'sentinel');
});

test('importRecipe_existingRecipeWithForce_overwrites', () => {
  const {root, draftPath} = tempRepo();
  fs.writeFileSync(path.join(root, RECIPE), 'sentinel');
  const result = importRecipe(draftPath, {repoRoot: root, force: true});
  assert.deepEqual(result.errors, []);
  assert.match(fs.readFileSync(path.join(root, RECIPE), 'utf8'), /title: 蒸肉餅/);
});

test('importRecipe_invalidDraft_writesNothing', () => {
  const {root, draftPath} = tempRepo(draft({tags: ['bbq']}));
  const result = importRecipe(draftPath, {repoRoot: root});
  assert.ok(result.errors.length > 0);
  assert.ok(!fs.existsSync(path.join(root, RECIPE)));
  assert.ok(!fs.existsSync(path.join(root, 'drafts/steamed-minced-pork.review.md')));
});

test('importRecipe_simplifiedText_returnsWarningButWrites', () => {
  const {root, draftPath} = tempRepo(draft({description: '好好味嘅鸡汤。'}));
  const result = importRecipe(draftPath, {repoRoot: root});
  assert.deepEqual(result.errors, []);
  assert.ok(matches(result.warnings, /鸡/));
  assert.ok(fs.existsSync(path.join(root, RECIPE)));
});

test('importRecipe_addDict_appendsMissingWordsOnce', () => {
  const {root, draftPath} = tempRepo();
  const dictFile = path.join(root, 'search/zh-user-dict.txt');
  fs.writeFileSync(dictFile, fs.readFileSync(dictFile, 'utf8').trimEnd()); // no trailing newline
  importRecipe(draftPath, {repoRoot: root, addDict: true});
  importRecipe(draftPath, {repoRoot: root, addDict: true, force: true});
  const lines = fs.readFileSync(dictFile, 'utf8').split('\n');
  assert.equal(lines.filter((l) => l === '免治豬肉 1000 n').length, 1);
  assert.ok(!lines.some((l) => /n免治豬肉/.test(l)));
});

test('recipeSchema_required_coversValidatorRequiredFields', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'extraction/recipe.schema.json'), 'utf8'));
  for (const field of [...REQUIRED_FIELDS, 'tags', 'ingredients', 'steps']) {
    assert.ok(schema.required.includes(field), `schema required is missing ${field}`);
  }
});

test('renderRecipe_multilineDescription_roundTrips', () => {
  const description = '第一句。\n第二句。';
  assert.equal(matter(renderRecipe(draft({description}))).data.description, description);
});

test('validateDraft_wrongTypes_returnsErrorsWithoutThrowing', () => {
  const cases = [
    draft({tips: '一條貼士'}),
    draft({tags: 'egg'}),
    draft({uncertain: ['睇唔清']}),
    draft({suggested_new_tags: ['beef']}),
    draft({ingredients: [{name: 300, amount: '300 克'}]}),
    draft({seasonings: 'salt'}),
    draft({steps: ['蒸。']}),
  ];
  for (const d of cases) assert.ok(validateDraft(d, VOCAB).length > 0, JSON.stringify(d).slice(0, 80));
  assert.ok(matches(validateDraft(draft({tags: 'egg'}), VOCAB), /tags.*列表/));
});

test('importRecipe_nullJson_returnsErrorWithoutThrowing', () => {
  const {root, draftPath} = tempRepo(null, 'null');
  assert.ok(importRecipe(draftPath, {repoRoot: root}).errors.length > 0);
});
