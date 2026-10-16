// Turns a recipe webpage into text Gemini can read: decodes the charset,
// finds schema.org Recipe JSON-LD and strips the HTML down to plain lines.
// Regex only on purpose: Gemini copes with a little leftover noise.

export const MAX_PAGE_CHARS = 30000;

// <header> is kept: blog posts often put the recipe title in an article header.
const DROPPED_ELEMENTS = ['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'nav', 'footer', 'aside', 'form'];
const NAMED_ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};

function charsetOf(text) {
  return /charset\s*=\s*["']?([\w-]+)/i.exec(text)?.[1];
}

export function decodeHtml(bytes, contentType) {
  const head = Buffer.from(bytes.subarray(0, 2048)).toString('latin1');
  const label = charsetOf(contentType ?? '') ?? charsetOf(head) ?? 'utf-8';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

const isRecipe = (node) => {
  const type = node?.['@type'];
  return type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'));
};

function findRecipe(node) {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipe(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object' || node === null) return null;
  if (isRecipe(node)) return node;
  return node['@graph'] ? findRecipe(node['@graph']) : null;
}

export function findRecipeJsonLd(html) {
  const blocks = html.matchAll(/<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, json] of blocks) {
    let data;
    try {
      data = JSON.parse(json);
    } catch {
      continue;
    }
    const recipe = findRecipe(data);
    if (recipe) return recipe;
  }
  return null;
}

export function pageTitle(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? decodeEntities(match[1]).replace(/\s+/g, ' ').trim() : '';
}

export function htmlToText(html) {
  let text = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const tag of DROPPED_ELEMENTS) {
    text = text.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'gi'), '\n');
  }
  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|ul|ol|table|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  const lines = decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean);
  const joined = lines.join('\n');
  const truncated = joined.length > MAX_PAGE_CHARS;
  return {text: truncated ? joined.slice(0, MAX_PAGE_CHARS) : joined, truncated};
}
