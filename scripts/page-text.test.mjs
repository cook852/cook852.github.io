import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MAX_PAGE_CHARS, decodeHtml, findRecipeJsonLd, pageTitle, htmlToText} from './page-text.mjs';

const ldJson = (json) => `<script type="application/ld+json">${json}</script>`;

test('decodeHtml_big5ContentType_decodesChinese', () => {
  assert.equal(decodeHtml(new Uint8Array([0xbb, 0x5d]), 'text/html; charset=big5'), '蒸');
});

test('decodeHtml_metaCharsetGbk_decodesChinese', () => {
  const head = Buffer.from('<meta charset="gbk">', 'latin1');
  const out = decodeHtml(Buffer.concat([head, Buffer.from([0xd5, 0xf4])]), 'text/html');
  assert.ok(out.endsWith('蒸'));
});

test('decodeHtml_httpEquivBig5_decodesChinese', () => {
  const head = Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=Big5">', 'latin1');
  assert.ok(decodeHtml(Buffer.concat([head, Buffer.from([0xbb, 0x5d])]), '').endsWith('蒸'));
});

test('decodeHtml_noCharset_defaultsUtf8', () => {
  assert.equal(decodeHtml(new TextEncoder().encode('蒸肉餅'), ''), '蒸肉餅');
});

test('decodeHtml_unknownCharset_fallsBackToUtf8', () => {
  assert.equal(decodeHtml(new TextEncoder().encode('蒸肉餅'), 'text/html; charset=nonsense'), '蒸肉餅');
});

test('findRecipeJsonLd_recipeInGraphAfterBrokenBlock_returnsRecipe', () => {
  const html =
    ldJson('{oops') + ldJson('{"@graph":[{"@type":"WebPage"},{"@type":["Recipe","NewsArticle"],"name":"蒸肉餅"}]}');
  assert.equal(findRecipeJsonLd(html).name, '蒸肉餅');
});

test('findRecipeJsonLd_topLevelArray_returnsRecipe', () => {
  assert.equal(findRecipeJsonLd(ldJson('[{"@type":"Recipe","name":"x"}]')).name, 'x');
});

test('findRecipeJsonLd_none_returnsNull', () => {
  assert.equal(findRecipeJsonLd('<p>hi</p>'), null);
});

test('pageTitle_entityInTitle_decoded', () => {
  assert.equal(pageTitle('<head><title> 蒸肉餅 &amp; 白飯 </title></head>'), '蒸肉餅 & 白飯');
});

test('pageTitle_noTitle_returnsEmpty', () => {
  assert.equal(pageTitle('<p>x</p>'), '');
});

test('htmlToText_dropsScriptsAndNav_keepsBodyLines', () => {
  const {text} = htmlToText('<nav>選單</nav><script>x=1</script><h1>蒸肉餅</h1><p>豬肉 300 克</p><footer>版權</footer>');
  assert.equal(text, '蒸肉餅\n豬肉 300 克');
});

test('htmlToText_entities_decoded', () => {
  assert.equal(htmlToText('<p>鹽&amp;糖 &#33976; &#x84B8;&nbsp;!</p>').text, '鹽&糖 蒸 蒸 !');
});

test('htmlToText_underCap_notTruncated', () => {
  assert.equal(htmlToText('<p>短</p>').truncated, false);
});

test('htmlToText_overCap_truncatesAndFlags', () => {
  const r = htmlToText(`<p>${'字'.repeat(MAX_PAGE_CHARS + 10)}</p>`);
  assert.equal(r.text.length, MAX_PAGE_CHARS);
  assert.equal(r.truncated, true);
});
