const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function parseDungeonImport('), html.indexOf('function openDungeonImport(')), context);
const parse = (text, filename) => JSON.parse(JSON.stringify(context.parseDungeonImport(text, filename)));

test('text imports preserve full script and strip BOM', () => {
  for (const ext of ['txt', 'md']) {
    const result = parse('\uFEFF# Title\n<script>literal</script>\n规则', `story.${ext}`);
    assert.equal(result[0].scenario, '# Title\n<script>literal</script>\n规则');
    assert.equal(result[0].name, 'story');
  }
});

test('JSON imports accept collections and whitelist fields without copying identifiers', () => {
  const entry = { id: 'existing', name: 'Test', scenario: 'Script', rounds: 100, difficulty: 'hard', rules: 'Rules', worldBookIds: ['foreign'], npcAffection: { x: 90 } };
  for (const value of [entry, [entry], { dungeonTemplates: [entry] }]) {
    const result = parse(JSON.stringify(value), 'test.json')[0];
    assert.equal(result.rounds, 100);
    assert.equal(result.rules, 'Rules');
    assert.equal(result.id, undefined);
    assert.equal(result.npcAffection, undefined);
    assert.deepEqual(result.worldBookIds, []);
  }
  assert.equal(parse('{"content":"text","rounds":-1}', 'a.json')[0].rounds, 12);
});

test('invalid imports fail instead of producing empty templates', () => {
  for (const value of ['{', 'null', '[]', '{}', '[{"scenario":"valid"},{}]']) {
    assert.throws(() => parse(value, 'bad.json'));
  }
  assert.throws(() => parse('  ', 'empty.txt'));
  assert.throws(() => parse('text', 'a.pdf'));
});

test('import editor saves a fresh template only on confirmation', () => {
  const controls = new Map();
  const body = {
    innerHTML: '', querySelectorAll: () => [],
    querySelector(selector) {
      if (!controls.has(selector)) controls.set(selector, { value: '' });
      return controls.get(selector);
    }
  };
  let saves = 0;
  const existing = { id: 'existing', scenario: 'original' };
  const active = { templateId: 'existing' };
  const env = vm.createContext({
    dungeonTemplates: [existing], activeDungeon: active, uid: () => 'new-id',
    escHtml: String, showModal: (title, build) => build(body, () => {}),
    saveDungeonTemplates: () => saves++, render: () => {}
  });
  const start = html.indexOf('function openDungeonEditor(');
  vm.runInContext(html.slice(start, html.indexOf('// AI生成副本', start)), env);
  env.openDungeonEditor(undefined, parse('{"id":"existing","scenario":"imported"}', 'a.json')[0]);
  assert.equal(saves, 0);
  assert.equal(env.dungeonTemplates.length, 1);
  for (const [selector, value] of Object.entries({ _dgn: 'Imported', _dgd: '', _dgs: 'imported', _dgr: '', _dgru: 'rules', _dgro: '100' })) {
    body.querySelector('#' + selector).value = value;
  }
  body.querySelector('#_dgsv').onclick();
  assert.equal(saves, 1);
  assert.equal(env.dungeonTemplates[1].id, 'new-id');
  assert.equal(env.dungeonTemplates[1].scenario, 'imported');
  assert.equal(env.dungeonTemplates[0], existing);
  assert.equal(env.activeDungeon, active);
});
