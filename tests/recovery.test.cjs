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

// Without the tabs permission, Chrome reports only platform tab URLs. It hides
// every other address, including this extension's own session tab.
const visibleTab = tab => /^https:\/\/(www\.)?(instagram|tiktok)\.com\//.test(tab.url || '') ? { ...tab } : { ...tab, url: undefined, pendingUrl: undefined, title: undefined };
// Extension pages with a live document, as chrome.runtime.getContexts lists them.
const ownContexts = (tabs, { tabIds = [] } = {}) => [...tabs.values()]
  .filter(tab => tabIds.includes(tab.id) && !tab.discarded && tab.url?.startsWith('chrome-extension://extension-id/'))
  .map(tab => ({ contextType: 'TAB', tabId: tab.id, frameId: 0, documentUrl: tab.url, documentOrigin: 'chrome-extension://extension-id' }));

function background(initial, platform = initial?.settings?.platform || 'instagram') {
  let job = structuredClone(initial);
  let now = 100000;
  const tabs = new Map([[7, { id: 7, url: `https://www.${platform}.com/`, windowId: 1 }]]);
  if (initial) tabs.set(initial.runnerTabId, { id: initial.runnerTabId, url: `chrome-extension://extension-id/runner.html#${initial.token}` });
  const removed = [];
  let nextTabId = 90;
  const chrome = {
    runtime: { id: 'extension-id', getURL: value => `chrome-extension://extension-id/${value.replace(/^\//, '')}`, getManifest: () => ({ version: 'test' }), onMessage: event(), getContexts: async filter => ownContexts(tabs, filter) },
    storage: { session: { get: async () => ({ job: structuredClone(job) }), set: async value => { job = structuredClone(value.job); } } },
    sidePanel: { setPanelBehavior: async () => {} },
    tabs: {
      query: async () => [...tabs.values()].map(visibleTab), get: async id => tabs.has(id) ? visibleTab(tabs.get(id)) : undefined,
      create: async options => { const tab = { id: nextTabId++, ...options }; tabs.set(tab.id, tab); return tab; },
      remove: async id => { removed.push(id); tabs.delete(id); },
      update: async () => {}, onRemoved: event(), onUpdated: event()
    }
  };
  const context = vm.createContext({ chrome, URL, console, crypto: webcrypto, Date: { now: () => now }, signupController: { suspendIfDisabled: async () => {}, read: async () => null, isActive: () => false, tabRemoved: async () => {}, tabUpdated: async () => {} } });
  context.importScripts = (...files) => files.filter(file => !file.startsWith('signup')).forEach(file => vm.runInContext(fs.readFileSync(path.join(extension, file), 'utf8'), context));
  vm.runInContext(fs.readFileSync(path.join(extension, 'background.js'), 'utf8'), context);
  const message = (request, sender = panel) => new Promise(resolve => chrome.runtime.onMessage.listeners[0](request, sender, resolve));
  return { chrome, tabs, removed, message, job: () => job, advance: milliseconds => { now += milliseconds; }, start: () => message({ type: 'start', tabId: 7, settings: { ...settings, platform } }) };
}

function runner(operation = async () => {}, respond) {
  const calls = [];
  const nodes = new Map();
  const job = { token: 'token', tabId: 7, runnerTabId: 90, phase: 'starting', deadline: Date.now() + 600000, settings, stats: {}, activity: [], message: 'starting' };
  const node = () => ({ textContent: '', disabled: false, dataset: {}, scrollTop: 0, listeners: {}, addEventListener(type, listener) { this.listeners[type] = listener; }, append() {}, replaceChildren() {}, classList: { toggle() {} } });
  const chrome = {
    runtime: { sendMessage: async message => { calls.push(message); return respond ? respond(message, job) : { ok: true, data: message.type === 'runner-job' ? job : null }; } },
    tabs: { onUpdated: event() }, storage: { onChanged: event() }
  };
  const context = vm.createContext({ chrome, URL, console, Date, AbortController, platforms, validPlatform, platformURL, instagramURL, location: { hash: '#token' },
    setTimeout: (fn, delay) => setTimeout(fn, delay >= 3000 ? 20 : 1), clearTimeout, setInterval, clearInterval,
    document: { getElementById: id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); }, createElement: node, body: { classList: { toggle() {} } }, addEventListener() {} },
    sessionEngine: { runSession: operation }
  });
  context.commentHistory = require('../comment-history.js');
  context.sessionResults = require('../session-results.js');
  return { calls, nodes, context, start: () => vm.runInContext(fs.readFileSync(path.join(extension, 'runner.js'), 'utf8'), context) };
}

async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail('the expected recovery did not finish');
}

test('comment history survives activity turnover, acknowledgement retries, worker restart and completion', async () => {
  const h = background(); await h.start();
  const job = h.job();
  const sender = { id: 'extension-id', url: `chrome-extension://extension-id/runner.html#${job.token}`, tab: { id: job.runnerTabId } };
  const comment = { text: 'this part stood out: a useful personal branding idea', url: 'https://www.instagram.com/p/example/', author: '/creator/', status: 'confirmed', time: 100100, secret: 'omit this' };
  const patch = { phase: 'running', comments: [comment], message: 'comment confirmed.' };
  await h.message({ type: 'runner-update', token: job.token, patch }, sender);
  await h.message({ type: 'runner-update', token: job.token, patch }, sender);
  for (let i = 0; i < 20; i++) await h.message({ type: 'runner-update', token: job.token, patch: { phase: 'running', message: `watching post ${i}` } }, sender);
  const restarted = background(h.job());
  await restarted.message({ type: 'runner-update', token: job.token, patch: { phase: 'complete', message: 'finished' } }, sender);
  const state = (await restarted.message({ type: 'state' })).data;
  assert.equal(state.comments?.length, 1);
  assert.equal(state.comments[0].text, comment.text);
  assert.equal(state.comments[0].secret, undefined);
  assert.equal(state.activity.length, 12);
  assert.ok(!state.activity.some(item => item.message === 'comment confirmed.'));
  assert.equal((await restarted.start()).ok, true);
  assert.deepEqual((await restarted.message({ type: 'state' })).data.comments, []);
});

test('a comment confirmed during Stop remains reviewable without reviving the session', async () => {
  const h = background(); await h.start();
  const job = h.job();
  const sender = { id: 'extension-id', url: `chrome-extension://extension-id/runner.html#${job.token}`, tab: { id: job.runnerTabId } };
  await h.message({ type: 'stop' });
  const comment = { text: 'the comment that finished while stopping', url: 'https://www.instagram.com/p/example/', author: '/creator/', time: 100100, status: 'confirmed' };
  await h.message({ type: 'runner-update', token: job.token, patch: { phase: 'running', message: 'comment confirmed.', comments: [comment] } }, sender);
  assert.equal(h.job().phase, 'stopping');
  assert.match(h.job().message, /session stopped/);
  await h.message({ type: 'runner-update', token: job.token, patch: { phase: 'stopped' } }, sender);
  assert.equal((await h.message({ type: 'state' })).data.comments?.[0]?.text, comment.text);
});

test('specific activity retains the complete username and longest generated comment through public state', async () => {
  const h = background(); await h.start();
  const job = h.job();
  const sender = { id: 'extension-id', url: `chrome-extension://extension-id/runner.html#${job.token}`, tab: { id: job.runnerTabId } };
  const text = `commented on @${'a'.repeat(30)}'s post: this part stood out: "${'something '.repeat(18).trim()}"`;
  assert.ok(text.length > 240 && text.length < 600);
  await h.message({ type: 'runner-update', token: job.token, patch: { phase: 'running', message: text } }, sender);
  const state = (await h.message({ type: 'state' })).data;
  assert.equal(state.message, text);
  assert.equal(state.activity[0].message, text);
  await h.message({ type: 'runner-update', token: job.token, patch: { phase: 'running', message: 'x'.repeat(1000) } }, sender);
  assert.equal(h.job().message.length, 600);
});

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

test('a new session closes the finished session tab even though Chrome hides its address', async () => {
  const h = background(); await h.start();
  const job = h.job();
  const sender = { id: 'extension-id', url: `chrome-extension://extension-id/runner.html#${job.token}`, tab: { id: job.runnerTabId } };
  await h.message({ type: 'runner-update', token: job.token, patch: { phase: 'complete', message: 'time’s up. your session is complete.' } }, sender);
  assert.equal((await h.chrome.tabs.get(90)).url, undefined);
  const result = await h.start();
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(h.removed, [90]);
  assert.equal(h.job().phase, 'starting');
});

test('a session tab without a live page is left open and does not block a new session', async () => {
  for (const change of [{ discarded: true }, { url: 'about:blank', pendingUrl: 'chrome-extension://extension-id/runner.html#x' }]) {
    const h = background(); await h.start();
    const job = h.job();
    const sender = { id: 'extension-id', url: `chrome-extension://extension-id/runner.html#${job.token}`, tab: { id: job.runnerTabId } };
    await h.message({ type: 'runner-update', token: job.token, patch: { phase: 'complete', message: 'done' } }, sender);
    h.tabs.set(90, { ...h.tabs.get(90), ...change });
    assert.equal((await h.start()).ok, true);
    assert.deepEqual(h.removed, []);
    assert.equal(h.tabs.has(90), true);
  }
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


function historicalTikTokJob(phase = 'running') {
  const posted = { text: 'the exact posted tiktok comment', url: 'https://tiktok.com/@creator/video/123', author: '@creator', status: 'confirmed', time: 100100, secret: 'omit this' };
  const uncertain = { text: 'the exact unconfirmed tiktok comment', url: 'https://www.tiktok.com/@other/video/456/', author: '@other', status: 'uncertain', time: 100200 };
  return {
    token: 'token', sessionId: 'old-tiktok-session', tabId: 7, runnerTabId: 90, phase,
    settings: { platform: 'tiktok', minutes: 10, terms: ['personal branding'], pace: 'auto', limits: { like: 4, follow: 2, comment: 2 }, weights: { like: 2, follow: 1, comment: 1 } },
    stopRequested: phase === 'stopping', stopRequestedAt: phase === 'stopping' ? 90000 : undefined,
    deadline: 700000, nextActionAt: 110000, stats: { like: 2, follow: 1, comment: 1, skipped: 1 },
    unconfirmed: { like: 0, follow: 1, comment: 1 }, pausedActions: ['comment'],
    comments: [posted, { ...posted, url: 'https://www.tiktok.com/@creator/video/123/' }, uncertain, { ...uncertain, url: 'https://tiktok.com/@other/video/456' }],
    activity: Array.from({ length: 12 }, (_, index) => ({ time: 100100 - index, message: `watching tiktok ${11 - index}` })),
    message: 'comment not confirmed.'
  };
}

test('saved TikTok results remain reviewable after updating, without accepting late runner results', async t => {
  for (const phase of ['complete', 'stopped', 'error']) await t.test(phase, async () => {
    const saved = historicalTikTokJob(phase);
    const h = background(saved);
    const sender = { id: 'extension-id', url: `chrome-extension://extension-id/runner.html#${saved.token}`, tab: { id: saved.runnerTabId } };
    for (const retryPhase of ['running', 'complete']) {
      assert.equal((await h.message({ type: 'runner-update', token: saved.token, patch: { phase: retryPhase, comments: [], stats: { comment: 99 }, message: 'late retry' } }, sender)).ok, true);
    }
    const restarted = background(h.job());
    const state = (await restarted.message({ type: 'state' })).data;
    assert.equal(state.settings.platform, 'tiktok');
    assert.equal(state.phase, phase);
    assert.equal(state.running, false);
    assert.equal(state.message, saved.message);
    assert.equal(state.comments.length, 2);
    assert.deepEqual(Array.from(state.comments, item => item.status), ['confirmed', 'uncertain']);
    assert.deepEqual(Array.from(state.comments, item => item.url), ['https://www.tiktok.com/@creator/video/123/', 'https://www.tiktok.com/@other/video/456/']);
    assert.deepEqual(Array.from(state.comments, item => item.text), [saved.comments[0].text, saved.comments[2].text]);
    assert.equal(state.comments[0].author, 'creator');
    assert.equal(state.comments[0].secret, undefined);
    assert.equal(state.stats.comment, 1, 'an unconfirmed submission is not counted as posted');
    assert.deepEqual(Array.from(state.activity, item => ({ ...item })), saved.activity);
    assert.deepEqual({ ...state.unconfirmed }, saved.unconfirmed);
    assert.deepEqual(Array.from(state.pausedActions), saved.pausedActions);
    assert.equal((await restarted.start()).ok, false, 'saved TikTok settings cannot restart a TikTok session');
  });
});

test('updating stops saved active TikTok sessions without tab actions and allows a new Instagram session', async t => {
  for (const phase of ['starting', 'running', 'stopping']) await t.test(phase, async () => {
    const saved = historicalTikTokJob(phase);
    const h = background(saved);
    const sender = { id: 'extension-id', url: `chrome-extension://extension-id/runner.html#${saved.token}`, tab: { id: saved.runnerTabId } };
    const tabCalls = [];
    const originals = {};
    for (const method of ['query', 'get', 'create', 'update', 'remove']) {
      originals[method] = h.chrome.tabs[method];
      h.chrome.tabs[method] = async () => { tabCalls.push(method); throw new Error('the paused TikTok session must not touch browser tabs'); };
    }
    // Startup must stop old sessions even before a dashboard or runner reconnects.
    await until(() => h.job().phase === 'stopped');
    assert.equal(h.job().stopRequested, true);
    assert.equal(h.job().nextActionAt, null);
    assert.match(h.job().message, /tiktok session stopped.*instagram only/);
    assert.deepEqual(h.job().comments, saved.comments);
    assert.deepEqual(h.job().stats, saved.stats);
    assert.deepEqual(h.job().unconfirmed, saved.unconfirmed);
    assert.deepEqual(h.job().pausedActions, saved.pausedActions);
    const stopped = structuredClone(h.job());
    for (const type of ['hello', 'state', 'stop']) assert.equal((await h.message({ type })).ok, true);
    assert.equal((await h.message({ type: 'runner-show', token: saved.token }, sender)).ok, false);
    assert.equal((await h.message({ type: 'runner-job', token: saved.token }, sender)).data.phase, 'stopped');
    await h.message({ type: 'runner-update', token: saved.token, patch: { phase: 'running', stats: { comment: 99 }, comments: [], nextActionAt: 110000, message: 'late retry' } }, sender);
    assert.deepEqual(h.job(), stopped, 'late activity cannot revive TikTok or erase saved results');
    let runs = 0;
    const oldRunner = runner(async () => { runs++; }, message => h.message(message, sender));
    oldRunner.start();
    await until(() => oldRunner.nodes.get('status')?.textContent === 'stopped');
    assert.equal(runs, 0, 'reopening the old runner must not run the session engine');
    assert.deepEqual(tabCalls, []);
    Object.assign(h.chrome.tabs, originals);
    h.tabs.set(8, { id: 8, url: 'https://www.instagram.com/', windowId: 1 });
    assert.equal((await h.message({ type: 'start', tabId: 8, settings: { ...settings, platform: 'instagram' } })).ok, true);
    assert.equal(h.job().settings.platform, 'instagram');
    assert.equal(h.job().phase, 'starting');
    assert.notEqual(h.job().token, saved.token);
    assert.equal((await h.message({ type: 'runner-update', token: saved.token, patch: { phase: 'running' } }, sender)).ok, false);
    assert.deepEqual((await h.message({ type: 'state' })).data.comments, []);
  });
});
