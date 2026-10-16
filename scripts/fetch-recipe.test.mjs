import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fetchRecipePage, packetName, buildPacket, parseCliArgs} from './fetch-recipe.mjs';

const URL = 'https://example.com/r';
const PAGE =
  '<html><head><title>蒸肉餅</title>' +
  '<script type="application/ld+json">{"@type":"Recipe","name":"蒸肉餅"}</script></head>' +
  '<body><h1>蒸肉餅</h1><p>豬肉 300 克</p></body></html>';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cook852-fetch-'));
const respond = (body, status = 200, headers = {'content-type': 'text/html; charset=utf-8'}) => async () =>
  new Response(body, {status, headers});

test('packetName_sameUrl_isStableAsciiName', () => {
  assert.match(packetName(URL), /^page-[0-9a-f]{8}$/);
  assert.equal(packetName(URL), packetName(URL));
  assert.notEqual(packetName(URL), packetName(`${URL}2`));
});

test('buildPacket_noJsonLd_omitsJsonLdSection', () => {
  const out = buildPacket({url: URL, title: 't', prompt: 'P', recipeJsonLd: null, text: '內文'});
  assert.doesNotMatch(out, /JSON-LD/);
  assert.match(out, /^P\n\n來源網址：https:\/\/example\.com\/r\n網頁標題：t\n\n## 網頁內容\n\n內文\n$/);
});

test('fetchRecipePage_pageWithJsonLd_writesPacketWithPromptUrlAndJsonLd', async () => {
  const draftsDir = tmpDir();
  const result = await fetchRecipePage(URL, {draftsDir, fetchImpl: respond(PAGE)});
  assert.deepEqual(result.errors, []);
  assert.equal(result.foundJsonLd, true);
  assert.equal(result.truncated, false);
  assert.match(result.packetPath, /page-[0-9a-f]{8}\.page\.md$/);
  const packet = fs.readFileSync(result.packetPath, 'utf8');
  assert.match(packet, /來源網址：https:\/\/example\.com\/r/);
  assert.match(packet, /## 結構化資料（JSON-LD）/);
  assert.match(packet, /唔好照抄網頁嘅句子/);
  assert.doesNotMatch(packet, /點樣用/);
  assert.match(packet, /豬肉 300 克/);
});

test('fetchRecipePage_http403_returnsHtmlAdviceAndWritesNothing', async () => {
  const draftsDir = tmpDir();
  const result = await fetchRecipePage(URL, {draftsDir, fetchImpl: respond('blocked', 403)});
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /403/);
  assert.match(result.errors[0], /--html/);
  assert.deepEqual(fs.readdirSync(draftsDir), []);
});

test('fetchRecipePage_fetchThrows_returnsHtmlAdvice', async () => {
  const fetchImpl = async () => {
    throw new Error('getaddrinfo ENOTFOUND');
  };
  const result = await fetchRecipePage(URL, {draftsDir: tmpDir(), fetchImpl});
  assert.match(result.errors[0], /ENOTFOUND/);
  assert.match(result.errors[0], /--html/);
});

test('fetchRecipePage_htmlPath_neverCallsFetch', async () => {
  const dir = tmpDir();
  const htmlPath = path.join(dir, 'saved.html');
  fs.writeFileSync(htmlPath, PAGE);
  const fetchImpl = async () => {
    throw new Error('should not fetch');
  };
  const result = await fetchRecipePage(URL, {htmlPath, draftsDir: path.join(dir, 'drafts'), fetchImpl});
  assert.deepEqual(result.errors, []);
  assert.ok(fs.existsSync(result.packetPath));
});

test('fetchRecipePage_missingHtmlFile_returnsError', async () => {
  const result = await fetchRecipePage(URL, {htmlPath: '/nonexistent/x.html', draftsDir: tmpDir()});
  assert.equal(result.errors.length, 1);
});

test('parseCliArgs_urlOnly_returnsUrl', () => {
  assert.deepEqual(parseCliArgs([URL]), {url: URL, htmlPath: undefined});
});

test('parseCliArgs_htmlBeforeUrl_returnsBoth', () => {
  assert.deepEqual(parseCliArgs(['--html', 'a.html', URL]), {url: URL, htmlPath: 'a.html'});
});

test('parseCliArgs_htmlWithoutUrl_returnsNull', () => {
  assert.equal(parseCliArgs(['--html', 'a.html']), null);
  assert.equal(parseCliArgs([URL, '--html']), null);
});

test('fetchRecipePage_tinyPageWithoutJsonLd_flagsSuspectedBlock', async () => {
  const captcha = '<html><title>滑动验证</title><body><p>请滑动完成验证</p></body></html>';
  const result = await fetchRecipePage(URL, {draftsDir: tmpDir(), fetchImpl: respond(captcha)});
  assert.equal(result.suspectBlocked, true);
});

test('fetchRecipePage_normalRecipePage_notFlaggedBlocked', async () => {
  const result = await fetchRecipePage(URL, {draftsDir: tmpDir(), fetchImpl: respond(PAGE)});
  assert.equal(result.suspectBlocked, false);
});
