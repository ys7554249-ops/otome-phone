const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('// ===== 情侣空间 =====');
const end = html.indexOf('pages.moments =', start);
assert.ok(start >= 0 && end > start);
const source = html.slice(start, end);
const key = 'slot_default::coupleSpace_owner';

function setup(seed = {}) {
  const values = structuredClone(seed);
  let id = 0;
  const context = {
    _currentSlot: 'default', activePersonaId: 'persona', activeCharId: 'owner', pages: {},
    personaList: [{id: 'persona'}],
    charList: [{id: 'a', name: 'A'}, {id: 'b', name: 'B'}],
    getMyChars: () => context.charList,
    uid: () => `id-${++id}`,
    store: {
      getRaw: (name, fallback) => values[name] ?? fallback,
      setRaw: (name, value) => { values[name] = structuredClone(value); }
    },
    askAI: async () => '「晚安」',
    isLLMError: value => value.startsWith('error'),
    URL: {createObjectURL: () => 'blob:photo', revokeObjectURL() {}}
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const space = context.coupleSpaceStore('owner', 'persona', 'default');
  return {context, space, values};
}

function bindAndPost(context, space) {
  assert.equal(context.coupleChangeBinding(space, space.read(), 'a'), true);
  const note = {id: 'note', from: 'u', text: '晚安'};
  space.update(data => { data.messages.push(note); });
  return {binding: space.read(), note};
}

test('character key takes priority and legacy data is claimed once without removing it', () => {
  const legacyKey = 'slot_default::coupleSpace_persona';
  const legacy = {partnerId: 'a', startDate: '2022-04-04', memories: [{imgId: 'img_old'}], tasks: [{id: 'old', done: true}], messages: [{from: 'c', text: '旧留言'}], extra: true};
  const {context, space, values} = setup({[legacyKey]: legacy});
  assert.deepEqual(values[legacyKey], legacy);
  assert.equal(space.read().startDate, legacy.startDate);
  assert.deepEqual(values[key], legacy);
  assert.equal(context.coupleSpaceStore('other', 'persona', 'default').read().partnerId, undefined);
  space.update(data => { data.partnerId = null; });
  assert.equal(space.read().partnerId, null);
  assert.deepEqual(values[legacyKey], legacy);
  assert.equal(values[key].extra, true);
  assert.equal(context.coupleMessageAuthor(legacy.messages[0], 'User'), '历史回复（作者未记录）');
});

test('unscoped legacy keys are adopted only with a clear persona and never override a current key', () => {
  const legacyKey = 'slot_default::coupleSpace';
  const legacy = {partnerId: 'missing', startDate: '2022-04-04'};
  const {context, space, values} = setup({[legacyKey]: legacy});
  context.personaList.push({id: 'other-persona'});
  assert.equal(space.read().partnerId, undefined);
  assert.equal(values[key], undefined);
  context.personaList.pop();
  assert.equal(space.read().partnerId, 'missing');
  const current = setup({[legacyKey]: legacy, [key]: {partnerId: null}});
  assert.equal(current.space.read().partnerId, null);
});

test('deleted or unbound partners can be replaced, and rebinding restores only the matching date', () => {
  const saved = {partnerId: 'a', startDate: '2021-06-20', memories: [{imgId: 'img_old'}], tasks: [{id: 'old', done: true}], messages: [{from: 'c', text: '旧留言'}]};
  const {context, space, values} = setup({[key]: saved});
  context.charList[0].isDeleted = true;
  assert.equal(context.couplePartner('a'), undefined);
  assert.equal(context.coupleChangeBinding(space, space.read(), 'a'), false);
  assert.equal(context.coupleChangeBinding(space, space.read(), null), true);
  assert.equal(values[key].pastBindings[0].startDate, saved.startDate);
  assert.equal(context.coupleChangeBinding(space, space.read(), 'b'), true);
  assert.notEqual(values[key].startDate, saved.startDate);
  context.charList[0].isDeleted = false;
  assert.equal(context.coupleChangeBinding(space, space.read(), 'a'), true);
  assert.equal(values[key].startDate, saved.startDate);
  for (const field of ['memories', 'tasks', 'messages']) assert.deepEqual(values[key][field], saved[field]);
});

test('anniversaries are added, edited and removed; calendar days and timeline handle legacy dates', () => {
  const {context, space, values} = setup();
  assert.equal(context.coupleTogetherDays('2024-02-28', new Date(2024, 2, 1)), 2);
  assert.equal(context.coupleTogetherDays('2024-02-30'), null);
  assert.equal(context.coupleTogetherDays('2024-03-02', new Date(2024, 2, 1)), 0);
  assert.equal(context.coupleSaveAnniversary(space, null, ' ', '2024-02-29'), false);
  assert.equal(context.coupleSaveAnniversary(space, null, 'First date', '2024-02-29'), true);
  const {id} = values[key].anniversaries[0];
  assert.equal(context.coupleSaveAnniversary(space, id, ' Updated ', '2024-03-01'), true);
  context.coupleSaveAnniversary(space, null, 'Future', '2024-04-01');
  space.update(data => {
    data.memories.push({imgId: 'img_old', date: '2024-03-02'});
    data.tasks.push({done: true, text: 'Walk', completedAt: '2024-03-03'});
    data.messages.push({from: 'c', text: 'Legacy', time: 'unparsed old timestamp'});
  });
  assert.deepEqual(Array.from(context.coupleTimeline(space.read(), 'Me', '2024-03-05'), row => row.text), ['Walk', '收藏了一张照片', 'Updated', 'Legacy']);
  assert.equal(context.coupleRemoveAnniversary(space, id), true);
  assert.equal(context.coupleSaveAnniversary(space, id, 'Stale', '2024-03-01'), false);
  assert.deepEqual(values[key].anniversaries.map(row => row.title), ['Future']);
});

test('concurrent photo and AI reply merge into the latest archive and preserve other writes', async () => {
  const {context, space, values} = setup();
  const {binding, note} = bindAndPost(context, space);
  const photo = Promise.withResolvers(), reply = Promise.withResolvers();
  context.saveImage = () => photo.promise;
  context.askAI = () => reply.promise;
  const uploading = context.coupleAddPhoto(space, {});
  const replying = context.coupleRequestReply(space, binding, context.charList[0], note, {});
  context.activeCharId = 'other';
  space.update(data => { data.tasks.push({id: 'task', done: true}); });
  reply.resolve(' 「晚安」 ');
  assert.equal(await replying, true);
  photo.resolve('img_new');
  assert.equal(await uploading, true);
  assert.deepEqual(values[key].messages.map(row => row.text), ['晚安', '晚安']);
  assert.equal(values[key].messages[1].authorName, 'A');
  assert.equal(values[key].memories[0].imgId, 'img_new');
  assert.equal(values[key].tasks[0].done, true);
  assert.equal(values['slot_default::coupleSpace_other'], undefined);
  assert.equal(await context.coupleRequestReply(space, binding, context.charList[0], note, {}), false);
});

for (const change of ['unbind', 'new partner', 'same partner rebound', 'deleted', 'slot switched', 'persona switched']) {
  test(`late reply is discarded after ${change}`, async () => {
    const {context, space, values} = setup();
    const {binding, note} = bindAndPost(context, space);
    const reply = Promise.withResolvers();
    context.askAI = () => reply.promise;
    const pending = context.coupleRequestReply(space, binding, context.charList[0], note, {});
    if (change === 'deleted') context.charList[0].isDeleted = true;
    else if (change === 'slot switched') context._currentSlot = 'different';
    else if (change === 'persona switched') context.activePersonaId = 'different';
    else {
      assert.equal(context.coupleChangeBinding(space, space.read(), null), true);
      if (change !== 'unbind') assert.equal(context.coupleChangeBinding(space, space.read(), change === 'new partner' ? 'b' : 'a'), true);
    }
    reply.resolve('late');
    assert.equal(await pending, false);
    assert.equal(values[key].messages.length, 1);
  });
}
