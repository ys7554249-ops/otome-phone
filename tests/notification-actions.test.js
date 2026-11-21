const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { setImmediate: afterRender } = require('node:timers/promises');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/^([ \t]*)function _asOpenNotificationCheck\(\)\s*\{[\s\S]*?^\1\}/m);
assert.ok(source, 'notification check modal exists');

async function openCheck(Notification, navigator = {}) {
  const buttons = new Map();
  const toasts = [];
  const modal = {
    set innerHTML(markup) {
      buttons.clear();
      for (const [, id] of markup.matchAll(/<button\b[^>]*\bid="([^"]+)"/g)) {
        buttons.set(id, {
          disabled: false,
          addEventListener(type, handler) {
            if (type === 'click') this.click = () => handler({ currentTarget: this });
          }
        });
      }
    },
    querySelector(selector) { return buttons.get(selector.slice(1)) || null; }
  };
  vm.runInNewContext(`${source[0]}\n_asOpenNotificationCheck()`, {
    Notification, navigator,
    getAssistantNotificationStatus: async () => ({ notificationSupported: true, permission: Notification.permission }),
    showModal: (_, render) => render(modal, () => {}),
    showToast: message => toasts.push(message)
  });
  await afterRender();
  return { buttons, toasts };
}

test('permission is requested only on click and granting it reveals the test action', async () => {
  let requests = 0;
  const Notification = {
    permission: 'default',
    async requestPermission() {
      requests++;
      return this.permission = 'granted';
    }
  };
  const { buttons } = await openCheck(Notification);
  assert.equal(requests, 0);
  assert.equal(buttons.has('_astest'), false);
  const allow = buttons.get('_asallow');
  const pending = allow.click();
  assert.equal(requests, 1);
  assert.equal(allow.disabled, true);
  await pending;
  await afterRender();
  assert.equal(buttons.has('_asallow'), false);
  assert.equal(buttons.get('_astest').disabled, false);
});

test('a rejected service worker notification shows failure and allows retry', async () => {
  let attempts = 0;
  const registration = { async showNotification() { attempts++; throw new Error('send failed'); } };
  const { buttons, toasts } = await openCheck({ permission: 'granted' }, {
    serviceWorker: { getRegistration: async () => registration }
  });
  const send = buttons.get('_astest');
  const pending = send.click();
  assert.equal(send.disabled, true);
  await pending;
  await afterRender();
  assert.equal(attempts, 1);
  assert.deepEqual(toasts, ['测试通知发送失败，请检查浏览器和系统通知设置']);
  assert.equal(buttons.get('_astest').disabled, false);
});

test('a test click sends the notification through the service worker and confirms success', async () => {
  const calls = [];
  const registration = { async showNotification(title, options) { calls.push({ title, ...options }); } };
  const { buttons, toasts } = await openCheck({ permission: 'granted' }, {
    serviceWorker: { getRegistration: async () => registration }
  });
  assert.equal(calls.length, 0);
  await buttons.get('_astest').click();
  assert.deepEqual(calls, [{ title: '花枝通知测试', body: '这是一条测试通知，用来检查当前设备的通知显示。', tag: 'otome-assistant-test' }]);
  assert.deepEqual(toasts, ['测试通知已发送，请检查系统通知栏']);
});
