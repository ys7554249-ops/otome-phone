const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function section(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return html.slice(from, to);
}

test('startup migrates all character slots and leaves unrelated data and nested fields intact', async () => {
  const first = { id: 'first', affection: 0, relation: '好友', mood: '平静', isBlocked: true, bindPersonaId: 'p2', custom: { affection: 42 } };
  const second = { id: 'second', affection: -20, relation: '对手', personality: '自己写的好感设定' };
  const data = {
    _currentSlot: 'second', _saves_meta: {},
    charList: [first], 'slot_second::charList': [second],
    'slot_third::charList': [{ id: 'third', relation: '室友' }],
    'slot_default::coupleSpace_first': { partnerId: 'second' },
    'slot_second::activeDungeon': { npcAffection: { npc: 60 } },
    'slot_second::htmlCards': [{ affection: 'custom card field' }],
  };
  const writes = new Map();
  const ctx = vm.createContext({
    dataDB: {
      init: async () => {}, getAll: async () => data,
      set: async (key, value) => writes.set(key, structuredClone(value)), del: async () => {},
    },
    localStorage: { length: 0 },
  });
  await vm.runInContext(
    section('const GLOBAL_KEYS', '// ===== TTS音频管理') +
    section('function stripLegacyCharacterAffection(', 'function loadCharList(') +
    'store.initAll()', ctx,
  );
  assert.deepEqual(writes.get('slot_default::charList'), [
    { id: 'first', relation: '好友', mood: '平静', isBlocked: true, bindPersonaId: 'p2', custom: { affection: 42 } },
  ]);
  assert.deepEqual(writes.get('slot_second::charList'), [
    { id: 'second', relation: '对手', personality: '自己写的好感设定' },
  ]);
  assert.deepEqual([...writes.keys()].sort(), ['slot_default::charList', 'slot_second::charList']);
  writes.clear();
  await vm.runInContext('store.initAll()', ctx);
  assert.equal(writes.size, 0);
});

test('old gifts keep valid nurture effects and a gift-only item still gets a reaction', async () => {
  const role = { id: 'c1', name: 'Lin', relation: '朋友', mood: '安静' };
  const before = { ...role };
  const stats = { energy: 20, maxEnergy: 90, fatigue: 40, exp: 0, level: 0 };
  const bag = [
    { name: '旧礼盒', effect: 'mood+15, energy+10, fatigue-5, exp+20' },
    { name: '旧鲜花', effect: 'mood+8' },
  ];
  let statWrites = 0;
  const ctx = vm.createContext({
    charList: [role], store: { get: () => bag, set: () => {} },
    getNurtureData: () => stats, saveNurtureData: () => { statWrites++; },
    calcNurtureLevel: () => 1,
    getGiftReaction: async (_role, item, effects) => {
      assert.equal(item.name, '旧鲜花');
      assert.equal(effects, '');
      return '谢谢你的花。';
    },
  });
  vm.runInContext(section('function getUserBag(', 'async function getGiftReaction('), ctx);
  const mixed = await ctx.useItemOnChar(0, role.id, true);
  assert.match(mixed.msg, /体力恢复10点！疲劳减少5点！经验\+20/);
  const gift = await ctx.useItemOnChar(0, role.id);
  assert.equal(gift.reaction, '谢谢你的花。');
  assert.match(gift.msg, /收到了旧鲜花/);
  assert.deepEqual(stats, { energy: 30, maxEnergy: 90, fatigue: 35, exp: 20, level: 1 });
  assert.equal(statWrites, 1);
  assert.equal(bag.length, 0);
  assert.deepEqual(role, before);
});

test('legacy status is discarded without becoming mood; custom cards keep their fields', async () => {
  const ctx = vm.createContext({
    window: {}, getApi: () => ({ key: 'test' }), store: { get: (_key, fallback) => fallback },
    getMsgs: () => [], worldBooks: [], styleBooks: [], embApi: {},
    searchMemoryByKeyword: () => [], sysPrompt: () => '', liveCtx: () => '', setTimeout, clearTimeout,
  });
  vm.runInContext(section('function _recentCheckup(', 'function liveCtx(')
    + section('window.getSmartChatReply =', '// 全局单例：监听互动卡片'), ctx);
  const role = { id: 'c1', name: 'Lin', mood: '平静' };
  async function reply(text, onChunk) {
    ctx.callLLM = async opts => {
      opts.onChunk?.(text);
      return { ok: true, text };
    };
    return ctx.window.getSmartChatReply(['你好'], role, onChunk);
  }
  for (const label of ['好感度', 'affection', 'love', '爱意值']) {
    const custom = await reply(`你好。<status>${label}：90</status>`);
    assert.equal(custom.state.mood, '');
  }
  const customMood = await reply('你好。<status>affection:99\nemotion:好奇</status>');
  assert.equal(customMood.state.mood, '好奇');
  const card = '<div>卡片里的好感：90</div>';
  assert.equal((await reply(card)).text, card);

  let streamed;
  const native = await reply('你好。\n[状态:看书|好感度:90|心情:专注|心声:真安静]', text => { streamed = text; });
  assert.doesNotMatch(streamed, /好感度/);
  assert.equal(native.text, '你好。');
  assert.equal(native.state.status, '看书');
  assert.equal(native.state.mood, '专注');
  assert.equal(native.thoughts, '真安静');
  assert.equal((await reply('你好。\n【状态栏】\n好感度：90')).text, '你好。');
  assert.equal(role.mood, '平静');
});

test('assistant character tools ignore retired arguments and preserve role fields', () => {
  const role = { id: 'c1', name: 'Lin', relation: '朋友', mood: '平静', status: '读书' };
  const charList = [role];
  const ctx = vm.createContext({
    charList, worldBooks: [], activePersonaId: 'p1', _asFindChar: name => charList.find(c => c.name === name),
    uid: () => 'c2', genWcId: () => 'wc2', saveCharList() {}, saveWorldBooks() {}, refreshPlaceUnlocks() {},
  });
  const [tools, defs] = vm.runInContext(
    section('  const _asTools={', '  function _asRunTool(') +
    section('  const _asToolDefs=(()=>{', '  })()') + '  })();\n[_asTools,_asToolDefs]', ctx,
  );
  assert.ok(tools.update_char({ name: 'Lin', affection: 99 }).err);
  assert.match(tools.update_char({ name: 'Lin', relation: '同事', affection: 99 }).text, /关系/);
  assert.match(tools.list_chars().text, /Lin｜同事｜读书/);
  assert.match(tools.get_char({ name: 'Lin' }).text, /心情：平静/);
  tools.create_char({ name: 'Ari', relation: '对手', mood: '好奇', affection: 80 });
  assert.equal(charList[1].relation, '对手');
  assert.equal(charList[1].mood, '好奇');
  assert.equal(charList.some(c => Object.hasOwn(c, 'affection')), false);
  assert.doesNotMatch(JSON.stringify(defs), /affection|好感/);
});
