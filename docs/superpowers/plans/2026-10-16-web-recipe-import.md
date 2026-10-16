# Webpage → Recipe Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a text-based recipe webpage into a draft recipe on this site. Fetch the page, have Gemini rewrite it as our JSON in HK home-style wording, then reuse the existing `import:recipe` step.

**Architecture:** A new `fetch:recipe` CLI downloads a page, or reads a saved `.html` file. It decodes the charset and pulls out any schema.org `Recipe` JSON-LD plus the readable page text. Then it writes one paste-ready packet, `drafts/page-<hash>.page.md`, containing the web prompt, the source URL and the page content. The user pastes the packet into Gemini (AI Studio, Structured output with the existing `extraction/recipe.schema.json`) and saves the output as `drafts/<slug>.json`. From there, the existing video flow runs unchanged: `npm run import:recipe`, review, then remove `draft: true`. An optional last task adds `extract:web`, which calls the Gemini API directly and skips the copy-paste.

**Tech Stack:** Node 22+ ESM scripts (local is v24), global `fetch`, `TextDecoder` (full ICU, so `big5` and `gbk` work), `gray-matter`, `node:test` + `node:assert/strict`.

**Spec:** None. The user skipped the design conversation. These decisions are the planner's calls and should be checked in review:
- Mirror the video flow: manual Gemini paste first, then the API as an optional extra (Task 5).
- Use one shared JSON schema and importer for video and web. Only the prompt differs.
- The prompt makes Gemini **rewrite in its own words**, so the page is not copied verbatim. That keeps the content "ours" and avoids reproducing someone else's text.
- No HTML-parsing dependency. Use regex/stream stripping, which is enough for LLM input because Gemini tolerates noise.

## Global Constraints

- Every slug, tag key, folder name and file name is lowercase ASCII `[a-z0-9-]`. No pinyin and no Cantonese romanization (`CLAUDE.md`). Packet files are named `page-<first 8 hex of sha1(url)>.page.md`, never after the page's own slug.
- All user-facing CLI text is in Cantonese Traditional Chinese, in the voice of `scripts/import-recipe.mjs`. Prefixes: `✗` for errors, `⚠` for warnings and `✓` for success.
- No new npm dependencies.
- Tests live in `scripts/*.test.mjs` and are named `function_condition_expectedOutcome`. Tests never hit the network. Inject `fetchImpl`.
- Source URLs never appear in `recipes/**`, only in `drafts/` (same rule as the video flow).
- `drafts/` stays gitignored. The API key is read from `GEMINI_API_KEY` (`.env.local`, already gitignored) and is never written to disk or logs.
- Page text sent to Gemini is capped at `MAX_PAGE_CHARS = 30000`.

## Review Focus

1. **The site blocks scripted fetches** (403/503, Cloudflare page, timeout). Expected: `✗` plus advice to save the page as HTML and re-run with `--html <file>`, with no stack trace. (Task 3)
2. **The page is Big5/GBK, not UTF-8** (older HK/TW/Mainland recipe sites). Expected: correct Chinese, not mojibake. Read the charset from `Content-Type` first, then `<meta charset>`, and fall back to UTF-8. (Task 2)
3. **JSON-LD is nested or messy:** `Recipe` inside `@graph`, in a top-level array, `@type: ["Recipe", "NewsArticle"]`, or a second `ld+json` block that is invalid JSON. Expected: the recipe is still found and the broken block is ignored. (Task 2)
4. **A huge page full of comments and "related recipes"** goes over the cap. Expected: the text is truncated at `MAX_PAGE_CHARS`, and the CLI prints a `⚠` saying so. (Tasks 2, 3)
5. **A web draft has no timestamps.** Expected: the review checklist leaves out the 材料／步驟時間點 sections instead of listing every line as `（—）`. (Task 4)

---

### Task 1: Web extraction prompt, kept in sync

**Files:**
- Create: `extraction/prompt-web.md`
- Modify: `scripts/sync-extraction.mjs`, `scripts/sync-extraction.test.mjs`, `extraction/recipe.schema.json` (descriptions only)

**Interfaces:**
- Produces: `PROMPT_PATHS = ['extraction/prompt.md', 'extraction/prompt-web.md']` in `sync-extraction.mjs`. `syncPrompt(text, vocab)` is unchanged. The CLI and `--check` loop over all prompt paths.
- Produces: the prompt body after the `---` line, which Task 3 reads. Everything after the first line that is exactly `---` is "the prompt".

- [ ] **Step 1: Write failing test.** Extend `committedExtractionFiles_matchRepoVocabulary` so it checks every entry in `PROMPT_PATHS`, and add:

```js
test('promptWeb_committed_hasVocabMarkersAndRewriteRule', () => {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'extraction/prompt-web.md'), 'utf8');
  assert.match(text, /<!-- vocab:start -->[\s\S]*<!-- vocab:end -->/);
  assert.match(text, /自己嘅說話/);
});
```

- [ ] **Step 2:** Run `npm test`. Expected: FAIL (the file is missing and `PROMPT_PATHS` is not exported).

- [ ] **Step 3: Write `extraction/prompt-web.md`.** Copy the structure of `extraction/prompt.md`, including the HTML comment saying how to use it, and change "影片" to "網頁". Rules that differ from the video prompt:
  1. Rewrite every step in your own words as short instructions. **Never copy sentences from the page.** Rewrite the description and tips too.
  2. If the page is Simplified Chinese or uses Mainland terms, convert to Traditional Chinese HK wording (same examples as rule 1 of the video prompt).
  3. Convert cups/oz/lb/°F to metric or HK kitchen units. Put the original amount in `note`.
  4. Use only the main recipe. Ignore ads, comments, "related recipes" and the author's life story. If there are several recipes, take the main one and add an `uncertain` entry.
  5. Leave every `timestamp` empty. Set `source.channel` to the site or author name.
  6. Don't guess amounts. Use `適量` plus an `uncertain` entry (same as the video prompt).
  - Keep the vocab markers, the slug rule and the `suggested_new_tags` rule word for word.
- [ ] **Step 4: Update the schema descriptions** in `recipe.schema.json`:
  - `source`: "The video or webpage this recipe comes from"
  - `source.url`: "Video or page URL"
  - `source.channel`: "Channel, website or author name"
  - each `timestamp`: "mm:ss in the video; empty for webpages"

  Export `PROMPT_PATHS` and loop over it in the CLI. Run `npm run sync:extraction`.
- [ ] **Step 5:** Run `npm test && npm run sync:extraction -- --check`. Expected: PASS and `✓ extraction/ 已同步`.
- [ ] **Step 6: Commit.** Run `git commit -m "feat: add webpage extraction prompt synced with vocabulary"`.

---

### Task 2: Page decoding and text extraction (pure functions)

**Files:**
- Create: `scripts/page-text.mjs`, `scripts/page-text.test.mjs`

**Interfaces:**
- Produces:
  - `MAX_PAGE_CHARS = 30000`
  - `decodeHtml(bytes: Uint8Array, contentType: string): string`: takes the charset from `contentType`, else from a `<meta charset>` or `http-equiv` found by sniffing the first 2048 bytes as latin1, else uses `utf-8`. An unknown label falls back to `utf-8`.
  - `findRecipeJsonLd(html: string): object | null`: checks every `<script type="application/ld+json">` block and skips any that fail `JSON.parse`. It walks arrays and `@graph`. A match is `@type === 'Recipe'` or an `@type` array that includes `'Recipe'`. Returns the first match.
  - `pageTitle(html: string): string`: the decoded `<title>` text, or `''`.
  - `htmlToText(html: string): {text: string, truncated: boolean}`
    - Removes `script`, `style`, `noscript`, `svg`, `nav`, `header`, `footer`, `aside`, `form` together with their content.
    - Turns `br` and closing `p|div|li|h1-6|tr` tags into `\n`, then strips all remaining tags.
    - Decodes `&amp; &lt; &gt; &quot; &#39; &nbsp;`, `&#NNN;` and `&#xHH;`.
    - Trims each line, collapses runs of blank lines to one, and drops lines that are empty after trimming.
    - Cuts the result at `MAX_PAGE_CHARS`.

- [ ] **Step 1: Write failing tests.**

```js
test('decodeHtml_big5ContentType_decodesChinese', () => {
  assert.equal(decodeHtml(new Uint8Array([0xbb, 0x5d]), 'text/html; charset=big5'), '蒸');
});
test('decodeHtml_metaCharsetGbk_decodesChinese', () => {
  const head = Buffer.from('<meta charset="gbk">', 'latin1');
  const out = decodeHtml(Buffer.concat([head, Buffer.from([0xd5, 0xf4])]), 'text/html');
  assert.ok(out.endsWith('蒸'));
});
test('decodeHtml_noCharset_defaultsUtf8', () => {
  assert.equal(decodeHtml(new TextEncoder().encode('蒸肉餅'), ''), '蒸肉餅');
});
test('findRecipeJsonLd_recipeInGraphAfterBrokenBlock_returnsRecipe', () => {
  const html = '<script type="application/ld+json">{oops</script>' +
    '<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":["Recipe","NewsArticle"],"name":"蒸肉餅"}]}</script>';
  assert.equal(findRecipeJsonLd(html).name, '蒸肉餅');
});
test('findRecipeJsonLd_topLevelArray_returnsRecipe', () => {
  const html = '<script type="application/ld+json">[{"@type":"Recipe","name":"x"}]</script>';
  assert.equal(findRecipeJsonLd(html).name, 'x');
});
test('findRecipeJsonLd_none_returnsNull', () => { assert.equal(findRecipeJsonLd('<p>hi</p>'), null); });
test('htmlToText_dropsScriptsAndNav_keepsBodyLines', () => {
  const {text} = htmlToText('<nav>選單</nav><script>x=1</script><h1>蒸肉餅</h1><p>豬肉 300 克</p><footer>版權</footer>');
  assert.equal(text, '蒸肉餅\n豬肉 300 克');
});
test('htmlToText_entities_decoded', () => {
  assert.equal(htmlToText('<p>鹽&amp;糖 &#33976; &#x84B8;&nbsp;!</p>').text, '鹽&糖 蒸 蒸 !');
});
test('htmlToText_overCap_truncatesAndFlags', () => {
  const r = htmlToText(`<p>${'字'.repeat(MAX_PAGE_CHARS + 10)}</p>`);
  assert.equal(r.text.length, MAX_PAGE_CHARS);
  assert.equal(r.truncated, true);
});
```

(The byte codes are verified in Node: 蒸 is `BB 5D` in Big5 and `D5 F4` in GBK.)

- [ ] **Step 2:** Run `npm test`. Expected: the new tests FAIL (the module is missing).
- [ ] **Step 3: Implement** `scripts/page-text.mjs` against the Interfaces above. Use only regex, with no DOM, and add a one-line header comment in the style of the other scripts.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** Run `git commit -m "feat: decode recipe webpages and extract JSON-LD and text"`.

---

### Task 3: `fetch:recipe` CLI and README

**Files:**
- Create: `scripts/fetch-recipe.mjs`, `scripts/fetch-recipe.test.mjs`
- Modify: `package.json` (add `"fetch:recipe": "node scripts/fetch-recipe.mjs"`), `README.md`

**Interfaces:**
- Consumes: everything in Task 2, and the web prompt body from Task 1.
- Produces:
  - `packetName(url: string): string`: returns `page-${sha1(url).slice(0, 8)}`.
  - `buildPacket({url, title, prompt, recipeJsonLd, text}): string`: returns Markdown with these parts, in order:
    1. the prompt body
    2. a blank line, then `來源網址：${url}` and `網頁標題：${title}`
    3. if `recipeJsonLd` is present: `## 結構化資料（JSON-LD）` and a fenced `json` block, pretty-printed
    4. `## 網頁內容` followed by `text`
  - `async fetchRecipePage(url, {htmlPath?, draftsDir, repoRoot, fetchImpl = fetch}): Promise<{packetPath: string, foundJsonLd: boolean, truncated: boolean, errors: string[]}>`:
    - Reads bytes from `htmlPath` if given. Otherwise it calls `fetchImpl(url, {headers: {'user-agent': <a normal desktop browser UA>}, signal: AbortSignal.timeout(15000)})`.
    - A non-2xx status, or any thrown error, becomes a single error string: `` `下載唔到 ${url}（${status 或 error.message}）：喺瀏覽器「另存網頁」做 .html，再用 --html <檔案> 重新執行` ``.
    - Writes `${draftsDir}/${packetName(url)}.page.md`, creating `draftsDir` if needed. If you re-run on the same URL, the file is overwritten.
- CLI: `npm run fetch:recipe -- <url> [--html <file>]`.
  - `--html` with no URL is an error, because the URL is needed for `source.url`.
  - On success it prints:
    - `✓ 已建立 <packet>`
    - `✓ 搵到結構化食譜資料` or `⚠ 網頁冇結構化食譜資料，靠 Gemini 由內文抽取`
    - `⚠ 網頁太長，已截短` when truncated
    - three next-step lines: paste into AI Studio with `extraction/recipe.schema.json` under Structured output → save as `drafts/<slug>.json` → `npm run import:recipe -- drafts/<slug>.json`

- [ ] **Step 1: Write failing tests.** Use a `mkdtemp` drafts dir and a fake `fetchImpl` that returns `new Response(bytes, {status, headers})`:
  - `fetchRecipePage_pageWithJsonLd_writesPacketWithPromptUrlAndJsonLd`: the packet contains `來源網址：https://example.com/r` and `## 結構化資料（JSON-LD）`, plus a line from `prompt-web.md`. The path ends with `page-<8 hex>.page.md`, and `foundJsonLd === true`.
  - `fetchRecipePage_http403_returnsHtmlAdviceAndWritesNothing`: errors match `/--html/`, and `draftsDir` stays empty.
  - `fetchRecipePage_fetchThrows_returnsHtmlAdvice`: `fetchImpl` rejects, and the errors match `/--html/`.
  - `fetchRecipePage_htmlPath_neverCallsFetch`: `fetchImpl` throws if called, and the result has no errors.
  - `packetName_sameUrl_isStableAsciiName`: matches `/^page-[0-9a-f]{8}$/` and is equal across two calls.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** `fetch-recipe.mjs` and the CLI block, following the `if (process.argv[1] && …)` pattern in `import-recipe.mjs`. Add the npm script.
- [ ] **Step 4: README.** Add a section `## 由網頁新增食譜` after the video section. It covers four steps: fetch → paste into Gemini → `import:recipe` → review against the original page. Mention `--html` for blocked sites, and say that the steps are rewritten, not copied.
- [ ] **Step 5:** Run `npm test`, then do a manual smoke check against a real public recipe page: `npm run fetch:recipe -- <url>`. Expected: a packet is created and its text is readable Chinese.
- [ ] **Step 6: Commit.** Run `git commit -m "feat: add fetch:recipe CLI to prepare webpage recipes for Gemini"`.

---

### Task 4: Review checklist for web drafts

**Files:**
- Modify: `scripts/import-recipe.mjs` (`renderReview`), `scripts/import-recipe.test.mjs`

**Interfaces:**
- `renderReview(draft)` keeps its signature. When no ingredient, seasoning, step or `uncertain` item has a non-empty `timestamp`:
  - It leaves out `## 材料時間點` and `## 步驟時間點`.
  - It adds `## 對照原網頁`, which has one item, `- [ ] 份量、步驟同原網頁一致（${source.url}）`.
  - `uncertain` lines drop the `（—）` suffix.
- Video drafts render exactly as before.

- [ ] **Step 1: Write failing tests.**
  - `renderReview_noTimestamps_omitsTimestampSectionsAndAddsSourceCheck`: a draft with every timestamp `''` and `source.url = 'https://example.com/r'`. The output does not match `/時間點/` or `/（—）/`, and it matches `/對照原網頁[\s\S]*example\.com\/r/`.
  - `renderReview_withTimestamps_unchanged`: the output of the existing `DRAFT` still contains `## 材料時間點` and `（00:30）`.
- [ ] **Step 2:** Run `npm test`. Expected: the first test FAILS.
- [ ] **Step 3: Implement.** The `import:recipe` CLI's last line currently says `對住影片改好`. Change it to `對住來源（影片或網頁）改好`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** Run `git commit -m "feat: web-friendly review checklist for drafts without timestamps"`.

---

### Task 5 (optional): `extract:web`, Gemini API without copy-paste

Do this only after Tasks 1–4 have been used on a few real pages and the prompt is settled.

**Files:**
- Create: `scripts/extract-web.mjs`, `scripts/extract-web.test.mjs`
- Modify: `package.json` (`"extract:web": "node --env-file-if-exists=.env.local scripts/extract-web.mjs"`), `README.md`

**Interfaces:**
- Consumes:
  - `fetchRecipePage` (Task 3)
  - `parseDraftText` and `validateDraft` from `import-recipe.mjs`
  - `loadVocabulary`
- Produces: `async extractWeb(url, {htmlPath?, repoRoot, apiKey, model, fetchImpl = fetch}): Promise<{draftPath: string, errors: string[]}>`:
  1. Builds the packet with `fetchRecipePage`.
  2. POSTs to `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`:
     - the key goes in the `x-goog-api-key` header, never in the URL
     - body: `{contents: [{parts: [{text: packet}]}], generationConfig: {responseMimeType: 'application/json', responseJsonSchema: <recipe.schema.json>}}`
  3. Reads `candidates[0].content.parts[0].text` and passes it to `parseDraftText`, then `validateDraft`.
  4. Writes `drafts/<slug>.json` even when validation fails, so the user can fix it by hand, and returns the validation errors.
- CLI: `npm run extract:web -- <url> [--html <file>] [--model <name>]`.
  - The model defaults to `process.env.GEMINI_MODEL`, else a current Flash model. **Check the current model name in the Gemini docs when implementing.**
  - A missing `GEMINI_API_KEY` gives `✗ 未設定 GEMINI_API_KEY（寫入 .env.local）`.
  - On success it prints the next step, `npm run import:recipe -- drafts/<slug>.json`.

- [ ] **Step 1: Write failing tests** with a fake `fetchImpl` that serves both the page and the API:
  - `extractWeb_validResponse_writesDraftJsonNamedBySlug`
  - `extractWeb_apiError_returnsErrorWithStatusAndNeverLogsKey`: an error string does not contain the key.
  - `extractWeb_invalidDraft_writesFileAndReturnsValidationErrors`
  - `extractWeb_sendsKeyInHeaderNotUrl`: assert on the captured request.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Then update the README: add an optional "一步到位" line under the web section.
- [ ] **Step 4:** Run `npm test`, then do one real run with a key in `.env.local`. Expected: `drafts/<slug>.json` imports cleanly.
- [ ] **Step 5: Commit.** Run `git commit -m "feat: add optional extract:web using the Gemini API"`.

---

## Finish

- [ ] Run `npm test && npm run check:recipes && npm run build`. Expected: all pass.
- [ ] End-to-end on one real page: fetch → Gemini → import → `npm start` shows the draft → review → remove `draft: true`.
