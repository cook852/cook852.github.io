// Turns a Gemini extraction (drafts/<slug>.json) into a draft recipe page.
// Usage: npm run import:recipe -- drafts/<slug>.json [--force] [--add-dict]

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
