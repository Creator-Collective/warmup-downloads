const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');
const { validateSettings } = require('../plan.js');
const { warmupDiagnostics } = require('../browser-extension/guards.js');
const { commentComposer } = require('./fixtures/tiktok-comment-composer.cjs');

// Test-build plumbing and privacy: the background keeps numbers-only diagnostics on
// tiktok test jobs through Stop, the final update and resume; the page check and the
// report answer only the test build's own side panel; and the report is built from
// fixed labels and numbers only, which a whitelist of words enforces here.
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'browser-extension');
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
const plain = value => JSON.parse(JSON.stringify(value));
const website = { id: 'extension-id', url: 'https://creator-collective-warmup.vercel.app/', frameId: 0, tab: { id: 2 } };
const panel = { id: 'extension-id', url: 'chrome-extension://extension-id/sidepanel.html' };
const NOW = 1000000;
const FEATURES = {
  real: null,
  tiktok: "const productFeatures = Object.freeze({ accountSignup: false, platforms: Object.freeze(['tiktok']), testTools: true });",
  noTools: "const productFeatures = Object.freeze({ accountSignup: false, platforms: Object.freeze(['tiktok']) });"
};
const EMPTY = { version: 1, like: { pairs: {}, reads: {} }, follow: { pairs: {}, reads: {} }, comment: { confirm: {}, submit: {} }, advances: 0, runs: 0, ends: {}, blocks: {} };

function worker(features, initial, { page = null, scriptError = null } = {}) {
  let job = structuredClone(initial);
  let time = NOW;
  const created = [], scripts = [], tabCalls = [];
  const allTabs = [
    { id: 7, title: 'instagram', url: 'https://www.instagram.com/', windowId: 3 },
    { id: 8, title: 'tiktok', url: 'https://www.tiktok.com/@creator/video/123/', windowId: 4 },
    { id: 9, title: 'private', url: 'https://www.tiktok.com/@x/video/1', windowId: 3, incognito: true }
  ];
  if (job?.runnerTabId) allTabs.push({ id: job.runnerTabId, url: `chrome-extension://extension-id/runner.html#${job.token}` });
  class Clock extends Date { static now() { return time; } }
  const track = (name, fn) => async (...args) => { tabCalls.push(name); return fn(...args); };
  const chrome = {
    sidePanel: { setPanelBehavior: async () => {} },
    runtime: { id: 'extension-id', getURL: p => `chrome-extension://extension-id/${p.replace(/^\//, '')}`, getManifest: () => ({ version: '0.6.58.1' }), onMessage: event() },
    storage: { session: { get: async () => ({ job: structuredClone(job) }), set: async value => { job = structuredClone(value.job); } } },
    tabs: {
      query: track('query', async () => allTabs),
      get: track('get', async id => { const tab = allTabs.find(item => item.id === id); if (!tab) throw new Error(`No tab with id: ${id}.`); return tab; }),
      create: track('create', async options => { created.push(plain(options)); const tab = { id: 90 + created.length + (job?.runnerTabId ? 10 : 0), ...options }; allTabs.push(tab); return tab; }),
      remove: track('remove', async id => { allTabs.splice(allTabs.findIndex(tab => tab.id === id), 1); }),
      update: track('update', async () => ({})),
      onRemoved: event(), onUpdated: event()
    },
    scripting: {
      executeScript: async input => {
        scripts.push(plain({ tabId: input.target.tabId, files: input.files || null, func: Boolean(input.func) }));
        if (scriptError) throw new Error(scriptError);
        if (input.files) { page?.load(); return [{ result: null }]; }
        return [{ result: page ? page.inject(input.func, input.args || []) : null }];
      }
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
  return { message, runner, created, scripts, tabCalls, job: () => job, advance: ms => { time += ms; } };
}

function savedJob(patch = {}) {
  const settings = validateSettings({ platform: 'tiktok', minutes: 10, niche: 'branding, storytelling', enableComments: true });
  const checkpoint = {
    version: 1, stats: { scroll: 5, read: 1, search: 2, open: 4, like: 3, follow: 1, comment: 0, skipped: 2 },
    unconfirmed: { like: 1, follow: 0, comment: 0 }, pausedActions: [], comments: [],
    seen: ['seen'], done: { like: ['liked'], follow: ['followed'], comment: [] }, usedComments: [],
    termIndex: 1, currentSearchTerm: 'branding', elapsedMs: 120000, remainingMs: 480000,
    cooldowns: { like: 6000, follow: 10000, comment: 25000, engagement: 6000, break: 90000 }, inFlight: null
  };
  return { sessionId: 'saved-session', token: 'old-token', runnerTabId: 90, tabId: 8, settings, checkpoint, remainingMs: 480000, deadline: 700000, phase: 'stopped', stopRequested: true, nextActionAt: null,
    stats: checkpoint.stats, unconfirmed: checkpoint.unconfirmed, pausedActions: [], comments: [], activity: [], message: 'session stopped.', ...patch };
}
const START = { type: 'start', tabId: 8, settings: { platform: 'tiktok', minutes: 10, niche: 'branding' } };
const update = (h, patch) => h.message({ type: 'runner-update', token: h.job().token, patch }, h.runner());

test('the instagram build keeps no diagnostics and treats the test commands as unknown', async () => {
  const h = worker('real');
  assert.equal((await h.message({ type: 'start', tabId: 7, settings: { platform: 'instagram', minutes: 10, niche: 'branding' } })).ok, true);
  assert.equal(Object.hasOwn(h.job(), 'diagnostics'), false);
  assert.equal((await update(h, { phase: 'running', message: 'watching', diagnostics: { runs: 1, like: { pairs: { ok: { persisted: 1 } } } } })).ok, true);
  assert.equal(Object.hasOwn(h.job(), 'diagnostics'), false);
  for (const features of ['real', 'noTools']) {
    const build = worker(features);
    for (const source of [panel, website]) {
      for (const type of ['test-probe', 'test-report']) {
        assert.deepEqual(await build.message({ type, tabId: 8 }, source), { ok: false, error: 'unknown dashboard action.' }, `${features} ${type}`);
      }
    }
    assert.deepEqual(build.scripts, []);
  }
});

test('the tiktok test build keeps diagnostics through updates, stop, the final update and resume', async () => {
  const h = worker('tiktok');
  assert.equal((await h.message(START)).ok, true);
  assert.deepEqual(h.job().diagnostics, EMPTY);
  // Only known codes and whole counts are kept.
  await update(h, { phase: 'running', message: 'watching', diagnostics: {
    version: 9, extra: 'https://www.tiktok.com/@secret', advances: '7', runs: 1,
    like: { pairs: { ok: { persisted: 2, 'https://x': 5 }, '@handle': { persisted: 1 } }, reads: { ok: 2.5, 'not-liked': -1 } },
    comment: { confirm: { 'own-row-missing': 1, 'a secret comment': 3 }, submit: { 'composer-empty': 1 } }, blocks: { challenge: 1, 'cookie=1': 1 }
  } });
  assert.deepEqual(h.job().diagnostics, { ...EMPTY, runs: 1, like: { pairs: { ok: { persisted: 2 } }, reads: {} },
    comment: { confirm: { 'own-row-missing': 1 }, submit: { 'composer-empty': 1 } }, blocks: { challenge: 1 } });
  // An action that finishes during Stop keeps its counts, while Stop keeps the phase.
  assert.equal((await h.message({ type: 'stop' })).ok, true);
  assert.equal(h.job().phase, 'stopping');
  await update(h, { phase: 'running', diagnostics: { runs: 1, like: { pairs: { ok: { persisted: 3 } } } } });
  assert.equal(h.job().phase, 'stopping');
  assert.deepEqual(h.job().diagnostics.like.pairs, { ok: { persisted: 3 } });
  await update(h, { phase: 'stopped', message: 'session stopped. you have control.', diagnostics: { runs: 1, like: { pairs: { ok: { persisted: 4 } } }, ends: { stopped: 1 } } });
  assert.equal(h.job().phase, 'stopped');
  assert.deepEqual(h.job().diagnostics, { ...EMPTY, runs: 1, like: { pairs: { ok: { persisted: 4 } }, reads: {} }, ends: { stopped: 1 } });
  // A late update after the end changes nothing.
  await update(h, { phase: 'running', diagnostics: { runs: 5 } });
  assert.deepEqual(h.job().diagnostics.runs, 1);
  // Resume keeps them, and checkpoints leave them alone.
  const saved = savedJob({ diagnostics: { runs: 1, advances: 3, ends: { stopped: 1 }, like: { pairs: { ok: { reverted: 2 } } } } });
  const resumed = worker('tiktok', saved);
  const result = await resumed.message({ type: 'resume', sessionId: saved.sessionId, tabId: 8 });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(resumed.job().diagnostics, { ...EMPTY, runs: 1, advances: 3, ends: { stopped: 1 }, like: { pairs: { ok: { reverted: 2 } }, reads: {} } });
  assert.equal(Object.hasOwn(result.data, 'diagnostics'), false, 'the session state shown to the page is unchanged');
  assert.equal((await resumed.message({ type: 'runner-checkpoint', token: resumed.job().token, checkpoint: saved.checkpoint }, resumed.runner())).ok, true);
  assert.equal(resumed.job().diagnostics.advances, 3);
});

test('the page check answers only the test build side panel, never during a session, and changes nothing', async () => {
  const page = commentComposer();
  const h = worker('tiktok', undefined, { page });
  assert.equal(await h.message({ type: 'test-probe', tabId: 8 }, website), undefined);
  assert.equal(await h.message({ type: 'test-probe', tabId: 8 }, { id: 'extension-id', url: 'chrome-extension://extension-id/runner.html#x', tab: { id: 90 } }), undefined);
  assert.deepEqual(h.scripts, []);
  const result = await h.message({ type: 'test-probe', tabId: 8 });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(h.scripts, [{ tabId: 8, files: ['tiktok.js'], func: false }, { tabId: 8, files: null, func: true }]);
  assert.deepEqual(h.tabCalls, ['get']);
  assert.deepEqual(result.data.probe, warmupDiagnostics.normalizeProbe(result.data.probe));
  assert.equal(result.data.probe.stage, 'post');
  assert.equal(result.data.probe.like, true);
  assert.deepEqual(result.data.lines, warmupDiagnostics.probeLines(result.data.probe));
  assert.deepEqual(page.clicks, []);
  assert.equal(page.context.collectiveCommentBefore, undefined);
  for (const [request, error] of [
    [{ type: 'test-probe', tabId: 7 }, 'that tab is no longer on tiktok. choose it again.'],
    [{ type: 'test-probe', tabId: 9 }, 'use a regular chrome window for this check.'],
    [{ type: 'test-probe' }, 'choose a tiktok tab first.'],
    [{ type: 'test-probe', tabId: 404 }, 'choose a tiktok tab first.']
  ]) assert.deepEqual(await h.message(request), { ok: false, error }, JSON.stringify(request));
  const failing = worker('tiktok', undefined, { scriptError: 'Cannot access contents of the page.' });
  assert.deepEqual(await failing.message({ type: 'test-probe', tabId: 8 }), { ok: false, error: 'couldn’t read that page. let it finish loading, then check again.' });
  for (const phase of ['starting', 'running', 'stopping']) {
    const busy = worker('tiktok', { ...savedJob(), phase, stopRequested: phase === 'stopping', deadline: NOW + 300000 });
    assert.deepEqual(await busy.message({ type: 'test-probe', tabId: 8 }), { ok: false, error: 'stop the session before checking a page.' }, phase);
    assert.deepEqual(busy.scripts, [], phase);
  }
});

// Every word a report may contain. Anything else, such as page text, a link, a
// handle, a keyword or comment text, fails this test.
const VOCABULARY = new Set([
  'creator', 'collective', 'test', 'report', 'version', 'platform', 'phase', 'minutes', 'left', 'keywords', 'focus', 'targets', 'likes', 'follows', 'comments',
  'confirmed', 'not', 'searches', 'opens', 'next', 'scrolls', 'reading', 'pauses', 'skipped', 'paused', 'posted', 'unsure', 'runs', 'ended', 'blocks',
  'like', 'follow', 'comment', 'checks', 'in', 'place', 'to', 'fresh', 'page', 'reads', 'submit', 'problems', 'none', 'yes', 'no', 'unknown',
  'tiktok', 'instagram', 'ready', 'starting', 'running', 'stopping', 'stopped', 'complete', 'error', 'balanced',
  'check', 'language', 'block', 'stage', 'search', 'keyword', 'address', 'result', 'cards', 'counted', 'behind', 'viewer', 'dialogs', 'video', 'post',
  'links', 'found', 'kind', 'author', 'link', 'caption', 'playing', 'two', 'or', 'shorter', 'control', 'clickable', 'liked', 'following', 'close',
  'icon', 'box', 'has', 'text', 'button', 'reply', 'mode', 'own', 'profile', 'accounts', 'possible', 'blocker', 'photo', 'other',
  ...Object.values(warmupDiagnostics.codes).flat(),
  'several-viewers', 'viewer-error', 'not-a-post', 'no-media', 'no-post-id', 'photo-details', 'photo-changed', 'account', 'composer'
]);
const SECRETS = ['http', 'www.', '.com', '@', 'secret', 'cookie', 'sessionid', 'hunter2', 'caption words', 'my niche'];
function assertWhitelisted(text, extra = []) {
  const allowed = new Set([...VOCABULARY, ...extra]);
  for (const line of text.split('\n')) {
    for (const word of line.split(/[\s·:,]+/).filter(Boolean)) {
      assert.ok(allowed.has(word) || /^\d+$/.test(word) || /^\d+:\d\d$/.test(word) || /^\d+(?:\.\d+){1,3}$/.test(word), `"${word}" in "${line}"`);
    }
  }
  const lower = text.toLowerCase();
  for (const secret of SECRETS) assert.equal(lower.includes(secret), false, secret);
}
const leakyJob = () => savedJob({
  message: 'watching https://www.tiktok.com/@secret_handle/video/1/ cookie sessionid=hunter2',
  activity: [{ time: 1, message: 'liked @secret_handle: secret caption words' }],
  comments: [{ text: 'a secret comment', url: 'https://www.tiktok.com/@secret_handle/video/1/', author: '@secret_handle', time: 1, status: 'confirmed' },
    { text: 'another secret', url: 'https://www.tiktok.com/@secret/video/2/', author: '@secret', time: 2, status: 'uncertain' }],
  settings: { ...validateSettings({ platform: 'tiktok', minutes: 10, niche: 'my niche secret, https://www.tiktok.com/@secret', enableComments: true }), focus: 'https://evil' },
  diagnostics: { runs: 2, advances: 11, extra: 'https://www.tiktok.com/@secret', like: { pairs: { ok: { persisted: 3, reverted: 1, 'https://x': 2 }, 'not-liked': { reverted: 1 } }, reads: { ok: 3, 'not-liked': 2 } },
    follow: { pairs: { ok: { 'timed-out': 1 } } }, comment: { confirm: { 'own-row-missing': 1, 'secret caption words': 1 }, submit: { 'composer-empty': 2 } },
    ends: { stopped: 1, blocked: 1 }, blocks: { challenge: 1, '@secret': 1 } }
});
const leakyProbe = { ...warmupDiagnostics.normalizeProbe({ host: true, stage: 'post', kind: 'video', like: true, likeControls: 1, lang: 'de-DE' }),
  caption: 'secret caption words', lang: 'de-DE', url: 'https://www.tiktok.com/@secret', handle: '@secret', stage: 'post', kind: 'https://evil', commentBlocker: '@secret' };

test('the test report is fixed labels and numbers only, with no text, links, handles, keywords or cookies', async () => {
  const text = warmupDiagnostics.report({ version: '0.6.58.1', job: leakyJob(), probe: leakyProbe });
  assertWhitelisted(text, ['de-de']);
  const lines = text.split('\n');
  assert.equal(lines[0], 'creator collective test report');
  assert.equal(lines[1], 'version 0.6.58.1');
  assert.match(text, /platform tiktok · phase stopped · minutes 10 · left 8:00 · keywords 2 · focus balanced/);
  assert.match(text, /confirmed: likes 3 · follows 1 · comments 0/);
  assert.match(text, /searches 2 · opens 4 · next 11 · scrolls 5 · reading pauses 1 · skipped 2/);
  assert.match(text, /comments paused: no · comments posted 1 · comments unsure 1/);
  assert.match(text, /runs 2 · ended: stopped 1, blocked 1 · blocks: challenge 1/);
  assert.match(text, /like checks, in place to fresh page: ok to persisted 3, ok to reverted 1, not-liked to reverted 1/);
  assert.match(text, /follow checks, in place to fresh page: ok to timed-out 1/);
  assert.match(text, /comment checks: own-row-missing 1\ncomment submit problems: composer-empty 2/);
  assert.match(text, /page check\ntiktok page: yes · language de-de · block none · stage post/);
  assert.match(text, /kind none/);
  // The panel sends back the page check it was given; normalizing it again changes nothing.
  for (const probe of [leakyProbe, {}, { lang: '', blockReason: null }, { lang: 'zh_Hans', blockReason: 'challenge', stage: 'blocked' }, { lang: 'x-secret', blockReason: 'secret' }]) {
    const once = warmupDiagnostics.normalizeProbe(probe);
    assert.deepEqual(warmupDiagnostics.normalizeProbe(once), once, JSON.stringify(probe));
  }
  assert.equal(warmupDiagnostics.normalizeProbe({ lang: 'zh_Hans' }).lang, 'zh-hans');
  assert.equal(warmupDiagnostics.normalizeProbe({ blockReason: 'secret' }).blockReason, 'unknown');
  const once = warmupDiagnostics.normalize(leakyJob().diagnostics);
  assert.deepEqual(warmupDiagnostics.normalize(once), once);
  // Injected version text and a page-controlled language never pass either.
  const injected = warmupDiagnostics.report({ version: '1.0 https://evil', job: null, probe: { ...leakyProbe, lang: 'en-US-x-https://evil' } });
  assertWhitelisted(injected);
  assert.match(injected, /^creator collective test report\nversion unknown\nplatform none · phase ready/);
  assert.match(injected, /language other/);
  // The background builds the same report from the saved job for its own side panel.
  const h = worker('tiktok', leakyJob());
  const answer = await h.message({ type: 'test-report', probe: leakyProbe });
  assert.equal(answer.ok, true, answer.error);
  assert.equal(answer.data.text, warmupDiagnostics.report({ version: '0.6.58.1', job: leakyJob(), probe: leakyProbe }));
  assertWhitelisted(answer.data.text, ['de-de']);
  assert.equal(await h.message({ type: 'test-report' }, website), undefined);
  const empty = await worker('tiktok').message({ type: 'test-report' });
  assertWhitelisted(empty.data.text);
  assert.doesNotMatch(empty.data.text, /page check/);
});

// The real side panel and hosted page with the real dashboard scripts.
async function dashboard({ hosted = false, hello = {}, answers = {} } = {}) {
  const base = hosted ? root : extension;
  const html = fs.readFileSync(path.join(base, hosted ? 'index.html' : 'sidepanel.html'), 'utf8');
  const dom = new JSDOM(html, { url: hosted ? 'https://creator-collective-warmup.vercel.app/' : 'chrome-extension://extension-id/sidepanel.html', runScripts: 'outside-only' });
  const { window } = dom;
  const requests = [], copied = [];
  const storage = new Map();
  Object.defineProperty(window, 'localStorage', { value: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } });
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async text => { copied.push(text); } } });
  window.setInterval = () => 1;
  const state = { running: false, phase: 'ready', message: 'ready when you are.', activity: [] };
  const answer = message => {
    requests.push(message);
    if (message.type === 'hello') return { supportsFocus: true, ...hello, state };
    if (message.type === 'tabs') return message.platform === 'tiktok' ? [{ id: 8, title: 'TikTok' }] : [{ id: 7, title: 'Instagram' }];
    if (Object.hasOwn(answers, message.type)) return answers[message.type](message);
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
  return { dom, window, requests: () => plain(requests), copied, settle, $: id => window.document.getElementById(id) };
}

test('the test tools appear only in a side panel whose own build reports them', async t => {
  for (const [name, options, shown] of [
    ['tiktok test build side panel', { hello: { platforms: ['tiktok'], testTools: true } }, true],
    ['instagram build side panel', { hello: { platforms: ['instagram'] } }, false],
    ['side panel of an older build', {}, false],
    ['hosted page hearing a test build reply', { hosted: true, hello: { platforms: ['tiktok'], testTools: true } }, false]
  ]) await t.test(name, async () => {
    const h = await dashboard(options);
    try {
      for (const id of ['test-tools', 'check-page', 'copy-report', 'test-status', 'test-output']) assert.equal(Boolean(h.$(id)), shown, `${name}: ${id}`);
      assert.deepEqual(h.requests().map(request => request.type), ['hello', 'tabs'], 'nothing extra is sent on connect');
    } finally { h.dom.window.close(); }
  });
});

test('check this page sends only the chosen tab, and copy test report copies the background report', async () => {
  const probe = warmupDiagnostics.normalizeProbe({ host: true, stage: 'post', like: true });
  const h = await dashboard({ hello: { platforms: ['tiktok'], testTools: true }, answers: {
    'test-probe': () => ({ probe, lines: warmupDiagnostics.probeLines(probe) }),
    'test-report': message => ({ text: warmupDiagnostics.report({ version: '0.6.58.1', job: null, probe: message.probe }) })
  } });
  try {
    assert.equal(h.$('instagram-tab').value, '8');
    assert.equal(h.$('check-page').type, 'button');
    assert.equal(h.$('copy-report').type, 'button');
    h.$('check-page').click();
    await h.settle();
    assert.deepEqual(h.requests().at(-1), { type: 'test-probe', tabId: 8 });
    assert.equal(h.$('test-output').hidden, false);
    assert.equal(h.$('test-output').value, warmupDiagnostics.probeLines(probe).join('\n'));
    assert.equal(h.$('test-status').textContent, 'page checked. nothing was clicked or typed.');
    h.$('copy-report').click();
    await h.settle();
    assert.deepEqual(h.requests().at(-1), { type: 'test-report', probe });
    assert.deepEqual(h.copied, [warmupDiagnostics.report({ version: '0.6.58.1', job: null, probe })]);
    assert.equal(h.$('test-output').value, h.copied[0]);
    assert.equal(h.$('test-status').textContent, 'test report copied.');
    assert.ok(!h.requests().some(request => request.type === 'start'), 'the form was not submitted');
  } finally { h.dom.window.close(); }
});
