const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');
const { validateSettings } = require('../plan.js');
const { normalizeCheckpoint, publicState } = require('../browser-extension/guards.js');
const root = path.resolve(__dirname, '..');
const origin = 'https://creator-collective-warmup.vercel.app';
const sender = { id: 'extension-id', url: `${origin}/`, frameId: 0, tab: { id: 2 } };
const panel = { id: 'extension-id', url: 'chrome-extension://extension-id/sidepanel.html' };
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
function savedJob() {
  const settings = validateSettings({ platform: 'instagram', minutes: 10, niche: 'branding, storytelling', enableComments: true, customLimits: { like: 30, follow: 10, comment: 5 }, focus: 'follow' });
  const checkpoint = {
    version: 1, stats: { scroll: 57, read: 12, search: 2, open: 18, like: 19, follow: 6, comment: 1, skipped: 4 },
    unconfirmed: { like: 1, follow: 0, comment: 0 }, pausedActions: [],
    comments: [{ text: 'this example is clear', url: 'https://www.instagram.com/p/commented/', author: 'creator', status: 'confirmed', time: 1000 }],
    seen: ['seen'], done: { like: ['liked'], follow: ['followed'], comment: ['commented'] }, usedComments: ['this example is clear'],
    termIndex: 2, currentSearchTerm: 'storytelling', elapsedMs: 120000, remainingMs: 480000,
    cooldowns: { like: 6000, follow: 10000, comment: 25000, engagement: 6000, break: 90000 }, inFlight: null
  };
  return { sessionId: 'saved-session', token: 'old-token', runnerTabId: 90, tabId: 7, settings, checkpoint, remainingMs: 480000, deadline: 700000, phase: 'stopped', stopRequested: true, nextActionAt: null, stats: checkpoint.stats, unconfirmed: checkpoint.unconfirmed, pausedActions: [], comments: checkpoint.comments, activity: [{ time: 1000, message: 'watching your post.' }], message: 'session stopped.' };
}
function background(initial = savedJob()) {
  let job = structuredClone(initial), time = 1000000, id = 90;
  const created = [], removed = [];
  const allTabs = [{ id: 7, title: 'instagram', url: 'https://www.instagram.com/', windowId: 3 }, { id: 8, title: 'tiktok', url: 'https://www.tiktok.com/', windowId: 3 }];
  if (job?.runnerTabId) allTabs.push({ id: job.runnerTabId, url: `chrome-extension://extension-id/runner.html#${job.token}` });
  class Clock extends Date { static now() { return time; } }
  const chrome = { sidePanel: { setPanelBehavior: async () => {} }, runtime: { id: 'extension-id', getURL: p => `chrome-extension://extension-id/${p.replace(/^\//, '')}`, getManifest: () => ({ version: 'test' }), onMessage: event() },
    storage: { session: { get: async () => ({ job: structuredClone(job) }), set: async value => { job = structuredClone(value.job); } } },
    tabs: { query: async () => allTabs, get: async tabId => allTabs.find(tab => tab.id === tabId), create: async options => { created.push(options); const tab = { id: ++id, ...options }; allTabs.push(tab); return tab; }, remove: async tabId => { removed.push(tabId); allTabs.splice(allTabs.findIndex(tab => tab.id === tabId), 1); }, update: async () => {}, onRemoved: event(), onUpdated: event() } };
  const ctx = vm.createContext({ chrome, console, URL, crypto: webcrypto, structuredClone, Date: Clock });
  ctx.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(root, 'browser-extension', file), 'utf8'), ctx));
  vm.runInContext(fs.readFileSync(path.join(root, 'browser-extension/background.js'), 'utf8'), ctx);
  const message = (request, source = sender) => new Promise(resolve => { if (!chrome.runtime.onMessage.listeners[0](request, source, resolve)) resolve(undefined); });
  const runner = () => ({ id: 'extension-id', url: `chrome-extension://extension-id/runner.html#${job.token}`, tab: { id: job.runnerTabId } });
  return { message, runner, chrome, created, removed, allTabs, job: () => job, now: () => time, advance: ms => { time += ms; } };
}

test('resume preserves saved progress, original targets and unused time while rotating runner credentials', async () => {
  for (const source of [sender, panel]) {
    const original = savedJob(), h = background(original), oldRunner = h.runner();
    h.advance(86400000);
    const result = await h.message({ type: 'resume', sessionId: original.sessionId, tabId: 7, settings: { minutes: 120 }, checkpoint: { stats: {} } }, source);
    assert.equal(result.ok, true);
    assert.deepEqual(h.job().settings, original.settings);
    assert.deepEqual(h.job().stats, original.stats);
    assert.deepEqual(h.job().unconfirmed, original.unconfirmed);
    assert.deepEqual(h.job().checkpoint, original.checkpoint);
    assert.deepEqual(h.job().comments, original.comments);
    assert.deepEqual(h.job().activity, original.activity);
    assert.equal(h.job().sessionId, original.sessionId);
    assert.equal(h.job().deadline - h.now(), original.remainingMs);
    assert.notEqual(h.job().token, original.token);
    assert.deepEqual(h.removed, [90]);
    assert.equal(h.created[0].active, false);
    assert.equal(h.created[0].windowId, 3);
    assert.equal((await h.message({ type: 'runner-checkpoint', token: original.token, checkpoint: original.checkpoint }, oldRunner)).ok, false);
    assert.equal((await h.message({ type: 'resume', sessionId: original.sessionId, tabId: 7 }, source)).ok, false);
    assert.equal(h.created.length, 1);
  }
});

test('resume fails closed for active, expired, legacy, malformed, replaced and unsupported sessions', async () => {
  for (const patch of [
    { phase: 'running', stopRequested: false }, { phase: 'starting' }, { phase: 'stopping' }, { phase: 'complete' },
    { remainingMs: 0 }, { checkpoint: undefined }, { checkpoint: { version: 1 } },
    { settings: { ...savedJob().settings, platform: 'tiktok' } }, { sessionId: 'replaced-session' }
  ]) {
    const h = background({ ...savedJob(), ...patch });
    assert.equal((await h.message({ type: 'resume', sessionId: 'saved-session', tabId: 7 })).ok, false);
    assert.equal(h.created.length, 0);
    assert.equal(h.removed.length, 0);
  }
  const h = background();
  for (const tabId of [8, undefined, '7']) assert.equal((await h.message({ type: 'resume', sessionId: 'saved-session', tabId })).ok, false);
  h.allTabs[0].incognito = true;
  assert.equal((await h.message({ type: 'resume', sessionId: 'saved-session', tabId: 7 })).ok, false);
});

test('resume closes only its old runner, and cannot create a second runner while closing fails', async () => {
  const h = background();
  h.chrome.tabs.remove = async () => { throw new Error('still open'); };
  assert.equal((await h.message({ type: 'resume', sessionId: 'saved-session', tabId: 7 })).ok, false);
  assert.equal(h.created.length, 0);
  h.allTabs.find(tab => tab.id === 90).url = 'https://example.com/';
  assert.equal((await h.message({ type: 'resume', sessionId: 'saved-session', tabId: 7 })).ok, true);
  assert.deepEqual(h.removed, []);
});

test('stop freezes remaining time and accepts the runner’s final preserved checkpoint without draining paused time', async () => {
  const initial = savedJob();
  initial.phase = 'running'; initial.stopRequested = false; initial.deadline = 1400000;
  const h = background(initial);
  assert.equal((await h.message({ type: 'stop' })).ok, true);
  assert.equal(h.job().remainingMs, 400000);
  assert.equal(h.job().checkpoint.elapsedMs, 200000);
  h.advance(60000);
  const final = { ...initial.checkpoint, elapsedMs: 260000, remainingMs: 340000, stats: { ...initial.stats, like: 20 } };
  assert.equal((await h.message({ type: 'runner-checkpoint', token: initial.token, checkpoint: final }, h.runner())).ok, true);
  await h.message({ type: 'runner-update', token: initial.token, patch: { phase: 'stopped', message: 'stopped.' } }, h.runner());
  assert.equal(h.job().remainingMs, 400000);
  assert.equal(h.job().checkpoint.elapsedMs, 200000);
  assert.equal(h.job().stats.like, 20);
  h.advance(60000);
  const response = await h.message({ type: 'state' });
  assert.equal(response.data.remainingMs, 400000);
  assert.equal(response.data.canResume, true);
  for (const privateKey of ['checkpoint', 'token', 'runnerTabId', 'seen', 'done', 'inFlight', 'usedComments']) assert.equal(Object.hasOwn(response.data, privateKey), false);
});

test('closed and discarded tabs freeze usable sessions, while completion cannot resume', async () => {
  for (const type of ['close', 'discard', 'complete']) {
    const initial = { ...savedJob(), phase: 'running', stopRequested: false, deadline: 1400000 }, h = background(initial);
    if (type === 'close') h.chrome.tabs.onRemoved.listeners[0](7);
    if (type === 'discard') h.chrome.tabs.onUpdated.listeners[0](7, { discarded: true });
    if (type === 'complete') await h.message({ type: 'runner-update', token: initial.token, patch: { phase: 'complete' } }, h.runner());
    const response = await h.message({ type: 'state' });
    assert.equal(response.data.remainingMs, type === 'complete' ? 0 : 400000);
    assert.equal(response.data.canResume, type !== 'complete');
  }
});

test('checkpoints keep complete deduplication and uncertain action data, and reject unsafe or over-cap data', async () => {
  const original = savedJob(), checkpoint = structuredClone(original.checkpoint);
  checkpoint.seen = Array.from({ length: 10000 }, (_, index) => `post-${index}`);
  checkpoint.inFlight = { action: 'comment', key: 'pending-post', post: { id: 'https://www.instagram.com/p/pending/', author: null }, comment: 'a useful example', time: 10000 };
  checkpoint.privateData = 'discard me';
  const h = background({ ...original, phase: 'running', stopRequested: false, deadline: 1480000 });
  const spoof = { ...h.runner(), tab: { id: 123 } };
  assert.equal((await h.message({ type: 'runner-checkpoint', token: original.token, checkpoint }, spoof)).ok, false);
  assert.equal((await h.message({ type: 'runner-checkpoint', token: original.token, checkpoint }, h.runner())).ok, true);
  assert.equal(h.job().checkpoint.seen.length, 10000);
  assert.equal(h.job().checkpoint.inFlight.key, 'pending-post');
  assert.equal(h.job().checkpoint.privateData, undefined);
  for (const change of [
    { seen: [...checkpoint.seen, 'overflow'] }, { usedComments: ['x'.repeat(2049)] },
    { stats: { ...checkpoint.stats, like: 31 } }, { unconfirmed: { ...checkpoint.unconfirmed, like: 12 } },
    { remainingMs: Infinity }, { elapsedMs: -1 }, { version: 2 }, { done: {} },
    { comments: [{ text: 'bad', url: 'https://evil.example/' }] }, { inFlight: { ...checkpoint.inFlight, action: 'delete' } }
  ]) assert.equal(normalizeCheckpoint({ ...checkpoint, ...change }, original.settings), null);
  assert.equal((await h.message({ type: 'runner-checkpoint', token: original.token, checkpoint: { ...checkpoint, seen: [...checkpoint.seen, 'overflow'] } }, h.runner())).ok, false);
  assert.equal(h.job().checkpoint, null);
  assert.equal(publicState({ ...h.job(), phase: 'stopped' }).canResume, false);
});

test('website resume bridge forwards only the saved session id and chosen tab', async () => {
  const forwarded = [], responses = [];
  let listener;
  const window = { addEventListener: (_type, fn) => { listener = fn; }, postMessage: message => responses.push(message) };
  window.top = window;
  const context = vm.createContext({ window, location: { origin }, chrome: { runtime: { sendMessage: async message => { forwarded.push(message); return { ok: true }; } } } });
  vm.runInContext(fs.readFileSync(path.join(root, 'browser-extension/bridge.js'), 'utf8'), context);
  await listener({ source: window, origin, data: { channel: 'cc-warmup-request', id: 'request', type: 'resume', sessionId: 'saved-session', tabId: 7, settings: { minutes: 120 }, checkpoint: {} } });
  assert.deepEqual({ ...forwarded[0] }, { type: 'resume', sessionId: 'saved-session', tabId: 7 });
  assert.equal(responses[0].ok, true);
});

test('a real engine checkpoint survives background validation, stop, and resumed runner handoff', async () => {
  const h = background(null);
  const started = await h.message({ type: 'start', tabId: 7, settings: { minutes: 3, niche: 'study tips', customLimits: { like: 1, follow: 0, comment: 0 } } });
  assert.equal(started.ok, true);
  const engine = vm.createContext({ setTimeout, clearTimeout, AbortController, URL });
  for (const file of ['plan.js', 'session.js']) vm.runInContext(fs.readFileSync(path.join(root, 'browser-extension', file), 'utf8'), engine);
  const controller = new AbortController(), token = h.job().token;
  let index = 0, saves = 0;
  const adapter = {
    checkpoint: async checkpoint => {
      const response = await h.message({ type: 'runner-checkpoint', token, checkpoint }, h.runner());
      assert.equal(response.ok, true, response.error); saves += 1;
    },
    update: () => {}, search: async () => {}, open: async () => true, scroll: async () => true, leavePost: async () => true,
    inspect: async () => ({ post: { id: `https://www.instagram.com/p/real-${index++}/`, author: 'creator', text: 'study tips', caption: 'Study tips work best with daily practice.', like: true, follow: true, comment: true } }),
    engage: async () => { await h.message({ type: 'stop' }); controller.abort(); return 'confirmed'; }
  };
  await engine.sessionEngine.runSession(h.job().settings, adapter, controller.signal, { random: () => 0.5, now: h.now, sleep: async ms => h.advance(ms) });
  assert.ok(saves > 2);
  assert.equal(h.job().stats.like, 1);
  assert.equal(h.job().checkpoint.inFlight, null);
  assert.equal(h.job().checkpoint.done.like.length, 1);
  await h.message({ type: 'runner-update', token, patch: { phase: 'stopped' } }, h.runner());
  const checkpoint = structuredClone(h.job().checkpoint);
  h.advance(86400000);
  assert.equal((await h.message({ type: 'resume', sessionId: h.job().sessionId, tabId: 7 })).ok, true);
  assert.deepEqual(h.job().checkpoint, checkpoint);
  assert.equal(h.job().deadline - h.now(), checkpoint.remainingMs);
});

function view({ legacy = false } = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), { url: 'chrome-extension://extension-id/sidepanel.html', runScripts: 'outside-only' });
  const { window } = dom, requests = [], intervals = new Map(), storage = new Map();
  Object.defineProperty(window, 'localStorage', { value: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } });
  let state = publicState(savedJob()), responder;
  if (legacy) delete state.canResume;
  window.setInterval = (fn, ms) => intervals.set(ms, fn);
  window.chrome = { runtime: { sendMessage: async message => {
    requests.push(message);
    if (responder) { const result = await responder(message); if (result !== undefined) return result; }
    if (message.type === 'hello') return { ok: true, data: { supportsFocus: true, state } };
    if (message.type === 'tabs') return { ok: true, data: [{ id: 7, title: 'instagram' }] };
    if (message.type === 'resume') state = { ...state, running: true, canResume: false, phase: 'running', deadline: Date.now() + state.remainingMs };
    if (message.type === 'start') state = { ...state, running: true, canResume: false, phase: 'running', sessionId: 'new-session', settings: validateSettings(message.settings), stats: {}, deadline: Date.now() + message.settings.minutes * 60000 };
    return { ok: true, data: state };
  } } };
  for (const file of ['plan.js', 'comment-history.js', 'session-results.js', 'dashboard.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  return { dom, window, requests, state: () => state, $: id => window.document.getElementById(id), poll: () => intervals.get(1500)(), timer: () => intervals.get(1000)(), respond: fn => { responder = fn; } };
}

test('resume is primary, shows saved settings and frozen time, and ignores edited invalid new-session fields', async t => {
  const h = view(); t.after(() => h.window.close()); await tick();
  assert.equal(h.$('resume').hidden, false);
  assert.equal(h.$('resume').disabled, false);
  assert.equal(h.$('start').textContent, 'start new session');
  assert.equal(h.$('start').classList.contains('secondary'), true);
  assert.match(h.$('resume-summary').textContent, /branding, storytelling.*30 likes.*10 follows.*5 comments.*follow focus/);
  assert.equal(h.$('remaining').textContent, '8:00 left');
  h.timer(); assert.equal(h.$('remaining').textContent, '8:00 left');
  h.$('niche').value = ''; h.$('niche').dispatchEvent(new h.window.Event('input'));
  assert.equal(h.$('start').disabled, true);
  assert.equal(h.$('resume').disabled, false);
  h.$('resume').click(); await tick();
  assert.deepEqual({ ...h.requests.find(request => request.type === 'resume') }, { type: 'resume', sessionId: 'saved-session', tabId: 7 });
  assert.equal(h.$('resume').hidden, true);
  assert.equal(h.$('stop').hidden, false);
  assert.equal(h.$('niche').value, 'branding, storytelling');
  assert.equal(h.$('stat-like').textContent, '19 / 30');
});

test('start new session remains explicit and uses the edited new settings', async t => {
  const h = view(); t.after(() => h.window.close()); await tick();
  h.$('niche').value = 'new niche'; h.$('niche').dispatchEvent(new h.window.Event('input'));
  h.$('start').click(); await tick();
  assert.equal(h.requests.some(request => request.type === 'resume'), false);
  assert.equal(h.requests.find(request => request.type === 'start').settings.niche, 'new niche');
  assert.equal(h.state().sessionId, 'new-session');
});

test('old extensions do not show unsupported resume controls', async t => {
  const h = view({ legacy: true }); t.after(() => h.window.close()); await tick();
  assert.equal(h.$('resume').hidden, true);
  assert.equal(h.$('resume-summary').hidden, true);
  assert.equal(h.$('start').textContent, 'start session');
  assert.equal(h.$('start').disabled, false);
  h.$('resume').click(); await tick();
  assert.equal(h.requests.some(request => request.type === 'resume'), false);
});

test('a stale state poll cannot overwrite resume, and failed resume keeps retry available', async t => {
  const h = view(); t.after(() => h.window.close()); await tick();
  let resolve;
  const old = structuredClone(h.state());
  h.respond(message => message.type === 'state' ? new Promise(done => { resolve = done; }) : undefined);
  const polling = h.poll(); await tick();
  h.$('resume').click(); await tick();
  resolve({ ok: true, data: old }); await polling;
  assert.equal(h.$('stop').hidden, false);
  assert.equal(h.$('resume').hidden, true);
  const failed = view(); t.after(() => failed.window.close()); await tick();
  failed.respond(message => message.type === 'resume' ? { ok: false, error: 'choose your instagram tab again.' } : undefined);
  failed.$('resume').click(); await tick();
  assert.equal(failed.$('resume').disabled, false);
  assert.match(failed.$('form-error').textContent, /choose your instagram tab again/);
});
