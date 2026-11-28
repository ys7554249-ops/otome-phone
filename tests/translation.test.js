const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function setup(fetch) {
  const node = () => ({ textContent: '', style: {}, children: [], appendChild(child) { this.children.push(child); } });
  const ctx = vm.createContext({ fetch, AbortController, setTimeout, clearTimeout, ce: node, askAI() { throw new Error('Paid API must never be called'); } });
  vm.runInContext(html.slice(html.indexOf('async function translateText('), html.indexOf('function showTranslateModal(')), ctx);
  return { ctx, node };
}
test('Chinese prompts remain unchanged without requests', async () => {
  const { ctx } = setup(() => { throw new Error('Unexpected request'); });
  assert.equal(await ctx.translateText('少女，花朵，soft light', '中文'), '少女，花朵，soft light');
});
test('explicit Chinese to English uses correct source language', async () => {
  const { ctx } = setup(async url => {
    assert.match(url, /langpair=zh\|en/);
    return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: 'flowers' } }) };
  });
  assert.equal(await ctx.translateText('花朵', '英文'), 'flowers');
});
test('quota and network failures reject without paid fallback', async () => {
  for (const fetch of [async () => { throw new Error('offline'); }, async () => ({ ok: true, json: async () => ({ responseStatus: 429, responseData: { translatedText: 'quota exceeded' } }) })]) {
    const { ctx } = setup(fetch);
    await assert.rejects(ctx.translateText('flowers', '中文'));
  }
});
test('prompt rendering requests translation only on click and preserves original', async () => {
  let calls = 0;
  const { ctx, node } = setup(async () => { calls++; throw new Error('offline'); });
  const el = node();
  ctx.renderImagePrompt(el, 'flowers');
  assert.equal(calls, 0);
  await el.children[0].onclick();
  assert.equal(calls, 1);
  assert.equal(el.textContent, 'flowers');
  assert.equal(el.children[0].disabled, false);
  assert.match(el.children[1].textContent, /原文已保留/);
  const chinese = node();
  ctx.renderImagePrompt(chinese, '花朵');
  assert.equal(chinese.children.length, 0);
});
