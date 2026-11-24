const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function collectNotifications()');
const end = html.indexOf('function openOfflineCompanionPicker(', start);
assert.ok(start >= 0 && end > start);

test('all read clears the desktop badge while leaving the active dungeon intact', () => {
  const badge = { style: {} };
  const clear = {};
  const chatItem = { dataset: { idx: '0' } };
  const modal = {
    querySelectorAll: () => modal.innerHTML.includes('data-idx="0"') ? [chatItem] : [],
    querySelector: selector => selector === '#_notif_clr' ? clear : null,
  };
  const activeDungeon = { status: 'ongoing', currentRound: 3 };
  const messages = [{ from: 'c', text: 'Hello' }, { from: 'c', text: 'Again' }];
  const momentsData = [{ id: 'm', charId: 'u', likes: ['c'], comments: [{ from: 'c' }] }];
  const forumPosts = [{ id: 'p', authorType: 'user', comments: [{ fromType: 'character' }] }];
  const saved = [];
  const pages = [];
  const context = vm.createContext({
    activeDungeon, momentsData, forumPosts,
    getMyChars: () => [{ id: 'c', name: 'Lin' }],
    getMsgs: () => messages,
    saveMsgs: () => saved.push('chat'),
    saveMoments: () => saved.push('moments'),
    loadForumPosts() {},
    saveForumPosts: () => saved.push('forum'),
    isN: () => false,
    escHtml: String,
    confirm: () => true,
    render: page => pages.push(page),
    saveCharList() {},
    store: { set() {} },
    showModal: (_title, draw) => draw(modal, () => {}),
    $: selector => selector === '#_notifbadge' ? badge : null,
  });
  vm.runInContext(html.slice(start, end), context);
  context.openNotificationPanel();
  assert.match(modal.innerHTML, /共 5 条未读/);
  assert.equal(badge.textContent, 5);
  assert.equal(badge.style.display, 'flex');

  chatItem.onclick();
  assert.deepEqual(pages, ['chat']);
  assert.equal(badge.textContent, 3);
  context.openNotificationPanel();
  clear.onclick();
  assert.equal(context.getNotificationCount(), 0);
  assert.equal(badge.style.display, 'none');
  assert.match(modal.innerHTML, /没有新通知/);
  assert.ok(messages.every(message => message.read));
  assert.ok(momentsData[0].comments[0]._readByUser);
  assert.deepEqual(momentsData[0]._readLikes, ['c']);
  assert.ok(forumPosts[0].comments[0]._readByUser);
  assert.deepEqual([...new Set(saved)].sort(), ['chat', 'forum', 'moments']);
  assert.deepEqual(activeDungeon, { status: 'ongoing', currentRound: 3 });
});
