# cook852.github.io

香港家常中菜食譜網站，用 [Docusaurus](https://docusaurus.io/) 建立，網址：<https://cook852.github.io/>

## 本機運行

需要 Node.js 22 或以上。

```bash
npm install
npm start          # 開發模式，http://localhost:3000
npm run build      # 建立正式版本
npm run serve      # 預覽正式版本（搜尋功能只喺呢度先用到）
```

## 新增食譜

1. 複製 `templates/recipe-template.md` 去 `recipes/` 入面啱嘅分類資料夾，例如 `recipes/jia-chang/`。
2. **檔名只可以用細楷英文、數字同 `-`**（例如 `ma-po-dou-fu.md`），中文菜名寫喺 `title`。
3. 填好 frontmatter（`title`、`description`、`servings`、`prep_time`、`cook_time`、`difficulty`，份量／時間／難度會自動顯示喺標題下面）同段落：
   `## 材料` → `## 調味料`（可選）→ `## 做法`（用 1. 2. 3. 列步驟）→ `## 小貼士`（可選）。
4. `tags` 只可以用 `recipes/tags.yml` 入面已有嘅 key；要新標籤就先喺 `tags.yml` 加。
5. 執行 `npm run check:recipes` 檢查格式，再 `npm run build` 確認冇壞連結。

### 搜尋字詞

搜尋用嘅中文分詞字典係簡體，所以繁體詞語（例如「雞蛋」、「蘿蔔」）要加入 `search/zh-user-dict.txt`（每行：`詞語 1000 n`），否則兩個字嘅搜尋可能搵唔到。

## 新增分類

1. 喺 `recipes/` 開新資料夾（英文檔名），加 `_category_.json`，參考 `recipes/jia-chang/_category_.json`，記得設定 `link.slug`。
2. 喺 `src/components/CategoryGrid/index.tsx` 嘅 `CATEGORIES` 加一行，首頁先會顯示。

## 部署

每次 push 去 `main`，GitHub Actions（`.github/workflows/deploy.yml`）會自動測試、建立同部署到 GitHub Pages。

第一次需要喺 GitHub repo **Settings → Pages → Build and deployment → Source** 揀 **GitHub Actions**。
