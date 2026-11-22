const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `${name} exists`);
  const open = html.indexOf('{', start + marker.length);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth++;
    if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

const source = [
  extractFunction('_fillCharUser'),
  extractFunction('_recentUserText'),
  extractFunction('_wbTriggersHit'),
  extractFunction('_worldBookPromptText')
].join('\n');

test('main reply flow builds its system prompt from the request character and text', () => {
  assert.match(html, /function sysPrompt\(stableOnly,c=C\(\),turnText=''\)/);
  assert.match(html, /const sys = sysPrompt\(true,c,userMsgStr\|\|''\);/);
});

function makeContext({ selectedCharacter, activeCharacter, books, messages = [] }) {
  const context = {
    worldBooks: books,
    getMsgs: () => messages,
    P: () => ({ name: 'User' })
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, selectedCharacter, activeCharacter };
}

test('prompt uses the request character and current message for trigger matching', () => {
  const selectedCharacter = { id: 'selected', name: 'Selected', worldBookIds: ['book'] };
  const activeCharacter = { id: 'currently-open', name: 'Other', worldBookIds: [] };
  const { context } = makeContext({
    selectedCharacter,
    activeCharacter,
    books: [{ id: 'book', triggers: 'ancient city', content: 'For {{char}}', enabled: true }]
  });

  assert.equal(
    context._worldBookPromptText(selectedCharacter, 'We reached the ancient city.'),
    '\n\n【世界观背景】\nFor Selected'
  );
  assert.equal(context._worldBookPromptText(activeCharacter, 'We reached the ancient city.'), '');
});

test('prompt includes legacy books without enabled and always-on books', () => {
  const character = { id: 'selected', name: 'Selected', worldBookIds: ['legacy', 'always', 'disabled', 'card'] };
  const { context } = makeContext({
    selectedCharacter: character,
    activeCharacter: null,
    books: [
      { id: 'legacy', content: 'Legacy setting' },
      { id: 'always', content: 'Always setting', triggers: '' },
      { id: 'disabled', content: 'Disabled setting', enabled: false },
      { id: 'card', content: 'Card data', type: 'card' }
    ]
  });

  const prompt = context._worldBookPromptText(character, 'Anything');
  assert.match(prompt, /Legacy setting/);
  assert.match(prompt, /Always setting/);
  assert.doesNotMatch(prompt, /Disabled setting|Card data/);
});

test('recent messages still activate matching world-book triggers', () => {
  const character = { id: 'selected', name: 'Selected', worldBookIds: ['book'] };
  const { context } = makeContext({
    selectedCharacter: character,
    activeCharacter: null,
    books: [{ id: 'book', triggers: 'moon gate', content: 'Moon gate setting', enabled: true }],
    messages: [{ from: 'u', text: 'The moon gate is open.' }]
  });

  assert.match(context._worldBookPromptText(character, 'What now?'), /Moon gate setting/);
});
