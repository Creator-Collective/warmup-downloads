const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const script = fs.readFileSync(path.join(__dirname, '..', 'setup.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const unavailableMessage = 'reload the cc extension, then refresh this page. for your first install, use chrome’s ⋮ menu → extensions → manage extensions.';

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

test('loading and focusing setup never probe the extension or open a tab', async () => {
  const h = setup();
  h.window.dispatchEvent(new h.window.Event('focus'));
  h.window.document.dispatchEvent(new h.window.Event('visibilitychange'));
  await tick();
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.textContent, 'open chrome extensions');
  assert.equal(h.status.hidden, true);
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.size, 0);
  h.dom.window.close();
});

test('one deliberate click opens extensions directly and deduplicates clicks while pending', async () => {
  const h = setup();
  h.button.click();
  h.button.dispatchEvent(new h.window.MouseEvent('click'));
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.requests[0], {
    channel: 'cc-warmup-request', id: 'request-1', type: 'open-extensions', origin: h.window.location.origin,
  });
  assert.equal([...h.timers.values()][0].delay, 5000);
  assert.equal(h.button.disabled, true);
  assert.equal(h.button.textContent, 'opening…');
  h.response(h.requests[0], { tabId: 0 });
  await tick();
  assert.equal(h.status.textContent, 'chrome extensions opened.');
  assert.equal(h.status.hidden, false);
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.textContent, 'open chrome extensions');
  assert.equal(h.timers.size, 0);
  h.response(h.requests[0], null, { data: { channel: 'cc-warmup-response', id: h.requests[0].id, ok: false } });
  await tick();
  assert.equal(h.status.textContent, 'chrome extensions opened.');
  assert.equal(h.requests.length, 1);
  h.dom.window.close();
});

test('responses from another window, origin, channel or request cannot complete opening', async () => {
  const h = setup();
  h.button.click();
  const request = h.requests[0];
  const result = { tabId: 42 };
  h.response(request, result, { source: null });
  h.response(request, result, { origin: 'https://unrelated.example' });
  h.response(request, result, { data: { channel: 'unrelated', id: request.id, ok: true, data: result } });
  h.response(request, result, { data: { channel: 'cc-warmup-response', id: 'other-id', ok: true, data: result } });
  await tick();
  assert.equal(h.status.hidden, true);
  assert.equal(h.button.disabled, true);
  assert.equal(h.timers.size, 1);
  h.response(request, result);
  await tick();
  assert.equal(h.status.textContent, 'chrome extensions opened.');
  assert.equal(h.button.disabled, false);
  h.dom.window.close();
});

test('a missing bridge times out, ignores late replies and retries only on a fresh click', async () => {
  const h = setup();
  h.button.click();
  const firstRequest = h.requests[0];
  h.expire();
  await tick();
  assert.equal(h.status.textContent, unavailableMessage);
  assert.equal(h.status.hidden, false);
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.textContent, 'open chrome extensions');
  h.response(firstRequest, { tabId: 42 });
  h.window.dispatchEvent(new h.window.Event('focus'));
  await tick();
  assert.equal(h.requests.length, 1);
  assert.equal(h.status.textContent, unavailableMessage);
  h.button.click();
  assert.equal(h.requests.length, 2);
  assert.equal(h.status.hidden, true);
  assert.notEqual(h.requests[1].id, firstRequest.id);
  h.response(firstRequest, { tabId: 42 });
  await tick();
  assert.equal(h.button.disabled, true);
  assert.equal(h.status.hidden, true);
  h.response(h.requests[1], { tabId: 43 });
  await tick();
  assert.equal(h.status.textContent, 'chrome extensions opened.');
  assert.equal(h.button.disabled, false);
  assert.equal(h.requests.length, 2);
  h.dom.window.close();
});

test('an unsupported command or invalid tab result offers menu instructions and allows a direct retry', async () => {
  for (const failure of ['error', undefined, {}, { tabId: -1 }, { tabId: 1.5 }, { tabId: '42' }, { tabId: Infinity }]) {
    const h = setup();
    h.button.click();
    const request = h.requests[0];
    if (failure === 'error') {
      h.response(request, null, { data: { channel: 'cc-warmup-response', id: request.id, ok: false, error: 'unknown command' } });
    } else {
      h.response(request, failure);
    }
    await tick();
    assert.equal(h.status.textContent, unavailableMessage);
    assert.equal(h.button.disabled, false);
    assert.equal(h.button.textContent, 'open chrome extensions');
    assert.equal(h.timers.size, 0);
    h.response(request, { tabId: 42 });
    await tick();
    assert.equal(h.status.textContent, unavailableMessage);
    h.button.click();
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[1].type, 'open-extensions');
    h.response(h.requests[1], { tabId: 42 });
    await tick();
    assert.equal(h.status.textContent, 'chrome extensions opened.');
    h.dom.window.close();
  }
});

test('a synchronous bridge error clears pending state without retrying or reporting success', async () => {
  const h = setup();
  let attempts = 0;
  h.window.postMessage = () => {
    attempts++;
    throw new Error('bridge unavailable');
  };
  h.button.click();
  await tick();
  assert.equal(attempts, 1);
  assert.equal(h.status.textContent, unavailableMessage);
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.textContent, 'open chrome extensions');
  assert.equal(h.timers.size, 0);
  h.dom.window.close();
});
