// Copies the allowed categories and tags into the Gemini prompt and schema,
// so extraction can only pick names the site already has.
// Usage: node scripts/sync-extraction.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import matter from 'gray-matter';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = 'extraction/recipe.schema.json';
const PROMPT_PATH = 'extraction/prompt.md';
const START = '<!-- vocab:start -->';
const END = '<!-- vocab:end -->';

export function loadVocabulary(repoRoot = REPO_ROOT) {
  const recipes = path.join(repoRoot, 'recipes');
  const categories = fs
    .readdirSync(recipes, {withFileTypes: true})
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(recipes, entry.name, '_category_.json')))
    .map((entry) => entry.name)
    .sort();
  const tags = Object.keys(matter.engines.yaml.parse(fs.readFileSync(path.join(recipes, 'tags.yml'), 'utf8')) ?? {});
  return {categories, tags};
}

export function syncSchema(schema, vocab) {
  const out = structuredClone(schema);
  out.properties.category.enum = vocab.categories;
  out.properties.tags.items.enum = vocab.tags;
  return out;
}

export function syncPrompt(text, vocab) {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${PROMPT_PATH} 要有 "${START}" 同 "${END}" 標記`);
  }
  const block = [
    `分類（category）只可以揀：${vocab.categories.join(', ')}`,
    `標籤（tags）只可以揀：${vocab.tags.join(', ')}`,
  ].join('\n');
  return `${text.slice(0, start)}${START}\n${block}\n${text.slice(end)}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const vocab = loadVocabulary();
  const schemaFile = path.join(REPO_ROOT, SCHEMA_PATH);
  const promptFile = path.join(REPO_ROOT, PROMPT_PATH);
  const schemaText = fs.readFileSync(schemaFile, 'utf8');
  const promptText = fs.readFileSync(promptFile, 'utf8');
  const newSchema = JSON.stringify(syncSchema(JSON.parse(schemaText), vocab), null, 2) + '\n';
  const newPrompt = syncPrompt(promptText, vocab);

  if (process.argv.includes('--check')) {
    if (newSchema !== schemaText || newPrompt !== promptText) {
      console.error('✗ extraction/ 同 recipes/ 唔同步，請執行 npm run sync:extraction');
      process.exit(1);
    }
    console.log('✓ extraction/ 已同步');
  } else {
    fs.writeFileSync(schemaFile, newSchema);
    fs.writeFileSync(promptFile, newPrompt);
    console.log(`✓ 已更新 ${SCHEMA_PATH} 同 ${PROMPT_PATH}`);
  }
}
