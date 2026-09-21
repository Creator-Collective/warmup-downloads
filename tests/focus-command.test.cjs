const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const extension = path.join(__dirname, '../browser-extension');
const guards = require('../browser-extension/guards.js');
const origin = 'https://creator-collective-warmup.vercel.app';
const sender = { id: 'extension-id', url: `${origin}/`, frameId: 0, tab: { id: 2 } };
const panel = { id: 'extension-id', url: 'chrome-extension://extension-id/sidepanel.html', frameId: 0 };
const event = () => ({ listeners: [], addListener(callback) { this.listeners.push(callback); } });
const read = file => fs.readFileSync(path.join(extension, file), 'utf8');

function background(initial) {
  let job = initial;
  const created = [];
  const chrome = {
    sidePanel: { setPanelBehavior: async () => {} },
    runtime: { id: 'extension-id', getURL: p => `chrome-extension://extension-id/${p.replace(/^\//, '')}`, getManifest: () => ({ version: '0.6.51' }), onMessage: event() },
    storage: { session: { get: async () => ({ job: structuredClone(job) }), set: async value => { job = structuredClone(value.job); } } },
    tabs: { get: async id => ({ id, url: 'https://www.instagram.com/', windowId: 1 }), query: async () => [], create: async options => { created.push(options); return { id: 90 }; }, remove: async () => {}, onRemoved: event(), onUpdated: event() },
    action: { onClicked: event() },
  };
  const context = vm.createContext({ chrome, console, URL, crypto: webcrypto, structuredClone });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(read(file), context));
  vm.runInContext(read('background.js'), context);
  const message = (request, source = sender) => new Promise(resolve => {
    if (!chrome.runtime.onMessage.listeners[0](request, source, resolve)) resolve(undefined);
  });
  return { message, created, chrome, job: () => structuredClone(job) };
}

function bridge(worker, { pageOrigin = origin, subframe = false } = {}) {
  const forwarded = [];
  const responses = [];
  let listener;
  const window = { addEventListener(type, callback) { if (type === 'message') listener = callback; }, postMessage(response) { responses.push(response); } };
  window.top = subframe ? {} : window;
  vm.runInNewContext(read('bridge.js'), { window, location: { origin: pageOrigin }, chrome: { runtime: { sendMessage(message) { forwarded.push(message); return worker.message(message); } } } });
  return { forwarded, responses, async request(request, overrides = {}) { if (listener) await listener({ source: window, origin: pageOrigin, data: { channel: 'cc-warmup-request', id: 'focus-request', ...request }, ...overrides }); } };
}

async function start(h) {
  const result = await h.message({ type: 'start', tabId: 8, settings: { platform: 'instagram', minutes: 10, niche: 'study tips', enableComments: true, customLimits: { like: 10, follow: 3, comment: 2 } } });
  assert.equal(result.ok, true);
  return h.job();
}

const focusRequest = (job, focus = 'follow') => ({ type: 'set-focus', sessionId: job.sessionId, focus });
const runnerSender = job => ({ id: 'extension-id', url: `chrome-extension://extension-id/runner.html#${job.token}`, tab: { id: job.runnerTabId } });

test('trusted website and packaged panel can change focus without changing session identity, duration or targets', async () => {
  for (const source of [sender, panel]) {
    const h = background();
    const before = await start(h);
    const result = await h.message(focusRequest(before), source);
    assert.equal(result.ok, true);
    assert.equal(result.data.settings.focus, 'follow');
    assert.equal(result.data.canChangeFocus, true);
    assert.equal(result.data.sessionId, before.sessionId);
    assert.equal(result.data.token, undefined);
    const after = h.job();
    assert.deepEqual({ ...after, settings: { ...after.settings, focus: before.settings.focus } }, before);
    assert.equal(h.created.length, 1, 'focus must reuse the running session');
  }
});

test('website focus bridge forwards only focus and session identity', async () => {
  const h = background();
  const job = await start(h);
  const b = bridge(h);
  await b.request({ ...focusRequest(job, 'comment'), settings: { minutes: 120, limits: { comment: 999 } }, patch: { phase: 'starting' }, token: 'injected', tabId: 400, deadline: Infinity });
  assert.deepEqual(Object.keys(b.forwarded[0]).sort(), ['focus', 'sessionId', 'type']);
  assert.equal(b.responses[0].ok, true);
  assert.equal(h.job().settings.focus, 'comment');
  assert.equal(h.job().settings.limits.comment, 2);
  assert.equal(h.job().deadline, job.deadline);
  assert.equal(h.job().token, job.token);
  assert.equal(h.job().tabId, job.tabId);
});

test('untrusted origins, frames, senders and message events cannot change focus', async () => {
  const h = background();
  const job = await start(h);
  for (const options of [{ pageOrigin: 'https://evil.example' }, { pageOrigin: `${origin}.evil.example` }, { subframe: true }]) {
    const b = bridge(h, options);
    await b.request(focusRequest(job));
    assert.equal(b.forwarded.length, 0);
  }
  const b = bridge(h);
  for (const overrides of [{ source: {} }, { origin: 'https://evil.example' }]) await b.request(focusRequest(job), overrides);
  assert.equal(b.forwarded.length, 0);
  for (const source of [{ ...sender, url: 'https://www.instagram.com/' }, { ...sender, frameId: 2 }, { ...panel, id: 'other-extension' }, { ...panel, url: 'chrome-extension://extension-id/runner.html' }]) {
    const response = await h.message(focusRequest(job), source);
    assert.notEqual(response?.ok, true);
  }
  assert.deepEqual(h.job(), job);
});

test('invalid focus, missing and stale session ids are rejected without mutating the active session', async () => {
  const h = background();
  const job = await start(h);
  for (const focus of ['likes', '', null, [], {}, 10, '__proto__']) {
    const result = await h.message(focusRequest(job, focus));
    assert.equal(result.ok, false);
  }
  for (const sessionId of [undefined, null, 1, '', `${job.sessionId}-old`]) {
    const result = await h.message({ ...focusRequest(job), sessionId });
    assert.equal(result.ok, false);
  }
  assert.deepEqual(h.job(), job);
});

test('focus cannot revive stopped, stopping, complete, error or expired sessions', async () => {
  const h = background();
  const job = await start(h);
  for (const patch of [{ phase: 'stopped' }, { phase: 'stopping' }, { phase: 'complete' }, { phase: 'error' }, { phase: 'running', stopRequested: true }, { phase: 'running', deadline: Date.now() - 1 }]) {
    const original = { ...job, ...patch };
    const restarted = background(original);
    const result = await restarted.message({ ...focusRequest(original), phase: 'running', stopRequested: false, deadline: Date.now() + 600000 });
    assert.equal(result.ok, false);
    assert.deepEqual(restarted.job(), original);
    assert.equal(guards.publicState(original).canChangeFocus, false);
  }
});

test('Stop wins over a queued focus change, preserving final counts and deadline', async () => {
  const h = background();
  const job = await start(h);
  const [stopped, focused] = await Promise.all([h.message({ type: 'stop' }), h.message(focusRequest(job))]);
  assert.equal(stopped.ok, true);
  assert.equal(focused.ok, false);
  assert.equal(h.job().stopRequested, true);
  assert.equal(h.job().phase, 'stopping');
  assert.equal(h.job().settings.focus, 'balanced');
  assert.equal(h.job().deadline, job.deadline);
});

test('focus survives background restarts and runner progress updates cannot overwrite it', async () => {
  const h = background();
  const job = await start(h);
  await h.message(focusRequest(job, 'comment'));
  const restarted = background(h.job());
  const state = await restarted.message({ type: 'state' });
  assert.equal(state.data.settings.focus, 'comment');
  assert.equal(state.data.canChangeFocus, true);
  const result = await restarted.message({ type: 'runner-update', token: job.token, patch: { phase: 'running', stats: { like: 2 }, settings: { focus: 'like', limits: { like: 999 } }, focus: 'follow', deadline: Infinity, message: 'watching a post' } }, runnerSender(job));
  assert.equal(result.ok, true);
  assert.equal(restarted.job().settings.focus, 'comment');
  assert.equal(restarted.job().stats.like, 2);
  assert.equal(restarted.job().settings.limits.like, 10);
  assert.equal(restarted.job().deadline, job.deadline);
  assert.equal((await restarted.message({ type: 'hello' })).data.supportsFocus, true);
});

test('older stored jobs without a session identity remain readable but cannot accept focus changes', async () => {
  const h = background();
  const job = await start(h);
  delete job.sessionId;
  delete job.settings.focus;
  const restarted = background(job);
  const state = (await restarted.message({ type: 'state' })).data;
  assert.equal(state.settings.focus, 'balanced');
  assert.equal(state.canChangeFocus, false);
  assert.equal((await restarted.message(focusRequest(job))).ok, false);
});

test('runner reads live focus from storage updates without restarting the engine', async () => {
  const job = { token: 'test-token', sessionId: 'test-session', tabId: 7, runnerTabId: 90, deadline: Date.now() + 600000, phase: 'starting', settings: { platform: 'instagram', minutes: 10, focus: 'balanced' }, stats: {}, activity: [], message: 'starting' };
  const calls = [];
  const chrome = { runtime: { sendMessage: async message => { calls.push(message); return { ok: true, data: message.type === 'runner-job' ? job : null }; } }, tabs: { get: async () => ({ url: 'https://www.instagram.com/' }), onUpdated: event() }, storage: { onChanged: event() } };
  const node = () => ({ textContent: '', disabled: false, dataset: {}, addEventListener() {}, replaceChildren() {}, append() {}, classList: { toggle() {} } });
  const elements = new Map();
  let engineCalls = 0;
  let passed = false;
  const context = vm.createContext({ chrome, URL, console, setTimeout, clearTimeout, setInterval, clearInterval, AbortController, Date, location: { hash: '#test-token' }, ...guards,
    document: { getElementById(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); }, createElement: node, body: { classList: { toggle() {} } }, addEventListener() {} },
    commentHistory: require('../comment-history.js'), sessionResults: require('../session-results.js'),
    sessionEngine: { async runSession(settings, adapter, signal, options) {
      engineCalls++;
      assert.equal(options.getFocus(), 'balanced');
      for (const focus of ['follow', 'comment', 'like', 'balanced']) {
        chrome.storage.onChanged.listeners[0]({ job: { newValue: { ...job, settings: { ...job.settings, focus } } } }, 'session');
        assert.equal(options.getFocus(), focus);
        assert.equal(signal.aborted, false);
      }
      passed = true;
    } },
  });
  vm.runInContext(read('runner.js'), context);
  for (let index = 0; index < 12; index++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(passed, true);
  assert.equal(engineCalls, 1);
  assert.ok(calls.some(call => call.type === 'runner-update' && call.patch.phase === 'complete'));
});
