const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function imageResultUrl(');
const end = html.indexOf('async function genImage(', start);
const ctx = vm.createContext({ URL: { createObjectURL: () => 'blob:generated' } });
vm.runInContext(html.slice(start, end), ctx);

test('image response parser accepts standard and wrapped proxy formats', () => {
  for (const payload of [
    { data: [{ url: 'https://img.example/a.png' }] },
    { data: [{ b64_json: 'abc' }] },
    { images: ['https://img.example/b.png'] },
    { output: [{ image_url: { url: 'https://img.example/c.png' } }] },
    { result: { src: 'https://img.example/d.png' } }
  ]) {
    assert.match(ctx.imageResultUrl(payload), /^(https:\/\/|data:image\/)/);
  }
});

test('image response parser ignores malformed non-image values', () => {
  assert.equal(ctx.imageResultUrl({ data: [{ url: 'not-a-url' }] }), null);
  assert.equal(ctx.imageResultUrl({ error: { message: 'upstream failed' } }), null);
  assert.equal(ctx.imageResultUrl('not-a-url'), null);
});

test('binary image responses become object URLs', async () => {
  const response = { headers: { get: () => 'image/png' }, blob: async () => ({}) };
  assert.equal(await ctx.imageResponseUrl(response), 'blob:generated');
});
