const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');
const { validateSettings } = require('../plan.js');
const { resumableJob, publicState } = require('../browser-extension/guards.js');

// Each build lists the platforms it may drive in features.js. The instagram build
// lists only instagram; a tiktok test build lists only tiktok. These tests load the
// real background.js with each list, and the real side panel and hosted page markup.
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'browser-extension');
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
const plain = value => JSON.parse(JSON.stringify(value));
const INSTAGRAM_ONLY = 'warm-up is instagram only for now.';
const TIKTOK_ONLY = 'this test build runs tiktok only.';
const website = { id: 'extension-id', url: 'https://creator-collective-warmup.vercel.app/', frameId: 0, tab: { id: 2 } };
const panel = { id: 'extension-id', url: 'chrome-extension://extension-id/sidepanel.html' };
const NOW = 1000000;
const FEATURES = {
  real: null,
  legacy: 'const productFeatures = Object.freeze({ accountSignup: false });',
  tiktok: "const productFeatures = Object.freeze({ accountSignup: false, platforms: Object.freeze(['tiktok']), testTools: true });"
};

function worker(features, initial) {
  let job = structuredClone(initial);
  let time = NOW;
  const created = [], queries = [], removed = [], updated = [], tabCalls = [];
  const allTabs = [
    { id: 7, title: 'instagram', url: 'https://www.instagram.com/', windowId: 3 },
    { id: 8, title: 'tiktok', url: 'https://www.tiktok.com/', windowId: 4 },
    { id: 9, title: 'private', url: 'https://www.tiktok.com/@x/video/1', windowId: 3, incognito: true }
  ];
  if (job?.runnerTabId) allTabs.push({ id: job.runnerTabId, url: `chrome-extension://extension-id/runner.html#${job.token}` });
  class Clock extends Date { static now() { return time; } }
  const track = (name, fn) => async (...args) => { tabCalls.push(name); return fn(...args); };
  const chrome = {
    sidePanel: { setPanelBehavior: async () => {} },
    runtime: { id: 'extension-id', getURL: p => `chrome-extension://extension-id/${p.replace(/^\//, '')}`, getManifest: () => ({ version: '0.6.57' }), onMessage: event() },
    storage: { session: { get: async () => ({ job: structuredClone(job) }), set: async value => { job = structuredClone(value.job); } } },
    tabs: {
      query: track('query', async request => { queries.push(plain(request)); return allTabs; }),
      get: track('get', async id => allTabs.find(tab => tab.id === id)),
      create: track('create', async options => { created.push(plain(options)); const tab = { id: 90 + created.length + (job?.runnerTabId ? 10 : 0), ...options }; allTabs.push(tab); return tab; }),
      remove: track('remove', async id => { removed.push(id); allTabs.splice(allTabs.findIndex(tab => tab.id === id), 1); }),
      update: track('update', async (...args) => { updated.push(plain(args)); return {}; }),
      onRemoved: event(), onUpdated: event()
    }
  };
  const ctx = vm.createContext({ chrome, console, URL, crypto: webcrypto, structuredClone, Date: Clock });
  ctx.importScripts = (...files) => files.forEach(file => vm.runInContext(
    file === 'features.js' && FEATURES[features] ? FEATURES[features] : fs.readFileSync(path.join(extension, file), 'utf8'), ctx));
  vm.runInContext(fs.readFileSync(path.join(extension, 'background.js'), 'utf8'), ctx);
  const message = (request, source = panel) => new Promise(resolve => {
    if (!chrome.runtime.onMessage.listeners[0](request, source, response => resolve(plain(response)))) resolve(undefined);
  });
  const runner = () => ({ id: 'extension-id', url: `chrome-extension://extension-id/runner.html#${job.token}`, tab: { id: job.runnerTabId } });
  return { ctx, message, runner, created, queries, removed, updated, tabCalls, job: () => job, advance: ms => { time += ms; } };
}

function activeJob(phase, platform) {
  const settings = { ...validateSettings({ platform: platform || 'instagram', minutes: 10, niche: 'branding', enableComments: true }) };
  if (!platform) delete settings.platform;
  return {
    token: 'token', sessionId: 'session-1', tabId: platform === 'tiktok' ? 8 : 7, runnerTabId: 90, phase, settings,
    stopRequested: phase === 'stopping', ...(phase === 'stopping' ? { stopRequestedAt: NOW - 1000 } : {}),
    deadline: NOW + 300000, remainingMs: 300000, nextActionAt: NOW + 5000, checkpoint: null,
    stats: { like: 2, follow: 1 }, unconfirmed: { like: 0, follow: 1, comment: 0 }, pausedActions: [], activity: [{ time: NOW - 1000, message: 'watching' }], comments: [], message: 'watching'
  };
}

function savedJob(platform = 'tiktok', patch = {}) {
  const settings = validateSettings({ platform, minutes: 10, niche: 'branding, storytelling', enableComments: true, customLimits: { like: 30, follow: 10, comment: 5 }, focus: 'follow' });
  const comment = platform === 'tiktok'
    ? { text: 'this example is clear', url: 'https://www.tiktok.com/@creator/video/123/', author: 'creator', time: 1000, status: 'confirmed' }
    : { text: 'this example is clear', url: 'https://www.instagram.com/p/commented/', author: 'creator', time: 1000, status: 'confirmed' };
  const checkpoint = {
    version: 1, stats: { scroll: 57, read: 12, search: 2, open: 18, like: 19, follow: 6, comment: 1, skipped: 4 },
    unconfirmed: { like: 1, follow: 0, comment: 0 }, pausedActions: [], comments: [comment],
    seen: ['seen'], done: { like: ['liked'], follow: ['followed'], comment: ['commented'] }, usedComments: ['this example is clear'],
    termIndex: 2, currentSearchTerm: 'storytelling', elapsedMs: 120000, remainingMs: 480000,
    cooldowns: { like: 6000, follow: 10000, comment: 25000, engagement: 6000, break: 90000 }, inFlight: null
  };
  return { sessionId: 'saved-session', token: 'old-token', runnerTabId: 90, tabId: platform === 'tiktok' ? 8 : 7, settings, checkpoint, remainingMs: 480000, deadline: 700000, phase: 'stopped', stopRequested: true, nextActionAt: null,
    stats: checkpoint.stats, unconfirmed: checkpoint.unconfirmed, pausedActions: [], comments: checkpoint.comments, activity: [{ time: 1000, message: 'watching your post.' }], message: 'session stopped.', ...patch };
}

test('the instagram build lists only instagram, and hello says so without test tools', async () => {
  const h = worker('real');
  assert.deepEqual(plain(vm.runInContext('productFeatures.platforms', h.ctx)), ['instagram']);
  assert.equal(vm.runInContext('Object.isFrozen(productFeatures.platforms)', h.ctx), true);
  assert.equal(vm.runInContext('productFeatures.testTools', h.ctx), undefined);
  for (const source of [website, panel]) {
    const hello = await h.message({ type: 'hello' }, source);
    assert.deepEqual(Object.keys(hello.data).sort(), ['platforms', 'state', 'supportsFocus', 'version']);
    assert.deepEqual(hello.data.platforms, ['instagram']);
    assert.equal(Object.hasOwn(hello.data, 'testTools'), false);
  }
});

test('a feature file without a platform list keeps the instagram-only gates and wording', async () => {
  const h = worker('legacy');
  assert.deepEqual((await h.message({ type: 'hello' })).data.platforms, ['instagram']);
  assert.deepEqual(await h.message({ type: 'tabs', platform: 'tiktok' }), { ok: false, error: INSTAGRAM_ONLY });
  assert.deepEqual(await h.message({ type: 'tabs' }), { ok: true, data: [{ id: 7, title: 'instagram' }] });
  const stopped = worker('legacy', activeJob('running', 'tiktok'));
  assert.equal((await stopped.message({ type: 'state' })).ok, true);
  assert.equal(stopped.job().message, `tiktok session stopped. ${INSTAGRAM_ONLY}`);
  const kept = worker('legacy', activeJob('running', null));
  assert.equal((await kept.message({ type: 'state' })).ok, true);
  assert.deepEqual(kept.job(), activeJob('running', null));
});

test('the tiktok build lists, opens and starts only tiktok, using only tiktok addresses', async () => {
  for (const source of [panel, website]) {
    const h = worker('tiktok');
    assert.deepEqual(await h.message({ type: 'tabs', platform: 'tiktok' }, source), { ok: true, data: [{ id: 8, title: 'tiktok' }] });
    assert.deepEqual(h.queries, [{ url: ['https://www.tiktok.com/*', 'https://tiktok.com/*'] }]);
    for (const type of ['open-platform', 'open-instagram']) assert.equal((await h.message({ type, platform: 'tiktok' }, source)).ok, true);
    assert.deepEqual(h.created, [{ url: 'https://www.tiktok.com/' }, { url: 'https://www.tiktok.com/' }]);
    const started = await h.message({ type: 'start', tabId: 8, settings: { platform: 'tiktok', minutes: 10, niche: 'branding' } }, source);
    assert.equal(started.ok, true);
    assert.equal(h.job().settings.platform, 'tiktok');
    assert.equal(h.job().tabId, 8);
    assert.deepEqual(h.created.at(-1), { url: `chrome-extension://extension-id/runner.html#${h.job().token}`, active: false, windowId: 4 });
    assert.equal(started.data.settings.platform, 'tiktok');
    assert.equal(started.data.running, true);
  }
});

test('the tiktok build rejects instagram and platform-less requests without touching browser tabs', async () => {
  for (const source of [panel, website]) {
    const h = worker('tiktok');
    for (const [request, error] of [
      [{ type: 'tabs', platform: 'instagram' }, TIKTOK_ONLY],
      [{ type: 'tabs' }, TIKTOK_ONLY],
      [{ type: 'open-platform', platform: 'instagram' }, TIKTOK_ONLY],
      [{ type: 'open-instagram' }, TIKTOK_ONLY],
      [{ type: 'start', tabId: 7, settings: { platform: 'instagram', minutes: 10, niche: 'branding' } }, TIKTOK_ONLY],
      [{ type: 'start', tabId: 7, settings: { minutes: 10, niche: 'branding' } }, TIKTOK_ONLY],
      [{ type: 'tabs', platform: 'youtube' }, 'choose instagram or tiktok.']
    ]) assert.deepEqual(await h.message(request, source), { ok: false, error }, JSON.stringify(request));
    assert.deepEqual(h.tabCalls, []);
    assert.equal(h.job(), undefined);
    for (const [tabId, error] of [[7, 'that tab is no longer on tiktok. choose it again.'], [9, 'use a regular chrome window for this session.'], [undefined, 'choose a tiktok tab first.']]) {
      assert.deepEqual(await h.message({ type: 'start', tabId, settings: { platform: 'tiktok', minutes: 10, niche: 'branding' } }, source), { ok: false, error });
    }
    assert.equal(h.job(), undefined);
    assert.deepEqual(h.created, []);
  }
});

test('the tiktok build hello reports its platform and test tools', async () => {
  const h = worker('tiktok');
  const hello = await h.message({ type: 'hello' });
  assert.deepEqual(Object.keys(hello.data).sort(), ['platforms', 'state', 'supportsFocus', 'testTools', 'version']);
  assert.deepEqual(hello.data.platforms, ['tiktok']);
  assert.equal(hello.data.testTools, true);
  assert.equal(hello.data.supportsFocus, true);
  assert.equal(hello.data.state.phase, 'ready');
});

test('the tiktok build stops saved active instagram and platform-less sessions at worker start without tab actions', async () => {
  for (const platform of ['instagram', null]) {
    for (const phase of ['starting', 'running', 'stopping']) {
      const initial = activeJob(phase, platform);
      const h = worker('tiktok', initial);
      assert.equal((await h.message({ type: 'state' })).ok, true);
      assert.deepEqual(h.job(), { ...initial, phase: 'stopped', stopRequested: true, nextActionAt: null, message: `instagram session stopped. ${TIKTOK_ONLY}`, remainingMs: 300000, checkpoint: null }, `${platform}/${phase}`);
      assert.deepEqual(h.tabCalls, []);
      const runner = { id: 'extension-id', url: `chrome-extension://extension-id/runner.html#${initial.token}`, tab: { id: initial.runnerTabId } };
      assert.equal((await h.message({ type: 'runner-show', token: initial.token }, runner)).ok, false);
      assert.deepEqual(h.updated, []);
    }
  }
  for (const phase of ['complete', 'stopped', 'error']) {
    const initial = { ...activeJob(phase, 'instagram'), stopRequested: true, nextActionAt: null };
    const h = worker('tiktok', initial);
    assert.equal((await h.message({ type: 'state' })).ok, true);
    assert.deepEqual(h.job(), initial, phase);
  }
});

test('the tiktok build leaves active tiktok sessions running and can show their tab', async () => {
  for (const phase of ['starting', 'running', 'stopping']) {
    const initial = activeJob(phase, 'tiktok');
    const h = worker('tiktok', initial);
    for (const type of ['hello', 'state']) assert.equal((await h.message({ type })).ok, true);
    const runner = { id: 'extension-id', url: `chrome-extension://extension-id/runner.html#${initial.token}`, tab: { id: initial.runnerTabId } };
    assert.equal((await h.message({ type: 'runner-job', token: initial.token }, runner)).data.phase, phase);
    assert.deepEqual(h.job(), initial, phase);
    assert.deepEqual(h.tabCalls, []);
    assert.equal((await h.message({ type: 'runner-show', token: initial.token }, runner)).ok, true);
    assert.deepEqual(h.updated, [[8, { active: true }]]);
  }
});

test('the tiktok build resumes a saved tiktok session with its targets, progress and frozen time', async () => {
  for (const source of [panel, website]) {
    const original = savedJob('tiktok');
    const h = worker('tiktok', original);
    const oldRunner = h.runner();
    const state = (await h.message({ type: 'state' }, source)).data;
    assert.equal(state.canResume, true);
    assert.equal(state.settings.platform, 'tiktok');
    h.advance(86400000);
    const result = await h.message({ type: 'resume', sessionId: original.sessionId, tabId: 8, settings: { minutes: 120 }, checkpoint: { stats: {} } }, source);
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(h.job().settings, original.settings);
    assert.deepEqual(h.job().stats, original.stats);
    assert.deepEqual(h.job().unconfirmed, original.unconfirmed);
    assert.deepEqual(h.job().checkpoint, original.checkpoint);
    assert.deepEqual(h.job().comments, original.comments);
    assert.equal(h.job().sessionId, original.sessionId);
    assert.equal(h.job().deadline - (NOW + 86400000), original.remainingMs);
    assert.notEqual(h.job().token, original.token);
    assert.deepEqual(h.removed, [90]);
    assert.deepEqual(h.created, [{ url: `chrome-extension://extension-id/runner.html#${h.job().token}`, active: false, windowId: 4 }]);
    assert.equal((await h.message({ type: 'runner-checkpoint', token: original.token, checkpoint: original.checkpoint }, oldRunner)).ok, false);
    assert.equal((await h.message({ type: 'resume', sessionId: original.sessionId, tabId: 8 }, source)).ok, false);
    assert.equal(h.created.length, 1);
  }
});

test('each build resumes only its own saved sessions, and a platform-less session never resumes', async () => {
  const withoutPlatform = savedJob('instagram');
  delete withoutPlatform.settings.platform;
  for (const [features, saved, tabId] of [['tiktok', savedJob('instagram'), 7], ['tiktok', withoutPlatform, 7], ['real', savedJob('tiktok'), 8], ['real', withoutPlatform, 7]]) {
    const h = worker(features, saved);
    assert.equal((await h.message({ type: 'state' })).data.canResume, false);
    assert.deepEqual(await h.message({ type: 'resume', sessionId: saved.sessionId, tabId }), { ok: false, error: 'this session can’t be resumed. start a new session.' });
    assert.deepEqual(h.created, []);
    assert.deepEqual(h.removed, []);
    assert.deepEqual(h.job(), saved);
  }
});

test('guards resume and describe sessions against the enabled platform list, instagram by default', () => {
  const tiktok = savedJob('tiktok'), instagram = savedJob('instagram');
  const { platform, ...withoutPlatform } = instagram.settings;
  const legacy = { ...instagram, settings: withoutPlatform };
  assert.equal(resumableJob(instagram), true);
  assert.equal(resumableJob(tiktok), false);
  assert.equal(resumableJob(tiktok, ['tiktok']), true);
  assert.equal(resumableJob(instagram, ['tiktok']), false);
  for (const enabled of [undefined, ['instagram'], ['tiktok'], ['instagram', 'tiktok']]) assert.equal(resumableJob(legacy, enabled), false);
  for (const enabled of [null, 'tiktok', []]) assert.equal(resumableJob(tiktok, enabled), false);
  assert.equal(publicState(tiktok).canResume, false);
  assert.equal(publicState(tiktok, ['tiktok']).canResume, true);
  assert.equal(publicState(instagram, ['tiktok']).canResume, false);
  assert.deepEqual(plain({ ...publicState(tiktok, ['tiktok']), canResume: false }), plain(publicState(tiktok)));
});

// The real side panel and hosted page markup with the real dashboard scripts.
async function dashboard({ hosted = false, pagePlatform = 'instagram', hello = {}, state = { running: false, phase: 'ready', message: 'ready when you are.', activity: [] }, stored = null, onFocus = null } = {}) {
  const base = hosted ? root : extension;
  const html = fs.readFileSync(path.join(base, hosted ? 'index.html' : 'sidepanel.html'), 'utf8');
  const input = '<input id="platform" type="hidden" value="instagram">';
  assert.equal(html.split(input).length, 2);
  const dom = new JSDOM(html.replace(input, `<input id="platform" type="hidden" value="${pagePlatform}">`), {
    url: hosted ? 'https://creator-collective-warmup.vercel.app/' : 'chrome-extension://extension-id/sidepanel.html', runScripts: 'outside-only'
  });
  const { window } = dom;
  const requests = [];
  const storage = new Map(stored ? [['cc-web-session', JSON.stringify(stored)]] : []);
  Object.defineProperty(window, 'localStorage', { value: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } });
  window.setInterval = () => 1;
  let current = state;
  const answer = message => {
    requests.push(message);
    if (message.type === 'hello') return { supportsFocus: true, ...hello, state: current };
    if (message.type === 'tabs') return message.platform === 'tiktok' ? [{ id: 8, title: 'TikTok' }] : [{ id: 7, title: 'Instagram' }];
    if (message.type === 'set-focus') { current = onFocus ? onFocus(current, message) : current; return current; }
    if (message.type === 'start' || message.type === 'resume') return { ...current, running: true, phase: 'starting', canResume: false, message: 'starting your session…' };
    return current;
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

const TIKTOK_START = { type: 'start', settings: { platform: 'tiktok', niche: 'personal branding', minutes: 10, pace: 'auto', enableComments: true, focus: 'balanced', customLimits: {} }, tabId: 8 };
const showsTikTok = h => {
  assert.equal(h.$('platform').value, 'tiktok');
  assert.equal(h.$('tab-label').textContent, 'tiktok tab');
  assert.equal(h.$('instagram-tab').dataset.icon, 'tiktok');
  assert.equal(h.$('open-instagram').textContent, 'open tiktok ↗');
};

test('a side panel takes tiktok from its own build or its own page, and sends it on every request', async t => {
  const variants = [
    ['instagram page, tiktok build hello', { hello: { platforms: ['tiktok'], testTools: true } }],
    ['tiktok page, tiktok build hello', { pagePlatform: 'tiktok', hello: { platforms: ['tiktok'], testTools: true } }],
    ['tiktok page, hello without platforms', { pagePlatform: 'tiktok' }]
  ];
  for (const [name, options] of variants) await t.test(name, async variant => {
    const h = await dashboard(options);
    variant.after(() => h.dom.window.close());
    assert.equal(h.$('connection').textContent, 'connected');
    showsTikTok(h);
    assert.equal(h.$('focus-controls').hidden, false);
    assert.equal(h.$('instagram-tab').value, '8', 'the only tiktok tab is chosen automatically');
    assert.deepEqual(h.requests(), [{ type: 'hello' }, { type: 'tabs', platform: 'tiktok' }]);
    h.$('open-instagram').click();
    await h.settle();
    assert.deepEqual(h.requests().slice(2), [{ type: 'open-platform', platform: 'tiktok' }, { type: 'tabs', platform: 'tiktok' }]);
    h.$('session-form').dispatchEvent(new h.window.Event('submit', { cancelable: true }));
    await h.settle();
    assert.deepEqual(h.requests().at(-1), TIKTOK_START);
    assert.equal(h.saved().platform, 'tiktok');
    assert.deepEqual(h.saved().profiles.tiktok, { niche: 'personal branding', minutes: '10', focus: 'balanced', customLimits: {} });
  });
});

test('a side panel follows its own build back to instagram, while the hosted page ignores its page and replies', async t => {
  const variants = [
    ['tiktok page, instagram build hello', { pagePlatform: 'tiktok', hello: { platforms: ['instagram'] } }],
    ['tiktok page, unknown platform hello', { pagePlatform: 'youtube', hello: { platforms: ['youtube'] } }],
    ['hosted tiktok page, 0.6.57 hello', { hosted: true, pagePlatform: 'tiktok' }],
    ['hosted tiktok page, tiktok hello', { hosted: true, pagePlatform: 'tiktok', hello: { platforms: ['tiktok'], testTools: true } }]
  ];
  for (const [name, options] of variants) await t.test(name, async variant => {
    const h = await dashboard(options);
    variant.after(() => h.dom.window.close());
    assert.equal(h.$('platform').value, 'instagram');
    assert.equal(h.$('tab-label').textContent, 'instagram tab');
    assert.equal(h.$('open-instagram').textContent, 'open instagram ↗');
    assert.deepEqual(h.requests(), [{ type: 'hello' }, { type: 'tabs', platform: 'instagram' }]);
  });
});

test('the tiktok side panel restores and saves its own draft without touching the instagram draft', async t => {
  const instagram = { niche: 'instagram niche', minutes: '15', focus: 'like', customLimits: { follow: '3' } };
  const stored = { version: 3, platform: 'instagram', profiles: { instagram, tiktok: { niche: 'tiktok niche', minutes: '20', focus: 'balanced', customLimits: { comment: '4' } } } };
  const h = await dashboard({ hello: { platforms: ['tiktok'] }, stored });
  t.after(() => h.dom.window.close());
  showsTikTok(h);
  assert.equal(h.$('niche').value, 'tiktok niche');
  assert.equal(h.$('minutes').value, '20');
  assert.equal(h.$('limit-comment').value, '4');
  h.$('niche').value = 'cooking';
  h.$('niche').dispatchEvent(new h.window.Event('input'));
  assert.equal(h.saved().platform, 'tiktok');
  assert.equal(h.saved().profiles.tiktok.niche, 'cooking');
  assert.deepEqual(h.saved().profiles.instagram, instagram);
  h.$('session-form').dispatchEvent(new h.window.Event('submit', { cancelable: true }));
  await h.settle();
  const start = h.requests().at(-1);
  assert.equal(start.settings.platform, 'tiktok');
  assert.equal(start.settings.niche, 'cooking');
  assert.equal(start.settings.minutes, 20);
  assert.deepEqual(start.settings.customLimits, { comment: 4 });
});

test('the tiktok side panel mirrors a running tiktok session and sends focus changes', async t => {
  const settings = validateSettings({ platform: 'tiktok', minutes: 30, niche: 'cooking, baking', enableComments: true, customLimits: { like: 20, follow: 6, comment: 2 } });
  const state = { running: true, phase: 'running', sessionId: 'session-1', canChangeFocus: true, deadline: Date.now() + 600000, settings, tabId: 12, message: 'watching a video.', activity: [], stats: {} };
  const h = await dashboard({ hello: { platforms: ['tiktok'] }, state, onFocus: (current, message) => ({ ...current, settings: { ...current.settings, focus: message.focus } }) });
  t.after(() => h.dom.window.close());
  showsTikTok(h);
  assert.equal(h.$('niche').value, 'cooking, baking');
  assert.equal(h.$('minutes').value, '30');
  assert.deepEqual(['like', 'follow', 'comment'].map(action => h.$(`limit-${action}`).value), ['20', '6', '2']);
  assert.equal(h.$('instagram-tab').value, '12');
  assert.equal(h.$('instagram-tab').selectedOptions[0].textContent, 'active tiktok tab');
  assert.equal(h.$('focus-controls').hidden, false);
  assert.equal(h.$('focus').disabled, false);
  h.$('focus').value = 'follow';
  h.$('focus').dispatchEvent(new h.window.Event('change', { bubbles: true }));
  await h.settle();
  assert.deepEqual(h.requests().find(request => request.type === 'set-focus'), { type: 'set-focus', sessionId: 'session-1', focus: 'follow' });
  assert.equal(h.$('focus-status').textContent, 'applies to remaining targets.');
  assert.equal(h.saved().platform, 'tiktok');
  assert.equal(h.saved().profiles.tiktok.focus, 'follow');
});

test('the tiktok side panel resumes a saved tiktok session with only its id and the chosen tab', async t => {
  const saved = plain(publicState(savedJob('tiktok'), ['tiktok']));
  const h = await dashboard({ hello: { platforms: ['tiktok'] }, state: saved });
  t.after(() => h.dom.window.close());
  assert.equal(h.$('resume').hidden, false);
  assert.equal(h.$('resume-summary').textContent, 'resume uses saved settings: branding, storytelling · 30 likes · 10 follows · 5 comments · follow focus. edits apply to new sessions.');
  h.$('resume').click();
  await h.settle();
  assert.deepEqual(h.requests().at(-1), { type: 'resume', sessionId: 'saved-session', tabId: 8 });
});
