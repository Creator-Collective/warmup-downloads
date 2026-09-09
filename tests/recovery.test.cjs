const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const extension = path.join(__dirname, '../browser-extension');
const { platforms, validPlatform, platformURL, instagramURL } = require('../browser-extension/guards.js');
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
const settings = { minutes: 10, niche: 'personal branding', customLimits: { like: 0, follow: 0, comment: 0 } };
const panel = { id: 'extension-id', url: 'chrome-extension://extension-id/sidepanel.html' };

function background(initial) {
  let job = structuredClone(initial);
  let now = 100000;
  const tabs = new Map([[7, { id: 7, url: 'https://www.instagram.com/', windowId: 1 }]]);
  if (initial) tabs.set(initial.runnerTabId, { id: initial.runnerTabId, url: `chrome-extension://extension-id/runner.html#${initial.token}` });
  const removed = [];
  let nextTabId = 90;
  const chrome = {
    runtime: { id: 'extension-id', getURL: value => `chrome-extension://extension-id/${value.replace(/^\//, '')}`, getManifest: () => ({ version: 'test' }), onMessage: event() },
    storage: { session: { get: async () => ({ job: structuredClone(job) }), set: async value => { job = structuredClone(value.job); } } },
    sidePanel: { setPanelBehavior: async () => {} },
    tabs: {
      query: async () => [...tabs.values()], get: async id => tabs.get(id),
      create: async options => { const tab = { id: nextTabId++, ...options }; tabs.set(tab.id, tab); return tab; },
      remove: async id => { removed.push(id); tabs.delete(id); },
      update: async () => {}, onRemoved: event(), onUpdated: event()
    }
  };
  const context = vm.createContext({ chrome, URL, console, crypto: webcrypto, Date: { now: () => now }, signupController: { suspendIfDisabled: async () => {}, read: async () => null, isActive: () => false, tabRemoved: async () => {}, tabUpdated: async () => {} } });
  context.importScripts = (...files) => files.filter(file => !file.startsWith('signup')).forEach(file => vm.runInContext(fs.readFileSync(path.join(extension, file), 'utf8'), context));
  vm.runInContext(fs.readFileSync(path.join(extension, 'background.js'), 'utf8'), context);
  const message = (request, sender = panel) => new Promise(resolve => chrome.runtime.onMessage.listeners[0](request, sender, resolve));
  return { chrome, tabs, removed, message, job: () => job, advance: milliseconds => { now += milliseconds; }, start: () => message({ type: 'start', tabId: 7, settings }) };
}

function runner(operation = async () => {}, respond) {
  const calls = [];
  const nodes = new Map();
  const job = { token: 'token', tabId: 7, runnerTabId: 90, phase: 'starting', deadline: Date.now() + 600000, settings, stats: {}, activity: [], message: 'starting' };
  const node = () => ({ textContent: '', disabled: false, listeners: {}, addEventListener(type, listener) { this.listeners[type] = listener; }, append() {}, replaceChildren() {}, classList: { toggle() {} } });
  const chrome = {
    runtime: { sendMessage: async message => { calls.push(message); return respond ? respond(message, job) : { ok: true, data: message.type === 'runner-job' ? job : null }; } },
    tabs: { onUpdated: event() }, storage: { onChanged: event() }
  };
  const context = vm.createContext({ chrome, URL, console, Date, AbortController, platforms, validPlatform, platformURL, instagramURL, location: { hash: '#token' },
    setTimeout: (fn, delay) => setTimeout(fn, delay >= 3000 ? 20 : 1), clearTimeout, setInterval, clearInterval,
    document: { getElementById: id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); }, createElement: node, body: { classList: { toggle() {} } }, addEventListener() {} },
    sessionEngine: { runSession: operation }
  });
  return { calls, nodes, context, start: () => vm.runInContext(fs.readFileSync(path.join(extension, 'runner.js'), 'utf8'), context) };
}

async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail('the expected recovery did not finish');
}

test('stop keeps the lock during acknowledgement grace, then closes only the dead runner', async () => {
  const h = background(); await h.start();
  const previous = h.job();
  await h.message({ type: 'stop' });
  assert.equal(h.job().phase, 'stopping');
  assert.equal((await h.start()).ok, false);
  assert.deepEqual(h.removed, []);
  h.advance(3000);
  const state = await h.message({ type: 'state' });
  assert.deepEqual(h.removed, [90]);
  assert.equal(h.tabs.has(7), true);
  assert.equal(state.data.running, false);
  assert.match(state.data.message, /action already sent may still complete/);
  assert.equal((await h.start()).ok, true);
  const stale = { id: 'extension-id', url: `chrome-extension://extension-id/runner.html#${previous.token}`, tab: { id: 90 } };
  assert.equal((await h.message({ type: 'runner-update', token: previous.token, patch: { phase: 'running' } }, stale)).ok, false);
});

test('a repeated explicit stop can recover immediately, including after a worker restart', async () => {
  const h = background(); await h.start();
  await h.message({ type: 'stop' });
  const restarted = background(h.job());
  const result = await restarted.message({ type: 'stop' });
  assert.equal(result.data.running, false);
  assert.deepEqual(restarted.removed, [90]);
});

test('failed runner closure retains the action lock and exposes manual recovery', async () => {
  const h = background(); await h.start(); await h.message({ type: 'stop' });
  h.chrome.tabs.remove = async () => { throw new Error('browser is busy'); };
  const result = await h.message({ type: 'stop' });
  assert.equal(result.data.running, true);
  assert.equal(h.job().phase, 'stopping');
  assert.match(result.data.message, /close the session tab/);
  assert.equal((await h.start()).ok, false);
});

test('the old lock stays held until Chrome confirms the runner has closed', async () => {
  const h = background(); await h.start(); await h.message({ type: 'stop' });
  let close;
  h.chrome.tabs.remove = () => new Promise(resolve => { close = resolve; });
  const stopping = h.message({ type: 'stop' });
  await until(() => close);
  assert.equal(h.job().phase, 'stopping');
  close(); await stopping;
  assert.equal(h.job().phase, 'error');
});

test('recovery does not close a runner tab that the user navigated elsewhere', async () => {
  const h = background(); await h.start(); await h.message({ type: 'stop' });
  h.tabs.set(90, { id: 90, url: 'https://example.com/' });
  assert.equal((await h.message({ type: 'stop' })).data.running, false);
  assert.deepEqual(h.removed, []);
  assert.equal(h.tabs.has(90), true);
});

test('a finished runner cannot revive its session or replace its outcome', async () => {
  const h = background(); await h.start();
  const job = h.job();
  const sender = { id: 'extension-id', url: `chrome-extension://extension-id/runner.html#${job.token}`, tab: { id: 90 } };
  await h.message({ type: 'runner-update', token: job.token, patch: { phase: 'error', message: 'an action may have gone through' } }, sender);
  await h.message({ type: 'runner-update', token: job.token, patch: { phase: 'running', message: 'late update' } }, sender);
  await h.message({ type: 'runner-update', token: job.token, patch: { phase: 'complete', message: 'late acknowledgement' } }, sender);
  assert.equal(h.job().phase, 'error');
  assert.equal(h.job().message, 'an action may have gone through');
});

test('failed startup acknowledges an error without running the Instagram engine', async () => {
  let runs = 0;
  const h = runner(async () => { runs++; }, message => {
    if (message.type === 'runner-job') throw new Error('temporary connection error');
    return { ok: true };
  });
  h.start();
  await until(() => h.nodes.get('status')?.textContent === 'couldn’t start');
  assert.equal(runs, 0);
  assert.equal(h.calls.filter(call => call.type === 'runner-job').length, 8);
  assert.equal(h.calls.find(call => call.type === 'runner-update').patch.phase, 'error');
});

test('a lost completion acknowledgement retries only status, never the session', async () => {
  let runs = 0; let acknowledgements = 0;
  const h = runner(async () => { runs++; }, (message, job) => {
    if (message.type === 'runner-update' && ++acknowledgements < 3) throw new Error('connection error');
    return { ok: true, data: message.type === 'runner-job' ? job : null };
  });
  h.start(); await until(() => acknowledgements === 3);
  assert.equal(runs, 1);
  assert.deepEqual(h.calls.filter(call => call.patch).map(call => call.patch.phase), ['complete', 'complete', 'complete']);
});

test('uncertain in-flight action warning survives acknowledgement retries after stop', async () => {
  let acknowledgements = 0;
  const h = runner(async () => {
    vm.runInContext("pendingEngagement = true; controller.abort(new Error('stopped'))", h.context);
  }, (message, job) => {
    if (message.type === 'runner-update' && ++acknowledgements === 1) throw new Error('connection error');
    return { ok: true, data: message.type === 'runner-job' ? job : null };
  });
  h.start(); await until(() => acknowledgements === 2);
  for (const call of h.calls.filter(call => call.patch)) {
    assert.equal(call.patch.phase, 'error');
    assert.match(call.patch.message, /action may have gone through/);
  }
});

test('exhausted status retries keep a visible stop control and recovery instructions', async () => {
  const h = runner(async () => {}, (message, job) => {
    if (message.type === 'runner-update') throw new Error('connection error');
    return { ok: true, data: job };
  });
  h.start(); await until(() => h.nodes.get('status')?.textContent === 'connection lost');
  assert.equal(h.calls.filter(call => call.patch).length, 3);
  assert.equal(h.nodes.get('stop').disabled, false);
  assert.match(h.nodes.get('message').textContent, /close this session tab before restarting/);
});

test('runner-only Stop retries a settled result once and renders its acknowledgement without storage events', async () => {
  let runs = 0;
  let recovered = false;
  let acknowledge;
  const h = runner(async () => { runs++; }, (message, job) => {
    if (message.type === 'runner-update') {
      if (!recovered) throw new Error('connection error');
      return new Promise(resolve => { acknowledge = resolve; });
    }
    return { ok: true, data: job };
  });
  h.start(); await until(() => h.nodes.get('status')?.textContent === 'connection lost');
  recovered = true;
  h.nodes.get('stop').listeners.click();
  h.nodes.get('stop').listeners.click();
  await until(() => acknowledge);
  assert.equal(h.calls.filter(call => call.patch).length, 4);
  assert.equal(h.calls.some(call => call.type === 'runner-stop'), false);
  acknowledge({ ok: true });
  await until(() => h.nodes.get('status')?.textContent === 'complete');
  assert.equal(h.nodes.get('stop').disabled, true);
  assert.equal(runs, 1);
  assert.ok(h.calls.filter(call => call.patch).every(call => call.patch.phase === 'complete'));
});

test('runner-only recovery preserves uncertain actions after engine cancellation', async () => {
  let recovered = false;
  let runs = 0;
  const h = runner(async () => {
    runs++;
    vm.runInContext("pendingEngagement = true; controller.abort(new Error('stopped'))", h.context);
  }, (message, job) => {
    if (message.type === 'runner-update' && !recovered) throw new Error('connection error');
    return { ok: true, data: message.type === 'runner-job' ? job : null };
  });
  h.start(); await until(() => h.nodes.get('status')?.textContent === 'connection lost');
  recovered = true;
  h.nodes.get('stop').listeners.click();
  await until(() => h.nodes.get('status')?.textContent === 'error');
  assert.equal(runs, 1);
  assert.equal(h.nodes.get('stop').disabled, true);
  assert.match(h.nodes.get('message').textContent, /action may have gone through/);
  assert.ok(h.calls.filter(call => call.patch).every(call => call.patch.phase === 'error'));
});

test('runner-only Stop recovers failed startup without a stored job response or dashboard', async () => {
  let recovered = false;
  let runs = 0;
  const h = runner(async () => { runs++; }, message => {
    if (message.type === 'runner-job' || !recovered) throw new Error('connection error');
    return { ok: true };
  });
  h.start(); await until(() => h.nodes.get('status')?.textContent === 'connection lost');
  recovered = true;
  h.nodes.get('stop').listeners.click();
  await until(() => h.nodes.get('status')?.textContent === 'error');
  assert.equal(runs, 0);
  assert.equal(h.nodes.get('stop').disabled, true);
  assert.equal(h.calls.filter(call => call.type === 'runner-job').length, 8);
  assert.equal(h.calls.filter(call => call.patch).length, 4);
});

test('unanswered messages are bounded and never allow a late startup to replay', async () => {
  let runs = 0;
  const h = runner(async () => { runs++; }, () => new Promise(() => {}));
  h.start(); await until(() => h.nodes.get('status')?.textContent === 'connection lost');
  assert.equal(runs, 0);
  assert.equal(h.calls.filter(call => call.type === 'runner-job').length, 8);
  assert.equal(h.calls.filter(call => call.type === 'runner-update').length, 3);
});
