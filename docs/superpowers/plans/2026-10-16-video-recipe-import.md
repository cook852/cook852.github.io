# Video → Recipe Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a Gemini extraction (JSON) of a cooking video into a valid, draft recipe page with one command, with the site crediting the source video.

**Architecture:** Gemini receives a prompt and a JSON Schema that are committed in `extraction/`. Their allowed category and tag lists are generated from the repo by `scripts/sync-extraction.mjs`. `scripts/import-recipe.mjs` is a deterministic Node CLI with no AI. It validates the JSON, warns on Simplified/Mainland wording (`scripts/hk-wording.mjs`), renders the Markdown, reuses `checkRecipe()` and writes a review checklist. The site shows a source credit from new `source_*` frontmatter fields. `draft: true` hides a recipe from production until it has been reviewed.

**Tech Stack:** Node 22 ESM scripts, `gray-matter` (already a devDependency), `node:test` + `node:assert/strict`, Docusaurus 3.10 / React 19 / TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-16-video-recipe-import-design.md`

## Global Constraints

- Every slug, tag key, folder name and file name is lowercase ASCII `[a-z0-9-]`. No pinyin and no Cantonese romanization (`CLAUDE.md`).
- All user-facing messages (CLI errors and warnings, page text) are in Cantonese Traditional Chinese, in the same voice as `scripts/check-recipes.mjs`. Prefixes: `✗` for errors, `⚠` for warnings and `✓` for success.
- No new npm dependencies. Read YAML with `matter.engines.yaml.parse` from gray-matter, and validate the draft by hand rather than with ajv.
- Tests live in `scripts/*.test.mjs` (the `npm test` glob). Name them `function_condition_expectedOutcome`.
- Never invent amounts. An empty `amount` is an error that tells the user to write `適量`.
- Timestamps never appear in `recipes/**`. They go only in `drafts/`.
- `drafts/` is gitignored.
- Out of scope: the phase-2 `extract:video` Gemini API script (the spec says to build it only after the manual flow is proven).

## Review Focus

1. **The JSON is wrapped in a ```` ```json ```` fence when copied from the Gemini chat UI.** The importer should strip the fence, not fail on it. (Task 4)
2. **The title or description contains YAML-special characters** (`:`, `#`, quotes, a leading `[`). The rendered frontmatter must still round-trip through gray-matter. (Task 3)
3. **Gemini leaves out optional arrays** (`seasonings`, `tips`, `suggested_new_tags`, `uncertain`) or `note`/`timestamp`. Treat them as empty. Never print `undefined`. (Tasks 3 and 4)
4. **The user re-runs the import after editing the recipe.** It must refuse to overwrite without `--force`, and must leave the existing file untouched. (Task 4)
5. **The same ingredient appears twice** (e.g. 薑 in both 材料 and 調味料) and is missing from the search dictionary. It should be reported or added only once. (Task 3)

---

### Task 1: Source credit + checker updates

**Files:**
- Modify: `scripts/check-recipes.mjs`
- Modify: `scripts/check-recipes.test.mjs`
- Modify: `src/components/RecipeMeta/index.tsx`, `src/components/RecipeMeta/styles.module.css`
- Modify: `templates/recipe-template.md`

**Interfaces:**
- Produces:
  - `checkRecipe(relPath, source): string[]` now also errors on a bad `source_url`.
  - New `recipeWarnings(relPath, source): string[]`.
  - `checkAll()` is unchanged.
  - New `warnAll(rootDir = 'recipes'): string[]`, which walks the folders the same way `checkAll` does.

- [ ] **Step 1: Write failing tests** in `scripts/check-recipes.test.mjs`:

```js
test('checkRecipe_httpsSourceUrl_returnsNoErrors', () => {
  const source = VALID.replace('tags:', 'source_url: https://www.youtube.com/watch?v=abc\ntags:');
  assert.deepEqual(checkRecipe(PATH, source), []);
});

test('checkRecipe_nonHttpSourceUrl_reportsSourceUrl', () => {
  const source = VALID.replace('tags:', 'source_url: youtube.com/abc\ntags:');
  assert.ok(matches(checkRecipe(PATH, source), /source_url/));
});

test('recipeWarnings_draftTrue_warnsDraft', () => {
  const source = VALID.replace('tags:', 'draft: true\ntags:');
  assert.ok(matches(recipeWarnings(PATH, source), /draft/));
});

test('recipeWarnings_noDraft_returnsEmpty', () => {
  assert.deepEqual(recipeWarnings(PATH, VALID), []);
});
```

- [ ] **Step 2:** Run `npm test`. Expected: the 4 new tests FAIL (`recipeWarnings` is not exported, and the source_url check is missing).

- [ ] **Step 3: Implement.**
  - In `checkRecipe`: if `data.source_url !== undefined` and it doesn't match `/^https?:\/\/\S+$/`, push `` `${where}: source_url 一定要係 http(s) 網址` ``.
  - Add `recipeWarnings`, which returns `` [`${where}: 仲係 draft: true，正式網站唔會顯示`] `` when `data.draft === true`.
  - Add `warnAll`.
  - In the CLI block, print each warning with `⚠` before the error loop. Warnings never change the exit code.

- [ ] **Step 4:** Run `npm test`. Expected: all tests PASS.

- [ ] **Step 5: Add the source credit in `RecipeMeta`.**
  - Extend `RecipeFrontMatter` with `source_url?: string; source_title?: string; source_channel?: string`.
  - When `source_url` is set, render one more item after 難度 with the label `參考影片`. Its value is `<a href={source_url} target="_blank" rel="noopener noreferrer">{source_title ?? source_url}</a>`, followed by ` · {source_channel}` when a channel is set.
  - Give that item a class that makes it take the full row (`flex-basis: 100%`), so a long title wraps on its own line.

- [ ] **Step 6: Update the template.** Add these commented optional lines to `templates/recipe-template.md`, under `tags`:

```yaml
# source_url: https://www.youtube.com/watch?v=...   # 可選：參考影片
# source_title: 影片標題
# source_channel: 頻道名稱
```

- [ ] **Step 7: Verify.** Add `source_url`, `source_title` and `source_channel` to `recipes/soup/daikon-pork-rib-soup.md` in a scratch edit (don't commit it). Run `npm run check:recipes` and `npm run build`. Expected: `✓ 所有食譜格式正確` and a successful build. Then `npm start` and check that the credit line shows and the link opens in a new tab. Revert the scratch edit.

- [ ] **Step 8: Commit.**

```bash
git add scripts/check-recipes.mjs scripts/check-recipes.test.mjs src/components/RecipeMeta templates/recipe-template.md
git commit -m "feat: credit source video and warn on draft recipes"
```

---

### Task 2: Extraction prompt, schema and vocabulary sync

**Files:**
- Create: `extraction/prompt.md`, `extraction/recipe.schema.json`
- Create: `scripts/sync-extraction.mjs`, `scripts/sync-extraction.test.mjs`
- Modify: `package.json` (add a `"sync:extraction": "node scripts/sync-extraction.mjs"` script)

**Interfaces:**
- Produces:
  - `loadVocabulary(repoRoot = REPO_ROOT): {categories: string[], tags: string[]}`. `categories` is the sorted folder names under `recipes/` that contain `_category_.json`. `tags` is the keys of `recipes/tags.yml`, in file order.
  - `syncSchema(schema: object, vocab): object`. It returns a copy with these enums replaced:
    - `properties.category.enum = vocab.categories`
    - `properties.tags.items.enum = vocab.tags`
  - `syncPrompt(text: string, vocab): string`. It replaces everything between `<!-- vocab:start -->` and `<!-- vocab:end -->` with:
    ```
    分類（category）只可以揀：<comma-separated categories>
    標籤（tags）只可以揀：<comma-separated tags>
    ```
  - CLI: rewrites both files in place. With `--check`, it exits 1 and prints `✗ extraction/ 同 recipes/ 唔同步，請執行 npm run sync:extraction` if either file would change.

- [ ] **Step 1: Write `extraction/recipe.schema.json`.**
  - Use only the keywords Gemini `responseSchema` accepts: `type`, `properties`, `required`, `items`, `enum`, `description`. No `$ref`, `pattern` or `additionalProperties`.
  - The fields and shape are exactly the spec's "Schema (shape)" block.
  - Required top-level fields: `source, slug, category, title, description, servings, prep_time, cook_time, difficulty, tags, ingredients, steps`.
  - Required in an ingredient or seasoning item: `name, amount`. Required in a step: `text`.
  - `servings` is an `integer`.
  - `difficulty.enum` is `["易","中","難"]`.
  - Leave the `category` and `tags` enums empty for now. The sync fills them.
  - Each property's `description` gives the matching prompt rule in one short line (e.g. slug: `English kebab-case, e.g. steamed-minced-pork; never pinyin`).

- [ ] **Step 2: Write `extraction/prompt.md`.** Write it in Cantonese Traditional Chinese, addressed to Gemini. It contains:
  - The 7 rules from the spec's "Rules the prompt must state", in that order.
  - The `<!-- vocab:start -->`/`<!-- vocab:end -->` markers.
  - A one-line instruction to output only JSON that matches the schema.
  - A short header for the human: how to use it in AI Studio, i.e. paste the prompt, add the video URL, and turn on Structured output with `recipe.schema.json`.

- [ ] **Step 3: Write failing tests** in `scripts/sync-extraction.test.mjs`:

```js
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
  const schema = JSON.parse(fs.readFileSync('extraction/recipe.schema.json', 'utf8'));
  const prompt = fs.readFileSync('extraction/prompt.md', 'utf8');
  assert.deepEqual(syncSchema(schema, vocab), schema);
  assert.equal(syncPrompt(prompt, vocab), prompt);
});
```

- [ ] **Step 4:** Run `npm test`. Expected: the new tests FAIL (module not found).

- [ ] **Step 5: Implement `scripts/sync-extraction.mjs`.** Write the schema back with `JSON.stringify(schema, null, 2) + '\n'`. Resolve paths from `REPO_ROOT` the same way `check-recipes.mjs` does.

- [ ] **Step 6:** Run `npm run sync:extraction`, then `npm test`. Expected: all tests PASS, and both files now list the 5 categories and 6 tags.

- [ ] **Step 7: Commit.**

```bash
git add extraction scripts/sync-extraction.mjs scripts/sync-extraction.test.mjs package.json
git commit -m "feat: add Gemini extraction prompt and schema synced from tags and categories"
```

---

### Task 3: Draft validation, wording checks and rendering (pure functions)

**Files:**
- Create: `scripts/hk-wording.mjs`, `scripts/hk-wording.test.mjs`
- Create: `scripts/import-recipe.mjs` (pure exports only; the CLI comes in Task 4)
- Create: `scripts/import-recipe.test.mjs`

**Interfaces:**
- Consumes: `loadVocabulary()` (Task 2), and `checkRecipe()` (Task 1) in the round-trip test.
- Produces:
  - `wordingWarnings(text: string): string[]` (in `hk-wording.mjs`), plus the exported data `SIMPLIFIED_CHARS: string` and `MAINLAND_TERMS: Record<string, string>`.
  - From `import-recipe.mjs`:
    - `normalizeDraft(draft): Draft`. It fills missing `seasonings`, `tips`, `suggested_new_tags` and `uncertain` with `[]`, and missing `note`/`timestamp` with `''`.
    - `validateDraft(draft, vocab): string[]`
    - `renderRecipe(draft): string`
    - `renderReview(draft): string`
    - `dictGaps(draft, dictText: string): string[]`. It returns lines in the form `詞語 1000 n`.

- [ ] **Step 1: Write failing tests** in `scripts/hk-wording.test.mjs`:

```js
test('wordingWarnings_simplifiedChar_warnsWithChar', () => {
  assert.ok(wordingWarnings('鸡蛋三只').some((w) => w.includes('鸡')));
});
test('wordingWarnings_mainlandTerm_suggestsHkTerm', () => {
  assert.ok(wordingWarnings('土豆一個').some((w) => w.includes('土豆') && w.includes('薯仔')));
});
test('wordingWarnings_hkText_returnsEmpty', () => {
  assert.deepEqual(wordingWarnings('薯仔切粒，加生抽同粟粉水。'), []);
});
```

- [ ] **Step 2: Implement `hk-wording.mjs`.**
  - Seed `SIMPLIFIED_CHARS` with at least `这们鸡汤盐酱葱姜蒜个块锅热时间钟里面边说`. Each distinct hit gives `` `簡體字「${c}」` ``.
  - Seed `MAINLAND_TERMS` with:
    - `土豆→薯仔`, `西红柿→番茄`, `西紅柿→番茄`, `淀粉→粟粉`, `澱粉→粟粉`
    - `酱油→生抽／老抽`, `醬油→生抽／老抽`, `番茄酱→茄汁`, `番茄醬→茄汁`
    - `料酒→紹興酒`, `大葱→京葱`, `生粉→粟粉`
  - Each hit gives `` `「${term}」香港一般叫「${hk}」` ``.
  - Run `npm test`. Expected: PASS.

- [ ] **Step 3: Write failing tests** in `scripts/import-recipe.test.mjs`. Base them on a `DRAFT` fixture that has every field filled (category `home-style`, tags `['home-style','pork','steamed']`, 2 ingredients, 1 seasoning, 2 steps, 1 tip, 1 uncertain item) and a `VOCAB = loadVocabulary()`. The tests:
  - `validateDraft_validDraft_returnsNoErrors`: the result is `[]`.
  - `validateDraft_pinyinLikeOrNonAsciiSlug_reportsSlug`: the slug `蒸肉餅` → an error matching `/slug/`.
  - `validateDraft_unknownCategory_reportsCategory`: `category: 'bbq'` → `/category/`.
  - `validateDraft_unknownTag_reportsTagAndTagsYml`: `tags: ['bbq']` → an error matching `/bbq/` and `/tags\.yml/`.
  - `validateDraft_emptyAmount_tellsToUseShiLiang`: an ingredient amount of `''` → `/適量/`.
  - `validateDraft_missingRequiredField_reportsField`: deleting `cook_time` → `/cook_time/`.
  - `validateDraft_badDifficulty_reportsDifficulty`.
  - `renderRecipe_fullDraft_passesCheckRecipe`: `checkRecipe('home-style/x.md', renderRecipe(DRAFT))` is `[]`.
  - `renderRecipe_fullDraft_hasDraftAndSourceFrontmatter`: `matter(out).data` has `draft === true` and `source_url === DRAFT.source.url`, and `tags` deep-equals `DRAFT.tags`.
  - `renderRecipe_yamlSpecialTitle_roundTrips`: the title `'蒸肉餅: #1 "家常"'` → `matter(out).data.title` equals it exactly. (Review Focus 2)
  - `renderRecipe_noSeasoningsOrTips_omitsThoseSections`: the output contains no `## 調味料` and no `## 小貼士`, and `checkRecipe` is `[]`. (Review Focus 3)
  - `renderRecipe_ingredientWithNote_rendersFullWidthParens`: `{name:'薑', amount:'3 片', note:'切絲'}` → contains `- 薑 3 片（切絲）`.
  - `renderRecipe_anyDraft_containsNoTimestamps`: given steps with timestamp `'01:23'`, the output does not contain `01:23`.
  - `renderReview_missingTimestamps_neverPrintsUndefined`: after `normalizeDraft` on a draft with no timestamps or notes, the output doesn't contain `undefined`. Uncertain items render as `- [ ] {field}：{issue}（{timestamp or —}）`. (Review Focus 3)
  - `dictGaps_duplicateIngredient_reportsOnce`: 薑 appears in both ingredients and seasonings, and the dictionary has no 薑 → exactly `['薑 1000 n']`. (Review Focus 5)
  - `dictGaps_knownWord_skipped`: the dictionary text `'排骨 1000 n\n'` with ingredient 排骨 → `[]`.

- [ ] **Step 4:** Run `npm test`. Expected: the new tests FAIL (module not found).

- [ ] **Step 5: Implement the pure functions in `scripts/import-recipe.mjs`.**
  - **`validateDraft`:**
    - checks the spec's required fields
    - slug matches `/^[a-z0-9]+(-[a-z0-9]+)*$/`
    - category is in `vocab.categories`
    - each tag is in `vocab.tags`, and the error names `recipes/tags.yml`
    - `difficulty` is one of 易/中/難
    - `servings` is a positive integer
    - `ingredients` and `steps` are non-empty
    - every ingredient and seasoning has a non-blank `name` and `amount`
  - **`renderRecipe`:**
    - Frontmatter order: `title, description, servings, prep_time, cook_time, difficulty, tags, source_url, source_title, source_channel, draft`.
    - Write `tags` in flow style (`[a, b]`), as the existing recipes do.
    - Write a scalar string bare if it matches `/^[^\s:#\[\]{}&*!|>'"%@`,?-][^:#]*$/` and has no trailing space. Otherwise write it as `JSON.stringify(value)` (valid YAML double-quoted).
    - Skip any `source_*` that is empty.
    - Body sections follow the template exactly, with one blank line between sections and a trailing newline.
  - **`renderReview`:**
    - Title line: `` # 審稿清單：${title}（${source.url}） ``.
    - Then `## 唔確定` for the uncertain items, `## 材料時間點` and `## 步驟時間點`.
  - **`dictGaps`:**
    - The set of dictionary words is the first whitespace token of each line of `dictText`.
    - Go through the names from ingredients, then seasonings, deduplicated in order.

- [ ] **Step 6:** Run `npm test`. Expected: all tests PASS.

- [ ] **Step 7: Commit.**

```bash
git add scripts/hk-wording.mjs scripts/hk-wording.test.mjs scripts/import-recipe.mjs scripts/import-recipe.test.mjs
git commit -m "feat: validate and render Gemini recipe drafts"
```

---

### Task 4: `import:recipe` CLI, gitignore and README

**Files:**
- Modify: `scripts/import-recipe.mjs` (add `importRecipe` and the CLI block)
- Modify: `scripts/import-recipe.test.mjs`
- Modify: `package.json` (add `"import:recipe": "node scripts/import-recipe.mjs"`)
- Modify: `.gitignore` (add `/drafts`)
- Modify: `README.md`

**Interfaces:**
- Consumes: everything Task 3 produces, `loadVocabulary` (Task 2), `checkRecipe` (Task 1) and `wordingWarnings`.
- Produces:
  - `parseDraftText(text: string): object`. It strips a leading or trailing Markdown code fence (```` ```json ```` or ```` ``` ````) and surrounding whitespace, then calls `JSON.parse`. On a parse error it throws `` `JSON 格式錯誤：${e.message}` ``.
  - `importRecipe(draftPath: string, {repoRoot = REPO_ROOT, force = false, addDict = false} = {}): {recipePath: string, reviewPath: string, errors: string[], warnings: string[], newTags: object[], dictLines: string[]}`.
  - When `errors` is non-empty, nothing is written.

- [ ] **Step 1: Write failing tests.** Each test uses a temp repo built with `fs.mkdtempSync(path.join(os.tmpdir(), 'cook852-'))`. Copy `recipes/` and `search/zh-user-dict.txt` into it, and write the draft to `<tmp>/drafts/steamed-minced-pork.json`. The tests:
  - `parseDraftText_jsonCodeFence_parses`: ```` '```json\n{"a":1}\n```\n' ```` → `{a: 1}`. (Review Focus 1)
  - `parseDraftText_invalidJson_throwsCantonese`: matches `/JSON 格式錯誤/`.
  - `importRecipe_validDraft_writesRecipeAndReview`:
    - `recipes/home-style/steamed-minced-pork.md` exists, and `checkRecipe` on it is `[]`.
    - `drafts/steamed-minced-pork.review.md` exists.
  - `importRecipe_existingRecipe_refusesAndLeavesFileUntouched`:
    - Write sentinel text into the target first. The result `errors` match `/--force/`.
    - The file content is still the sentinel. (Review Focus 4)
  - `importRecipe_existingRecipeWithForce_overwrites`.
  - `importRecipe_invalidDraft_writesNothing`:
    - Use an unknown tag. `errors` is non-empty.
    - Neither the recipe file nor the review file exists.
  - `importRecipe_simplifiedText_returnsWarningButWrites`.
  - `importRecipe_addDict_appendsMissingWordsOnce`:
    - Running twice with `addDict: true` leaves the new word in the dictionary exactly once.
    - Read the dictionary before appending, and make sure the appended block starts on a new line.

- [ ] **Step 2:** Run `npm test`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement `parseDraftText` and `importRecipe`.**

  Order of work:
  1. Read the file and parse it.
  2. Call `normalizeDraft`.
  3. Call `validateDraft`. On errors, return early.
  4. Check the target path. If it exists and `force` is false, return the error `` `${rel} 已經存在，要覆蓋請加 --force` ``.
  5. Render the recipe, then run `checkRecipe(relPath, rendered)`. Errors here are bugs, so return them with nothing written.
  6. Collect warnings: `wordingWarnings` over the `JSON.stringify` of the draft's human-text fields.
  7. Write the recipe, and write the review file into `path.dirname(draftPath)`.
  8. Compute `dictGaps`. Append them if `addDict`.

- [ ] **Step 4: Add the CLI block.**

  Usage: `npm run import:recipe -- <draft.json> [--force] [--add-dict]`.

  Print in this order:
  - `✗` errors, then exit 1
  - `⚠` warnings
  - `新標籤建議（要用就先加入 recipes/tags.yml，再執行 npm run sync:extraction）：key — label` for each `suggested_new_tags` item
  - the dictionary lines (`搜尋字典未有：` followed by the lines), or `已加入搜尋字典` when `--add-dict` is set
  - `✓ 已建立 <recipePath>（draft）`
  - `審稿清單：<reviewPath>`
  - the next step: `npm start 睇下，對住影片改好，再刪 draft: true`

- [ ] **Step 5:** Run `npm test`. Expected: all tests PASS.

- [ ] **Step 6: Wire it up and document it.**
  - Add `/drafts` to `.gitignore`.
  - Add the `import:recipe` script to `package.json`.
  - Add a `## 由影片新增食譜` section to `README.md`, in the same Cantonese voice. It covers the 4 steps from the spec's pipeline:
    1. Gemini/AI Studio with `extraction/prompt.md` and the schema, saving the result to `drafts/<slug>.json`
    2. `npm run import:recipe -- drafts/<slug>.json`
    3. Review with `npm start` and the review checklist, then delete `draft: true`
    4. `check:recipes`, `build`, commit and push

    Also say that after adding a tag or category you run `npm run sync:extraction`.

- [ ] **Step 7: End-to-end check.**
  1. Write a realistic draft at `drafts/steamed-minced-pork.json`, using every field and wrapping it in a ```` ```json ```` fence.
  2. Run `npm run import:recipe -- drafts/steamed-minced-pork.json`. Expected: `✓ 已建立 recipes/home-style/steamed-minced-pork.md（draft）`.
  3. Run `npm run check:recipes`. Expected: a `⚠ … draft` line, then `✓`.
  4. Run `npm run build`. Expected: success, with no `steamed-minced-pork` in `build/`.
  5. Run `npm start` and check that the page shows with its 參考影片 credit.
  6. Delete the generated recipe. Don't commit sample content.

- [ ] **Step 8: Commit.**

```bash
git add scripts/import-recipe.mjs scripts/import-recipe.test.mjs package.json .gitignore README.md
git commit -m "feat: add import:recipe CLI for Gemini video extractions"
```
