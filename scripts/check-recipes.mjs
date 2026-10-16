// Checks every recipe in recipes/ for the agreed frontmatter and section format.
// Usage: node scripts/check-recipes.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import matter from 'gray-matter';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_FIELDS = ['title', 'description', 'servings', 'prep_time', 'cook_time', 'difficulty'];
const DIFFICULTIES = ['易', '中', '難'];
const SECTION_ORDER = ['材料', '調味料', '做法', '小貼士'];
const REQUIRED_SECTIONS = ['材料', '做法'];
const ASCII_PATH = /^[a-z0-9-]+(\/[a-z0-9-]+)*\.mdx?$/;
const ASCII_SLUG = /^\/?[a-z0-9-]+(\/[a-z0-9-]+)*$/;

function checkPath(relPath) {
  return ASCII_PATH.test(relPath)
    ? []
    : [`${relPath}: 檔名同資料夾名只可以用細楷英文字母、數字同 "-"（例如 fan-qie-chao-dan.md）`];
}

export function checkRecipe(relPath, source) {
  const errors = checkPath(relPath);
  const where = relPath;

  const {data, content} = matter(source);

  for (const field of ['slug', 'id']) {
    if (data[field] !== undefined && !ASCII_SLUG.test(String(data[field]))) {
      errors.push(`${where}: frontmatter "${field}" 只可以用細楷英文字母、數字、"-" 同 "/"`);
    }
  }

  for (const field of REQUIRED_FIELDS) {
    if (data[field] === undefined || data[field] === null || String(data[field]).trim() === '') {
      errors.push(`${where}: 缺少 frontmatter 欄位 "${field}"`);
    }
  }
  if (data.difficulty !== undefined && !DIFFICULTIES.includes(data.difficulty)) {
    errors.push(`${where}: difficulty 必須係 ${DIFFICULTIES.join(' / ')} 其中之一，而家係 "${data.difficulty}"`);
  }

  const lines = content.split('\n');
  const headings = [];
  lines.forEach((line, index) => {
    const match = /^## (.+?)\s*$/.exec(line);
    if (match) headings.push({name: match[1], index});
  });

  for (const section of REQUIRED_SECTIONS) {
    if (!headings.some((h) => h.name === section)) {
      errors.push(`${where}: 缺少 "## ${section}" 段落`);
    }
  }

  const known = headings.map((h) => SECTION_ORDER.indexOf(h.name)).filter((i) => i !== -1);
  if (known.some((value, i) => i > 0 && value <= known[i - 1])) {
    errors.push(`${where}: 段落次序要係 ${SECTION_ORDER.map((s) => `## ${s}`).join(' → ')}`);
  }

  const method = headings.find((h) => h.name === '做法');
  if (method) {
    const firstLine = lines.slice(method.index + 1).find((line) => line.trim() !== '');
    if (!firstLine || !/^\d+\. /.test(firstLine)) {
      errors.push(`${where}: "## 做法" 要用數字列出步驟（1. 2. 3. …）`);
    }
  }

  return errors;
}

export function checkCategory(relPath, source) {
  const {link} = JSON.parse(source);
  if (link?.type === 'generated-index' && !ASCII_SLUG.test(String(link.slug ?? ''))) {
    return [`${relPath}: generated-index 一定要設定英文 link.slug（例如 "/category/jia-chang"），否則網址會變成中文亂碼`];
  }
  return [];
}

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full, base);
    return [path.relative(base, full).split(path.sep).join('/')];
  });
}

export function checkAll(rootDir = 'recipes') {
  const root = path.resolve(REPO_ROOT, rootDir);
  const read = (relPath) => fs.readFileSync(path.join(root, relPath), 'utf8');
  return listFiles(root).flatMap((relPath) => {
    const name = path.posix.basename(relPath);
    if (name === '_category_.json') return checkCategory(relPath, read(relPath));
    if (!/\.mdx?$/.test(name)) return [];
    // Index pages aren't recipes, but their URL still comes from the path.
    if (name === 'index.md') return checkPath(relPath);
    return checkRecipe(relPath, read(relPath));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkAll();
  for (const error of errors) console.error(`✗ ${error}`);
  if (errors.length > 0) process.exit(1);
  console.log('✓ 所有食譜格式正確');
}
