const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const script = fs.readFileSync(path.join(__dirname, '..', 'setup.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'setup.html'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup() {
  const dom = new JSDOM(html, {
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
  let reloads = 0;
  vm.runInNewContext(script, {
    window, document: window.document, crypto: window.crypto,
    location: { origin: window.location.origin, reload() { reloads++; } },
    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
  });
  return {
    dom, window, requests, timers, response,
    button: element('extensions-shortcut'), status: element('extensions-shortcut-status'),
    check: element('check-extension'), badge: element('version-status'), installed: element('installed-version'),
    latest: window.document.querySelector('[data-latest-version]').dataset.latestVersion, element, reloads: () => reloads,
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
    assert.equal(h.installed.textContent, version);
    assert.match(h.badge.textContent, /update needed/);
    assert.equal(h.status.hidden, true);
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
  assertReady(h);
  assert.equal(h.badge.textContent, 'not connected');
  assert.equal(h.installed.textContent, 'not detected');
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

test('version comparison distinguishes old, current and newer installs numerically', async () => {
  const cases = [
    ['0.6.9', 'outdated', 'update needed'],
    ['0.6.46', 'outdated', 'update needed'],
    ['latest', 'current', 'up to date'],
    ['latest-four-parts', 'current', 'up to date'],
    ['0.6.100', 'newer', 'newer version installed'],
    ['1.0.0', 'newer', 'newer version installed'],
  ];
  for (const [input, state, label] of cases) {
    const h = setup();
    const version = input === 'latest' ? h.latest : input === 'latest-four-parts' ? `${h.latest}.0` : input;
    await connect(h, version);
    assert.equal(h.badge.dataset.state, state);
    assert.equal(h.badge.textContent, label);
    assert.equal(h.installed.textContent, version);
    assert.equal(h.element('latest-version').textContent, h.latest);
    assert.equal(h.element('mode-update').getAttribute('aria-pressed'), 'true');
    assert.equal(h.requests.length, 1, 'detecting an install must not open a tab');
    h.dom.window.close();
  }
});

test('check again detects an updated extension without a refresh or opening any tab', async () => {
  const h = setup();
  await connect(h, '0.6.43');
  h.check.click();
  h.check.dispatchEvent(new h.window.MouseEvent('click'));
  h.button.dispatchEvent(new h.window.MouseEvent('click'));
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].type, 'hello');
  assert.equal(h.check.disabled, true);
  assert.equal(h.button.disabled, true);
  assert.equal(h.badge.textContent, 'checking…');
  h.response(h.requests[1], { version: h.latest });
  await tick();
  assert.equal(h.badge.textContent, 'up to date');
  assert.equal(h.installed.textContent, h.latest);
  assert.equal(h.check.disabled, false);
  assertReady(h);
  assert.equal(h.requests.length, 2);
  assert.equal(h.timers.size, 0);
  h.dom.window.close();
});

test('check again clears a stale installed version when connection disappears', async () => {
  const h = setup();
  await connect(h, h.latest);
  h.check.click();
  h.expire();
  await tick();
  assert.equal(h.badge.textContent, 'not connected');
  assert.equal(h.installed.textContent, 'not detected');
  assert.doesNotMatch(h.element('version-hint').textContent, /not installed|uninstall/i);
  assert.equal(h.check.disabled, false);
  assertReady(h);
  h.dom.window.close();
});

test('a late startup reply cannot overwrite a newer explicit version check', async () => {
  const h = setup();
  const startup = h.requests[0];
  h.check.click();
  h.response(h.requests[1], { version: h.latest });
  await tick();
  h.response(startup, { version: '0.6.43' });
  await tick();
  assert.equal(h.badge.textContent, 'up to date');
  assert.equal(h.installed.textContent, h.latest);
  assert.equal(h.timers.size, 0);
  h.dom.window.close();
});

test('bad version responses do not display untrusted version strings or claim installation', async () => {
  for (const version of [null, '0.6.046', '65536.0.0', '<img src=x onerror=alert(1)>']) {
    const h = setup();
    await connect(h, version);
    assert.equal(h.badge.textContent, 'not connected');
    assert.equal(h.installed.textContent, 'not detected');
    assert.equal(h.installed.children.length, 0);
    h.dom.window.close();
  }
});

test('manual install/update selection persists across checks and keeps actions in the right steps', async () => {
  const h = setup();
  h.element('mode-install').click();
  await connect(h, '0.6.46');
  assert.equal(h.element('mode-install').getAttribute('aria-pressed'), 'true');
  assert.equal(h.element('manager-action').parentElement.id, 'step-two');
  h.element('mode-update').click();
  assert.equal(h.element('mode-update').getAttribute('aria-pressed'), 'true');
  assert.equal(h.element('manager-action').parentElement.id, 'step-three');
  assert.match(h.element('step-two-copy').textContent, /existing extension folder/);
  assert.match(h.element('step-three-copy').textContent, /check again/);
  assert.equal(h.window.document.querySelectorAll('a[download]').length, 1);
  h.dom.window.close();
});

test('the labelled illustrated walkthrough advances, goes back and resets when instructions change', async () => {
  const h = setup();
  await connect(h);
  const frames = ['walkthrough-download', 'walkthrough-manage', 'walkthrough-finish'].map(h.element);
  const visible = () => frames.filter(frame => !frame.hidden).map(frame => frame.id);
  assert.deepEqual(visible(), ['walkthrough-download']);
  assert.equal(h.element('walkthrough-back').disabled, true);
  h.element('walkthrough-next').click();
  assert.deepEqual(visible(), ['walkthrough-manage']);
  assert.equal(h.element('walkthrough-progress').textContent, '2 of 3');
  assert.equal(h.element('walkthrough-manage').classList.contains('is-update'), true);
  h.element('walkthrough-back').click();
  assert.deepEqual(visible(), ['walkthrough-download']);
  h.element('walkthrough-next').click();
  h.element('walkthrough-next').click();
  assert.deepEqual(visible(), ['walkthrough-finish']);
  assert.equal(h.element('walkthrough-next').textContent, 'start again');
  h.element('walkthrough-next').click();
  assert.deepEqual(visible(), ['walkthrough-download']);
  h.element('walkthrough-next').click();
  h.element('mode-install').click();
  assert.deepEqual(visible(), ['walkthrough-download']);
  assert.equal(h.element('walkthrough-manage').classList.contains('is-update'), false);
  assert.match(h.element('walkthrough').textContent, /illustrated walkthrough/);
  assert.equal(h.requests.length, 1, 'walkthrough controls must not contact the extension');
  h.dom.window.close();
});


test('an explicit failed check reloads once to recover a replaced bridge, while startup never reloads', async () => {
  for (const failure of ['timeout', 'disconnected']) {
    const h = setup();
    await connect(h);
    assert.equal(h.reloads(), 0);
    h.check.click();
    const request = h.requests[1];
    if (failure === 'timeout') h.expire();
    else h.response(request, null, { data: { channel: 'cc-warmup-response', id: request.id, ok: false, error: 'extension disconnected. refresh this page.' } });
    await tick();
    assert.equal(h.reloads(), 1);
    assert.equal(h.status.textContent, 'reconnecting to the extension…');
    h.expire();
    h.response(request, { version: h.latest });
    await tick();
    assert.equal(h.reloads(), 1, 'timers and late replies cannot cause another reload');
    h.dom.window.close();
    const reloadedPage = setup();
    reloadedPage.expire();
    await tick();
    assert.equal(reloadedPage.reloads(), 0, 'the freshly loaded page cannot enter a reload loop');
    assert.equal(reloadedPage.badge.textContent, 'not connected');
    reloadedPage.dom.window.close();
  }
});
