const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');
const { validateSettings } = require('../plan.js');
const { resumableJob, publicState } = require('../browser-extension/guards.js');

// Instagram pins for the shared control paths the TikTok parity work will make
// platform-aware: background.js gates (enabledPlatform, suspendDisabledJob, hello),
// guards.js resumableJob/publicState, and dashboard.js platform defaults and hello
// handling. Recorded at d5865be. Wording is pinned exactly because Instagram error and
// stop messages must stay word for word.
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'browser-extension');
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
const plain = value => JSON.parse(JSON.stringify(value));
const INSTAGRAM_ONLY = 'warm-up is instagram only for now.';
const website = { id: 'extension-id', url: 'https://creator-collective-warmup.vercel.app/', frameId: 0, tab: { id: 2 } };
const panel = { id: 'extension-id', url: 'chrome-extension://extension-id/sidepanel.html' };
const NOW = 1000000;

function worker(initial) {
  let job = structuredClone(initial);
  const created = [], queries = [], removed = [], tabCalls = [];
  const allTabs = [
    { id: 7, title: 'instagram', url: 'https://www.instagram.com/', windowId: 3 },
    { id: 8, title: 'tiktok', url: 'https://www.tiktok.com/', windowId: 3 },
    { id: 9, title: 'private', url: 'https://instagram.com/p/x/', windowId: 3, incognito: true }
  ];
  if (job?.runnerTabId) allTabs.push({ id: job.runnerTabId, url: `chrome-extension://extension-id/runner.html#${job.token}` });
  class Clock extends Date { static now() { return NOW; } }
  const track = (name, fn) => async (...args) => { tabCalls.push(name); return fn(...args); };
  const chrome = {
    sidePanel: { setPanelBehavior: async () => {} },
    runtime: { id: 'extension-id', getURL: p => `chrome-extension://extension-id/${p.replace(/^\//, '')}`, getManifest: () => ({ version: '0.6.57' }), onMessage: event() },
    storage: { session: { get: async () => ({ job: structuredClone(job) }), set: async value => { job = structuredClone(value.job); } } },
    tabs: {
      query: track('query', async request => { queries.push(plain(request)); return allTabs; }),
      get: track('get', async id => allTabs.find(tab => tab.id === id)),
      create: track('create', async options => { created.push(plain(options)); return { id: 90 + created.length, ...options }; }),
      remove: track('remove', async id => { removed.push(id); }),
      update: track('update', async () => ({})),
      onRemoved: event(), onUpdated: event()
    }
  };
  const ctx = vm.createContext({ chrome, console, URL, crypto: webcrypto, structuredClone, Date: Clock });
  ctx.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(extension, file), 'utf8'), ctx));
  vm.runInContext(fs.readFileSync(path.join(extension, 'background.js'), 'utf8'), ctx);
  const message = (request, source = panel) => new Promise(resolve => {
    if (!chrome.runtime.onMessage.listeners[0](request, source, response => resolve(plain(response)))) resolve(undefined);
  });
  return { message, created, queries, removed, tabCalls, job: () => job };
}

function activeJob(phase, platform) {
  const settings = { ...validateSettings({ platform: platform || 'instagram', minutes: 10, niche: 'branding', enableComments: true }) };
  if (!platform) delete settings.platform;
  return {
    token: 'token', sessionId: 'session-1', tabId: 7, runnerTabId: 90, phase, settings,
    stopRequested: phase === 'stopping', ...(phase === 'stopping' ? { stopRequestedAt: NOW - 1000 } : {}),
    deadline: NOW + 300000, remainingMs: 300000, nextActionAt: NOW + 5000, checkpoint: null,
    stats: { like: 2, follow: 1 }, unconfirmed: { like: 0, follow: 1, comment: 0 }, pausedActions: [], activity: [{ time: NOW - 1000, message: 'watching' }], comments: [], message: 'watching'
  };
}

test('instagram-only rejections keep their exact wording and never touch browser tabs', async () => {
  for (const source of [website, panel]) {
    const h = worker();
    for (const [request, error] of [
      [{ type: 'tabs', platform: 'tiktok' }, INSTAGRAM_ONLY],
      [{ type: 'open-platform', platform: 'tiktok' }, INSTAGRAM_ONLY],
      [{ type: 'open-instagram', platform: 'tiktok' }, INSTAGRAM_ONLY],
      [{ type: 'start', tabId: 8, settings: { platform: 'tiktok', minutes: 10, niche: 'branding' } }, INSTAGRAM_ONLY],
      [{ type: 'tabs', platform: 'youtube' }, 'choose instagram or tiktok.'],
      [{ type: 'start', tabId: 8, settings: { minutes: 10, niche: 'branding' } }, 'that tab is no longer on instagram. choose it again.']
    ]) assert.deepEqual(await h.message(request, source), { ok: false, error }, JSON.stringify(request));
    assert.deepEqual(h.tabCalls, ['get'], 'only the last start looked up its chosen tab');
    assert.equal(h.job(), undefined);
  }
});

test('instagram listing, opening and starting use only instagram addresses, with instagram as the default', async () => {
  for (const platform of [undefined, 'instagram']) {
    const h = worker();
    assert.deepEqual(await h.message({ type: 'tabs', platform }), { ok: true, data: [{ id: 7, title: 'instagram' }] });
    assert.deepEqual(h.queries, [{ url: ['https://www.instagram.com/*', 'https://instagram.com/*'] }]);
    for (const type of ['open-platform', 'open-instagram']) assert.equal((await h.message({ type, platform })).ok, true);
    assert.deepEqual(h.created, [{ url: 'https://www.instagram.com/' }, { url: 'https://www.instagram.com/' }]);
    const started = await h.message({ type: 'start', tabId: 7, settings: { platform, minutes: 10, niche: 'branding' } });
    assert.equal(started.ok, true);
    assert.equal(h.job().settings.platform, 'instagram');
    assert.deepEqual(h.created.at(-1), { url: `chrome-extension://extension-id/runner.html#${h.job().token}`, active: false, windowId: 3 });
    assert.equal(started.data.settings.platform, 'instagram');
  }
});

test('hello reports the version, focus support and public state, and never test tools', async () => {
  for (const initial of [undefined, activeJob('running', 'instagram'), activeJob('running', null)]) {
    const h = worker(initial);
    const hello = await h.message({ type: 'hello' });
    assert.equal(hello.ok, true);
    // The parity plan may add platforms: ['instagram'] here; nothing else may appear.
    assert.deepEqual(Object.keys(hello.data).filter(key => key !== 'platforms').sort(), ['state', 'supportsFocus', 'version']);
    if (Object.hasOwn(hello.data, 'platforms')) assert.deepEqual(hello.data.platforms, ['instagram']);
    assert.equal(hello.data.version, '0.6.57');
    assert.equal(hello.data.supportsFocus, true);
    assert.equal(hello.data.testTools, undefined);
    assert.deepEqual(hello.data.state, (await h.message({ type: 'state' })).data);
    assert.equal(hello.data.state.phase, initial ? 'running' : 'ready');
    if (initial) {
      assert.equal(hello.data.state.settings.platform, 'instagram');
      assert.equal(hello.data.state.remainingMs, 300000);
      assert.equal(hello.data.state.canChangeFocus, true);
    }
  }
});

test('worker start and panel requests leave active instagram and platform-less sessions untouched', async () => {
  for (const platform of ['instagram', null]) {
    for (const phase of ['starting', 'running', 'stopping']) {
      const initial = activeJob(phase, platform);
      const h = worker(initial);
      for (const type of ['hello', 'state']) assert.equal((await h.message({ type })).ok, true);
      const runner = { id: 'extension-id', url: `chrome-extension://extension-id/runner.html#${initial.token}`, tab: { id: initial.runnerTabId } };
      assert.equal((await h.message({ type: 'runner-job', token: initial.token }, runner)).data.phase, phase);
      assert.deepEqual(h.job(), initial, `${platform}/${phase}`);
      assert.deepEqual(h.tabCalls, []);
    }
  }
});

test('worker start stops only active tiktok sessions, with the exact instagram-only message', async () => {
  for (const phase of ['starting', 'running', 'stopping']) {
    const initial = activeJob(phase, 'tiktok');
    const h = worker(initial);
    assert.equal((await h.message({ type: 'state' })).ok, true);
    assert.deepEqual(h.job(), { ...initial, phase: 'stopped', stopRequested: true, nextActionAt: null, message: `tiktok session stopped. ${INSTAGRAM_ONLY}`, remainingMs: 300000, checkpoint: null }, phase);
    assert.deepEqual(h.tabCalls, []);
  }
  for (const phase of ['complete', 'stopped', 'error']) {
    const initial = { ...activeJob(phase, 'tiktok'), stopRequested: true, nextActionAt: null };
    const h = worker(initial);
    assert.equal((await h.message({ type: 'state' })).ok, true);
    assert.deepEqual(h.job(), initial, phase);
  }
});

function savedJob(patch = {}) {
  const settings = validateSettings({ platform: 'instagram', minutes: 10, niche: 'branding, storytelling', enableComments: true, customLimits: { like: 30, follow: 10, comment: 5 }, focus: 'follow' });
  const checkpoint = {
    version: 1, stats: { scroll: 57, read: 12, search: 2, open: 18, like: 19, follow: 6, comment: 1, skipped: 4 },
    unconfirmed: { like: 1, follow: 0, comment: 0 }, pausedActions: [],
    comments: [{ text: 'this example is clear', url: 'https://www.instagram.com/p/commented/', author: 'creator', status: 'confirmed', time: 1000 }],
    seen: ['seen'], done: { like: ['liked'], follow: ['followed'], comment: ['commented'] }, usedComments: ['this example is clear'],
    termIndex: 2, currentSearchTerm: 'storytelling', elapsedMs: 120000, remainingMs: 480000,
    cooldowns: { like: 6000, follow: 10000, comment: 25000, engagement: 6000, break: 90000 }, inFlight: null
  };
  return { sessionId: 'saved-session', token: 'old-token', runnerTabId: 90, tabId: 7, settings, checkpoint, remainingMs: 480000, deadline: 700000, phase: 'stopped', stopRequested: true, nextActionAt: null,
    stats: checkpoint.stats, unconfirmed: checkpoint.unconfirmed, pausedActions: [], comments: checkpoint.comments, activity: [{ time: 1000, message: 'watching your post.' }], message: 'session stopped.', ...patch };
}

test('only a stopped or failed instagram session with time and a valid checkpoint can resume', () => {
  const settings = savedJob().settings;
  const { platform, ...withoutPlatform } = settings;
  assert.equal(platform, 'instagram');
  for (const [patch, expected] of [
    [{}, true], [{ phase: 'error' }, true],
    [{ phase: 'complete' }, false], [{ phase: 'running', stopRequested: false, deadline: Date.now() + 60000 }, false], [{ phase: 'starting' }, false], [{ phase: 'stopping' }, false],
    [{ remainingMs: 0 }, false], [{ sessionId: undefined }, false], [{ checkpoint: null }, false], [{ checkpoint: { version: 1 } }, false],
    [{ settings: { ...settings, platform: 'tiktok' } }, false],
    // Today a session without a saved platform is never resumable; 0.6.56+ sessions always carry one.
    [{ settings: withoutPlatform }, false]
  ]) assert.equal(resumableJob(savedJob(patch)), expected, JSON.stringify(patch).slice(0, 80));
});

test('public state for no session, a saved instagram session and a platform-less session keeps its shape', () => {
  assert.deepEqual(plain(publicState()), { running: false, phase: 'ready', message: 'ready when you are.', stats: {}, unconfirmed: { like: 0, follow: 0, comment: 0 }, pausedActions: [], activity: [], comments: [] });
  const saved = savedJob();
  assert.deepEqual(plain(publicState(saved)), {
    running: false, phase: 'stopped', message: 'session stopped.', deadline: 700000, nextActionAt: null, stats: saved.stats,
    unconfirmed: { like: 1, follow: 0, comment: 0 }, pausedActions: [], activity: saved.activity,
    comments: [{ text: 'this example is clear', url: 'https://www.instagram.com/p/commented/', author: 'creator', time: 1000, status: 'confirmed' }],
    tabId: 7, sessionId: 'saved-session', canResume: true, remainingMs: 480000, canChangeFocus: false,
    settings: { platform: 'instagram', minutes: 10, terms: ['branding', 'storytelling'], pace: 'auto', limits: { like: 30, follow: 10, comment: 5 }, weights: { like: 2, follow: 1, comment: 1 }, focus: 'follow' }
  });
  const { platform, ...withoutPlatform } = saved.settings;
  const legacy = plain(publicState(savedJob({ settings: withoutPlatform })));
  assert.equal(legacy.settings.platform, 'instagram');
  assert.equal(legacy.canResume, false);
});

// The real page markup and dashboard scripts. The side panel talks to the worker
// directly; the hosted page talks through window messages answered by the bridge.
async function dashboard({ hosted = false, hello = {}, state = { running: false, phase: 'ready', message: 'ready when you are.', activity: [] } } = {}) {
  const base = hosted ? root : extension;
  const dom = new JSDOM(fs.readFileSync(path.join(base, hosted ? 'index.html' : 'sidepanel.html'), 'utf8'), {
    url: hosted ? 'https://creator-collective-warmup.vercel.app/' : 'chrome-extension://extension-id/sidepanel.html', runScripts: 'outside-only'
  });
  const { window } = dom;
  const requests = [];
  const storage = new Map();
  Object.defineProperty(window, 'localStorage', { value: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } });
  window.setInterval = () => 1;
  const answer = message => {
    requests.push(message);
    if (message.type === 'hello') return { supportsFocus: true, ...hello, state };
    if (message.type === 'tabs') return [{ id: 7, title: 'Instagram' }];
    if (message.type === 'start' || message.type === 'resume') return { ...state, running: true, phase: 'starting', canResume: false, message: 'starting your session…' };
    return state;
  };
  if (hosted) {
    window.postMessage = data => {
      if (data?.channel !== 'cc-warmup-request') return;
      const { channel, id, ...message } = data;
      setImmediate(() => window.dispatchEvent(new window.MessageEvent('message', { source: window, origin: window.location.origin, data: { channel: 'cc-warmup-response', id, ok: true, data: answer(message) } })));
    };
  } else {
    window.chrome = { runtime: { sendMessage: async message => ({ ok: true, data: answer(message) }) } };
  }
  for (const name of ['plan.js', 'comment-history.js', 'session-results.js', 'dashboard.js', 'select-ui.js']) window.eval(fs.readFileSync(path.join(base, name), 'utf8'));
  const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
  await settle();
  return { dom, window, requests: () => plain(requests), settle, $: id => window.document.getElementById(id), saved: () => JSON.parse(storage.get('cc-web-session')) };
}

const START = { type: 'start', settings: { platform: 'instagram', niche: 'personal branding', minutes: 10, pace: 'auto', enableComments: true, focus: 'balanced', customLimits: {} }, tabId: 7 };

test('the side panel and hosted page stay on instagram whatever hello reports about platforms', async t => {
  const variants = [
    ['side panel, 0.6.57 hello', { hosted: false, hello: {} }],
    ['side panel, instagram build hello', { hosted: false, hello: { platforms: ['instagram'] } }],
    ['hosted page, 0.6.57 hello', { hosted: true, hello: {} }],
    ['hosted page, instagram build hello', { hosted: true, hello: { platforms: ['instagram'] } }],
    // The hosted page answers the first reply on its origin, so a foreign reply must not switch it.
    ['hosted page, foreign tiktok hello', { hosted: true, hello: { platforms: ['tiktok'], testTools: true } }]
  ];
  for (const [name, options] of variants) await t.test(name, async variant => {
    const h = await dashboard(options);
    variant.after(() => h.dom.window.close());
    assert.equal(h.$('connection').textContent, options.hosted ? 'extension connected' : 'connected');
    assert.equal(h.$('platform').value, 'instagram');
    assert.equal(h.$('tab-label').textContent, 'instagram tab');
    assert.equal(h.$('instagram-tab').dataset.icon, 'instagram');
    assert.equal(h.$('open-instagram').textContent, 'open instagram ↗');
    assert.equal(h.$('focus-controls').hidden, false);
    assert.deepEqual(h.requests(), [{ type: 'hello' }, { type: 'tabs', platform: 'instagram' }]);
    h.$('open-instagram').click();
    await h.settle();
    assert.deepEqual(h.requests().slice(2), [{ type: 'open-platform', platform: 'instagram' }, { type: 'tabs', platform: 'instagram' }]);
    h.$('session-form').dispatchEvent(new h.window.Event('submit', { cancelable: true }));
    await h.settle();
    assert.deepEqual(h.requests().at(-1), START);
    assert.equal(h.saved().version, 3);
    assert.equal(h.saved().platform, 'instagram');
    assert.deepEqual(Object.keys(h.saved().profiles), ['instagram']);
  });
});

test('without focus support the panel hides focus and starts a balanced session', async t => {
  const h = await dashboard({ hello: { supportsFocus: false } });
  t.after(() => h.dom.window.close());
  assert.equal(h.$('focus-controls').hidden, true);
  h.$('focus').value = 'follow';
  h.$('session-form').dispatchEvent(new h.window.Event('submit', { cancelable: true }));
  await h.settle();
  assert.deepEqual(h.requests().at(-1), START);
});

test('resume sends only the saved session id and the chosen instagram tab', async t => {
  const saved = plain(publicState(savedJob()));
  const h = await dashboard({ state: saved });
  t.after(() => h.dom.window.close());
  assert.equal(h.$('resume').hidden, false);
  assert.equal(h.$('resume-summary').textContent, 'resume uses saved settings: branding, storytelling · 30 likes · 10 follows · 5 comments · follow focus. edits apply to new sessions.');
  h.$('resume').click();
  await h.settle();
  assert.deepEqual(h.requests().at(-1), { type: 'resume', sessionId: 'saved-session', tabId: 7 });
});
