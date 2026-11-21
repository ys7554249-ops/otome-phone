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
  const open = html.indexOf('{', markerStart + marker.length);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth++;
    if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

const proposalSource = extractFunction('applyAssistantRoleProposal');
const personaProposalSource = extractFunction('createAssistantPersonaProposal');
const commitPersonaProposalSource = extractFunction('commitAssistantPersonaProposal');
const cancelPersonaProposalSource = extractFunction('cancelAssistantPersonaProposal');
const parseGreetingDraftsSource = extractFunction('parseAssistantGreetingDrafts');
const generateGreetingDraftsSource = extractFunction('generateAssistantGreetingDrafts');
const statusSource = extractFunction('getAssistantNotificationStatus');

function makeProposalContext() {
  const role = {
    id: 'role-1',
    name: '苏白',
    bindPersonaId: 'persona-1',
    personality: '温柔',
    relation: '朋友',
    quote: ''
  };
  const context = {
    activePersonaId: 'persona-1',
    charList: [role],
    personaList: [{ id: 'persona-1' }],
    saves: 0,
    saveCharList() { context.saves++; }
  };
  vm.createContext(context);
  vm.runInContext(proposalSource, context);
  return { context, role };
}

test('confirmed proposal updates only selected fields', () => {
  const { context, role } = makeProposalContext();
  const result = context.applyAssistantRoleProposal(
    { roleId: role.id },
    [{ field: 'personality', originalValue: '温柔', proposedValue: '温柔但有主见' }]
  );
  assert.equal(result.ok, true);
  assert.equal(role.personality, '温柔但有主见');
  assert.equal(role.relation, '朋友');
  assert.equal(context.saves, 1);
});

test('stale proposal preserves the newer role value', () => {
  const { context, role } = makeProposalContext();
  role.personality = '用户刚更新的设定';
  const result = context.applyAssistantRoleProposal(
    { roleId: role.id },
    [{ field: 'personality', originalValue: '温柔', proposedValue: '建议文本' }]
  );
  assert.equal(result.ok, false);
  assert.equal(role.personality, '用户刚更新的设定');
  assert.equal(context.saves, 0);
});

test('proposal cannot update another persona or unsupported fields', () => {
  const { context, role } = makeProposalContext();
  context.activePersonaId = 'persona-2';
  let result = context.applyAssistantRoleProposal(
    { roleId: role.id },
    [{ field: 'personality', originalValue: '温柔', proposedValue: '新文本' }]
  );
  assert.equal(result.ok, false);
  assert.equal(role.personality, '温柔');
  context.activePersonaId = 'persona-1';
  result = context.applyAssistantRoleProposal(
    { roleId: role.id },
    [{ field: 'affection', originalValue: '0', proposedValue: '100' }]
  );
  assert.equal(result.ok, false);
  assert.equal(role.affection, undefined);
  assert.equal(context.saves, 0);
});

test('persona proposal trims fields and remains transient', () => {
  const context = { uid: () => 'proposal-1', personaList: [{ id: 'existing', name: 'Existing' }] };
  vm.createContext(context);
  vm.runInContext(personaProposalSource, context);
  const before = structuredClone(context.personaList);
  const result = context.createAssistantPersonaProposal({
    name: '  New Persona  ', identity: ' Artist ', personality: ' Curious ', secret: ' Keeps a journal '
  });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.proposal)), {
    id: 'proposal-1', type: 'persona',
    values: { name: 'New Persona', identity: 'Artist', personality: 'Curious', secret: 'Keeps a journal' },
    status: 'pending'
  });
  assert.deepEqual(context.personaList, before);
});

test('persona proposal requires a name and rejects overlong or non-string fields', () => {
  const context = { uid: () => 'proposal-1', personaList: [] };
  vm.createContext(context);
  vm.runInContext(personaProposalSource, context);
  assert.equal(context.createAssistantPersonaProposal({ identity: 'Artist' }).reason, 'name');
  assert.equal(context.createAssistantPersonaProposal({ name: 'N'.repeat(61) }).reason, 'name');
  assert.equal(context.createAssistantPersonaProposal({ name: 'Valid', personality: 10 }).reason, 'personality');
});

test('persona proposal rejects duplicate names independent of case and compatibility width', () => {
  const context = { uid: () => 'proposal-1', personaList: [{ name: 'Ｆｌｏｗｅｒ' }] };
  vm.createContext(context);
  vm.runInContext(personaProposalSource, context);
  assert.equal(context.createAssistantPersonaProposal({ name: 'flower' }).reason, 'duplicate');
});

test('persona proposal commits only after confirmation and switches active persona', () => {
  const context = {
    uid: () => 'persona-2', genWcId: () => 'wechat-2', activePersonaId: 'persona-1',
    personaList: [{ id: 'persona-1', name: 'Existing' }], saves: 0,
    savePersonaList() { context.saves++; }
  };
  vm.createContext(context);
  vm.runInContext(`${personaProposalSource}\n${commitPersonaProposalSource}`, context);
  const { proposal } = context.createAssistantPersonaProposal({ name: 'New Persona', identity: 'Artist' });
  const result = context.commitAssistantPersonaProposal(proposal);
  assert.equal(result.ok, true);
  assert.equal(context.personaList.length, 2);
  assert.equal(context.activePersonaId, 'persona-2');
  assert.equal(context.personaList[1].identity, 'Artist');
  assert.equal(context.saves, 1);
  assert.equal(context.commitAssistantPersonaProposal(proposal).ok, false);
});

test('duplicate added after proposal creation prevents commit without changing active persona', () => {
  const context = {
    uid: () => 'new-id', genWcId: () => 'wechat', activePersonaId: 'original',
    personaList: [{ id: 'original', name: 'Existing' }], saves: 0,
    savePersonaList() { context.saves++; }
  };
  vm.createContext(context);
  vm.runInContext(`${personaProposalSource}\n${commitPersonaProposalSource}`, context);
  const { proposal } = context.createAssistantPersonaProposal({ name: 'New Persona' });
  context.personaList.push({ id: 'raced', name: 'new persona' });
  const result = context.commitAssistantPersonaProposal(proposal);
  assert.equal(result.reason, 'duplicate');
  assert.equal(context.activePersonaId, 'original');
  assert.equal(context.saves, 0);
});

test('cancelling a persona proposal prevents later confirmation', () => {
  const context = {
    uid: () => 'proposal-1', personaList: [],
    activePersonaId: 'original', savePersonaList() { throw new Error('should not save'); }
  };
  vm.createContext(context);
  vm.runInContext(`${personaProposalSource}\n${commitPersonaProposalSource}\n${cancelPersonaProposalSource}`, context);
  const { proposal } = context.createAssistantPersonaProposal({ name: 'New Persona' });
  const proposals = new Map([[proposal.id, proposal]]);
  assert.equal(context.cancelAssistantPersonaProposal(proposal.id, proposals), true);
  assert.equal(context.commitAssistantPersonaProposal(proposal).reason, 'expired');
  assert.equal(context.personaList.length, 0);
});

test('greeting draft parser accepts JSON arrays and caps drafts at three', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(parseGreetingDraftsSource, context);
  const drafts = context.parseAssistantGreetingDrafts(JSON.stringify([' One ', '', 'Two', 'Three', 'Four']));
  assert.deepEqual(JSON.parse(JSON.stringify(drafts)), ['One', 'Two', 'Three']);
  assert.deepEqual(JSON.parse(JSON.stringify(context.parseAssistantGreetingDrafts('not JSON'))), []);
});

test('greeting generation sends only bounded character, bound persona, and optional scene data', async () => {
  const callLLM = async options => {
    context.request = options;
    return { ok: true, text: JSON.stringify(['Draft one', 'Draft two', 'Draft three']) };
  };
  const context = { callLLM };
  vm.createContext(context);
  vm.runInContext(`${parseGreetingDraftsSource}\n${generateGreetingDraftsSource}`, context);
  const result = await context.generateAssistantGreetingDrafts({
    name: 'Role', personality: 'Warm', relation: 'Neighbor', status: 'At home', quote: 'Hello'
  }, { name: 'Persona', identity: 'Writer', personality: 'Curious' }, 'Rainy day reunion');
  assert.equal(result.ok, true);
  assert.equal(result.drafts.length, 3);
  assert.deepEqual(JSON.parse(context.request.messages[0].content), {
    character: { name: 'Role', relation: 'Neighbor', personality: 'Warm', mood: '', status: 'At home', speakingStyle: 'Hello' },
    userPersona: { name: 'Persona', identity: 'Writer', personality: 'Curious' },
    sceneRequest: 'Rainy day reunion'
  });
  assert.equal(context.request.stream, false);
  assert.equal(context.request.timeout, 60000);
});

test('greeting generation reports invalid characters and model failures', async () => {
  const emptyContext = {};
  vm.createContext(emptyContext);
  vm.runInContext(`${parseGreetingDraftsSource}\n${generateGreetingDraftsSource}`, emptyContext);
  assert.equal((await emptyContext.generateAssistantGreetingDrafts(null, null)).ok, false);

  const failedContext = { callLLM: async () => ({ ok: false, text: 'API unavailable' }) };
  vm.createContext(failedContext);
  vm.runInContext(`${parseGreetingDraftsSource}\n${generateGreetingDraftsSource}`, failedContext);
  assert.equal((await failedContext.generateAssistantGreetingDrafts({ name: 'Role' }, null)).error, 'API unavailable');
});

test('greeting generation requires three usable drafts', async () => {
  const context = { callLLM: async () => ({ ok: true, text: '["Only one"]' }) };
  vm.createContext(context);
  vm.runInContext(`${parseGreetingDraftsSource}\n${generateGreetingDraftsSource}`, context);
  const result = await context.generateAssistantGreetingDrafts({ name: 'Role' }, null);
  assert.equal(result.ok, false);
  assert.match(result.error, /3 个/);
});

test('notification diagnostics report capability state without secret values', async () => {
  const context = {
    Notification: { permission: 'granted' },
    navigator: { serviceWorker: { controller: {}, getRegistration: async () => ({ active: {} }) } },
    store: { get: key => key === 'autoBgMsgEnabled' },
    apiList: [{ id: 'selected', key: 'secret-value', model: 'test-model' }],
    activeApiId: 'selected'
  };
  vm.createContext(context);
  vm.runInContext(statusSource, context);
  const status = await context.getAssistantNotificationStatus();
  assert.equal(status.notificationSupported, true);
  assert.equal(status.permission, 'granted');
  assert.equal(status.serviceWorker, 'active');
  assert.equal(status.proactiveMessagesEnabled, true);
  assert.equal(status.apiConfigured, true);
  assert.equal(JSON.stringify(status).includes('secret-value'), false);
});

test('notification diagnostics handle unsupported APIs and missing registration', async () => {
  const context = {
    navigator: { serviceWorker: { getRegistration: async () => undefined } },
    store: { get: () => false },
    apiList: [],
    activeApiId: ''
  };
  vm.createContext(context);
  vm.runInContext(statusSource, context);
  const status = await context.getAssistantNotificationStatus();
  assert.equal(status.notificationSupported, false);
  assert.equal(status.permission, 'unsupported');
  assert.equal(status.serviceWorker, 'missing');
  assert.equal(status.proactiveMessagesEnabled, false);
  assert.equal(status.apiConfigured, false);
});

test('notification diagnostics ignore API credentials without a model', async () => {
  const context = {
    Notification: { permission: 'default' },
    navigator: {},
    store: { get: () => false },
    apiList: [{ id: 'selected', key: 'secret-value', model: '' }],
    activeApiId: 'selected'
  };
  vm.createContext(context);
  vm.runInContext(statusSource, context);
  const status = await context.getAssistantNotificationStatus();
  assert.equal(status.apiConfigured, false);
  assert.equal(JSON.stringify(status).includes('secret-value'), false);
});
