// Fetches a recipe webpage and writes a paste-ready packet for Gemini:
// the web prompt, the source URL, any Recipe JSON-LD and the page text.
// Usage: npm run fetch:recipe -- <url> [--html <saved page>]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodeHtml, findRecipeJsonLd, pageTitle, htmlToText} from './page-text.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROMPT_PATH = 'extraction/prompt-web.md';
// Bot checks often answer 200 with a near-empty page; a real recipe page has far more text.
const MIN_RECIPE_CHARS = 200;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export function packetName(url) {
  return `page-${crypto.createHash('sha1').update(url).digest('hex').slice(0, 8)}`;
}

// Everything after the first line that is exactly "---".
function promptBody(text) {
  const lines = text.split('\n');
  const separator = lines.findIndex((line) => line.trim() === '---');
  return lines.slice(separator + 1).join('\n').trim();
}

export function buildPacket({url, title, prompt, recipeJsonLd, text}) {
  const parts = [prompt, `來源網址：${url}\n網頁標題：${title}`];
  if (recipeJsonLd) {
    parts.push(`## 結構化資料（JSON-LD）\n\n\`\`\`json\n${JSON.stringify(recipeJsonLd, null, 2)}\n\`\`\``);
  }
  parts.push(`## 網頁內容\n\n${text}`);
  return `${parts.join('\n\n')}\n`;
}

async function download(url, fetchImpl) {
  const advice = '：喺瀏覽器「另存網頁」做 .html，再用 --html <檔案> 重新執行';
  try {
    const response = await fetchImpl(url, {
      headers: {'user-agent': USER_AGENT},
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return {error: `下載唔到 ${url}（HTTP ${response.status}）${advice}`};
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {bytes, contentType: response.headers.get('content-type') ?? ''};
  } catch (e) {
    return {error: `下載唔到 ${url}（${e.message}）${advice}`};
  }
}

export async function fetchRecipePage(
  url,
  {htmlPath, repoRoot = REPO_ROOT, draftsDir = path.join(repoRoot, 'drafts'), fetchImpl = fetch} = {},
) {
  const result = {packetPath: '', foundJsonLd: false, truncated: false, suspectBlocked: false, errors: []};
  let page;
  if (htmlPath) {
    try {
      page = {bytes: new Uint8Array(fs.readFileSync(htmlPath)), contentType: ''};
    } catch (e) {
      result.errors.push(`讀唔到 ${htmlPath}（${e.message}）`);
      return result;
    }
  } else {
    page = await download(url, fetchImpl);
    if (page.error) {
      result.errors.push(page.error);
      return result;
    }
  }

  const html = decodeHtml(page.bytes, page.contentType);
  const recipeJsonLd = findRecipeJsonLd(html);
  const {text, truncated} = htmlToText(html);
  const prompt = promptBody(fs.readFileSync(path.join(repoRoot, PROMPT_PATH), 'utf8'));

  fs.mkdirSync(draftsDir, {recursive: true});
  result.packetPath = path.join(draftsDir, `${packetName(url)}.page.md`);
  fs.writeFileSync(result.packetPath, buildPacket({url, title: pageTitle(html), prompt, recipeJsonLd, text}));
  result.foundJsonLd = recipeJsonLd !== null;
  result.truncated = truncated;
  result.suspectBlocked = !result.foundJsonLd && text.length < MIN_RECIPE_CHARS;
  return result;
}

// Returns null when the arguments don't make sense; the URL is required even
// with --html because it becomes source.url.
export function parseCliArgs(args) {
  const htmlIndex = args.indexOf('--html');
  const htmlPath = htmlIndex === -1 ? undefined : args[htmlIndex + 1];
  if (htmlIndex !== -1 && (!htmlPath || htmlPath.startsWith('--'))) return null;
  const url = args.find((a, i) => !a.startsWith('--') && (htmlIndex === -1 || i !== htmlIndex + 1));
  return url ? {url, htmlPath} : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cli = parseCliArgs(process.argv.slice(2));
  if (!cli) {
    console.error('✗ 用法：npm run fetch:recipe -- <網址> [--html <另存嘅網頁.html>]（用 --html 都要寫網址）');
    process.exit(1);
  }
  const {url, htmlPath} = cli;
  const result = await fetchRecipePage(url, {htmlPath: htmlPath && path.resolve(htmlPath)});

  for (const error of result.errors) console.error(`✗ ${error}`);
  if (result.errors.length > 0) process.exit(1);
  const packet = path.relative(process.cwd(), result.packetPath);
  console.log(`✓ 已建立 ${packet}`);
  if (result.foundJsonLd) console.log('✓ 搵到結構化食譜資料');
  else console.warn('⚠ 網頁冇結構化食譜資料，靠 Gemini 由內文抽取');
  if (result.suspectBlocked) {
    console.warn('⚠ 網頁內容好少，可能係驗證頁或者要登入：喺瀏覽器「另存網頁」做 .html，再用 --html <檔案> 重新執行');
  }
  if (result.truncated) console.warn('⚠ 網頁太長，已截短，記得對住原網頁檢查');
  console.log('下一步：');
  console.log(`  1. 開 Google AI Studio，Structured output 貼入 extraction/recipe.schema.json，再貼 ${packet} 全部內容`);
  console.log('  2. 將輸出存做 drafts/<slug>.json');
  console.log('  3. npm run import:recipe -- drafts/<slug>.json');
}
