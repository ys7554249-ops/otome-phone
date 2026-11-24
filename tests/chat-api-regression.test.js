const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const markerStart = html.indexOf(marker);
  assert.notEqual(markerStart, -1, `${name} exists`);
  const start = html.slice(Math.max(0, markerStart - 10), markerStart).includes('async ')
    ? html.lastIndexOf('async ', markerStart)
    : markerStart;
  const open = html.indexOf('{', start + marker.length);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth++;
    if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

const source = [
  html.slice(html.indexOf('function _usageDay('), html.indexOf('// ===== 前缀缓存命中统计 =====')),
  extractFunction('_reportCache'),
  extractFunction('_apiTemperature'),
  extractFunction('_toClaudeMessages'),
  extractFunction('callLLM'),
  extractFunction('openChatApiEditor'),
  'window._cacheLog = window._cacheLog || [];',
  'window.cacheStats = function(){' + html.split('window.cacheStats = function(){')[1].split('\n\nasync function callLLM')[0]
].join('\n');

function makeContext(extra = {}) {
  const saved = new Map();
  const context = {
    AbortController,
    clearTimeout,
    console: { log() {}, table() {}, warn() {}, error() {} },
    fetch: async () => { throw new Error('fetch stub was not configured'); },
    setTimeout,
    TextDecoder,
    store: { get: (key, fallback) => saved.get(key) ?? fallback, set: (key, value) => saved.set(key, jsonClone(value)) },
    window: {},
    ...extra
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('usage totals distinguish an explicit miss, missing metadata and Claude cache writes', () => {
  const context = makeContext();
  const day = new Date(2026, 10, 24);
  context._recordModelUsage({ prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 0 } }, 'openai', 'chat', day);
  context._recordModelUsage({ prompt_tokens: 50, completion_tokens: 6, prompt_cache_hit_tokens: 20 }, 'deepseek', 'chat', day);
  context._recordModelUsage({ input_tokens: 10, cache_read_input_tokens: 25, cache_creation_input_tokens: 15, output_tokens: 7 }, 'claude', 'chat', day);
  context._recordModelUsage({ prompt_tokens: 90, completion_tokens: 2 }, 'no-cache-data', 'chat', day);
  context._recordModelUsage(null, 'no-usage-data', 'chat', day);
  context._recordModelUsage({ total_tokens: 30 }, 'embedding', 'embedding', new Date(2026, 10, 18));
  context._recordModelUsage({ total_tokens: 40 }, 'embedding', 'embedding', new Date(2026, 10, 17));
  const data = context.store.get('modelUsageByDay');
  const today = jsonClone(context._modelUsageSummary(data, 1, day));
  assert.deepEqual(today.totals, { requests: 5, reported: 4, input: 290, output: 20, total: 310, inputMissing: 0, outputMissing: 0, cacheReported: 3, cacheInput: 200, cacheHit: 45 });
  assert.equal(today.models.find(m => m.model === 'openai').cacheReported, 1);
  assert.equal(today.models.find(m => m.model === 'no-usage-data').reported, 0);
  assert.equal(context._modelUsageSummary(data, 7, day).totals.total, 340);
  assert.equal(context._modelUsageSummary(data, 0, day).totals.total, 380);
});

test('usage preserves partial splits and derives missing counts from compatible totals', () => {
  const context = makeContext();
  context._recordModelUsage({ total_tokens: 100 }, 'total-only');
  context._recordModelUsage({ prompt_tokens: 40, total_tokens: 47 }, 'input-and-total');
  context._recordModelUsage({ output_tokens: 9, total_tokens: 79 }, 'output-and-total');
  context._recordModelUsage({ prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 30, completion_tokens: 5 }, 'cache-split');
  context._recordModelUsage({ prompt_tokens: 12, total_tokens: 10 }, 'inconsistent');
  context._recordModelUsage({ prompt_tokens: 0, completion_tokens: 1, prompt_cache_hit_tokens: 0 }, 'empty-input');
  const { totals, models } = context._modelUsageSummary(context.store.get('modelUsageByDay'), 0);
  const byName = Object.fromEntries(models.map(row => [row.model, row]));
  assert.equal(totals.inputMissing, 1);
  assert.equal(totals.outputMissing, 2);
  assert.equal(byName['total-only'].total, 100);
  assert.equal(byName['input-and-total'].output, 7);
  assert.equal(byName['output-and-total'].input, 70);
  assert.equal(byName['inconsistent'].outputMissing, 1);
  assert.equal(totals.cacheReported, 1);
  assert.equal(totals.cacheInput, 30);
  assert.equal(totals.cacheHit, 0);
});

test('streaming usage arriving after finish_reason is counted once', async () => {
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":null}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":null}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":80,"completion_tokens":5,"total_tokens":85,"prompt_tokens_details":{"cached_tokens":40}}}\n\n',
    'data: [DONE]\n\n',
  ];
  const context = makeContext({ fetch: async () => new Response(new ReadableStream({ start(controller) {
    chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } }) });
  const reply = await context.callLLM({ api: { provider: 'openai', baseUrl: 'https://api.example/v1', key: 'test-key', model: 'test-model' }, messages: [], stream: true });
  assert.equal(reply.text, 'hello');
  assert.equal(reply.inTokens, 80);
  const { totals } = context._modelUsageSummary(context.store.get('modelUsageByDay'), 0);
  assert.equal(totals.requests, 1);
  assert.equal(totals.total, 85);
  assert.equal(totals.cacheHit, 40);
});

function apiResponse(provider) {
  const body = provider === 'claude'
    ? { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 2, output_tokens: 1 } }
    : { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 2, completion_tokens: 1 } };
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(body)
  };
}

test('API temperature preserves zero through editor save and both request formats', async () => {
  const api = {
    id: 'api-1', name: 'Main', provider: 'openai', baseUrl: 'https://api.example/v1',
    key: 'test-key', model: 'test-model', temperature: 0
  };
  let savedApi;
  let modalHtml = '';
  const fields = {};
  const context = makeContext({
    apiList: [api],
    showModal(_title, renderModal) {
      renderModal({
        set innerHTML(value) { modalHtml = value; },
        querySelector(selector) {
          if (!fields[selector]) {
            const initialValue = selector === '#_catemp'
              ? modalHtml.match(/id="_catemp" value="([^"]*)"/)?.[1]
              : '';
            fields[selector] = { value: initialValue };
          }
          return fields[selector];
        }
      }, () => {});
    },
    saveApiList() { savedApi = context.apiList[0]; },
    render() {},
    escHtml: value => String(value),
    uid: () => 'new-api-id',
    testChatApi: async () => true
  });

  context.openChatApiEditor(api.id);
  assert.match(modalHtml, /id="_catemp" value="0"/);
  fields['#_casave'].onclick();
  assert.equal(savedApi.temperature, 0);

  assert.equal(context._apiTemperature(api.temperature), 0);
  assert.equal(context._apiTemperature('invalid'), 1);
  assert.equal(context._apiTemperature('0'), 0);

  for (const provider of ['openai', 'claude']) {
    let request;
    const requestApi = {
      ...api,
      provider,
      baseUrl: provider === 'claude' ? 'https://api.anthropic.com' : api.baseUrl,
      temperature: 0
    };
    context.fetch = async (url, options) => {
      request = { url, body: JSON.parse(options.body) };
      return apiResponse(provider);
    };
    const result = await context.callLLM({
      api: requestApi,
      messages: [{ role: 'user', content: 'hello' }],
      stream: false
    });
    assert.equal(result.ok, true);
    assert.equal(request.body.temperature, 0);
    assert.match(request.url, provider === 'claude' ? /\/v1\/messages$/ : /\/chat\/completions$/);
  }
});

test('Claude image conversion builds request blocks without mutating caller messages', async () => {
  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: 'Describe these' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
      { type: 'image_url', image_url: { url: 'https://images.example/photo.jpg' } },
      { type: 'image_url', image_url: { url: 'blob:local-image' } }
    ]
  }];
  const original = jsonClone(messages);
  let requestBody;
  const context = makeContext({
    fetch: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return apiResponse('claude');
    }
  });

  const result = await context.callLLM({
    api: {
      provider: 'claude', baseUrl: 'https://api.anthropic.com', key: 'test-key',
      model: 'claude-3-test', temperature: 0.4
    },
    messages,
    stream: false
  });

  assert.equal(result.ok, true);
  assert.deepEqual(jsonClone(requestBody.messages[0].content), [
    { type: 'text', text: 'Describe these' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
    { type: 'image', source: { type: 'url', url: 'https://images.example/photo.jpg' } },
    { type: 'image_url', image_url: { url: 'blob:local-image' } }
  ]);
  assert.deepEqual(messages, original);
});

test('cache statistics include Claude cache-read and cache-creation tokens in totals', () => {
  const context = makeContext();

  context._reportCache({
    input_tokens: 100,
    cache_read_input_tokens: 50,
    cache_creation_input_tokens: 25
  }, 100);
  context._reportCache({
    prompt_tokens: 200,
    prompt_tokens_details: { cached_tokens: 80 }
  }, 200);

  assert.deepEqual(jsonClone(context.window._cacheLog.map(({ hit, total, rate }) => ({ hit, total, rate }))), [
    { hit: 50, total: 175, rate: 29 },
    { hit: 80, total: 200, rate: 40 }
  ]);
  assert.deepEqual(jsonClone(context.window.cacheStats()), { hit: 130, total: 375 });
});
