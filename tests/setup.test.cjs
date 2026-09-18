const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const script = fs.readFileSync(path.join(__dirname, '..', 'setup.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(clipboard) {
  const dom = new JSDOM('<button id="extensions-shortcut" type="button" disabled>copy extensions address</button><p id="extensions-shortcut-status" hidden role="status"></p><input id="extensions-address" readonly hidden value="chrome://extensions/" aria-label="chrome extensions address">', {
    url: 'https://creator-collective-warmup.vercel.app/setup.html', runScripts: 'outside-only',
  });
  const { window } = dom;
  const requests = [];
  const timers = new Map();
  let sequence = 0;
  window.crypto.randomUUID = () => `request-${++sequence}`;
  window.postMessage = (message, origin) => requests.push({ ...message, origin });
  window.setTimeout = (callback, delay) => {
    const id = ++sequence;
    timers.set(id, { callback, delay });
    return id;
  };
  window.clearTimeout = id => timers.delete(id);
  if (clipboard !== undefined) Object.defineProperty(window.navigator, 'clipboard', { value: clipboard });
  const element = id => window.document.getElementById(id);
  const response = (request, data, overrides = {}) => window.dispatchEvent(new window.MessageEvent('message', {
    source: window,
    origin: window.location.origin,
    data: { channel: 'cc-warmup-response', id: request.id, ok: true, data },
    ...overrides,
  }));
  window.eval(script);
  return {
    dom, window, requests, timers, response,
    button: element('extensions-shortcut'), status: element('extensions-shortcut-status'), address: element('extensions-address'),
    expire() {
      for (const [id, timer] of [...timers]) {
        timers.delete(id);
        timer.callback();
      }
    },
  };
}

test('a capable extension enables opening only after a deliberate click, with one pending request', async () => {
  const h = setup();
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.textContent, 'copy extensions address');
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].type, 'setup-info');
  assert.equal(h.requests[0].origin, h.window.location.origin);
  assert.equal([...h.timers.values()][0].delay, 1800);
  h.response(h.requests[0], { version: '0.6.47', canOpenExtensions: true });
  await tick();
  assert.equal(h.button.textContent, 'open chrome extensions');
  assert.equal(h.requests.length, 1);
  h.button.click();
  h.button.dispatchEvent(new h.window.MouseEvent('click'));
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].type, 'open-extensions');
  assert.equal(h.button.disabled, true);
  h.response(h.requests[1], { tabId: 42 });
  await tick();
  assert.equal(h.status.textContent, 'chrome extensions opened.');
  assert.equal(h.status.hidden, false);
  assert.equal(h.address.hidden, true);
  assert.equal(h.button.disabled, false);
  assert.equal(h.timers.size, 0);
  h.dom.window.close();
});

test('an absent or older extension keeps copying available without waiting for detection', async () => {
  const copied = [];
  const h = setup({ writeText: async text => copied.push(text) });
  h.button.click();
  await tick();
  assert.deepEqual(copied, ['chrome://extensions/']);
  assert.equal(h.status.textContent, 'copied. paste it into chrome’s address bar.');
  h.expire();
  await tick();
  assert.equal(h.button.textContent, 'copy extensions address');
  assert.equal(h.button.disabled, false);
  h.response(h.requests[0], { canOpenExtensions: true });
  await tick();
  assert.equal(h.button.textContent, 'copy extensions address');
  assert.equal(h.requests.length, 1);
  h.dom.window.close();

  const older = setup();
  older.response(older.requests[0], { version: '0.6.45' });
  await tick();
  assert.equal(older.button.textContent, 'copy extensions address');
  older.dom.window.close();
});

test('responses from a different window, origin, channel or request cannot enable opening', async () => {
  const h = setup();
  const info = { canOpenExtensions: true };
  const request = h.requests[0];
  h.response(request, info, { source: null });
  h.response(request, info, { origin: 'https://unrelated.example' });
  h.response(request, info, { data: { channel: 'unrelated', id: request.id, ok: true, data: info } });
  h.response(request, info, { data: { channel: 'cc-warmup-response', id: 'other-id', ok: true, data: info } });
  await tick();
  assert.equal(h.button.textContent, 'copy extensions address');
  assert.equal(h.timers.size, 1);
  h.response(request, info);
  await tick();
  assert.equal(h.button.textContent, 'open chrome extensions');
  h.dom.window.close();
});

test('unsupported clipboard or denied permission exposes and selects the fixed address', async () => {
  for (const clipboard of [undefined, { writeText: async () => { throw new Error('denied'); } }]) {
    const h = setup(clipboard);
    h.address.value = 'https://unrelated.example';
    h.button.click();
    await tick();
    assert.equal(h.address.hidden, false);
    assert.equal(h.address.readOnly, true);
    assert.equal(h.address.value, 'chrome://extensions/');
    assert.equal(h.window.document.activeElement, h.address);
    assert.equal(h.address.selectionStart, 0);
    assert.equal(h.address.selectionEnd, h.address.value.length);
    assert.equal(h.status.textContent, 'copy this address into chrome’s address bar.');
    assert.equal(h.button.disabled, false);
    h.dom.window.close();
  }
});

test('copy clicks are deduplicated while clipboard access is pending', async () => {
  let finishCopy;
  let copies = 0;
  const h = setup({ writeText: () => { copies++; return new Promise(resolve => { finishCopy = resolve; }); } });
  h.button.click();
  h.button.dispatchEvent(new h.window.MouseEvent('click'));
  assert.equal(copies, 1);
  assert.equal(h.button.disabled, true);
  h.response(h.requests[0], { canOpenExtensions: true });
  await tick();
  assert.equal(h.button.disabled, true);
  finishCopy();
  await tick();
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.textContent, 'open chrome extensions');
  assert.equal(h.requests.length, 1);
  h.dom.window.close();
});

test('a delayed clipboard rejection preserves a capability confirmed while copying', async () => {
  let rejectCopy;
  const h = setup({ writeText: () => new Promise((resolve, reject) => { rejectCopy = reject; }) });
  h.button.click();
  h.response(h.requests[0], { canOpenExtensions: true });
  await tick();
  assert.equal(h.button.disabled, true);
  rejectCopy(new Error('clipboard denied'));
  await tick();
  assert.equal(h.address.hidden, false);
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.textContent, 'open chrome extensions');
  h.button.click();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].type, 'open-extensions');
  h.response(h.requests[1], { tabId: 42 });
  await tick();
  assert.equal(h.status.textContent, 'chrome extensions opened.');
  assert.equal(h.address.hidden, true);
  h.dom.window.close();
});

test('failed, invalid or timed-out opening falls back to copying without reporting success', async () => {
  for (const failure of ['error', 'missing tab', 'timeout']) {
    const copied = [];
    const h = setup({ writeText: async text => copied.push(text) });
    h.response(h.requests[0], { canOpenExtensions: true });
    await tick();
    h.button.click();
    const request = h.requests[1];
    if (failure === 'error') h.response(request, null, { data: { channel: 'cc-warmup-response', id: request.id, ok: false, error: 'disconnected' } });
    else if (failure === 'missing tab') h.response(request, {});
    else h.expire();
    await tick();
    assert.equal(h.button.textContent, 'copy extensions address');
    assert.equal(h.address.hidden, false);
    assert.equal(h.status.textContent, 'copy this address into chrome’s address bar.');
    assert.equal(h.button.disabled, false);
    h.response(request, { tabId: 42 });
    await tick();
    assert.equal(h.status.textContent, 'copy this address into chrome’s address bar.');
    h.button.click();
    await tick();
    assert.deepEqual(copied, ['chrome://extensions/']);
    assert.equal(h.requests.length, 2);
    h.dom.window.close();
  }
});
