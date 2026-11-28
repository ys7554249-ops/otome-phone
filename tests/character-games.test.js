const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('const GAME_ROOM_KEY=');
const end = html.indexOf('\npages.games=()=>{', start);
assert.notEqual(start, -1, 'game engine exists in index.html');
assert.notEqual(end, -1, 'game engine ends before the lobby renderer');
const gameEngineSource = html.slice(start, end);

function createGameContext(overrides = {}) {
  const rooms = [];
  let id = 0;
  const context = {
    activePersonaId: 'persona-1',
    charList: [{ id: 'character-1', name: 'Mina', bindPersonaId: 'persona-1' }],
    personaList: [{ id: 'persona-1', name: 'Player' }],
    P: () => ({ name: 'Player' }),
    getMyChars: () => context.charList.filter(character => character.bindPersonaId === context.activePersonaId),
    uid: () => `id-${++id}`,
    store: {
      get(key, fallback) { return key === 'characterGameRooms' ? structuredClone(rooms) : fallback; },
      set(key, value) { if (key === 'characterGameRooms') rooms.splice(0, rooms.length, ...structuredClone(value)); }
    },
    getApi: () => ({ key: 'configured' }),
    callLLM: async () => ({ ok: false }),
    _curPage: 'games',
    render() {},
    ...overrides
  };
  vm.createContext(context);
  vm.runInContext(gameEngineSource, context);
  return context;
}

function createRoom(context, gameType = 'gomoku', characterCount = 1) {
  const characters = context.charList.slice(0, characterCount);
  const result = context.createCharacterGameRoom(gameType, characters);
  assert.equal(result.ok, true);
  return result.room;
}

test('legacy routine notices are hidden while dialogue and useful errors remain', () => {
  const context = createGameContext();
  const room = createRoom(context);
  context.addCharacterGameChat(room, 'system', 'Mina 根据局面策略完成了这回合。');
  context.addCharacterGameChat(room, 'user', '聊聊天');
  context.addCharacterGameChat(room, 'character-1', '轮到你啦');
  context.addCharacterGameChat(room, 'system', '角色聊天需要先配置聊天 API。');
  context.persistCharacterGameRoom(room);
  const loaded = context.loadCharacterGameRooms()[0];
  assert.equal(loaded.chat.length, 3);
  assert.equal(loaded.chat[0].text, '聊聊天');
  assert.equal(loaded.chat[2].text, '角色聊天需要先配置聊天 API。');
});

test('local strategy advances a turn without adding routine chat notices', async () => {
  const context = createGameContext({ getApi: () => null });
  const room = createRoom(context);
  room.currentTurn = 1;
  await context.runCharacterGameTurns(room);
  assert.equal(room.state.moves, 1);
  assert.equal(room.chat.length, 0);
  assert.ok(room.log.length > 0);
});

test('game lobby displays the avatar and name without rendering raw character card data', () => {
  const createButton = {};
  const body = { style: {}, querySelector: () => createButton, querySelectorAll: () => [] };
  const page = { style: {}, appendChild() {} };
  const modalControl = { value: 'gomoku', addEventListener() {} };
  const modal = { querySelector: () => modalControl, querySelectorAll: () => [] };
  const context = createGameContext({
    charList: [{ id: 'mina', name: 'Mina & Co.', avatar: 'mina-avatar', bindPersonaId: 'persona-1', personality: '<character>\n```yaml\nbackground_story: internal card notes\n```\n</character>' }],
    pages: {}, isN: () => false, topBar() {}, app: { appendChild() {} },
    ce: (_tag, className) => className === 'page' ? page : body,
    escHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    avatarEl: avatar => `<img src="${avatar}">`,
    showModal: (_title, draw) => draw(modal, () => {})
  });
  const lobbyEnd = html.indexOf('\npages.gameroom=()=>{', end);
  assert.ok(lobbyEnd > end);
  vm.runInContext(html.slice(end, lobbyEnd), context);
  context.pages.games();
  createButton.onclick();
  assert.match(modal.innerHTML, /class="_game_char" value="mina"/);
  assert.match(modal.innerHTML, /<img src="mina-avatar">/);
  assert.match(modal.innerHTML, /Mina &amp; Co\./);
  assert.doesNotMatch(modal.innerHTML, /<character>|&lt;character|```yaml|internal card notes/);
});

test('room creation enforces supported player counts and persists bounded history', () => {
  const context = createGameContext({
    charList: [
      { id: 'c1', name: 'One', bindPersonaId: 'persona-1' },
      { id: 'c2', name: 'Two', bindPersonaId: 'persona-1' },
      { id: 'c3', name: 'Three', bindPersonaId: 'persona-1' },
      { id: 'foreign', name: 'Foreign', bindPersonaId: 'persona-2' }
    ]
  });
  assert.equal(context.createCharacterGameRoom('gomoku', []).ok, false);
  assert.equal(context.createCharacterGameRoom('unknown', [context.charList[0]]).ok, false);
  assert.equal(context.createCharacterGameRoom('gomoku', [context.charList[0], context.charList[0]]).ok, false);
  assert.equal(context.createCharacterGameRoom('gomoku', context.charList.slice(0, 4)).ok, false);
  assert.equal(context.createCharacterGameRoom('monopoly', context.charList.slice(0, 3)).ok, true);
  assert.equal(context.createCharacterGameRoom('gomoku', [context.charList[3]]).ok, false);

  for (let index = 0; index < 52; index++) {
    const room = createRoom(context);
    room.id = `room-${index}`;
    context.persistCharacterGameRoom(room);
  }
  assert.equal(context.loadCharacterGameRooms().length, 50);
  assert.equal(context.loadCharacterGameRooms()[0].id, 'room-2');
});

test('room restoration skips corrupt game state and bounds saved chat and log history', () => {
  const context = createGameContext();
  const valid = createRoom(context);
  const corrupt = structuredClone(valid);
  corrupt.id = 'corrupt';
  corrupt.state.board = [];
  context.store.set('characterGameRooms', [valid, corrupt]);
  assert.deepEqual(context.loadCharacterGameRooms().map(room => room.id), [valid.id]);

  valid.chat = Array.from({ length: 305 }, (_, index) => ({ id: `chat-${index}`, from: 'user', text: `chat-${index}` }));
  valid.log = Array.from({ length: 505 }, (_, index) => ({ id: `log-${index}`, text: `log-${index}` }));
  context.persistCharacterGameRoom(valid);
  const restored = context.loadCharacterGameRooms()[0];
  assert.equal(restored.chat.length, 300);
  assert.equal(restored.log.length, 500);
});

test('Gomoku rejects invalid cells and detects wins on all four axes', () => {
  const axes = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of axes) {
    const context = createGameContext();
    const room = createRoom(context);
    const row = dr === 1 ? 5 : 7;
    const col = dc === -1 ? 8 : 5;
    for (let offset = 0; offset < 4; offset++) room.state.board[row + dr * offset][col + dc * offset] = 0;
    assert.equal(context.applyGomokuMove(room, 0, row + dr * 4, col + dc * 4).winner, 'user');
    assert.equal(room.status, 'completed');
  }

  const context = createGameContext();
  const room = createRoom(context);
  assert.equal(context.applyGomokuMove(room, 0, -1, 0).ok, false);
  context.applyGomokuMove(room, 0, 0, 0);
  const snapshot = structuredClone(room.state);
  assert.equal(context.applyGomokuMove(room, 1, 0, 0).ok, false);
  assert.equal(JSON.stringify(room.state), JSON.stringify(snapshot));
});

test('Gomoku declares a draw when the final legal cell fills a board without a five-in-a-row', () => {
  const context = createGameContext();
  const room = createRoom(context);
  room.state.board = Array.from({ length: 15 }, (_, row) =>
    Array.from({ length: 15 }, (_, col) => (row + 2 * col) % 4 < 2 ? 0 : 1));
  room.state.board[14][14] = null;
  room.state.moves = 224;
  assert.equal(context.gomokuWinner(room.state.board, 14, 14, 0), false);

  const result = context.applyGomokuMove(room, 0, 14, 14);
  assert.equal(result.draw, true);
  assert.equal(room.status, 'completed');
});

test('Flight Chess launches on six, captures only shared-track tokens, and wins after both finish', () => {
  const context = createGameContext();
  const room = createRoom(context, 'flight-chess');
  const roll = context.rollFlightDie(room, 0, () => .999);
  assert.equal(roll.value, 6);
  assert.deepEqual(JSON.parse(JSON.stringify(roll.moves.map(move => move.index))), [0, 1]);
  assert.equal(context.resolveFlightMove(room, 0, 0).ok, true);
  assert.equal(room.state.tokens[0][0], 0);
  assert.equal(room.state.extraTurn, true);

  room.currentTurn = 0;
  room.state.die = 1;
  room.state.tokens[0][0] = 0;
  room.state.tokens[1][0] = 25;
  const capture = context.resolveFlightMove(room, 0, 0);
  assert.equal(capture.captured, true);
  assert.equal(room.state.tokens[1][0], -1);
  assert.equal(room.state.extraTurn, true);

  room.currentTurn = 0;
  room.state.die = 1;
  room.state.tokens[0][0] = 36;
  room.state.finished[0] = 1;
  const win = context.resolveFlightMove(room, 0, 0);
  assert.equal(win.winner, 'user');
  assert.equal(room.status, 'completed');
});

test('Mini Monopoly awards salary, transfers rent, and ends a purchase turn', () => {
  const context = createGameContext();
  const room = createRoom(context, 'monopoly');
  room.state.positions[0] = 23;
  const salary = context.rollMonopolyDie(room, 0, () => 0);
  assert.equal(salary.space.type, 'property');
  assert.equal(room.state.money[0], 1400);
  assert.equal(salary.canBuy, true);
  assert.equal(context.buyMonopolyProperty(room, 0, true).bought, true);
  assert.equal(room.state.ownership[1], 0);
  assert.equal(room.currentTurn, 1);

  room.state.positions[1] = 23;
  const moneyBefore = room.state.money[1];
  const rentBefore = room.state.money[0];
  const rent = context.rollMonopolyDie(room, 1, () => 0);
  assert.match(rent.event, /租金/);
  assert.equal(room.state.money[1], moneyBefore + 200 - room.state.board[1].rent);
  assert.equal(room.state.money[0], rentBefore + room.state.board[1].rent);
});

test('Mini Monopoly resolves chance gains and bankrupt fees, releasing the bankrupt player property', () => {
  const context = createGameContext();
  const luckyRoom = createRoom(context, 'monopoly');
  luckyRoom.state.positions[0] = 4;
  const chance = context.rollMonopolyDie(luckyRoom, 0, () => 0);
  assert.equal(chance.space.type, 'chance');
  assert.equal(luckyRoom.state.money[0], 1300);

  const bankruptRoom = createRoom(context, 'monopoly');
  bankruptRoom.state.positions[0] = 5;
  bankruptRoom.state.money[0] = 30;
  bankruptRoom.state.ownership[1] = 0;
  const fee = context.rollMonopolyDie(bankruptRoom, 0, () => 0);
  assert.equal(fee.space.type, 'fee');
  assert.equal(bankruptRoom.state.bankrupt[0], true);
  assert.equal(bankruptRoom.state.ownership[1], null);
  assert.equal(bankruptRoom.status, 'completed');
  assert.equal(bankruptRoom.winner, bankruptRoom.participants[1].id);
});

test('a rejected character API request makes a legal fallback move and keeps the game playable', async () => {
  const context = createGameContext({
    callLLM: async () => { throw new Error('network unavailable'); },
    charList: [{ id: 'character-1', name: 'Mina', bindPersonaId: 'persona-1' }]
  });
  const room = createRoom(context);
  room.currentTurn = 1;
  await context.runCharacterGameTurns(room);

  assert.equal(room.state.board[7][7], 1);
  assert.equal(room.currentTurn, 0);
  assert.equal(room.chat.length, 0);
  assert.equal(room.status, 'playing');
});

test('an illegal character action uses the same deterministic legal fallback', async () => {
  const context = createGameContext({
    callLLM: async () => ({ ok: true, text: JSON.stringify({ action: { row: 99, col: 99 }, dialogue: 'Try an invalid move' }) }),
    charList: [{ id: 'character-1', name: 'Mina', bindPersonaId: 'persona-1' }]
  });
  const room = createRoom(context);
  room.currentTurn = 1;
  await context.runCharacterGameTurns(room);

  assert.equal(room.state.board[7][7], 1);
  assert.equal(room.chat.length, 1);
  assert.equal(room.chat[0].text, 'Try an invalid move');
});

test('gomoku wins and blocks on every axis even when the model chooses a legal weak move', async () => {
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    for (const owner of [0, 1]) {
      const context = createGameContext({
        callLLM: async () => ({ ok: true, text: '{"action":{"row":0,"col":0}}' })
      });
      const room = createRoom(context);
      room.currentTurn = 1;
      room.state.board[7 - dr][7 - dc] = 1 - owner;
      for (let i = 0; i < 4; i++) room.state.board[7 + dr * i][7 + dc * i] = owner;
      room.state.moves = 5;
      await context.runCharacterGameTurns(room);
      assert.equal(room.state.board[7 + dr * 4][7 + dc * 4], 1);
      assert.equal(room.status, owner === 1 ? 'completed' : 'playing');
    }
  }
});

test('gomoku prefers winning to blocking and recognizes split threats from any opponent', () => {
  const context = createGameContext({ charList: [
    { id: 'c1', name: 'One', bindPersonaId: 'persona-1' },
    { id: 'c2', name: 'Two', bindPersonaId: 'persona-1' }
  ] });
  const room = createRoom(context, 'gomoku', 2);
  for (const col of [3, 4, 6, 7]) room.state.board[5][col] = 2;
  let move = context.rankGomokuMoves(room, 1)[0];
  assert.deepEqual([move.row, move.col], [5, 5]);
  for (let col = 3; col < 7; col++) room.state.board[10][col] = 1;
  move = context.rankGomokuMoves(room, 1)[0];
  assert.equal(move.row, 10);
  assert.equal(move.priority, 2);
});

test('gomoku builds an open four and supplies identity and ranked legal choices to the model', async () => {
  let request;
  const context = createGameContext({ callLLM: async options => {
    request = JSON.parse(options.messages[0].content);
    return { ok: true, text: '{"action":{"row":null,"col":""}}' };
  } });
  const room = createRoom(context);
  room.currentTurn = 1;
  for (const col of [6, 7, 8]) room.state.board[7][col] = 1;
  await context.runCharacterGameTurns(room);
  assert.ok(room.state.board[7][5] === 1 || room.state.board[7][9] === 1);
  assert.equal(request.game.summary.selfPlayerIndex, 1);
  assert.equal(request.game.summary.players.length, 2);
  assert.ok(request.game.summary.legalActions.length > 0);
  assert.equal(room.state.board[0][0], null);
});

test('game-room chat replies leave the persisted game state unchanged', async () => {
  const context = createGameContext({
    callLLM: async () => ({ ok: true, text: 'Mina: 好呀，继续加油。' }),
    charList: [{ id: 'character-1', name: 'Mina', bindPersonaId: 'persona-1', personality: '热情' }],
    _curPage: 'gameroom'
  });
  const room = createRoom(context);
  const stateBefore = JSON.stringify(room.state);
  context.addCharacterGameChat(room, 'user', '下一步走这里吗？');
  await context.appendCharacterGameChatReply(room, '下一步走这里吗？');

  assert.equal(JSON.stringify(room.state), stateBefore);
  assert.equal(room.chat.length, 2);
  assert.equal(room.chat[1].from, 'character-1');
  assert.match(room.chat[1].text, /继续加油/);
});

test('a character who cannot afford an unowned property completes the Monopoly turn', async () => {
  const context = createGameContext({
    callLLM: async () => { throw new Error('network unavailable'); },
    charList: [{ id: 'character-1', name: 'Mina', bindPersonaId: 'persona-1' }],
    Math: Object.assign(Object.create(Math), { random: () => 0 })
  });
  const room = createRoom(context, 'monopoly');
  room.currentTurn = 1;
  room.state.money[1] = 0;
  await context.runCharacterGameTurns(room);

  assert.equal(room.currentTurn, 0);
  assert.equal(room.state.dice, null);
  assert.equal(room.status, 'playing');
});
