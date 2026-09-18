const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const script = fs.readFileSync(path.join(__dirname, '..', 'setup.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup() {
  const dom = new JSDOM('<button id="extensions-shortcut" type="button" disabled>open chrome extensions</button><p id="extensions-shortcut-status" hidden role="status"></p>', {
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
  Object.defineProperty(window.navigator, 'clipboard', {
    get() { assert.fail('the shortcut must not access the clipboard'); },
  });
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
    button: element('extensions-shortcut'), status: element('extensions-shortcut-status'),
    expire() {
      for (const [id, timer] of [...timers]) {
        timers.delete(id);
        timer.callback();
      }
    },
  };
}

async function connect(h, version = '0.6.46') {
  assert.equal(h.requests[0].type, 'hello');
  h.response(h.requests[0], { version, state: { status: 'idle' } });
  await tick();
}

async function openFromClick(h, version = '0.6.46') {
  const count = h.requests.length;
  h.button.click();
  assert.equal(h.requests.length, count + 1);
  assert.equal(h.requests[count].type, 'hello');
  assert.equal(h.button.textContent, 'checking extension…');
  h.response(h.requests[count], { version });
  await tick();
  assert.equal(h.requests.length, count + 2);
  assert.equal(h.requests[count + 1].type, 'open-extensions');
  assert.equal(h.button.textContent, 'opening…');
  return h.requests[count + 1];
}

function assertReady(h) {
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.textContent, 'open chrome extensions');
}

function assertFailure(h) {
  assertReady(h);
  assert.equal(h.status.hidden, false);
  assert.ok(h.status.textContent.length > 0);
  assert.doesNotMatch(h.status.textContent, /extensions opened/i);
}

test('startup uses the legacy hello command to display installed versions without opening anything', async () => {
  for (const version of ['0.6.43', '0.6.46']) {
    const h = setup();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].type, 'hello');
    assert.equal(h.requests[0].channel, 'cc-warmup-request');
    assert.equal(h.requests[0].origin, h.window.location.origin);
    assert.equal([...h.timers.values()][0].delay, 5000);
    assertReady(h);
    await connect(h, version);
    assert.equal(h.status.hidden, false);
    assert.ok(h.status.textContent.includes(version));
    if (version === '0.6.43') assert.match(h.status.textContent, /updat/i);
    h.window.dispatchEvent(new h.window.Event('focus'));
    h.window.document.dispatchEvent(new h.window.Event('visibilitychange'));
    await tick();
    assert.equal(h.requests.length, 1);
    assert.equal(h.timers.size, 0);
    h.dom.window.close();
  }
});

test('an explicit click checks a fresh supported version before exactly one open request', async () => {
  for (const version of ['0.6.46', '0.6.46.0', '0.6.100', '0.7.0', '1.0.0']) {
    const h = setup();
    await connect(h);
    h.button.click();
    h.button.dispatchEvent(new h.window.MouseEvent('click'));
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[1].type, 'hello');
    assert.notEqual(h.requests[1].id, h.requests[0].id);
    assert.equal(h.button.textContent, 'checking extension…');
    assert.equal(h.button.disabled, true);
    h.response(h.requests[1], { version });
    await tick();
    assert.equal(h.requests.length, 3);
    assert.equal(h.requests[2].type, 'open-extensions');
    assert.equal(h.button.textContent, 'opening…');
    assert.equal([...h.timers.values()][0].delay, 5000);
    h.button.dispatchEvent(new h.window.MouseEvent('click'));
    assert.equal(h.requests.length, 3);
    h.response(h.requests[2], { tabId: 0 });
    await tick();
    assert.match(h.status.textContent, /extensions opened/i);
    assertReady(h);
    assert.equal(h.timers.size, 0);
    h.dom.window.close();
  }
});

test('old bridges and malformed versions never receive an unsupported open command', async () => {
  for (const version of ['0.6.43', '0.6.45.99', '0.5.99', undefined, null, 646, '0.6', '0.6.46.beta', '0.6.46.0.1', '0.6.046', '65536.0.0', '0.6.46<script>']) {
    const h = setup();
    await connect(h);
    h.button.click();
    // Older installed bridges recognize hello, but silently ignore open-extensions.
    h.response(h.requests[1], { version, state: { status: 'idle' } });
    await tick();
    assertFailure(h);
    assert.equal(h.requests.length, 2);
    assert.ok(h.requests.every(request => request.type === 'hello'));
    assert.equal(h.timers.size, 0);
    if (version === '0.6.43') {
      assert.match(h.status.textContent, /0\.6\.43/);
      assert.match(h.status.textContent, /updat/i);
      assert.match(h.status.textContent, /0\.6\.46/);
    }
    h.dom.window.close();
  }
});

test('a missing bridge times out, rejects late replies and retries only after another click', async () => {
  const h = setup();
  h.expire();
  await tick();
  assertFailure(h);
  assert.equal(h.requests.length, 1);
  h.button.click();
  const firstClick = h.requests[1];
  h.expire();
  await tick();
  assertFailure(h);
  const failureMessage = h.status.textContent;
  h.response(firstClick, { version: '0.6.46' });
  h.window.dispatchEvent(new h.window.Event('focus'));
  await tick();
  assert.equal(h.requests.length, 2);
  assert.equal(h.status.textContent, failureMessage);
  h.button.click();
  assert.equal(h.requests.length, 3);
  assert.equal(h.requests[2].type, 'hello');
  assert.notEqual(h.requests[2].id, firstClick.id);
  h.response(firstClick, { version: '0.6.46' });
  await tick();
  assert.equal(h.requests.length, 3);
  assert.equal(h.button.textContent, 'checking extension…');
  h.response(h.requests[2], { version: '0.6.46' });
  await tick();
  assert.equal(h.requests[3].type, 'open-extensions');
  h.response(h.requests[3], { tabId: 42 });
  await tick();
  assert.match(h.status.textContent, /extensions opened/i);
  assertReady(h);
  h.dom.window.close();
});

test('a delayed startup reply or timeout cannot overwrite the newer click result', async () => {
  for (const startupOutcome of ['old-version', 'timeout']) {
    const h = setup();
    const startupRequest = h.requests[0];
    const openRequest = await openFromClick(h);
    h.response(openRequest, { tabId: 42 });
    await tick();
    const success = h.status.textContent;
    assert.match(success, /extensions opened/i);
    if (startupOutcome === 'old-version') h.response(startupRequest, { version: '0.6.43' });
    else h.expire();
    await tick();
    assert.equal(h.status.textContent, success);
    assertReady(h);
    assert.equal(h.requests.length, 3);
    assert.equal(h.timers.size, 0);
    h.dom.window.close();
  }
});

test('spoofed origin, window, channel and request replies cannot pass either command stage', async () => {
  const h = setup();
  await connect(h);
  h.button.click();
  for (const [index, result] of [[1, { version: '0.6.46' }], [2, { tabId: 42 }]]) {
    const request = h.requests[index];
    h.response(request, result, { source: null });
    h.response(request, result, { origin: 'https://unrelated.example' });
    h.response(request, result, { data: { channel: 'unrelated', id: request.id, ok: true, data: result } });
    h.response(request, result, { data: { channel: 'cc-warmup-response', id: 'other-id', ok: true, data: result } });
    await tick();
    assert.equal(h.button.disabled, true);
    assert.equal(h.requests.length, index + 1);
    assert.equal(h.timers.size, 1);
    h.response(request, result);
    await tick();
  }
  assert.match(h.status.textContent, /extensions opened/i);
  assertReady(h);
  h.dom.window.close();
});

test('open failures or invalid tab results end loading and require a fresh check to retry', async () => {
  for (const failure of ['error', 'timeout', undefined, {}, { tabId: -1 }, { tabId: 1.5 }, { tabId: '42' }, { tabId: Infinity }]) {
    const h = setup();
    await connect(h);
    const request = await openFromClick(h);
    if (failure === 'timeout') h.expire();
    else if (failure === 'error') {
      h.response(request, null, { data: { channel: 'cc-warmup-response', id: request.id, ok: false, error: 'unknown command' } });
    } else h.response(request, failure);
    await tick();
    assertFailure(h);
    assert.equal(h.timers.size, 0);
    const failureMessage = h.status.textContent;
    h.response(request, { tabId: 42 });
    await tick();
    assert.equal(h.status.textContent, failureMessage);
    assert.equal(h.requests.length, 3);
    const retry = await openFromClick(h);
    h.response(retry, { tabId: 43 });
    await tick();
    assert.match(h.status.textContent, /extensions opened/i);
    assertReady(h);
    h.dom.window.close();
  }
});

test('synchronous bridge errors settle without retrying or reporting success', async () => {
  const h = setup();
  await connect(h);
  let attempts = 0;
  h.window.postMessage = () => {
    attempts++;
    throw new Error('bridge unavailable');
  };
  h.button.click();
  await tick();
  assert.equal(attempts, 1);
  assertFailure(h);
  assert.equal(h.timers.size, 0);
  h.dom.window.close();
});
