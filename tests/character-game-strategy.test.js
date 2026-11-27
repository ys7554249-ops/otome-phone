const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('const GAME_ROOM_KEY=');
const end = html.indexOf('\npages.games=()=>{', start);
assert.ok(start >= 0 && end > start);

function setup(type, response = null, random = 0) {
  const rooms = [];
  const requests = [];
  let id = 0;
  const math = Object.create(Math);
  math.random = () => random;
  const context = {
    Math: math,
    activePersonaId: 'persona-1',
    charList: [{ id: 'c1', name: 'Mina', bindPersonaId: 'persona-1' }],
    personaList: [{ id: 'persona-1', name: 'Player' }],
    P: () => ({ name: 'Player' }),
    getMyChars: () => context.charList,
    uid: () => `id-${++id}`,
    store: {
      get: (key, fallback) => key === 'characterGameRooms' ? structuredClone(rooms) : fallback,
      set(key, value) { if (key === 'characterGameRooms') rooms.splice(0, rooms.length, ...structuredClone(value)); }
    },
    getApi: () => ({ key: 'configured' }),
    callLLM: async request => {
      requests.push(JSON.parse(request.messages[0].content).game.summary);
      if (response instanceof Error) throw response;
      return response === null ? { ok: false } : { ok: true, text: JSON.stringify(response) };
    },
    _curPage: 'games',
    render() {}
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  const result = context.createCharacterGameRoom(type, context.charList);
  assert.equal(result.ok, true);
  result.room.currentTurn = 1;
  return { context, room: result.room, requests };
}

test('flight fallback finishes the best token and supplies full indexed context', async () => {
  const { context, room, requests } = setup('flight-chess');
  room.state.tokens = [[5, 10], [3, 36]];
  await context.runCharacterGameTurns(room);
  assert.equal(room.state.tokens[1][1], 37);
  const summary = requests[0];
  assert.equal(summary.playerIndex, 1);
  assert.deepEqual(summary.tokens, [[5, 10], [3, 36]]);
  assert.deepEqual(summary.finished, [0, 0]);
  assert.equal(summary.participants.length, 2);
  assert.equal(summary.rules.trackLength, 32);
  assert.equal(summary.rules.homeLength, 6);
  for (const key of ['launch', 'movement', 'sharedTrack', 'home', 'extraTurn', 'win']) assert.ok(summary.rules[key]);
  assert.equal(summary.candidates[0].tokenIndex, 1);
  assert.equal(summary.candidates[0].finishes, true);
  assert.equal(room.state.finished[1], 1);
});

test('flight corrects a clearly inferior legal choice to capture', async () => {
  const { context, room } = setup('flight-chess', { action: { tokenIndex: 0 } });
  room.state.tokens = [[19, -1], [0, 10]];
  await context.runCharacterGameTurns(room);
  assert.equal(room.state.tokens[1][1], 11);
  assert.equal(room.state.tokens[0][0], -1);
  assert.equal(room.state.extraTurn, true);
});

test('flight scores exposure after captures, safe home lanes and progress without mutation', () => {
  const { context, room } = setup('flight-chess');
  room.state.tokens = [[0, -1], [20, 25]];
  room.state.die = 6;
  const before = JSON.stringify(room.state);
  const candidates = context.scoreFlightCandidates(room, 1);
  assert.equal(candidates[0].tokenIndex, 1);
  assert.ok(candidates.find(c => c.tokenIndex === 0).risk > 0);
  assert.equal(JSON.stringify(room.state), before);
  room.state.die = 1;
  room.state.tokens = [[7, -1], [31, 37]];
  const safe = context.scoreFlightCandidates(room, 1);
  assert.equal(safe.length, 1);
  assert.equal(safe[0].destination, 32);
  assert.equal(safe[0].risk, 0);
  assert.equal(safe[0].progress, 1);
  room.state.tokens = [[19, -1], [10, 37]];
  const capture = context.scoreFlightCandidates(room, 1)[0];
  assert.equal(capture.captures, 1);
  assert.equal(capture.risk, 0);
});

test('flight preserves close model choices and rejects malformed token indexes', async () => {
  for (const tokenIndex of [1, null, '1', 9]) {
    const { context, room } = setup('flight-chess', { action: { tokenIndex } });
    room.state.tokens = [[-1, -1], [10, 9]];
    await context.runCharacterGameTurns(room);
    assert.deepEqual(Array.from(room.state.tokens[1]), tokenIndex === 1 ? [10, 10] : [11, 9]);
  }
});

test('flight handles launch, no legal moves, exact finish and game-winning fallback', async () => {
  const launch = setup('flight-chess', null, .999);
  await launch.context.runCharacterGameTurns(launch.room);
  assert.equal(launch.room.state.tokens[1][0], 0);
  const stuck = setup('flight-chess');
  await stuck.context.runCharacterGameTurns(stuck.room);
  assert.equal(stuck.requests.length, 0);
  assert.equal(stuck.room.currentTurn, 0);
  const win = setup('flight-chess', new Error('offline'));
  win.room.state.tokens[1] = [37, 36];
  win.room.state.finished[1] = 1;
  await win.context.runCharacterGameTurns(win.room);
  assert.equal(win.room.winner, 'c1');
  const overshoot = setup('flight-chess', null, .999);
  overshoot.room.state.tokens[1] = [35, 37];
  overshoot.room.state.die = 6;
  assert.equal(overshoot.context.scoreFlightCandidates(overshoot.room, 1).length, 0);
});

test('monopoly failure buys early with reserves and sends boolean protocol and complete state', async () => {
  const { context, room, requests } = setup('monopoly', new Error('offline'));
  await context.runCharacterGameTurns(room);
  assert.equal(room.state.ownership[2], 1);
  assert.equal(room.state.money[1], 940);
  const summary = requests[0];
  assert.equal(summary.playerIndex, 1);
  assert.equal(summary.participants.length, 2);
  assert.deepEqual(summary.legalActions, [{ buy: true }, { buy: false }]);
  assert.match(summary.legalAction, /boolean/);
  for (const key of ['board', 'positions', 'money', 'ownership', 'bankrupt', 'turnCount', 'dice']) assert.ok(key in summary.state);
  assert.equal(summary.state.board.length, 24);
  assert.equal(summary.state.positions[1], 2);
  assert.equal(summary.state.money[1], 1200);
  assert.equal(summary.rules.turnLimit, 120);
  assert.match(summary.rules.ranking, /highest cash.*property value is excluded/);
  assert.equal(summary.remainingTurns, 119);
  assert.equal(summary.recommendedBuy, true);
});

test('monopoly fallback respects cash reserves and remaining total turns', async () => {
  for (const [money, turns, expected] of [[1200, 0, true], [400, 0, false], [1200, 110, false], [1200, 119, false]]) {
    const { context, room } = setup('monopoly');
    room.state.money[1] = money;
    room.state.turnCount = turns;
    await context.runCharacterGameTurns(room);
    assert.equal(room.state.ownership[2] === 1, expected);
    assert.equal(room.state.turnCount, turns + 1);
    assert.equal(room.state.dice, null);
  }
});

test('monopoly honors explicit booleans and falls back for malformed responses', async () => {
  for (const [buy, expected] of [[true, true], [false, false], ['false', true], [null, true], [undefined, true]]) {
    const { context, room } = setup('monopoly', { action: { buy } });
    await context.runCharacterGameTurns(room);
    assert.equal(room.state.ownership[2] === 1, expected);
  }
  const { context, room, requests } = setup('monopoly', { action: { buy: true } });
  room.state.money[1] = 100;
  await context.runCharacterGameTurns(room);
  assert.equal(room.state.ownership[2], null);
  assert.equal(requests.length, 0);
  assert.equal(room.currentTurn, 0);
});
