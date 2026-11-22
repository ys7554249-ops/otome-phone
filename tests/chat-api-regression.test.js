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
  extractFunction('_reportCache'),
  extractFunction('_apiTemperature'),
  extractFunction('_toClaudeMessages'),
  extractFunction('callLLM'),
  extractFunction('openChatApiEditor'),
  'window._cacheLog = window._cacheLog || [];',
  'window.cacheStats = function(){' + html.split('window.cacheStats = function(){')[1].split('\n\nasync function callLLM')[0]
].join('\n');

function makeContext(extra = {}) {
  const context = {
    AbortController,
    clearTimeout,
    console: { log() {}, table() {}, warn() {}, error() {} },
    fetch: async () => { throw new Error('fetch stub was not configured'); },
    setTimeout,
    store: { get: (_key, fallback) => fallback },
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
