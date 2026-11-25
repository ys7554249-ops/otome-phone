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
const helpers = section('// ── 群主判定 ──', '// ===== 角色游戏房间 =====');
const host = () => ({ id: 'host', name: '江逾白', personality: '温柔', avatar: 'host.png' });
const fan = () => ({ id: 'fan', name: '小鱼', isHidden: true });
function legacy() {
  return { id: 'club', name: '江逾白的粉丝群', scene: '群主是江逾白，这里是他的直播粉丝聊天群。',
    isLiveGroup: true, charIds: ['host', 'fan'], adminIds: ['host'], mode: 'chat' };
}
function env(group = legacy(), extra = {}) {
  const data = new Map(), controls = new Map(), requests = [], modals = [], alerts = [];
  const forged = {};
  const control = key => {
    if (!controls.has(key)) controls.set(key, { value: '', style: {}, dataset: {}, textContent: '', disabled: false });
    return controls.get(key);
  };
  let id = 0;
  const context = vm.createContext({
    console, groups: [group], charList: [host(), fan()], activePersonaId: 'p1', personaList: [{ id: 'p1', name: '观众' }],
    P: () => ({ name: '观众' }), worldBooks: [], styleBooks: [], pages: {}, I: { mirror: () => '' },
    store: { _realKey: key => (data.get('slot') || 'default') + '::' + key,
      get: (key, fallback) => data.has(key) ? data.get(key) : fallback,
      set: (key, value) => data.set(key, structuredClone(value)) },
    saveGroups() { data.set('groups', structuredClone(context.groups)); }, saveCharList() {},
    getGroupMsgs: () => data.get('messages') || [], saveGroupMsgs: (_, messages) => data.set('messages', messages),
    isN: () => false, escHtml: String, avatarEl: () => '', genWcId: () => '', uid: () => 'id' + (++id),
    getApi: () => ({ key: 'test' }), isLLMError: () => false, getMemoryPromptText: () => '', getMsgs: () => [],
    isLiveRoomEnded: () => false, app: { querySelectorAll: () => [] },
    document: { getElementById: () => null }, now: () => new Date(), ftime: () => '12:00',
    confirm: () => true, alert: message => alerts.push(message), updateCharRel() {}, render() {},
    showModal(title, build) {
      const body = { style: {}, isConnected: true, innerHTML: '',
        querySelector: control, querySelectorAll: selector => forged[selector] || [] };
      modals.push({ title, body });
      build(body, () => { body.isConnected = false; });
    },
    askAI: async (system, prompt) => { requests.push({ system, prompt }); return '【江逾白】\n晚上好'; },
    deliverGroupPrivateReaction: (...args) => data.set('reaction', args),
    ...extra
  });
  context.window = context;
  vm.runInContext(helpers, context);
  vm.runInContext(section('function fanGroupTurnMembers(', '// 群聊AI调用（超强智能解析版）'), context);
  return { context, data, requests, modals, alerts, controls, control, forged,
    run: source => vm.runInContext(source, context) };
}

test('old fan groups resolve the original streamer without requiring a room rejoin', () => {
  const group = legacy(), e = env(group);
  assert.equal(e.context.groupOwnerId(group), 'host');
  assert.equal(e.context.groupOwner(group).name, '江逾白');
  assert.match(e.context.groupOwnerTag(group, 'host'), /群主/);
});

test('migration restores a kicked and muted legacy owner from the streamer pool and is idempotent', () => {
  const group = legacy();
  group.name = '夜聊小窝'; group.charIds = ['fan']; group.adminIds = ['fan']; group.mutedIds = ['host', 'fan'];
  const e = env(group, { charList: [fan()] });
  e.data.set('streamerPool', { list: [host()] });
  e.data.set('messages', [{ from: 'system', text: '江逾白 被移出了群聊' }]);
  assert.equal(e.context.normalizeGroupOwners(), true);
  assert.equal(group.liveHostId, 'host'); assert.equal(group.ownerId, 'host');
  assert.equal(group.liveHostName, '江逾白');
  assert.ok(group.charIds.includes('host')); assert.ok(group.adminIds.includes('host'));
  assert.deepEqual(group.mutedIds, ['fan']);
  assert.equal(e.context.charList.find(c => c.id === 'host').name, '江逾白');
  assert.equal(e.data.get('messages').length, 1, 'migration preserves chat history');
  assert.equal(e.context.normalizeGroupOwners(), false);
});

test('canonical streamer ID overrides a stale user ownerId', () => {
  const group = { ...legacy(), liveHostId: 'host', ownerId: 'u' }, e = env(group);
  assert.equal(e.context.groupOwnerId(group), 'host');
  e.context.normalizeGroupOwners();
  assert.equal(group.ownerId, 'host');
});

test('old private message sender metadata can recover a missing streamer profile', () => {
  const group = legacy(); group.charIds = ['fan']; group.adminIds = [];
  const e = env(group, { charList: [fan()] });
  e.data.set('live_pms', { host: [{ from: 'anchor', sender: { name: '江逾白', personality: '温柔' }, text: '你好' }] });
  e.context.normalizeGroupOwners();
  assert.equal(group.liveHostId, 'host');
  assert.equal(e.context.charList.find(c => c.id === 'host').personality, '温柔');
});

test('ambiguous or unavailable streamer identity never promotes a random fan to owner', () => {
  const group = legacy(); group.charIds = ['fan']; group.adminIds = ['fan'];
  const e = env(group, { charList: [fan()] });
  e.context.normalizeGroupOwners();
  assert.equal(e.context.groupOwnerId(group), '');
  assert.equal(e.context.groupOwner(group).name, '江逾白');
  assert.equal(e.context.groupOwner(group).isUser, false);
  assert.deepEqual(group.charIds, ['fan']);
});

test('ordinary groups retain user ownership and member management', () => {
  const group = { id: 'ordinary', charIds: ['fan'], adminIds: [] }, e = env(group);
  assert.equal(e.context.groupOwner(group).isUser, true);
  assert.equal(e.context.normalizeGroupOwners(), false);
  e.run(section('function openGroupMenu(g)', '// ===== 群聊小游戏'));
  e.context.openGroupMenu(group);
  assert.match(e.modals.at(-1).body.innerHTML, /class="_gckick /);
});

test('fan group opened directly from its list migrates before showing members', () => {
  const group = legacy(), e = env(group);
  e.run(section('window.openLiveGroupList =', 'pages.live=()=>'));
  e.context.openLiveGroupList();
  assert.equal(group.ownerId, 'host');
});

test('a regular fan sees a read-only roster and forged moderation callbacks cannot remove anyone', async () => {
  const group = legacy(), e = env(group);
  const kick = { dataset: { id: 'fan' } }, mute = { dataset: { id: 'fan' } }, admin = { dataset: { id: 'fan' } };
  e.forged['._gckick'] = [kick]; e.forged['._gcmute'] = [mute]; e.forged['._gcadmin'] = [admin];
  e.run(section('function openGroupMenu(g)', '// ===== 群聊小游戏'));
  e.context.openGroupMenu(group);
  assert.doesNotMatch(e.modals.at(-1).body.innerHTML, /class="_gc(?:kick|mute|admin) /);
  for (const button of [kick, mute, admin]) if (button.onclick) await button.onclick();
  assert.deepEqual(group.charIds, ['host', 'fan']);
  assert.deepEqual(group.adminIds, ['host']);
  assert.equal((group.mutedIds || []).length, 0);
  assert.equal(e.requests.length, 0);
  assert.equal(e.data.has('reaction'), false);
});

test('an explicitly appointed fan-group moderator still cannot kick the legacy streamer', async () => {
  const group = legacy(); group.adminIds.push('u');
  const e = env(group), kick = { dataset: { id: 'host' } };
  e.forged['._gckick'] = [kick];
  e.run(section('function openGroupMenu(g)', '// ===== 群聊小游戏'));
  e.context.openGroupMenu(group);
  await kick.onclick();
  assert.ok(group.charIds.includes('host')); assert.equal(e.requests.length, 0);
  assert.ok(e.alerts.length);
});

for (const mode of ['chat', 'drama']) test(`legacy ${mode} AI receives the streamer owner even after misinformation in history`, async () => {
  const group = legacy(); group.mode = mode;
  const e = env(group);
  e.run(section('async function callGroupAI(', '// 群聊菜单（增强版）'));
  await e.context.callGroupAI(group, e.context.charList, [{ from: 'host', text: '既然群主是你' }], [{ text: '谁是群主' }]);
  assert.equal(group.ownerId, 'host');
  assert.match(e.requests.at(-1).system, /群主[：是].*江逾白/);
  assert.match(e.requests.at(-1).system, /旧.*(?:错误|误称)|历史.*(?:错误|误称)/);
});

test('live PM follow-up supplies actual fan-group ownership instead of following the old false owner message', async () => {
  const group = legacy(), e = env(group, { _curPage: 'live' });
  e.data.set('streamerPool', { list: [host()] });
  e.data.set('live_pms', { host: [{ from: 'anchor', kind: 'fan-group', text: '既然群主是你，为何把我踢出群聊' }] });
  e.run(section('function appendLivePM(', 'window.openLiveGroupList ='));
  e.context.openLivePM('host');
  e.control('#_lpm_inp').value = '你才是群主吧？';
  await e.control('#_lpm_send').onclick();
  assert.match(e.requests.at(-1).system, /群主[：是].*江逾白/);
  assert.match(e.requests.at(-1).system, /普通粉丝/);
  assert.match(e.requests.at(-1).system, /旧.*(?:错误|误称)|历史.*(?:错误|误称)/);
  assert.equal(e.data.get('live_pms').host[0].text, '既然群主是你，为何把我踢出群聊', 'do not rewrite history');
});

for (const invalidate of ['switch slot', 'restore owner', 'revoke moderation', 'unmute', 'remove group']) {
  test(`pending moderation reply is discarded after ${invalidate}`, async () => {
    const group = legacy(); group.adminIds.push('u');
    let resolve;
    const reply = new Promise(done => { resolve = done; });
    const e = env(group, { askAI: () => reply });
    const mute = { dataset: { id: 'fan' } };
    e.forged['._gcmute'] = [mute];
    e.run(section('function openGroupMenu(g)', '// ===== 群聊小游戏'));
    e.context.openGroupMenu(group);
    mute.onclick();
    assert.ok(group.mutedIds.includes('fan'));
    if (invalidate === 'switch slot') e.data.set('slot', 'other');
    if (invalidate === 'restore owner') group.liveHostId = group.ownerId = 'fan';
    if (invalidate === 'revoke moderation') group.adminIds = ['host'];
    if (invalidate === 'unmute') group.mutedIds = [];
    if (invalidate === 'remove group') e.context.groups = [];
    resolve('为何禁言我');
    await reply; await Promise.resolve();
    assert.equal(e.data.has('reaction'), false);
  });
}

test('moderator can remove a fan and their reply retains the source group for follow-up', async () => {
  const group = legacy(); group.adminIds.push('u');
  const e = env(group, { _curPage: 'live' }), kick = { dataset: { id: 'fan' } };
  e.forged['._gckick'] = [kick];
  e.run(section('function appendLivePM(', 'window.openLiveGroupList ='));
  e.run(section('function openGroupMenu(g)', '// ===== 群聊小游戏'));
  e.context.openGroupMenu(group);
  kick.onclick();
  await new Promise(setImmediate);
  assert.ok(!group.charIds.includes('fan'));
  assert.equal(e.data.get('live_pms').fan[0].sourceGroupId, 'club');
  assert.match(e.context.livePMGroupContext('fan'), /群主：江逾白/);
  assert.match(e.context.livePMGroupContext('fan'), /任命的管理员/);
  e.context.openLivePM('fan');
  e.control('#_lpm_inp').value = '你先冷静一下';
  await e.control('#_lpm_send').onclick();
  const request = e.requests.at(-1);
  assert.match(request.system, /群主：江逾白/);
  assert.doesNotMatch(request.system, /你是主播小鱼/);
  assert.doesNotMatch(request.prompt, /主播：/);
  assert.match(request.prompt, /小鱼：/);
});

test('live PM result cannot write into a newly selected save slot', async () => {
  let resolve;
  const reply = new Promise(done => { resolve = done; });
  const e = env(legacy(), { askAI: () => reply });
  e.data.set('live_pms', { host: [{ from: 'anchor', sender: host(), text: '你好' }] });
  e.run(section('function appendLivePM(', 'window.openLiveGroupList ='));
  e.context.openLivePM('host');
  e.control('#_lpm_inp').value = '晚上好';
  const pending = e.control('#_lpm_send').onclick();
  e.data.set('slot', 'other');
  e.data.set('live_pms', {});
  resolve('旧存档的回复');
  await pending;
  assert.deepEqual(e.data.get('live_pms'), {});
});

for (const night of [true, false]) test(`live PM text backgrounds follow ${night ? 'night' : 'day'} mode before and after sending`, async () => {
  const e = env(legacy(), { isN: () => night });
  e.data.set('live_pms', { host: [{ from: 'anchor', sender: host(), text: '<测试>' }] });
  e.run(section('function appendLivePM(', 'window.openLiveGroupList ='));
  e.context.openLivePM('host');
  const expected = night ? /background:rgba\(255,255,255,.08\)/ : /background:rgba\(255,255,255,.8\)/;
  assert.match(e.modals.at(-1).body.innerHTML, expected);
  e.control('#_lpm_inp').value = '晚上好';
  await e.control('#_lpm_send').onclick();
  assert.match(e.control('#_lpm_list').innerHTML, expected);
});

test('main private chat prompt includes current fan-group facts after old false memories', () => {
  const group = legacy(), e = env(group, {
    _worldBookPromptText: () => '', getMemoryPromptText: () => '旧记忆：观众是群主，他把江逾白踢出群聊',
    getCharKnownList: () => [], getUserRel: () => null, pad: n => String(n).padStart(2, '0'),
    stickers: [], styleBooks: [], globalMemory: {}, memories: [], momentsData: [], C: host,
    _upcomingDateText: () => ''
  });
  e.run(section('function sysPrompt(', 'async function fetchModels('));
  const prompt = e.context.sysPrompt(true, e.context.charList[0], '谁是群主');
  assert.match(prompt, /群主：江逾白/);
  assert.match(prompt, /旧.*身份错误/);
  assert.ok(prompt.lastIndexOf('当前粉丝群身份') > prompt.indexOf('旧记忆'));
});

test('normal fans can invite a new fan without becoming group managers', async () => {
  const group = legacy(), e = env(group, { askAIJson: async () => ({ name: '新粉丝', personality: '活泼', firstMsg: '大家好' }) });
  e.run(section('function openGroupMenu(g)', '// ===== 群聊小游戏'));
  e.context.openGroupMenu(group);
  assert.match(e.modals.at(-1).body.innerHTML, /邀请好友入群/);
  assert.match(e.modals.at(-1).body.innerHTML, /邀请一位新粉丝入群/);
  await e.control('#_gcpullnpc').onclick();
  const added = e.context.charList.find(c => c.name === '新粉丝');
  assert.ok(group.charIds.includes(added.id));
  assert.equal(group.ownerId, 'host');
  assert.deepEqual(group.adminIds, ['host']);
  assert.match(e.data.get('messages')[0].text, /观众 邀请 新粉丝/);
});

test('normal fans can select an existing friend without API and without moderator rights', () => {
  const group = legacy(), e = env(group, { getApi: () => null });
  e.context.charList.push({ id: 'friend', name: '好友甲', bindPersonaId: 'p1' });
  const row = { dataset: { id: 'friend' } };
  e.forged['._gcinvitefriendrow'] = [row];
  e.run(section('function openGroupMenu(g)', '// ===== 群聊小游戏'));
  e.context.openGroupMenu(group);
  e.control('#_gcinvitefriend').onclick();
  row.onclick(); row.onclick();
  assert.equal(group.charIds.filter(id => id === 'friend').length, 1);
  assert.equal(group.ownerId, 'host'); assert.deepEqual(group.adminIds, ['host']);
  assert.match(e.data.get('messages')[0].text, /观众 邀请 好友甲/);
});

for (const format of ['labels', 'mixed', 'colon']) test(`fan-group parser preserves distinct speakers with ${format} output`, () => {
  const e = env(), members = [host(), fan()];
  const raw = format === 'labels' ? '【江逾白】\n晚上好\n【小鱼】\n主播好' : format === 'mixed' ? '【江逾白】\n晚上好\n小鱼：主播好' : '江逾白：晚上好\n小鱼：主播好';
  const replies = e.context.parseFanGroupReplies(raw, members, false);
  assert.deepEqual(Array.from(replies, r => r.charId), ['host', 'fan']);
});

test('fan names containing the streamer name match the exact member first', () => {
  const e = env();
  const replies = e.context.parseFanGroupReplies('【江逾白粉】\n我也在', [host(), { id: 'superfan', name: '江逾白粉' }], false);
  assert.equal(replies[0].charId, 'superfan');
});

test('unlabelled multi-person output is not silently attributed to the owner', () => {
  const e = env();
  assert.equal(e.context.parseFanGroupReplies('大家好\n收到', [host(), fan()], false).length, 0);
});

test('fan group asks missing fans for their own replies instead of accepting only the host', async () => {
  const group = legacy(), calls = [];
  const e = env(group, { askAI: async (system, prompt) => {
    calls.push({ system, prompt });
    return calls.length === 1 ? '【江逾白】\n晚上好' : '【小鱼】\n我也来了';
  } });
  e.run(section('async function callGroupAI(', '// 群聊菜单（增强版）'));
  const replies = await e.context.callGroupAI(group, e.context.charList, [], [{ text: '大家好' }]);
  assert.equal(calls.length, 2);
  assert.deepEqual(Array.from(new Set(replies.map(r => r.charId))), ['host', 'fan']);
  assert.match(calls[1].prompt, /只补写【小鱼】/);
});

test('fans who have not spoken are chosen ahead of recently active fans', () => {
  const group = legacy(), e = env(group);
  const fans = [fan(), { id: 'f2', name: '粉丝二' }, { id: 'f3', name: '粉丝三' }];
  const selected = e.context.fanGroupTurnMembers(group, [host(), ...fans], [{ from: 'fan' }, { from: 'f2' }]);
  assert.ok(selected.some(c => c.id === 'f3'));
  const all = e.context.fanGroupTurnMembers(group, [host(), ...fans], [], [], true);
  assert.equal(all.length, 4);
});

test('muted fans are never parsed or requested to join the response', async () => {
  const group = legacy(); group.mutedIds = ['fan'];
  const e = env(group, { askAI: async () => '【小鱼】\n不应发言\n【江逾白】\n晚上好' });
  e.run(section('async function callGroupAI(', '// 群聊菜单（增强版）'));
  const replies = await e.context.callGroupAI(group, e.context.charList, [], [{ text: '大家好' }]);
  assert.deepEqual(Array.from(replies, r => r.charId), ['host']);
});
