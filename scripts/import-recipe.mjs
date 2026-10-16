// Turns a Gemini extraction (drafts/<slug>.json) into a draft recipe page.
// Usage: npm run import:recipe -- drafts/<slug>.json [--force] [--add-dict]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkRecipe} from './check-recipes.mjs';
import {loadVocabulary} from './sync-extraction.mjs';
import {wordingWarnings} from './hk-wording.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DICT_PATH = 'search/zh-user-dict.txt';

const REQUIRED_FIELDS = ['slug', 'category', 'title', 'description', 'servings', 'prep_time', 'cook_time', 'difficulty'];
const DIFFICULTIES = ['易', '中', '難'];
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SAFE_SCALAR = /^[^\s:#\[\]{}&*!|>'"%@`,?-][^:#]*$/;
const YAML_LOOKALIKE = /^(true|false|yes|no|on|off|null|~|[-+]?[\d._]+)$/i;

const blank = (value) => value === undefined || value === null || String(value).trim() === '';

export function normalizeDraft(draft) {
  const item = (x) => ({...x, note: x.note ?? '', timestamp: x.timestamp ?? ''});
  return {
    ...draft,
    source: {url: '', title: '', channel: '', ...draft.source},
    ingredients: (draft.ingredients ?? []).map(item),
    seasonings: (draft.seasonings ?? []).map(item),
    steps: (draft.steps ?? []).map((s) => ({...s, timestamp: s.timestamp ?? ''})),
    tips: draft.tips ?? [],
    suggested_new_tags: draft.suggested_new_tags ?? [],
    uncertain: (draft.uncertain ?? []).map((u) => ({...u, timestamp: u.timestamp ?? ''})),
  };
}

export function validateDraft(draft, vocab) {
  const errors = [];
  for (const field of REQUIRED_FIELDS) {
    if (blank(draft[field])) errors.push(`缺少欄位 "${field}"`);
  }
  if (!blank(draft.slug) && !SLUG.test(draft.slug)) {
    errors.push(`slug "${draft.slug}" 只可以用細楷英文字母、數字同 "-"，唔可以用拼音`);
  }
  if (!blank(draft.category) && !vocab.categories.includes(draft.category)) {
    errors.push(`category "${draft.category}" 唔存在，只可以揀：${vocab.categories.join(', ')}`);
  }
  if (!Array.isArray(draft.tags)) {
    errors.push('缺少欄位 "tags"');
  } else {
    for (const tag of draft.tags.filter((t) => !vocab.tags.includes(t))) {
      errors.push(`標籤 "${tag}" 唔喺 recipes/tags.yml，要用就先加入 tags.yml 再執行 npm run sync:extraction`);
    }
  }
  if (!blank(draft.difficulty) && !DIFFICULTIES.includes(draft.difficulty)) {
    errors.push(`difficulty 必須係 ${DIFFICULTIES.join(' / ')} 其中之一，而家係 "${draft.difficulty}"`);
  }
  if (!blank(draft.servings) && !(Number.isInteger(draft.servings) && draft.servings > 0)) {
    errors.push(`servings 要係正整數，而家係 "${draft.servings}"`);
  }
  if (!Array.isArray(draft.ingredients) || draft.ingredients.length === 0) errors.push('ingredients 唔可以冇嘢');
  if (!Array.isArray(draft.steps) || draft.steps.length === 0) errors.push('steps 唔可以冇嘢');

  for (const list of ['ingredients', 'seasonings']) {
    (Array.isArray(draft[list]) ? draft[list] : []).forEach((item, i) => {
      if (blank(item?.name)) errors.push(`${list}[${i}] 缺少 name`);
      if (blank(item?.amount)) errors.push(`${list}[${i}]（${item?.name ?? ''}）冇份量：影片冇講就寫「適量」`);
    });
  }
  (Array.isArray(draft.steps) ? draft.steps : []).forEach((step, i) => {
    if (blank(step?.text)) errors.push(`steps[${i}] 缺少 text`);
  });
  return errors;
}

function yamlScalar(value) {
  if (typeof value !== 'string') return String(value);
  const bare = SAFE_SCALAR.test(value) && value === value.trimEnd() && !YAML_LOOKALIKE.test(value);
  return bare ? value : JSON.stringify(value);
}

const ingredientLine = ({name, amount, note}) => `- ${name} ${amount}${note ? `（${note}）` : ''}`;

export function renderRecipe(draft) {
  const front = [
    ['title', draft.title],
    ['description', draft.description],
    ['servings', draft.servings],
    ['prep_time', draft.prep_time],
    ['cook_time', draft.cook_time],
    ['difficulty', draft.difficulty],
  ].map(([key, value]) => `${key}: ${yamlScalar(value)}`);
  front.push(`tags: [${draft.tags.join(', ')}]`, 'draft: true');

  const sections = [['## 材料', draft.ingredients.map(ingredientLine)]];
  if (draft.seasonings?.length) sections.push(['## 調味料', draft.seasonings.map(ingredientLine)]);
  sections.push(['## 做法', draft.steps.map((s, i) => `${i + 1}. ${s.text}`)]);
  if (draft.tips?.length) sections.push(['## 小貼士', draft.tips.map((t) => `- ${t}`)]);

  const body = sections.map(([heading, lines]) => `${heading}\n\n${lines.join('\n')}`).join('\n\n');
  return `---\n${front.join('\n')}\n---\n\n${body}\n`;
}

const at = (timestamp) => `（${timestamp || '—'}）`;

export function renderReview(draft) {
  const uncertain = draft.uncertain.length
    ? draft.uncertain.map((u) => `- [ ] ${u.field}：${u.issue}${at(u.timestamp)}`)
    : ['- 冇'];
  return [
    `# 審稿清單：${draft.title}（${draft.source.url || '—'}）`,
    '',
    '## 唔確定',
    '',
    ...uncertain,
    '',
    '## 材料時間點',
    '',
    ...[...draft.ingredients, ...draft.seasonings].map((x) => `- ${x.name} ${x.amount}${at(x.timestamp)}`),
    '',
    '## 步驟時間點',
    '',
    ...draft.steps.map((s, i) => `${i + 1}. ${s.text}${at(s.timestamp)}`),
    '',
  ].join('\n');
}

export function dictGaps(draft, dictText) {
  const known = new Set(dictText.split('\n').map((line) => line.trim().split(/\s+/)[0]).filter(Boolean));
  const names = [...new Set([...draft.ingredients, ...(draft.seasonings ?? [])].map((x) => x.name.trim()))];
  return names.filter((name) => !known.has(name)).map((name) => `${name} 1000 n`);
}

// Gemini's chat UI wraps JSON in a ```json fence when copied.
export function parseDraftText(text) {
  const unfenced = text.trim().replace(/^```[a-z]*\s*\n/i, '').replace(/\n?```$/, '');
  try {
    return JSON.parse(unfenced);
  } catch (e) {
    throw new Error(`JSON 格式錯誤：${e.message}`);
  }
}

function humanText(draft) {
  return [
    draft.title,
    draft.description,
    ...[...draft.ingredients, ...draft.seasonings].flatMap((x) => [x.name, x.amount, x.note]),
    ...draft.steps.map((s) => s.text),
    ...draft.tips,
  ].join('\n');
}

export function importRecipe(draftPath, {repoRoot = REPO_ROOT, force = false, addDict = false} = {}) {
  const result = {recipePath: '', reviewPath: '', errors: [], warnings: [], newTags: [], dictLines: []};
  let raw;
  try {
    raw = parseDraftText(fs.readFileSync(draftPath, 'utf8'));
  } catch (e) {
    result.errors.push(e.message);
    return result;
  }

  result.errors = validateDraft(raw, loadVocabulary(repoRoot));
  if (result.errors.length > 0) return result;
  const draft = normalizeDraft(raw);

  const relPath = `${draft.category}/${draft.slug}.md`;
  result.recipePath = `recipes/${relPath}`;
  result.reviewPath = path.join(path.dirname(draftPath), `${draft.slug}.review.md`);
  const target = path.join(repoRoot, result.recipePath);
  if (fs.existsSync(target) && !force) {
    result.errors.push(`${result.recipePath} 已經存在，要覆蓋請加 --force`);
    return result;
  }

  const recipe = renderRecipe(draft);
  // Errors here mean renderRecipe is wrong, not the draft.
  result.errors = checkRecipe(relPath, recipe);
  if (result.errors.length > 0) return result;

  result.warnings = wordingWarnings(humanText(draft));
  result.newTags = draft.suggested_new_tags;
  fs.writeFileSync(target, recipe);
  fs.writeFileSync(result.reviewPath, renderReview(draft));

  const dictFile = path.join(repoRoot, DICT_PATH);
  const dictText = fs.readFileSync(dictFile, 'utf8');
  result.dictLines = dictGaps(draft, dictText);
  if (addDict && result.dictLines.length > 0) {
    const separator = dictText === '' || dictText.endsWith('\n') ? '' : '\n';
    fs.appendFileSync(dictFile, `${separator}${result.dictLines.join('\n')}\n`);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const draftArg = args.find((a) => !a.startsWith('--'));
  if (!draftArg) {
    console.error('✗ 用法：npm run import:recipe -- drafts/<slug>.json [--force] [--add-dict]');
    process.exit(1);
  }
  const addDict = args.includes('--add-dict');
  const result = importRecipe(path.resolve(draftArg), {force: args.includes('--force'), addDict});

  for (const error of result.errors) console.error(`✗ ${error}`);
  if (result.errors.length > 0) process.exit(1);
  for (const warning of result.warnings) console.warn(`⚠ ${warning}`);
  if (result.newTags.length > 0) {
    console.log('新標籤建議（要用就先加入 recipes/tags.yml，再執行 npm run sync:extraction）：');
    for (const {key, label} of result.newTags) console.log(`  ${key} — ${label}`);
  }
  if (result.dictLines.length > 0) {
    console.log(addDict ? `已加入搜尋字典：${result.dictLines.join('、')}` : `搜尋字典未有（加 --add-dict 自動加入 ${DICT_PATH}）：`);
    if (!addDict) for (const line of result.dictLines) console.log(`  ${line}`);
  }
  console.log(`✓ 已建立 ${result.recipePath}（draft）`);
  console.log(`審稿清單：${path.relative(process.cwd(), result.reviewPath)}`);
  console.log('下一步：npm start 睇下，對住影片改好，再刪 draft: true');
}
