const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function between(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return html.slice(from, to);
}
const code = between('let globalMemory=', 'function refreshPlaceUnlocks(')
  + between('function _recentCheckup(', 'function liveCtx(')
  + between('window.getSmartChatReply =', '// 全局单例：监听互动卡片');

function harness(extra = {}) {
  const c = { id: 'c1', name: 'Lin', mood: '平静', status: '看书', offlineMode: true };
  const messages = new Map();
  const db = new Map();
  const notices = [];
  let id = 0;
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    charList: [c], activeCharId: c.id, currentQuote: null,
    store: { get: (_key, fallback) => fallback, set() {} },
    getMsgs: cid => messages.get(cid) || [],
    saveMsgs: (cid, history) => messages.set(cid, structuredClone(history)),
    saveCharList() {},
    uid: () => `id-${++id}`,
    embApi: {},
    setTimeout, clearTimeout,
    dataDB: { get: async key => db.get(key), set: async (key, value) => db.set(key, value) },
    getMemApi: () => ({ key: 'test', model: 'memory' }),
    getApi: () => ({ key: 'test', model: 'chat' }),
    askAIJson: async () => null,
    alert: text => notices.push(text),
    window: {}, worldBooks: [], styleBooks: [],
    _personaAvatarB64: async () => null,
    liveCtx: role => `live:${role.mood}/${role.status}`,
    sysPrompt: (_stable, role) => ctx.getMemoryPromptText(role.id),
    ...extra,
  };
  vm.runInNewContext(code, ctx);
  return { ctx, c, messages, db, notices };
}

test('manual extraction uses a surviving legacy turn and saves before optional table extraction finishes', async () => {
  let prompt;
  const { ctx, c, messages } = harness({
    callLLM: async options => {
      assert.equal(options.api.model, 'memory');
      prompt = options.messages[0].content;
      return { ok: true, text: '我们约好下周去看展。' };
    },
    askAIJson: () => new Promise(() => {}),
  });
  messages.set(c.id, [
    { from: 'system', isSystem: true, text: '已切换到线下' },
    { from: 'c', mode: 'offline', text: '下周去看展吧。[心情:兴奋]' },
    { from: 'u', replied: false, text: '未发送到模型' },
  ]);
  assert.equal(await ctx.autoSummarizeMemory(c.id, true), true);
  assert.match(prompt, /下周去看展吧/);
  assert.doesNotMatch(prompt, /兴奋|已切换到线下|未发送到模型/);
  assert.equal(ctx.getCharMemory(c.id).summary, '我们约好下周去看展。');
});

test('failed extraction preserves events and exposes the API reason', async () => {
  const { ctx, c, notices } = harness({ callLLM: async () => ({ ok: false, err: '模型不可用' }) });
  ctx.addMemoryEvent(c.id, '约好一起去看展', 'chat');
  assert.equal(await ctx.autoSummarizeMemory(c.id, true), false);
  assert.equal(ctx.getCharMemory(c.id).keyEvents.length, 1);
  assert.deepEqual(notices, ['模型不可用']);
});

test('a stale extraction cannot reintroduce a deleted conversation', async () => {
  let resolve;
  const { ctx, c } = harness({ callLLM: () => new Promise(r => { resolve = r; }) });
  const reply = { from: 'c', mode: 'offline', text: '桥边的争吵' };
  ctx.rememberChatTurn(c, [], [reply]);
  const pending = ctx.autoSummarizeMemory(c.id, true);
  ctx.removeChatMessages(c, [reply], [reply]);
  resolve({ ok: true, text: '桥边的争吵' });
  assert.equal(await pending, false);
  assert.equal(ctx.getCharMemory(c.id).summary, '');
  assert.equal(ctx.getCharMemory(c.id).keyEvents.length, 0);
});

test('extraction keeps new events pending and late table updates respect deletion', async () => {
  let finishSummary;
  let finishTable;
  const { ctx, c } = harness({
    callLLM: () => new Promise(resolve => { finishSummary = resolve; }),
    askAIJson: () => new Promise(resolve => { finishTable = resolve; }),
  });
  const reply = { from: 'c', mode: 'offline', text: '和好后重新约定见面' };
  ctx.rememberChatTurn(c, [], [reply]);
  const pending = ctx.autoSummarizeMemory(c.id, true);
  ctx.addMemoryEvent(c.id, '新的朋友圈', 'moments');
  finishSummary({ ok: true, text: '约好再次见面' });
  assert.equal(await pending, true);
  const mem = ctx.getCharMemory(c.id);
  assert.deepEqual(Array.from(mem.keyEvents, e => Boolean(e.summarized)), [true, false]);

  ctx.removeChatMessages(c, [reply], [reply]);
  finishTable({ promise: [{ k: '再见面', v: '周五' }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(mem.memoryTable.promise.length, 0);
  assert.equal(mem.keyEvents[0].text, '新的朋友圈');
});

test('deletion unwinds state, removes only the linked duplicate turn and invalidates generated memory', async () => {
  const { ctx, c, messages, db } = harness();
  const old = { from: 'c', mode: 'online', text: '这句重复的话' };
  const removed = { from: 'c', mode: 'offline', text: old.text };
  const deletedUser = { from: 'u', mode: 'offline', text: '桥边的争吵', replied: true };
  const quoted = { from: 'u', mode: 'online', text: '继续', quote: { text: deletedUser.text } };
  ctx.recordChatState(c, old, { mood: '期待', status: '等车' });
  ctx.rememberChatTurn(c, [], [old]);
  ctx.recordChatState(c, removed, { mood: '生气', status: '争执', storyTimeline: '三年后' });
  ctx.rememberChatTurn(c, [deletedUser], [removed]);
  const mem = ctx.getCharMemory(c.id);
  const [keptEvent, droppedEvent] = mem.keyEvents;
  db.set('_vec_c1', [keptEvent, droppedEvent].map(e => ({ ...e, emb: [1, 0] })));
  ctx.getEmbedding = async () => [1, 0];
  mem.summary = '自动摘要：桥边的争吵';
  mem.manualSummary = '用户手写的设定';
  mem.lastSummaryTime = Date.now();
  mem.memoryTable.promise = [{ k: '旧约定', v: '手写', manual: true }, { k: '新约定', v: '自动档案' }];
  ctx.removeChatMessages(c, [old, deletedUser, removed, quoted], [deletedUser, removed]);

  assert.deepEqual([c.mood, c.status, c.storyTimeline], ['期待', '等车', '']);
  assert.equal(messages.get(c.id)[0]._memoryId, old._memoryId);
  assert.deepEqual(messages.get(c.id)[1], { from: 'u', mode: 'online', text: '继续' });
  assert.equal(mem.keyEvents.length, 1);
  assert.equal(mem.keyEvents[0], keptEvent);
  assert.equal(mem.summary, mem.manualSummary);
  assert.deepEqual(Array.from(mem.memoryTable.promise), [{ k: '旧约定', v: '手写', manual: true }]);
  const hits = await ctx.searchMemoryByVector(c.id, '桥边的争吵', 5);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].text, keptEvent.text);
});

test('deleting an older turn preserves newer state and rewires its later rollback', () => {
  const { ctx, c, messages } = harness();
  const first = { from: 'c', mode: 'offline', text: 'first' };
  const second = { from: 'c', mode: 'offline', text: 'second' };
  ctx.recordChatState(c, first, { mood: '生气' });
  ctx.recordChatState(c, second, { mood: '开心' });
  ctx.removeChatMessages(c, [first, second], [first]);
  assert.equal(c.mood, '开心');
  const remaining = messages.get(c.id);
  ctx.removeChatMessages(c, remaining, remaining);
  assert.equal(c.mood, '平静');
});

test('smart chat follows surviving dialogue and retrieves older related events without embeddings', async () => {
  let sent;
  const { ctx, c, messages } = harness({ callLLM: async options => {
    sent = options;
    return { ok: true, text: '好，周五见。[状态:等车|心情:轻松]' };
  } });
  c.offlineMode = false;
  const kept = { from: 'c', mode: 'online', text: '我们周五见' };
  const removed = { from: 'c', mode: 'offline', text: '桥边的大争吵' };
  const marker = { from: 'system', mode: 'offline', isSystem: true, text: '已切换到线下' };
  Object.assign(c, { mood: '生气', status: '争执', storyTimeline: '午夜' });
  ctx.addMemoryEvent(c.id, '旧书店约好周五见面', 'chat', 'online');
  for (let i = 0; i < 12; i++) ctx.addMemoryEvent(c.id, `无关的咖啡记录${i}`, 'moments', 'online');
  ctx.addMemoryEvent(c.id, 'Lin：桥边的大争吵', 'chat', 'offline');
  ctx.removeChatMessages(c, [kept, marker, removed], [removed]);
  const reply = await ctx.window.getSmartChatReply(['还记得旧书店吗？'], c);
  assert.equal(messages.get(c.id).length, 2);
  assert.deepEqual([c.mood, c.status, c.storyTimeline], ['', '', '']);
  assert.doesNotMatch(sent.system, /旧书店|大争吵/);
  assert.equal(sent.messages[0].content, kept.text);
  assert.match(sent.messages.at(-1).content, /与当前话题相关的过往记忆[\s\S]*旧书店约好周五见面/);
  assert.doesNotMatch(JSON.stringify(sent.messages), /大争吵|已切换|承接最后一段线下剧情|live:生气|午夜/);
  assert.equal(reply.state.mood, '轻松');
  assert.equal(c.mood, '', 'generation alone does not mutate the stored character state');
});

test('continuity still carries the latest surviving offline dialogue into online chat', async () => {
  let sent;
  const { ctx, c, messages } = harness({ callLLM: async options => {
    sent = options.messages;
    return { ok: true, text: '周五见。' };
  } });
  c.offlineMode = false;
  messages.set(c.id, [{ from: 'c', mode: 'offline', text: '在书店约好周五见' }]);
  await ctx.window.getSmartChatReply(['到时见'], c);
  assert.match(sent[0].content, /线下见面时.*在书店约好周五见/);
  assert.match(sent.at(-1).content, /承接最后一段线下剧情/);
});

test('online chat sends after the shared deadline even with stalled avatar and vector lookup', async () => {
  let expire, sent, avatarRole, searched;
  const stalled = new Promise(() => {});
  const { ctx, c } = harness({
    setTimeout(fn, ms) { assert.equal(ms, 1200); expire = fn; return 1; },
    clearTimeout() {},
    _personaAvatarB64(role) { avatarRole = role; return stalled; },
    callLLM: async options => { sent = options; return { ok: true, text: '周五见。' }; }
  });
  c.offlineMode = false;
  c.avatar = 'data:image/jpeg;base64,example';
  ctx.addMemoryEvent(c.id, '旧书店约好周五见面', 'chat', 'online');
  ctx.embApi.key = 'test';
  ctx.searchMemoryByVector = () => { searched = true; return stalled; };
  const reply = ctx.window.getSmartChatReply(['还记得旧书店吗？'], c);
  await Promise.resolve();
  assert.equal(avatarRole, c);
  assert.equal(searched, true);
  assert.equal(sent, undefined);
  expire();
  assert.equal((await reply).text, '周五见。');
  const parts = sent.messages.at(-1).content;
  assert.equal(parts.find(part => part.type === 'image_url').image_url.url, c.avatar);
  assert.match(parts.at(-1).text, /旧书店约好周五见面/);
});

test('online chat keeps a user attachment required when optional context times out', async () => {
  let expire, failImage, sent = false;
  const { ctx, c, messages } = harness({
    setTimeout(fn) { expire = fn; return 1; },
    clearTimeout() {},
    _personaAvatarB64: () => new Promise(() => {}),
    imgDB: { load: () => new Promise((_resolve, reject) => { failImage = reject; }) },
    callLLM: async () => { sent = true; return { ok: true, text: '收到。' }; }
  });
  c.offlineMode = false;
  messages.set(c.id, [{ from: 'u', image: 'img_test' }]);
  const reply = ctx.window.getSmartChatReply(['（发送了图片）'], c);
  failImage(new Error('read error'));
  expire();
  assert.match((await reply).err, /聊天图片读取失败/);
  assert.equal(sent, false);
});

test('regeneration reconnects a saved legacy checkup across gift notices without using later messages', async () => {
  let sent;
  const { ctx, c, messages } = harness({
    callLLM: async options => { sent = options.messages; return { ok: true, text: '我问的是方亦楷。' }; },
  });
  c.offlineMode = false;
  const opening = '整整一百二十四个小时不回我消息，原来是忙着去问方亦楷‘笨蛋在干嘛？’啊。';
  const list = [
    { from: 'c', text: opening },
    { from: 'c', text: '别装看不见，现在立刻给我解释清楚。' },
    { from: 'u', text: '解释什么？解释白城是大笨蛋嘛？', replied: true },
    { from: 'system', text: '送出了手织围巾', isSystem: true },
    { from: 'u', text: '？', replied: true },
    { from: 'system', text: '收下了手织围巾', isSystem: true },
    { from: 'c', text: '反正奶茶只有一杯' },
    { from: 'u', text: '后来聊了别的', replied: true },
  ];
  messages.set(c.id, list);
  const turn = ctx._regenerationUserTurn(list, 5);
  assert.equal(turn.start, 2);
  const texts = Array.from(turn.users, m => m.text);
  assert.deepEqual(texts, [list[2].text, list[4].text]);
  await ctx.window.getSmartChatReply(texts, c, null, { history: list.slice(0, turn.start), userMessages: turn.users });
  assert.ok(sent.some(m => m.role === 'assistant' && m.content === opening));
  assert.match(sent.at(-1).content, /你本人主动发消息查对方的岗/);
  assert.match(sent.at(-1).content, /方亦楷/);
  assert.doesNotMatch(JSON.stringify(sent), /后来聊了别的|奶茶只有一杯/);
});

test('new checkup context is used for the next direct reply and stops after that exchange', async () => {
  let last;
  const { ctx, c, messages } = harness({ callLLM: async ({ messages }) => {
    last = messages.at(-1).content;
    return { ok: true, text: '问你在干嘛。' };
  } });
  c.offlineMode = false;
  const list = [{ from: 'c', text: '刚才在跟谁聊天？', _checkup: { evidence: '给另一个角色发的消息' } }];
  messages.set(c.id, list);
  await ctx.window.getSmartChatReply('？', c);
  assert.match(last, /给另一个角色发的消息/);
  list.push({ from: 'u', text: '？', replied: true }, { from: 'c', text: '问你在干嘛。' });
  await ctx.window.getSmartChatReply('今天去哪？', c);
  assert.doesNotMatch(last, /承接当前对话|给另一个角色发的消息/);
});
