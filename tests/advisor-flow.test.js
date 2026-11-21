const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const advisor = html.match(/^([ \t]*)function _asOpenRoleAdvisor\(\)\{[\s\S]*?^\1\}/m);
assert.ok(advisor, 'advisor function exists in index.html');

function openAdvisor(t) {
  const role = {
    id: 'chosen', bindPersonaId: 'p1', name: 'Ada', personality: 'patient',
    relation: 'friend', quote: 'Take your time.', messages: ['PRIVATE-chat'],
    worldBookIds: ['world', 'disabled-world'], styleBookIds: ['style', 'disabled-style']
  };
  const controls = {};
  const checkbox = { checked: false, dataset: { index: '0' } };
  const modal = {
    querySelector(selector) {
      return controls[selector] ??= {
        addEventListener(event, handler) { this[event] = () => handler({ currentTarget: this }); }
      };
    },
    querySelectorAll(selector) {
      assert.equal(selector, '._asproposal:checked');
      return checkbox.checked ? [checkbox] : [];
    }
  };
  modal.querySelector('#_asrole').value = role.id;
  const close = t.mock.fn();
  const callLLM = t.mock.fn(async () => ({ ok: true, text: JSON.stringify({
    proposals: [{ field: 'personality', value: 'More decisive', reason: 'Clarify the trait' }]
  }) }));
  const context = {
    charList: [{ id: 'other', name: 'PRIVATE-other-role', bindPersonaId: 'p1' }, role,
      { id: 'foreign', name: 'PRIVATE-foreign-role', bindPersonaId: 'p2' }],
    personaList: [{ id: 'p1', name: 'PRIVATE-persona' }], activePersonaId: 'p1',
    apiList: [{ id: 'api', key: 'PRIVATE-test-key', model: 'mock' }], activeApiId: 'api',
    worldBooks: [
      { id: 'world', title: 'Harbor', triggers: 'sea', content: 'High tide' },
      { id: 'disabled-world', enabled: false, content: 'PRIVATE-disabled-world' },
      { id: 'unlinked-world', enabled: true, content: 'PRIVATE-unlinked-world' }
    ],
    styleBooks: [
      { id: 'style', title: 'Narration', position: 'system', content: 'Short sentences' },
      { id: 'disabled-style', enabled: false, content: 'PRIVATE-disabled-style' },
      { id: 'unlinked-style', enabled: true, content: 'PRIVATE-unlinked-style' }
    ],
    escHtml: String, callLLM, showModal: (_, render) => render(modal, close),
    applyAssistantRoleProposal: t.mock.fn(), saveCharList: t.mock.fn()
  };
  vm.runInNewContext(`${advisor[0]}\n_asOpenRoleAdvisor()`, context);
  return { context, controls, checkbox, close };
}

test('advisor sends only the chosen role fields and enabled linked material', async t => {
  const { context, controls } = openAdvisor(t);
  await controls['#_asreview'].click();
  assert.equal(context.callLLM.mock.callCount(), 1);
  const [{ api, system, messages }] = context.callLLM.mock.calls[0].arguments;
  assert.equal(api, context.apiList[0]);
  assert.doesNotMatch(JSON.stringify({ system, messages }), /PRIVATE-/);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'user');
  assert.deepEqual(JSON.parse(messages[0].content), {
    role: { name: 'Ada', personality: 'patient', relation: 'friend', quote: 'Take your time.' },
    worldBooks: [{ title: 'Harbor', triggers: 'sea', content: 'High tide' }],
    presets: [{ title: 'Narration', position: 'system', content: 'Short sentences' }]
  });
});

test('closing a reviewed proposal discards even a checked change', async t => {
  const { context, controls, checkbox, close } = openAdvisor(t);
  const before = structuredClone(context.charList);
  await controls['#_asreview'].click();
  assert.match(controls['#_asresult'].innerHTML, /class="_asproposal" data-index="0"/);
  assert.match(controls['#_asresult'].innerHTML, /More decisive/);
  checkbox.checked = true;
  await controls['#_asadvisorclose'].click();
  assert.equal(close.mock.callCount(), 1);
  assert.equal(context.applyAssistantRoleProposal.mock.callCount(), 0);
  assert.equal(context.saveCharList.mock.callCount(), 0);
  assert.deepEqual(context.charList, before);
});
