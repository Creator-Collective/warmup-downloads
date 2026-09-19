const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'extensions.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'extensions.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(options = {}) {
  const dom = new JSDOM(html, {
    url: options.url || 'https://creator-collective-warmup.vercel.app/extensions.html',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  const requests = [];
  const timers = new Map();
  let sequence = 0;
  window.crypto.randomUUID = () => `request-${++sequence}`;
  window.postMessage = (message, target) => {
    if (options.postThrows) throw new Error('disconnected');
    requests.push({ ...message, target });
  };
  const context = vm.createContext({
    window: options.iframe ? { top: window } : window,
    document: window.document,
    location: window.location,
    crypto: window.crypto,
    setTimeout(callback, delay) {
      const id = ++sequence;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  });
  const element = id => window.document.getElementById(id);
  const response = (request, data, overrides = {}) => window.dispatchEvent(new window.MessageEvent('message', {
    source: window,
    origin: window.location.origin,
    data: { channel: 'cc-warmup-response', id: request.id, ok: true, data },
    ...overrides,
  }));
  vm.runInContext(script, context);
  return {
    dom, window, requests, timers, response,
    button: element('manager-retry'), status: element('manager-status'), fallback: element('manager-fallback'),
    page: window.document.querySelector('[data-extension-manager]'),
    rerun() { vm.runInContext(script, context); },
    expire() {
      for (const [id, timer] of [...timers]) {
        timers.delete(id);
        timer.callback();
      }
    },
  };
}

async function hello(h, version = '0.6.46') {
  h.response(h.requests.at(-1), { version });
  await tick();
}

function failure(h) {
  assert.equal(h.fallback.hidden, false);
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.hidden, false);
  assert.equal(h.page.getAttribute('aria-busy'), 'false');
  assert.doesNotMatch(h.status.textContent, /extensions opened/);
}

test('loads one hello probe, then opens exactly one fixed extension manager for supported legacy versions', async () => {
  for (const version of ['0.6.46', '0.6.49', '0.6.52', '0.6.46.1', '0.7.0', '1.0.0']) {
    const h = setup();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].type, 'hello');
    assert.equal(h.requests[0].channel, 'cc-warmup-request');
    assert.equal(h.requests[0].target, h.window.location.origin);
    assert.equal([...h.timers.values()][0].delay, 5000);
    assert.equal(h.button.disabled, true);
    await hello(h, version);
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[1].type, 'open-extensions');
    assert.deepEqual(Object.keys(h.requests[1]).sort(), ['channel', 'id', 'target', 'type']);
    h.response(h.requests[1], { tabId: 17 });
    await tick();
    assert.equal(h.status.textContent, 'chrome extensions opened in another tab.');
    assert.equal(h.button.hidden, true);
    assert.equal(h.fallback.hidden, true);
    assert.equal(h.timers.size, 0);
    h.dom.window.close();
  }
});

test('old or malformed versions never send an opening command', async () => {
  for (const version of ['0.6.45', '0.5.99', '0.6.45.65535', '0.06.46', '0.6.046', '0.6', '0.6.52-beta', '0.6.65536', '65536.0.0', null, 652, {}]) {
    const h = setup();
    await hello(h, version);
    assert.equal(h.requests.length, 1);
    assert.equal(h.timers.size, 0);
    failure(h);
    h.dom.window.close();
  }
});

test('no bridge gives a bounded, visible menu fallback without automatic retries', async () => {
  const h = setup();
  h.expire();
  await tick();
  failure(h);
  assert.match(h.status.textContent, /not connected/);
  assert.match(h.fallback.textContent, /⋮ → extensions → manage extensions/);
  for (const type of ['focus', 'pageshow', 'visibilitychange']) h.window.dispatchEvent(new h.window.Event(type));
  h.expire();
  await tick();
  assert.equal(h.requests.length, 1);
  assert.equal(h.timers.size, 0);
  h.dom.window.close();
});

test('opening timeout never claims success or retries automatically', async () => {
  const h = setup();
  await hello(h);
  assert.equal([...h.timers.values()][0].delay, 5000);
  h.expire();
  await tick();
  failure(h);
  assert.match(h.status.textContent, /did not confirm/);
  h.response(h.requests[1], { tabId: 18 });
  await tick();
  failure(h);
  assert.equal(h.requests.length, 2);
  h.dom.window.close();
});

test('only a positive safe integer tab id counts as confirmed opening', async () => {
  for (const tabId of [undefined, null, -1, 0, 1.5, '12', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const h = setup();
    await hello(h);
    h.response(h.requests[1], { tabId });
    await tick();
    failure(h);
    assert.equal(h.requests.length, 2);
    h.dom.window.close();
  }
});

test('explicit negative responses and failed postMessage have truthful fallback', async () => {
  for (const opening of [false, true]) {
    const h = setup();
    if (opening) await hello(h);
    const request = h.requests.at(-1);
    h.response(request, null, { data: { channel: 'cc-warmup-response', id: request.id, ok: false, error: 'private detail' } });
    await tick();
    failure(h);
    assert.doesNotMatch(h.status.textContent, /private detail/);
    assert.equal(h.timers.size, 0);
    h.dom.window.close();
  }
  const h = setup({ postThrows: true });
  await tick();
  failure(h);
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.size, 0);
  h.dom.window.close();
});

test('repeated clicks, duplicate replies and script initialization cannot duplicate a pending opening', async () => {
  const h = setup();
  for (let i = 0; i < 3; i++) h.button.dispatchEvent(new h.window.Event('click'));
  h.rerun();
  assert.equal(h.requests.length, 1);
  h.response(h.requests[0], { version: '0.6.49' });
  h.response(h.requests[0], { version: '0.6.49' });
  await tick();
  assert.equal(h.requests.length, 2);
  for (let i = 0; i < 3; i++) h.button.dispatchEvent(new h.window.Event('click'));
  assert.equal(h.requests.length, 2);
  h.response(h.requests[1], { tabId: 19 });
  h.response(h.requests[1], { tabId: 20 });
  await tick();
  assert.equal(h.requests.length, 2);
  assert.equal(h.timers.size, 0);
  h.dom.window.close();
});

test('explicit retry starts fresh only after failure and ignores stale hello or open responses', async () => {
  const h = setup();
  const firstHello = h.requests[0];
  h.expire();
  await tick();
  h.button.click();
  assert.equal(h.requests.length, 2);
  h.response(firstHello, { version: '0.6.52' });
  await tick();
  assert.equal(h.requests.length, 2);
  await hello(h);
  const staleOpen = h.requests[2];
  h.expire();
  await tick();
  h.button.click();
  h.response(staleOpen, { tabId: 21 });
  await tick();
  assert.equal(h.requests.length, 4);
  assert.doesNotMatch(h.status.textContent, /extensions opened/);
  await hello(h);
  assert.equal(h.requests.length, 5);
  h.response(h.requests[4], { tabId: 22 });
  await tick();
  assert.match(h.status.textContent, /extensions opened/);
  h.dom.window.close();
});

test('spoofed sources, origins, channels and ids cannot advance hello or report success', async () => {
  const h = setup();
  for (const opening of [false, true]) {
    if (opening) await hello(h);
    const request = h.requests.at(-1);
    const data = opening ? { tabId: 123 } : { version: '0.6.52' };
    const baseline = h.requests.length;
    const status = h.status.textContent;
    for (const overrides of [
      { source: null },
      { source: {} },
      { origin: 'https://trycreatorcollective.com' },
      { origin: 'https://evil.example' },
      { data: { channel: 'cc-warmup-request', id: request.id, ok: true, data } },
      { data: { channel: 'cc-warmup-response', id: 'wrong-id', ok: true, data } },
      { data: { channel: 'cc-warmup-response', ok: true, data } },
      { data: null },
    ]) h.response(request, data, overrides);
    await tick();
    assert.equal(h.requests.length, baseline);
    assert.equal(h.status.textContent, status);
    assert.equal(h.timers.size, 1);
  }
  h.expire();
  await tick();
  h.dom.window.close();
});

test('helper does not initialize in frames or on untrusted origins', () => {
  for (const options of [{ iframe: true }, { url: 'https://evil.example/extensions.html' }, { url: 'https://trycreatorcollective.com/extensions.html' }]) {
    const h = setup(options);
    assert.equal(h.requests.length, 0);
    assert.equal(h.timers.size, 0);
    assert.equal(h.fallback.hidden, false);
    assert.equal(h.button.hidden, true);
    h.dom.window.close();
  }
});

test('URL parameters and incoming commands cannot choose another destination or action', async () => {
  const h = setup({ url: 'https://creator-collective-warmup.vercel.app/extensions.html?url=https://evil.example&type=start#stop' });
  h.window.dispatchEvent(new h.window.MessageEvent('message', {
    source: h.window, origin: h.window.location.origin,
    data: { channel: 'cc-warmup-request', type: 'start', id: 'arbitrary' },
  }));
  await hello(h);
  assert.deepEqual(h.requests.map(request => request.type), ['hello', 'open-extensions']);
  assert.equal(h.requests.some(request => 'url' in request || 'settings' in request), false);
  h.expire();
  await tick();
  h.dom.window.close();
});

test('leaving the page cancels pending replies before they can open a tab or alter status', async () => {
  for (const opening of [false, true]) {
    const h = setup();
    if (opening) await hello(h);
    const request = h.requests.at(-1);
    h.window.dispatchEvent(new h.window.Event('pagehide'));
    h.response(request, opening ? { tabId: 25 } : { version: '0.6.52' });
    await tick();
    assert.equal(h.requests.length, opening ? 2 : 1);
    assert.equal(h.timers.size, 0);
    assert.equal(h.button.disabled, true);
    assert.equal(h.button.hidden, true);
    assert.match(h.status.textContent, /return to warm-up/);
    assert.doesNotMatch(h.status.textContent, /extensions opened/);
    h.dom.window.close();
  }
});

test('helper assets deploy with the existing styles and all return links use the fixed dashboard URL', () => {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  assert.equal(doc.querySelector('link[rel=stylesheet]').getAttribute('href'), 'dashboard.css');
  assert.equal(doc.querySelector('.brand img').getAttribute('src'), 'cc-logo.webp');
  for (const link of doc.querySelectorAll('a')) assert.equal(link.href, 'https://trycreatorcollective.com/dashboard/warmup-automation');
  assert.equal(doc.querySelectorAll('iframe').length, 0);
  assert.equal(doc.querySelectorAll('a[href^="chrome:"]').length, 0);
  const ignored = fs.readFileSync(path.join(root, '.vercelignore'), 'utf8');
  for (const asset of ['extensions.html', 'extensions.js', 'dashboard.css', 'cc-logo.webp']) assert.ok(ignored.split('\n').includes(`!${asset}`));
  assert.doesNotMatch(script, /window\.opener|window\.open|location\.(?:assign|replace|reload)|clipboard/);
  dom.window.close();
});
