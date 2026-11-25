const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function section(start, end) {
  const from = html.indexOf(start), to = html.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return html.slice(from, to);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function environment(overrides = {}) {
  const data = new Map(), elements = new Map(), timers = new Map(), renders = [];
  let cleanup, id = 0;
  const node = () => ({
    style: {}, children: [], isConnected: true, value: '', textContent: '',
    appendChild(child) { this.children.push(child); if (child.id) elements.set('#' + child.id, child); },
    querySelector(selector) { return this.controls.get(selector) || this.controls.set(selector, node()).get(selector); },
    controls: new Map(), querySelectorAll: () => [], addEventListener() {}
  });
  const persona = { name: 'Player' }, character = { id: 'c', name: 'Role' };
  const context = vm.createContext({
    store: { _realKey: key => 'default::' + key,
      get: (key, fallback) => data.has(key) ? data.get(key) : fallback,
      set: (key, value) => data.set(key, structuredClone(value)) },
    $: key => elements.get(key) || elements.set(key, node()).get(key), ce: node,
    app: node(), pages: {}, P: () => persona, activePersonaId: 'p', personaList: [persona],
    charList: [character], getMyChars: () => [character], uid: () => String(++id),
    Math: Object.assign(Object.create(Math), { random: () => 0 }),
    isN: () => false, escHtml: String, confirm: () => true,
    getApi: () => ({ key: 'test' }), _curPage: '',
    _setPageTeardown(fn) { const previous = cleanup; cleanup = () => { previous?.(); fn(); }; },
    render(page) { cleanup?.(); cleanup = null; elements.clear(); renders.push(page); context._curPage = page; },
    setTimeout(fn, ms) { const timer = ++id; timers.set(timer, { fn: () => { timers.delete(timer); return fn(); }, ms }); return timer; },
    clearTimeout: timer => timers.delete(timer), setInterval: () => ++id, clearInterval() {},
    ...overrides
  });
  context.window = context;
  return { context, data, renders, timers, character, node, run: source => vm.runInContext(source, context) };
}

test('live back preserves the room; ending hides only that room and drops pending goods', async () => {
  const goods = deferred(), pool = ['a', 'b'].map(id => ({ id, type: 'npc', name: id, viewers: 80 }));
  const env = environment({
    genStreamerPool: () => pool, getUserLiveLevel: () => ({ level: 1 }), getLiveFanData: () => ({}),
    saveLiveFanData() {}, getLiveMemory: () => ({}), saveLiveMemory() {}, getLiveCoins: () => 0,
    getLvPriv: () => ({}), userLvTitles: [], avatarEl: () => '', isFollowed: () => false,
    I: { back: () => '' }, lI: new Proxy({}, { get: () => () => '' }),
    ttsApi: null, genNpcViewerNames: async () => [], askAIJson: () => goods.promise,
    stopOwnedTts() {}, eraHint: ''
  });
  const { context, data, renders, timers } = env;
  const css = { disabled: true };
  context.document = { getElementById: id => id === '_customCSS' ? css : context.$('#' + id) };
  env.run(section('function isLiveRoomEnded(', '\nfunction checkCharAutoLive('));
  env.run(section('const liveGuardDays=', 'const badgeColors='));
  env.run(section('function appendLivePM(', 'window.openLiveInbox ='));
  env.run(section('pages.liveroom=()=>{', '\n// ── 下单购买带货商品'));
  data.set('charLiveNow', { charId: 'b' });
  context.pages.liveroom();
  const headerStack = context.$('#_lrheaderstack');
  assert.match(headerStack.children[0].innerHTML, /id="_lrend"/);
  assert.equal(headerStack.children[1].id, '_lrlevelbar');
  assert.doesNotMatch(headerStack.children[1].style.cssText, /position:absolute|top:/);
  const delayed = [...timers.values()].find(timer => timer.ms === 20000);
  assert.ok(delayed);
  delayed.fn();
  context.$('#_lrback').onclick();
  assert.equal(renders.at(-1), 'live');
  assert.equal(context.isLiveRoomEnded('a'), false);
  assert.equal(css.disabled, true);
  assert.equal(timers.size, 0);
  context.pages.liveroom();
  goods.resolve({ items: [{ name: 'late goods' }] });
  await goods.promise;
  assert.deepEqual(data.get('liveRoomCache_a').goodsList, []);
  context.confirm = () => false;
  context.$('#_lrend').onclick();
  assert.equal(context.isLiveRoomEnded('a'), false);
  context.confirm = () => true;
  context.$('#_lrend').onclick();
  assert.equal(context.isLiveRoomEnded('a'), true);
  assert.equal(context.isLiveRoomEnded('b'), false);
  assert.equal(data.get('charLiveNow').charId, 'b');
  context.pages.liveroom();
  assert.equal(renders.at(-1), 'live');
});

test('support milestones send care and rival messages with separate cooldowns', () => {
  const { context, data, run } = environment({ now: () => new Date(), ftime: () => '12:00' });
  run(section('function isLiveRoomEnded(', '\nfunction checkCharAutoLive('));
  run(section('const liveGuardDays=', 'const badgeColors='));
  run(section('function appendLivePM(', 'window.openLiveInbox ='));
  const host = { id: 'host', name: 'Host', type: 'npc' };
  const rival = { id: 'rival', name: 'Rival' };
  const pool = [host, rival];
  const day = 86400000, start = Date.now();
  const trigger = (fan, elapsed = 0) => context.triggerLiveSupport(host, fan, pool, start + elapsed);
  trigger({ totalGift: 519, level: 2 });
  assert.equal(data.has('live_pms'), false);
  assert.equal(trigger({ level: 3 }), true);
  assert.equal(trigger({ level: 3 }, 1), false);
  assert.equal(data.get('live_pms').host.length, 1);
  assert.equal(trigger({ level: 5, anonymous: true }, 2), true);
  assert.equal(data.get('live_pms').rival, undefined);
  assert.equal(trigger({ level: 5 }, 3), true);
  assert.equal(data.get('live_pms').rival[0].kind, 'poach');
  assert.equal(trigger({ level: 5 }, day + 4), true);
  assert.equal(data.get('live_pms').rival.length, 1);
  trigger({ totalGift: 5200 }, day + 5);
  assert.match(data.get('live_pms').host.at(-1).text, /微聊/);
  trigger({ level: 5 }, 7 * day + 4);
  assert.equal(data.get('live_pms').rival.length, 2);
  assert.equal(context.liveSupportTier({ guardType: 3, guardExpire: start + 1 }, start), 2);
  assert.equal(context.liveSupportTier({ guardType: 3, guardExpire: start }, start), 0);
});

test('live fan group private replies open from the notice and remain in the inbox outside the streamer pool', () => {
  const badge = { hidden: true };
  const modals = [];
  const friend = { id: 'fan', name: '马星星', isHidden: true };
  const { context, data, node, run } = environment({
    _curPage: 'groupchat', now: () => new Date(), ftime: () => '12:00',
    isLLMError: text => text === '[API error]', avatarEl: () => '', _chatPreview: String,
    getMsgs() { return []; }, saveMsgs(id, messages) { data.set('chat_' + id, messages); },
    showModal(title, build) {
      const body = node();
      modals.push({ title, body });
      build(body, () => { body.isConnected = false; });
    }
  });
  context.app.querySelectorAll = () => [badge];
  run(section('function isLiveRoomEnded(', '\nfunction checkCharAutoLive('));
  run(section('function appendLivePM(', 'window.openLiveGroupList ='));
  const group = { id: 'club', isLiveGroup: true };
  data.set('activeGroupId', 'club');
  context.deliverGroupPrivateReaction(group, friend, '[API error]');
  assert.equal(modals.length, 0);
  context.deliverGroupPrivateReaction(group, friend, 'Can we talk?');
  assert.equal(data.get('live_pms').fan[0].kind, 'fan-group');
  assert.equal(data.has('chat_fan'), false);
  assert.equal(badge.hidden, false);
  modals.at(-1).body.querySelector('#_viewFanPM').onclick();
  assert.equal(modals.at(-1).title, '与 马星星 的私信');
  assert.match(modals.at(-1).body.innerHTML, /Can we talk\?/);
  assert.doesNotMatch(modals.at(-1).body.innerHTML, /_lpm_visit/);
  assert.equal(badge.hidden, true);

  context._curPage = 'live';
  context.deliverGroupPrivateReaction(group, friend, 'Still there?');
  assert.equal(modals.length, 2);
  data.get('live_pms').legacy = [{ from: 'anchor', text: 'Previously hidden' }];
  context.openLiveInbox();
  assert.match(modals.at(-1).body.innerHTML, /马星星/);
  assert.match(modals.at(-1).body.innerHTML, /Previously hidden/);
  context.openLivePM('legacy');
  assert.match(modals.at(-1).body.innerHTML, /Previously hidden/);
  assert.doesNotMatch(modals.at(-1).body.innerHTML, /_lpm_send/);
  context.deliverGroupPrivateReaction({ id: 'ordinary' }, friend, 'Ordinary chat');
  assert.equal(data.get('chat_fan')[0].text, 'Ordinary chat');
  assert.equal(data.get('live_pms').fan.length, 2);
});

test('user admin can invite new fans; leaving preserves history and discards pending invites', async () => {
  const pending = deferred(), requests = [], controls = new Map();
  const group = { id: 'fan', name: 'Fan club', isLiveGroup: true, charIds: [], adminIds: [] };
  let messages = [], modal;
  const env = environment({
    groups: [group], charList: [], worldBooks: [], styleBooks: [], alert: assert.fail,
    I: { mirror: () => '' }, avatarEl: () => '', genWcId: () => '', saveCharList() {},
    saveGroups() {}, getGroupMsgs: () => messages, saveGroupMsgs: (_, value) => { messages = value; },
    updateCharRel() {}, now: () => new Date(), ftime: () => '12:00',
    askAIJson: async (_, prompt) => {
      requests.push(prompt);
      return requests.length === 1 ? { name: 'New fan', firstMsg: 'Hello' } : pending.promise;
    },
    showModal(_, build) {
      controls.clear();
      const body = modal = { isConnected: true, innerHTML: '', querySelectorAll: () => [],
        querySelector(key) { return controls.get(key) || controls.set(key, { style: {} }).get(key); } };
      build(body, () => { body.isConnected = false; });
    }
  });
  env.run(section('// ── 群主判定 ──', '// ===== 角色游戏房间 ====='));
  env.run(section('function openGroupMenu(g)', '// ===== 群聊小游戏'));
  env.run(section('window.openLiveGroupList =', 'pages.live=()=>'));
  env.context.openGroupMenu(group);
  await controls.get('#_gcpullnpc').onclick();
  assert.match(requests[0], /邀请一位新粉丝/);
  assert.equal(group.charIds.length, 1);
  assert.deepEqual(group.adminIds, ['u']);
  assert.equal(messages.at(-1).text, 'Hello');

  env.context.openGroupMenu(group);
  const invite = controls.get('#_gcpullnpc').onclick();
  assert.match(requests[1], /邀请一位新粉丝/);
  controls.get('#_gmleave').onclick();
  assert.equal(group.liveGroupLeft, true);
  assert.equal(env.renders.at(-1), 'live');
  assert.equal(env.data.get('activeGroupId'), '');
  pending.resolve({ name: 'Late guest' });
  await invite;
  assert.equal(group.charIds.length, 1);
  assert.equal(messages.length, 2);
  env.context.openLiveGroupList();
  assert.doesNotMatch(modal.innerHTML, /Fan club/);
});

test('leaving a live session stops its voice and preserves unrelated queued audio', () => {
  const played = [], paused = [], revoked = [];
  const env = environment({
    Audio: class { constructor(url) { this.url = url; } play() { played.push(this.url); return Promise.resolve(); } pause() { paused.push(this.url); } },
    URL: { revokeObjectURL: url => revoked.push(url) }
  });
  env.run(section('window.audioQueue = [];', '\n// ===== 主题 ====='));
  const owner = {};
  env.context.playTtsUrl('live-1', owner);
  env.context.playTtsUrl('live-2', owner);
  env.context.playTtsUrl('chat');
  env.context.stopOwnedTts(owner);
  assert.deepEqual(paused, ['live-1']);
  assert.deepEqual(revoked, ['live-2', 'live-1']);
  assert.deepEqual(played, ['live-1', 'chat']);
});

for (const type of ['gomoku', 'flight-chess', 'monopoly']) {
  test(`ending ${type} discards pending moves and failed chat replies`, async () => {
    const move = deferred(), chat = deferred();
    let calls = 0;
    const env = environment({ callLLM: () => (++calls === 1 ? move.promise : chat.promise) });
    const { context, character } = env;
    env.run(section('const GAME_ROOM_KEY=', '\npages.games=()=>{'));
    const room = context.createCharacterGameRoom(type, [character]).room;
    room.currentTurn = 1;
    // Make the first die roll offer a legal move or purchase.
    if (type === 'flight-chess') room.state.tokens[1][0] = 0;
    context.persistCharacterGameRoom(room);
    const turn = context.runCharacterGameTurns(structuredClone(room));
    const reply = context.appendCharacterGameChatReply(structuredClone(room), 'hello');
    assert.equal(calls, 2);
    assert.equal(context.endCharacterGameRoom(room), true);
    assert.equal(context.endCharacterGameRoom(room), false);
    const ended = context.loadCharacterGameRooms()[0];
    assert.equal(ended.endReason, 'manual');
    assert.equal(ended.status, 'completed');
    assert.equal(ended.winner, null);
    assert.deepEqual(ended.state, structuredClone(room.state));
    move.resolve({ ok: true, text: '{"action":{"row":0,"col":0,"tokenIndex":0,"buy":true},"dialogue":"late"}' });
    chat.reject(new Error('late failure'));
    await Promise.all([turn, reply]);
    assert.deepEqual(context.loadCharacterGameRooms()[0], ended);
  });
}

test('ending after a Flight Chess roll freezes the board with no legal moves', () => {
  const { context, character, run } = environment();
  run(section('const GAME_ROOM_KEY=', '\npages.games=()=>{'));
  const room = context.createCharacterGameRoom('flight-chess', [character]).room;
  room.state.die = 6;
  assert.equal(context.validFlightMoves(room, 0).length, 2);
  context.persistCharacterGameRoom(room);
  assert.equal(context.endCharacterGameRoom(room), true);
  const ended = context.loadCharacterGameRooms()[0];
  assert.equal(context.validFlightMoves(ended, 0).length, 0);
  assert.equal(context.resolveFlightMove(ended, 0, 0).ok, false);
});

test('dungeon back goes to the list then home without reopening saved play', () => {
  const { context, run } = environment();
  let popstate;
  const shown = [];
  const entries = [];
  Object.assign(context, {
    addEventListener(type, callback) { if (type === 'popstate') popstate = callback; },
    history: {
      get state() { return entries.at(-1); },
      pushState(state) { entries.push(state); },
      replaceState(state) { entries[entries.length - 1] = state; },
    },
    document: { getElementById: () => null },
    requestAnimationFrame() {}, _pgCleanup() {},
  });
  context.app.classList = { add() {}, remove() {} };
  for (const page of ['home', 'dungeons', 'dungeonplay']) context.pages[page] = () => shown.push(page);
  run(section('let _isPopState = false;', '// ===== 左滑返回上一级手势'));
  run(section('function render(page){', '// ===== 首页 ====='));
  context.render('home');
  context.render('dungeons');
  context.render('dungeonplay');
  context.goBack();
  context.goBack();
  assert.deepEqual(shown, ['home', 'dungeons', 'dungeonplay', 'dungeons', 'home']);
  assert.deepEqual(entries.map(state => state.page), ['home', 'dungeons', 'home']);

  context.render('dungeons');
  popstate({ state: { page: 'dungeonplay' } });
  assert.equal(shown.at(-1), 'home');
  assert.equal(context.history.state.page, 'home');
});

function dungeonEnv() {
  const requests = [], prompts = [], modals = [], stats = ['strength', 'intelligence', 'charm', 'luck'];
  const env = environment({
    askAIJson(...args) { const result = deferred(); prompts.push(args); requests.push(result); return result.promise; },
    buildDungeonTeam: () => [{ id: '__NONE__', name: 'Role', stats: {}, bonus: {} }],
    teamAssistBonus: () => 0, STATS4: stats, SN4: {}, imgApi: null,
    mkStoryCard: () => ({}), _aiShowErr: () => {}, addDungeonFatigue() {},
    itemIcons: new Proxy({}, { get: () => () => '' }), rarityColors: { common: {}, uncommon: {} },
    inventory: [], saveInventory() {}, showToast() {}
  });
  const { context, node, run } = env;
  context.showModal = (title, build) => {
    const modal = node(); modals.push(modal); build(modal, () => { modal.isConnected = false; });
  };
  run(section("let activeDungeon = store.get(", '\nfunction saveDungeonTemplates'));
  run(section('function saveActiveDungeon()', '\nfunction saveInventory()'));
  run(section('async function doDungeonAdvance(', '\n// 副本队伍属性面板'));
  const template = { id: 't', name: 'Dungeon', targetRole: 'Role', difficulty: 'easy' };
  const start = (id, status = 'ongoing') => {
    context.dungeon = { id, status, currentRound: status === 'ongoing' ? 0 : 1, maxRounds: 5, story: [], oocCount: 0, npcAffection: {} };
    context.render('dungeonplay');
    run('activeDungeon=dungeon;saveActiveDungeon()');
    return context.dungeon;
  };
  return { ...env, requests, prompts, modals, template, start };
}

test('returning cancels an uncommitted round and a retry owns its own result', async () => {
  const { context, data, requests, template, character, start } = dungeonEnv();
  const dungeon = start('first');
  const old = context.doDungeonAdvance(template, character, null, 'old narration');
  assert.equal(dungeon.currentRound, 0);
  assert.deepEqual(dungeon.story, []);
  await context.doDungeonAdvance(template, character, null, 'double click');
  assert.equal(requests.length, 1);
  context.render('dungeons');
  context.render('dungeonplay');
  const retry = context.doDungeonAdvance(template, character, null, 'new narration');
  requests[0].resolve({ story: 'late' });
  await old;
  assert.equal(dungeon.currentRound, 0);
  requests[1].resolve({ story: 'accepted' });
  await retry;
  assert.equal(data.get('activeDungeon').currentRound, 1);
  assert.deepEqual(data.get('activeDungeon').story.map(event => event.text), ['new narration', 'accepted']);
});

test('discarding a settling dungeon cannot reward or modify its replacement', async () => {
  const { context, data, requests, modals, template, character, start } = dungeonEnv();
  let rewards = 0;
  context.walletReceive = () => rewards++;
  const old = start('old', 'finished');
  const settlement = context.doDungeonComplete(template, character);
  assert.equal(requests.length, 1);
  assert.equal(context.leaveDungeon(old), true);
  assert.equal(data.get('activeDungeon'), null);
  start('replacement');
  requests[0].resolve({ name: 'late reward' });
  await settlement;
  assert.equal(rewards, 0);
  assert.equal(context.inventory.length, 0);
  assert.equal(modals.length, 0);
  assert.equal(data.get('activeDungeon').id, 'replacement');
});

test('closed settlement reopens without duplicate rewards and finish exits before memory work', async () => {
  const { context, data, requests, prompts, modals, template, character, start } = dungeonEnv();
  const memory = deferred();
  let rewards = 0;
  context.Math.random = () => 0.99;
  context.walletReceive = () => rewards++;
  context.saveCharList = context.addMemoryEvent = () => {};
  context.autoSummarizeMemory = () => memory.promise;
  context.autoUpdateMemoryTable = async () => {};
  const dungeon = start('first', 'finished');
  dungeon.npcProfiles = { '楚瑶': { role: '师妹', relation: '因共同经历而互相信任' } };
  const pending = context.doDungeonComplete(template, character);
  await context.doDungeonComplete(template, character);
  assert.equal(requests.length, 1);
  assert.match(prompts[0][1], /楚瑶：师妹：因共同经历而互相信任/);
  context.render('dungeons');
  requests[0].resolve({ memoir: 'memoir', legacies: [] });
  await pending;
  assert.equal(rewards, 1);
  assert.equal(modals.length, 0);
  context.render('dungeonplay');
  await context.doDungeonComplete(template, character);
  modals[0].children.at(-1).onclick();
  assert.ok(data.get('activeDungeon')._settleData);
  await context.doDungeonComplete(template, character);
  assert.match(modals[1].innerHTML, /因共同经历而互相信任/);
  modals[1].querySelector('#_dgfin').onclick();
  assert.equal(context._curPage, 'dungeons');
  assert.equal(data.get('activeDungeon'), null);
  assert.equal(rewards, 1);
  assert.equal(character.dungeonHistory[0].npcProfiles['楚瑶'].relation, '因共同经历而互相信任');
  assert.equal('npcAffection' in character.dungeonHistory[0], false);
  start('replacement');
  memory.resolve();
  await memory.promise;
  assert.equal(data.get('activeDungeon').id, 'replacement');
});

test('dungeon progression keeps narrative profiles and ignores legacy relationship scores', async () => {
  const { context, data, requests, prompts, run, template, character, start } = dungeonEnv();
  const dungeon = start('legacy');
  dungeon.npcAffection = { '楚瑶': 73 };
  dungeon.npcProfiles = { '楚瑶': { role: '师妹', personality: '敏锐', firstMet: 1 } };
  dungeon.story.push({ type: 'npc_change', text: '楚瑶 好感↑5（同心解谜）→ 73', round: 1 });
  dungeon.currentRound = 1;
  const pending = context.doDungeonAdvance(template, character, null, '');
  assert.match(prompts[0][0], /楚瑶：师妹：敏锐/);
  assert.doesNotMatch(prompts[0][0], /73|npcChanges/);
  requests[0].resolve({
    story: '楚瑶决定留下。',
    npcChanges: [{ name: '旧字段', delta: 5 }],
    npcProfiles: [{ name: '师妹·楚瑶', relation: '愿意一起找出真相', delta: 10 }, { name: '老苏', relation: 80 }]
  });
  await pending;
  const saved = data.get('activeDungeon');
  assert.equal('npcAffection' in saved, false);
  assert.deepEqual(saved.npcProfiles, {
    '楚瑶': { role: '师妹', personality: '敏锐', firstMet: 1, relation: '愿意一起找出真相' },
    '老苏': { firstMet: 2 }
  });
  assert.deepEqual(saved.story.map(entry => entry.type), ['npc_change', 'narration']);
  run(section('function mkStoryCard(', '\n// 推进剧情核心'));
  const oldCard = context.mkStoryCard(saved.story[0], false);
  assert.match(oldCard.innerHTML, /楚瑶：同心解谜/);
  assert.doesNotMatch(oldCard.innerHTML, /好感|73/);
});

test('dungeon template upgrade changes only original NPC relationship sections', () => {
  const { context, run, data } = environment({ dungeonTemplates: [], saveDungeonTemplates() {} });
  run(section('function updateBuiltinDungeonRelations(', '\n// 副本列表页'));
  assert.equal(context.dungeonTemplates.length, 5);
  for (const template of context.dungeonTemplates) {
    assert.match(template.scenario, /NPC·叙事关系/);
    assert.doesNotMatch(template.scenario + template.rules, /好感/);
  }
  const custom = { id: 'builtin_escape', scenario: '【关键NPC·初始好感】\n自定义关系与剧情' };
  data.set('builtinDungeonsV3', true);
  context.dungeonTemplates = [custom];
  assert.equal(context.updateBuiltinDungeonRelations(custom), false);
  assert.deepEqual(custom, { id: 'builtin_escape', scenario: '【关键NPC·初始好感】\n自定义关系与剧情' });
  const defaults = section('const builtinDungeons=[', '\n  const existingIds');
  const [saved] = run(defaults + '\nbuiltinDungeons');
  saved.scenario += '\n\n用户追加的剧情';
  assert.equal(context.updateBuiltinDungeonRelations(saved), true);
  assert.match(saved.scenario, /NPC·叙事关系/);
  assert.match(saved.scenario, /用户追加的剧情$/);
  assert.equal(context.updateBuiltinDungeonRelations(saved), false);
});

test('NPC scan saves text profiles and drops results after leaving the dungeon', async () => {
  const { context, data, requests, prompts, modals, run, template, start } = dungeonEnv();
  context.dungeonTemplates = [template];
  context.I = { back: () => '' };
  context.updateBuiltinDungeonRelations = () => false;
  run(section('pages.dungeonplay=()=>{', '\nfunction mkStoryCard('));
  const openNpcPanel = () => {
    context.pages.dungeonplay();
    context.$('#_dgnpc').onclick();
    return modals.at(-1);
  };

  const old = start('old');
  old.templateId = template.id;
  old.charId = 'c';
  const scan = openNpcPanel().querySelector('#_scanNpc').onclick();
  assert.match(prompts[0][1], /"relation"/);
  assert.equal(context.leaveDungeon(old), true);
  const next = start('next');
  next.templateId = template.id;
  next.charId = 'c';
  requests[0].resolve({ npcs: [{ name: '上个副本的NPC' }] });
  await scan;
  assert.equal(data.get('activeDungeon').npcProfiles, undefined);

  const modal = openNpcPanel();
  const currentScan = modal.querySelector('#_scanNpc').onclick();
  requests[1].resolve({ npcs: [{ name: '老苏', role: '药师', personality: '温厚', relation: '记得主角的帮助', initialAffection: 45 }] });
  await currentScan;
  assert.deepEqual(data.get('activeDungeon').npcProfiles['老苏'], { role: '药师', personality: '温厚', relation: '记得主角的帮助' });
  assert.match(modal.innerHTML, /身份：药师[\s\S]*性格：温厚[\s\S]*关系：记得主角的帮助/);
});
