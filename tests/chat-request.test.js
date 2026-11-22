const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const helperSource = html.match(/const _chatRequestsInFlight=new Set\(\)[\s\S]*?(?=function saveMsgs\(cid,arr\)\s*\{)/);
assert.ok(helperSource, 'chat request lifecycle helpers exist');

function createHarness() {
  let uid = 0;
  const messages = new Map();
  const context = {
    uid: () => `request-${++uid}`,
    getMsgs: charId => messages.get(charId) || [],
    saveMsgs: (charId, value) => messages.set(charId, structuredClone(value)),
    saveGlobalMemory() {},
    AbortController,
    setTimeout,
    clearTimeout,
    structuredClone
  };
  vm.runInNewContext(`${helperSource[0]}\nglobalThis.api={
    begin:_beginChatRequest,
    snapshot:_snapshotPendingUserMessages,
    finishPending:_finishPendingUserMessages,
    rollback:_rollbackChatReply,
    restoreRegeneration:_restoreChatRegeneration,
    requests:_chatRequestsInFlight,
    regenerations:_chatRegenerationsInFlight
  }`, context);
  return { api: context.api, messages };
}

test('requests serialize per character while separate characters proceed independently', () => {
  const { api } = createHarness();
  const first = api.begin('char-a');
  assert.ok(first);
  assert.equal(api.begin('char-a'), null);
  const otherCharacter = api.begin('char-b');
  assert.ok(otherCharacter);

  assert.equal(first.finish(), true);
  const retry = api.begin('char-a');
  assert.ok(retry);
  assert.equal(first.finish(), false);
  assert.equal(api.requests.has('char-a'), true, 'an old request cannot release its successor');

  retry.finish();
  otherCharacter.finish();
  assert.equal(api.requests.size, 0);
});

test('request timeout aborts work, calls recovery, and releases only its own locks', async () => {
  const { api } = createHarness();
  const messages = [{ from: 'u', text: 'keep this', replied: false }];
  const snapshot = messages.map(message => ({ ...message }));
  const memory = { keyEvents: [{ text: 'old event' }] };
  const memorySnapshot = memory.keyEvents.slice();
  let timeouts = 0;
  const otherCharacter = api.begin('char-b');
  const timedOut = api.begin('char-a', {
    regeneration: true,
    timeoutMs: 10,
    onTimeout() {
      timeouts++;
      assert.equal(timedOut.signal.aborted, true);
      api.restoreRegeneration('char-a', snapshot, memory, memorySnapshot);
    }
  });
  assert.ok(timedOut);

  await new Promise(resolve => setTimeout(resolve, 30));

  assert.equal(timeouts, 1);
  assert.equal(timedOut.finish(), false);
  assert.equal(api.requests.has('char-a'), false);
  assert.equal(api.requests.has('char-b'), true);
  assert.equal(api.regenerations.has('char-a'), false);
  assert.deepEqual(messages, [{ from: 'u', text: 'keep this', replied: false }]);
  assert.deepEqual(JSON.parse(JSON.stringify(memory.keyEvents)), [{ text: 'old event' }]);
  assert.deepEqual(apiRequests(api), ['char-b']);
  otherCharacter.finish();
});

function apiRequests(api) {
  return [...api.requests];
}

test('successful replies mark only the captured pending messages as replied', () => {
  const { api } = createHarness();
  const captured = [
    { from: 'u', text: 'first', time: '10:00', replied: false },
    { from: 'u', text: 'already handled', time: '09:00', replied: true }
  ];
  const tokens = api.snapshot(captured);
  const arrivingDuringRequest = { from: 'u', text: 'second', time: '10:01', replied: false };
  const otherRoleMessage = { from: 'u', text: 'other character', replied: false };
  const current = [...captured, arrivingDuringRequest, otherRoleMessage];

  api.finishPending(current, tokens, true);

  assert.equal(captured[0].replied, true);
  assert.equal(captured[1].replied, true);
  assert.equal(arrivingDuringRequest.replied, false);
  assert.equal(otherRoleMessage.replied, false);
  assert.equal('_replyRequestToken' in captured[0], false);
});

test('failed replies restore the original conversation and retain messages sent meanwhile', () => {
  const { api, messages } = createHarness();
  const original = [
    { from: 'u', text: 'retry me', time: '10:00', replied: false },
    { from: 'c', text: 'old answer', time: '10:00' }
  ];
  const snapshot = original.map(message => ({ ...message }));
  const pendingTokens = api.snapshot(original);
  messages.set('char-a', [
    ...original.slice(0, 1),
    { from: 'u', text: 'new message', time: '10:01', replied: false },
    { from: 'c', text: 'partial answer' }
  ]);

  const restored = api.rollback('char-a', snapshot, pendingTokens);

  assert.deepEqual(JSON.parse(JSON.stringify(restored)), [
    { from: 'u', text: 'retry me', time: '10:00', replied: false },
    { from: 'c', text: 'old answer', time: '10:00' },
    { from: 'u', text: 'new message', time: '10:01', replied: false }
  ]);
  assert.deepEqual(messages.get('char-a'), JSON.parse(JSON.stringify(restored)));
});

test('ordinary reply and regeneration use cancellable owned request lifecycles', () => {
  const doReply = html.match(/const doReply=async\(\)=>\{[\s\S]*?\n  \}\n  \}\n\n\n  \/\/ 功能面板开关/);
  const regeneration = html.match(/const regenBtn = e\.target\.closest\('\._regen'\)[\s\S]*?\n    \}\n  \}\);/);
  assert.ok(doReply, 'ordinary reply flow exists');
  assert.ok(regeneration, 'regeneration flow exists');
  assert.match(doReply[0], /_beginChatRequest\(targetCharId/);
  assert.match(doReply[0], /\{signal:request\.signal\}/);
  assert.match(doReply[0], /_rollbackChatReply\(targetCharId,messageSnapshot,pendingTokens\)/);
  assert.match(regeneration[0], /_beginChatRequest\(targetCharId,\{[\s\S]*?regeneration:true/);
  assert.match(regeneration[0], /\{signal:request\.signal\}/);
  assert.match(regeneration[0], /_restoreRegen\(\)/);
});

test('feature-panel replies also isolate pending messages and follow request lifecycle', () => {
  const featureReply = html.match(/const funcReply=async\(userText,aiPrompt\)=>\{[\s\S]*?\n    \}\n\n    switch\(fn\)/);
  assert.ok(featureReply, 'feature-panel reply flow exists');
  assert.match(featureReply[0], /_beginChatRequest\(targetCharId/);
  assert.match(featureReply[0], /_snapshotPendingUserMessages\(\[userMessage\]\)/);
  assert.match(featureReply[0], /_finishPendingUserMessages\(newArr,pendingTokens,true\)/);
  assert.match(featureReply[0], /_finishPendingUserMessages\(current,pendingTokens,false\)/);
  assert.match(featureReply[0], /\{signal:request\.signal\}/);
});
