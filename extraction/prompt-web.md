<!--
點樣用：
1. 執行 npm run fetch:recipe -- <網址>，會喺 drafts/ 整一個 page-xxxxxxxx.page.md，入面已經有呢份指示同網頁內容。
2. 開 Google AI Studio（或者 Gemini），喺 Run settings 開 Structured output，貼入 extraction/recipe.schema.json。
3. 貼 page.md 嘅全部內容。
4. 將輸出嘅 JSON 存做 drafts/<slug>.json，然後執行 npm run import:recipe -- drafts/<slug>.json。
分類同標籤清單由 npm run sync:extraction 自動更新，唔好手改。
-->

---

你係一個香港家常菜編輯。請睇晒下面嘅食譜網頁內容，將入面嘅食譜整理成 JSON。

規則：

1. 用繁體中文，用香港家常煮食嘅講法同食材名，例如薯仔（唔係土豆）、番茄（唔係西紅柿）、粟粉（唔係澱粉）、生抽／老抽（唔係醬油）、蠔油。網頁係簡體字或者用大陸用語，都要轉做香港講法。
2. 份量用公制（克、毫升、公升）或者香港廚房單位（湯匙、茶匙、片、粒、條）。`amount` 寫短字串，例如「500 克」、「3 片」。網頁用杯、安士、磅、華氏，就換算做公制，原本份量寫入 `note`。
3. **唔好估份量。** 網頁冇講份量就寫「適量」，並喺 `uncertain` 加一項講明。睇唔明、前後矛盾嘅嘢都要加入 `uncertain`。
4. 每個步驟、`description` 同小貼士都要用自己嘅說話改寫成簡短嘅指示句，**唔好照抄網頁嘅句子**。
5. 只抽主食譜。唔理廣告、留言、「相關食譜」同作者嘅生活故事。網頁有幾個食譜，就揀主要嗰個，並喺 `uncertain` 講明。
6. 所有 `timestamp` 留空。`source.url` 寫來源網址，`source.title` 寫網頁標題，`source.channel` 寫網站或者作者名。
7. `slug` 用英文細楷加 `-`，例如 `steamed-minced-pork`。唔可以用普通話拼音（例如 `zheng-rou-bing`），亦唔可以用粵語拼音。`category` 同 `tags` 只可以喺下面清單揀。
8. 想用但清單冇嘅標籤，放入 `suggested_new_tags`（`key` 用英文），**唔好**放入 `tags`。

<!-- vocab:start -->
分類（category）只可以揀：dessert, dim-sum, home-style, rice-and-noodles, soup
標籤（tags）只可以揀：home-style, egg, quick, steamed, soup, pork
<!-- vocab:end -->

只輸出符合 schema 嘅 JSON，唔好加任何解釋。
