# Video → recipe import workflow (design)

## Intent

Most new recipes will come from cooking videos (YouTube, etc.). Gemini can
watch a video and pull out the recipe. The aim is a repeatable path from
"I found a video" to "a reviewed recipe page on cook852". The site's rules
should be enforced by code: English slugs, known tags, section order, HK
Traditional Chinese wording. Remembering them is not enough.

## Goals

- One fixed extraction prompt and output schema, so every Gemini run gives the
  same shape of data.
- One command that turns that data into a valid `recipes/<category>/<slug>.md`.
- Nothing reaches the live site without a human check against the video.

## Non-goals

- No crawling and no bulk import of whole channels.
- No auto-publishing. Every recipe gets a human review and a manual commit.
- No AI images or step photos (for now).
- No source-video credit on the page in this version. The video URL is kept
  only in `drafts/` (the JSON and the review checklist).

## Anti-goals (failures even if it "works")

- Made-up amounts or steps. When a video says "some salt", the page must say
  `適量`. It must not invent "1 茶匙".
- Simplified Chinese or Mainland terms (土豆, 西红柿, 淀粉) on the site.
  The site uses 薯仔, 番茄 and 粟粉.
- Pinyin or Cantonese-romanized slugs or tags (see `CLAUDE.md`).
- Copying the creator's narration word for word. Steps are rewritten in our
  own words.

## Pipeline

```
video URL
   │  ① Extract: Gemini + extraction/prompt.md + extraction/recipe.schema.json
   ▼
drafts/<slug>.json             (gitignored; raw structured data + timestamps)
   │  ② Import: npm run import:recipe drafts/<slug>.json
   ▼
recipes/<category>/<slug>.md   (draft: true; hidden from production build)
drafts/<slug>.review.md        (checklist: uncertain fields + timestamps)
   │  ③ Review: npm start, watch the video at the flagged timestamps, edit
   ▼
remove `draft: true` → npm run check:recipes → npm run build
   │  ④ Publish: commit + push → existing GitHub Actions deploy
   ▼
live page
```

### ① Extract (Gemini)

The prompt and schema are committed to the repo, so results stay
reproducible and can be versioned:

- `extraction/prompt.md`: the instructions you give Gemini.
- `extraction/recipe.schema.json`: a JSON Schema for the output.

Use it either way. Both take the same prompt and schema:

- **Phase 1, manual (start here):** paste the prompt and the video URL into
  Gemini or AI Studio. In AI Studio, turn on "structured output" with the
  schema. Save the JSON to `drafts/<slug>.json`.
- **Phase 2, scripted (later, optional):** run
  `npm run extract:video -- <url>`. A small Node script calls the Gemini API
  with the YouTube URL as a `fileData` part and the schema as
  `responseSchema`, then writes `drafts/<slug>.json`. It needs
  `GEMINI_API_KEY` in the environment, which is never committed. Build it
  only once the manual flow feels right.

**Rules the prompt must state:**

1. Write in Traditional Chinese with Hong Kong home-cooking wording and
   ingredient names: 薯仔, 番茄, 粟粉, 生抽/老抽, 蠔油.
2. Use metric units (克, 毫升, 公升) or HK kitchen units (湯匙, 茶匙, 片, 粒,
   條). Keep amounts as short strings, e.g. `500 克` or `3 片`.
3. **Never guess amounts.** If the video doesn't say an amount, use
   `適量` and add an entry to `uncertain`.
4. Give each ingredient and step the video timestamp where it appears
   (`mm:ss`).
5. Rewrite the steps in short imperative sentences. Do not transcribe the
   narration.
6. Propose an English kebab-case `slug` (`steamed-minced-pork`, never
   `zheng-rou-bing`). Choose `category` and `tags` only from the allowed
   lists pasted into the prompt.
7. Put any new tag you would want in `suggested_new_tags`. Never put it in
   `tags`.

**Schema (shape):**

```json
{
  "source":   { "url": "", "title": "", "channel": "" },
  "slug": "steamed-minced-pork",
  "category": "home-style",
  "title": "", "description": "",
  "servings": 2, "prep_time": "10 分鐘", "cook_time": "15 分鐘",
  "difficulty": "易",
  "tags": ["home-style", "pork", "steamed"],
  "suggested_new_tags": [{ "key": "", "label": "" }],
  "ingredients": [{ "name": "", "amount": "", "note": "", "timestamp": "" }],
  "seasonings":  [{ "name": "", "amount": "", "note": "", "timestamp": "" }],
  "steps":       [{ "text": "", "timestamp": "" }],
  "tips": [""],
  "uncertain":   [{ "field": "", "issue": "", "timestamp": "" }]
}
```

`difficulty` is an enum of 易/中/難, and `category` and `tags` are enums.
`scripts/sync-extraction-enums.mjs` (or the import script with `--sync`)
regenerates those enums from `recipes/*/` and `recipes/tags.yml`, so the
schema never goes stale.

### ② Import (`scripts/import-recipe.mjs`, deterministic, no AI)

`npm run import:recipe drafts/<slug>.json` runs these steps:

1. **Validate** the JSON against the schema. Stop with clear errors on bad
   data.
2. **Check names.** The slug must match `^[a-z0-9-]+$`. The category folder
   must exist. Every tag must be a key in `tags.yml`. Print any
   `suggested_new_tags` for you to add by hand.
3. **Check wording** (warnings, not errors):
   - Flag Simplified-only characters with a small built-in list (这, 们,
     鸡, 汤, 盐 …).
   - Flag Mainland terms with a small map (土豆→薯仔, 西红柿/番茄 check,
     淀粉→粟粉, 酱油→生抽/老抽).
4. **Render** the Markdown in the template's layout: frontmatter, then
   `## 材料`, `## 調味料` (only if there are any), `## 做法` as a numbered
   list, and `## 小貼士` (only if there are any). Write ingredient lines as
   `- {name} {amount}（{note}）`. Add `draft: true` to the frontmatter
   (Docusaurus leaves it out of production builds, but `npm start` still
   shows it).
5. **Refuse to overwrite** an existing recipe unless `--force` is passed.
6. **Run `checkRecipe()`** from `check-recipes.mjs` on the output, so both
   paths share one rule set.
7. **Report search-dictionary gaps.** For each ingredient name not in
   `search/zh-user-dict.txt`, print the ready-to-paste line (`詞語 1000 n`).
   With `--add-dict`, append them.
8. **Write `drafts/<slug>.review.md`**: every `uncertain` item, plus the
   step and ingredient timestamps, as a checklist.

Timestamps stay in the draft and review files only. They never go on the
published page.

### ③ Review (human)

- Run `npm start` and open the draft page. Check the review checklist against
  the video.
- Taste and adjust: Gemini doesn't know if the salt is right.
- Remove `draft: true`, then run `npm run check:recipes` and `npm run build`.

### ④ Publish

There are no changes here. Commit and push to `main`, and the existing
Actions workflow tests and deploys.

## Site changes needed

- **`check-recipes.mjs`:** fail in CI if any recipe still has
  `draft: true`. (Optional. It stops you forgetting one, but it also blocks
  committing work-in-progress drafts. Builder's call: recommend making it a
  warning.)
- **`.gitignore`:** add `drafts/`.
- **`package.json`:** add the `import:recipe` script, and `extract:video`
  later in phase 2.
- **`README.md`:** a short "由影片新增食譜" section in Cantonese, matching the
  existing README voice.

## Decisions I made (no input from you yet)

- Gemini outputs **JSON, not Markdown**. Code renders the Markdown, so the
  format and naming rules can't drift.
- Do the **manual Gemini step first** and add the API script later. That
  avoids handling API keys until the prompt is proven.
- Use **Docusaurus `draft: true`** as the review gate. There's no separate
  staging folder.
- Keep `drafts/` out of git.

## Left to the builder

- The exact lists of Simplified characters and Mainland terms (start small,
  grow over time).
- The wording of the prompt itself, within the rules above.
- Tests: `node --test` for the import script (rendering, slug and tag
  rejection, overwrite refusal, dictionary gap detection), in the same style
  as `check-recipes.test.mjs`.
