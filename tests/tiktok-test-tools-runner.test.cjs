const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const guards = require('../browser-extension/guards.js');
const { commentComposer } = require('./fixtures/tiktok-comment-composer.cjs');

// Test-build diagnostics in the runner: the in-place and fresh-page outcome of every
// like and follow, comment check and submit codes, the block code, how each run
// ended, and Next moves. They ride with every update and the final one, continue
// from the saved job, and are never recorded for a job without them.
const source = fs.readFileSync(path.join(__dirname, '../browser-extension/runner.js'), 'utf8');
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
const FIRST = 'https://www.tiktok.com/@creator/video/7300000000000000001/';
const SECOND = 'https://www.tiktok.com/@creator/video/7300000000000000002/';
const CHALLENGE = 'tiktok needs an account check. the session has stopped; complete the check yourself.';
const plain = value => JSON.parse(JSON.stringify(value));

function runner(operation, { diagnostics = {}, platform = 'tiktok', phase = 'starting' } = {}) {
  let now = 1800000000000;
  const calls = [], elements = new Map();
  const job = { token: 'test-token', tabId: 7, runnerTabId: 90, deadline: now + 600000, phase, settings: { minutes: 10, platform }, stats: {}, activity: [], message: 'starting',
    ...(diagnostics ? { diagnostics } : {}) };
  const chrome = {
    runtime: { sendMessage: async message => { calls.push(plain(message)); return { ok: true, data: message.type === 'runner-job' ? job : null }; } },
    tabs: { get: async () => ({ id: 7, url: FIRST, status: 'complete' }), update: async () => ({}), create: async () => { throw new Error('unexpected temporary tab'); }, remove: async () => {}, onUpdated: event() },
    storage: { onChanged: event() },
    scripting: { executeScript: async () => [{ result: { posts: [], post: null } }] }
  };
  const node = () => ({ textContent: '', disabled: false, dataset: {}, scrollTop: 0, addEventListener() {}, replaceChildren() {}, append() {}, click() {}, classList: { toggle() {} } });
  const ctx = vm.createContext({
    chrome, URL, console: { warn() {}, error() {}, log() {} }, AbortController, setInterval, clearInterval, clearTimeout,
    Date: { now: () => now },
    setTimeout: (fn, ms) => setTimeout(() => { if (ms < 3000) now += ms; fn(); }, ms >= 3000 ? 100 : 0),
    location: { hash: '#test-token' }, platforms: guards.platforms, validPlatform: guards.validPlatform, platformURL: guards.platformURL, instagramURL: guards.instagramURL,
    warmupDiagnostics: guards.warmupDiagnostics,
    document: { getElementById: id => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); }, createElement: node, body: { classList: { toggle() {} } }, addEventListener() {} },
    sessionEngine: { runSession: operation }, commentHistory: require('../comment-history.js'), sessionResults: require('../session-results.js')
  });
  const h = {
    ctx, chrome, job, calls, now: () => now,
    run: expression => vm.runInContext(expression, ctx),
    updates: () => calls.filter(call => call.type === 'runner-update').map(call => call.patch),
    terminal: () => calls.find(call => call.patch && ['complete', 'stopped', 'error'].includes(call.patch.phase))?.patch,
    stop: () => chrome.storage.onChanged.listeners[0]({ job: { newValue: { ...job, stopRequested: true, phase: 'stopping' } } }, 'session'),
    async finish() {
      vm.runInContext(source, ctx);
      for (let i = 0; i < 800 && !h.terminal(); i++) await new Promise(resolve => setTimeout(resolve, 2));
      assert.ok(h.terminal(), 'the runner must settle');
      return h.terminal();
    },
    page(answer) { chrome.scripting.executeScript = async request => answer(request); }
  };
  return h;
}

// One like or follow: the in-place reads, then the fresh page's tab and reads.
async function confirmation(action, { inPlace = () => ({ confirmed: false, reason: `not-${action === 'like' ? 'liked' : 'following'}` }),
  fresh = () => ({ confirmed: false, reason: action === 'like' ? 'not-liked' : 'not-following' }), freshTab = tab => tab, freshThrows = false, diagnostics = {} } = {}) {
  let result, clicks = 0;
  const created = [], removed = [];
  const tab = { id: 81, url: FIRST, status: 'complete' };
  const h = runner(async (settings, adapter) => {
    adapter.update({ message: 'watching' });
    result = await adapter.engage(action, { id: FIRST, author: '@creator' });
    adapter.update({ message: 'done' });
  }, { diagnostics });
  h.chrome.tabs.get = async tabId => tabId === 81 ? freshTab(tab) : { id: 7, url: FIRST, status: 'complete' };
  h.chrome.tabs.create = async options => { created.push(plain(options)); return tab; };
  h.chrome.tabs.remove = async id => { removed.push(id); };
  let inPlaceReads = 0;
  h.page(request => {
    if (request.files) return [{ result: null }];
    if (request.target.tabId === 81) { if (freshThrows) throw new Error('Frame with ID 0 was removed.'); return [{ result: fresh() }]; }
    if (request.args?.[1]?.action === `verify-${action}`) return [{ result: inPlace(++inPlaceReads) }];
    if (request.args?.[0] === action) { clicks++; return [{ result: true }]; }
    return [{ result: { post: null, posts: [] } }];
  });
  const terminal = await h.finish();
  return { result, terminal, clicks, created, removed, h, diagnostics: terminal.diagnostics };
}
const ok = () => ({ confirmed: true, reason: 'ok' });

test('each tiktok like and follow keeps its in-place result beside its fresh-page outcome', async () => {
  for (const action of ['like', 'follow']) {
    const not = action === 'like' ? 'not-liked' : 'not-following';
    for (const [name, options, result, pairs, reads] of [
      ['kept', { inPlace: ok, fresh: ok }, 'confirmed', { ok: { persisted: 1 } }, { ok: 1 }],
      ['shown, then undone on a fresh page', { inPlace: ok }, 'uncertain', { ok: { reverted: 1 } }, { [not]: 1 }],
      ['never shown and not saved', {}, 'uncertain', { [not]: { reverted: 1 } }, { [not]: 1 }],
      ['no control on either page', { inPlace: () => ({ confirmed: false, reason: 'no-control' }), fresh: () => ({ confirmed: false, reason: 'no-control' }) }, 'uncertain', { 'no-control': { unreadable: 1 } }, { 'no-control': 1 }],
      ['the post on neither page', { inPlace: () => ({ changed: true, confirmed: false, reason: 'no-post' }), fresh: () => ({ changed: true, confirmed: false, reason: 'no-post' }) }, 'uncertain', { 'no-post': { unreadable: 1 } }, { 'no-post': 1 }],
      ['a reader without codes', { inPlace: () => ({ confirmed: false }), fresh: () => ({ confirmed: false }) }, 'uncertain', { unread: { unreadable: 1 } }, { unread: 1 }],
      ['a fresh page that never loads', { inPlace: ok, freshTab: tab => ({ ...tab, status: 'loading' }) }, 'uncertain', { ok: { 'timed-out': 1 } }, {}],
      ['a fresh page that moves', { inPlace: ok, freshTab: tab => ({ ...tab, url: SECOND }) }, 'uncertain', { ok: { moved: 1 } }, {}],
      ['a fresh page whose frame keeps reloading', { inPlace: ok, freshThrows: true }, 'uncertain', { ok: { unreadable: 1 } }, {}]
    ]) {
      const f = await confirmation(action, options);
      assert.equal(f.result, result, `${action}: ${name}`);
      assert.equal(f.clicks, 1, `${action}: ${name} is never clicked again`);
      assert.deepEqual(f.created, [{ url: FIRST, active: false }], `${action}: ${name}`);
      assert.deepEqual(f.diagnostics[action], { pairs, reads }, `${action}: ${name}`);
      assert.deepEqual(f.diagnostics[action === 'like' ? 'follow' : 'like'], { pairs: {}, reads: {} }, `${action}: ${name}`);
      assert.deepEqual(f.diagnostics.ends, { deadline: 1 }, `${action}: ${name}`);
      assert.equal(f.terminal.phase, 'complete', `${action}: ${name}`);
    }
  }
});

test('a block on the fresh page stops the session and keeps only its code', async () => {
  const f = await confirmation('like', { inPlace: ok, fresh: () => ({ blocked: CHALLENGE, blockReason: 'challenge' }) });
  assert.equal(f.clicks, 1);
  assert.equal(f.terminal.phase, 'error');
  assert.match(f.terminal.message, /^tiktok needs an account check/);
  assert.deepEqual(f.diagnostics.like, { pairs: { ok: { blocked: 1 } }, reads: {} });
  assert.deepEqual({ ends: f.diagnostics.ends, blocks: f.diagnostics.blocks }, { ends: { blocked: 1 }, blocks: { challenge: 1 } });
  assert.equal(JSON.stringify(f.diagnostics).includes('account check'), false);
  assert.deepEqual(f.removed, [81]);
});

test('diagnostics ride with every update and the final one, and a job without them records none', async () => {
  const f = await confirmation('like', { inPlace: ok, fresh: ok });
  const updates = f.h.updates();
  assert.equal(updates.length, 3);
  for (const patch of updates) assert.equal(patch.diagnostics.version, 1);
  assert.deepEqual(updates[0].diagnostics.like, { pairs: {}, reads: {} }, 'before the like');
  assert.deepEqual(updates[1].diagnostics.like, { pairs: { ok: { persisted: 1 } }, reads: { ok: 1 } }, 'right after it');
  assert.deepEqual(f.terminal.diagnostics, { version: 1, like: { pairs: { ok: { persisted: 1 } }, reads: { ok: 1 } }, follow: { pairs: {}, reads: {} },
    comment: { confirm: {}, submit: {} }, advances: 0, runs: 1, ends: { deadline: 1 }, blocks: {} });
  for (const platform of ['tiktok', 'instagram']) {
    const h = runner(async (settings, adapter) => { adapter.update({ message: 'watching' }); }, { diagnostics: null, platform });
    await h.finish();
    for (const patch of h.updates()) assert.equal(Object.hasOwn(patch, 'diagnostics'), false, platform);
  }
  const without = await confirmation('like', { inPlace: ok, fresh: ok, diagnostics: null });
  assert.equal(without.result, 'confirmed');
  for (const patch of without.h.updates()) assert.equal(Object.hasOwn(patch, 'diagnostics'), false);
});

test('a resumed run continues the saved counts, and a refreshed tab records how it ended', async () => {
  const saved = { version: 1, runs: 1, advances: 4, like: { pairs: { ok: { persisted: 2 } } }, ends: { stopped: 1 }, comment: { confirm: { confirmed: 1 } } };
  const resumed = runner(async (settings, adapter) => { adapter.update({ message: 'resuming' }); }, { diagnostics: saved });
  const terminal = await resumed.finish();
  const first = resumed.updates()[0].diagnostics;
  assert.deepEqual({ runs: first.runs, advances: first.advances, like: first.like, comment: first.comment, ends: first.ends },
    { runs: 2, advances: 4, like: { pairs: { ok: { persisted: 2 } }, reads: {} }, comment: { confirm: { confirmed: 1 }, submit: {} }, ends: { stopped: 1 } });
  assert.deepEqual(terminal.diagnostics.ends, { stopped: 1, deadline: 1 });
  const refreshed = runner(async () => { throw new Error('the engine must not run'); }, { diagnostics: saved, phase: 'running' });
  const stopped = await refreshed.finish();
  assert.equal(stopped.phase, 'stopped');
  assert.deepEqual(stopped.diagnostics.ends, { stopped: 1, 'tab-refreshed': 1 });
  assert.equal(stopped.diagnostics.runs, 1);
});

test('each run records how it ended: deadline, stop, page change, block or error', async () => {
  const expected = [
    ['deadline', async () => {}],
    ['stopped', async (settings, adapter, signal, h) => { h.stop(); signal.throwIfAborted(); }],
    ['page-changed', async (settings, adapter, signal, h) => {
      h.run(`expectedDestination = '${FIRST}'`);
      h.chrome.tabs.onUpdated.listeners[0](7, { url: 'https://www.tiktok.com/@someone/video/7300000000000000099/' });
      signal.throwIfAborted();
    }],
    ['blocked', async (settings, adapter) => { const page = await adapter.inspect(); if (page.blocked) throw new Error(page.blocked); }],
    ['error', async () => { throw new Error('something else went wrong.'); }],
    // A block that cleared before a later, different stop is not the reason it ended.
    ['error', async (settings, adapter) => { await adapter.inspect(); throw new Error('something else went wrong.'); }]
  ];
  for (const [end, operation] of expected) {
    let h;
    h = runner((settings, adapter, signal) => operation(settings, adapter, signal, h));
    h.page(request => [{ result: request.files ? null : { blocked: CHALLENGE, blockReason: 'challenge' } }]);
    const terminal = await h.finish();
    assert.deepEqual(terminal.diagnostics.ends, { [end]: 1 }, end);
    assert.deepEqual(terminal.diagnostics.blocks, end === 'blocked' ? { challenge: 1 } : {}, end);
  }
});

test('a block found inside any tiktok page script keeps its code and still clicks nothing', async () => {
  const SEARCH = 'https://www.tiktok.com/search?q=branding';
  // Each step's page script, and what the runner does to reach it. The limit
  // appears between the runner's own read and that script.
  for (const [step, isStep, operation, message] of [
    ['like', request => request.args?.[0] === 'like', (adapter, c) => adapter.engage('like', { ...c.request, viewer: true }), /^tiktok limited activity\. .* an action may have gone through/],
    ['follow', request => request.args?.[0] === 'follow', (adapter, c) => adapter.engage('follow', { ...c.request, viewer: true }), /^tiktok limited activity\. .* an action may have gone through/],
    ['next', request => String(request.func).includes("action: 'click-next'"), (adapter, c, signal) => adapter.advance({ id: c.request.id, viewer: true, next: true }, signal, () => false), /^tiktok limited activity\./],
    ['close', request => String(request.func).includes("action: 'click-close'"), async (adapter, c, signal) => { await adapter.search('branding'); return adapter.leavePost({ id: c.request.id, viewer: true, close: true }, signal); }, /^tiktok limited activity\./],
    ['scroll', request => String(request.func).includes('resultLink'), adapter => adapter.scroll(), /^tiktok limited activity\./],
    ['comment open', request => String(request.func).includes("action: 'click-comment-open'"), (adapter, c) => adapter.engage('comment', { ...c.request, viewer: true }, c.request.comment), /^tiktok limited activity\./],
    ['comment typing', request => request.args?.[0] === 'comment', (adapter, c) => adapter.engage('comment', { ...c.request, viewer: true }, c.request.comment), /^a comment draft may remain in tiktok/],
    ['comment submit', request => String(request.func).includes("action: 'click-comment-submit'"), (adapter, c) => adapter.engage('comment', { ...c.request, viewer: true }, c.request.comment), /an action may have gone through/]
  ]) {
    const composer = commentComposer();
    // A second result link, so Next has somewhere to go.
    composer.main.append(composer.element('a', { href: 'https://www.tiktok.com/@creator/video/456/' }, '', composer.rect(0, 700, 50, 20)));
    let current = composer.request.id, reached = false, scriptsAfter = 0;
    const h = runner((settings, adapter, signal) => operation(adapter, composer, signal));
    h.chrome.tabs.get = async () => ({ id: 7, url: current, status: 'complete' });
    h.chrome.tabs.update = async (id, options) => { current = options.url; };
    h.page(request => {
      if (reached) scriptsAfter++;
      if (request.files) { composer.load(); return [{ result: null }]; }
      if (isStep(request)) { reached = true; composer.state.blocked = true; }
      return [{ result: composer.inject(request.func, request.args) }];
    });
    const terminal = await h.finish();
    assert.equal(reached, true, `${step}: the page script ran`);
    assert.equal(scriptsAfter, 0, `${step}: the session stops at once, with no further page reads`);
    assert.deepEqual(composer.clicks, [], step);
    assert.equal(composer.submitted, 0, step);
    assert.equal(terminal.phase, 'error', step);
    assert.match(terminal.message, message, step);
    assert.deepEqual({ ends: terminal.diagnostics.ends, blocks: terminal.diagnostics.blocks }, { ends: { blocked: 1 }, blocks: { 'rate-limit': 1 } }, step);
    assert.equal(current, step === 'close' ? SEARCH : composer.request.id, step);
  }
});

// The real tiktok.js composer behind the runner.
async function tiktokComment(configure = () => {}) {
  const composer = commentComposer();
  let result;
  const h = runner(async (settings, adapter) => { result = await adapter.engage('comment', { ...composer.request, viewer: true }, composer.request.comment); });
  h.chrome.tabs.get = async () => ({ id: 7, url: composer.request.id, status: 'complete' });
  h.page(request => {
    if (request.files) { composer.load(); return [{ result: null }]; }
    return [{ result: composer.inject(request.func, request.args) }];
  });
  configure(composer);
  const terminal = await h.finish();
  return { result, terminal, comment: terminal.diagnostics.comment };
}

test('comment checks and failed submits are counted by their fixed codes, never by text', async () => {
  const posted = await tiktokComment();
  assert.equal(posted.result, 'confirmed');
  assert.deepEqual(posted.comment, { confirm: { confirmed: 1 }, submit: {} });
  const unconfirmed = await tiktokComment(composer => { composer.state.confirm = false; });
  assert.equal(unconfirmed.result, 'uncertain');
  assert.deepEqual(unconfirmed.comment, { confirm: { 'composer-not-empty': 1 }, submit: {} });
  const ignored = await tiktokComment(composer => { composer.state.ignorePaste = true; });
  assert.equal(ignored.result, 'not-typed');
  assert.deepEqual(ignored.comment, { confirm: {}, submit: { 'composer-empty': 1 } });
  for (const f of [posted, unconfirmed, ignored]) assert.equal(JSON.stringify(f.terminal.diagnostics).includes('personal branding'), false);
});

test('a Next that lands on a post is counted as a move', async () => {
  let current = FIRST;
  const moves = [];
  const h = runner(async (settings, adapter, signal) => {
    h.run(`expectedDestination = '${FIRST}'`);
    moves.push(await adapter.advance({ id: FIRST, viewer: true, next: true }, signal, () => false));
    moves.push(await adapter.advance({ id: SECOND, viewer: true, next: false }, signal, () => false));
  });
  h.chrome.tabs.get = async () => ({ id: 7, url: current, status: 'complete' });
  h.page(request => {
    if (request.files) return [{ result: null }];
    if (typeof request.args?.[1] === 'number' && String(request.func).includes('click-next')) {
      current = SECOND;
      h.chrome.tabs.onUpdated.listeners[0](7, { url: SECOND });
      return [{ result: true }];
    }
    return [{ result: { posts: [FIRST, SECOND], sequence: [FIRST, SECOND], post: { id: current, viewer: true, next: true } } }];
  });
  const terminal = await h.finish();
  assert.deepEqual(moves, [true, false]);
  assert.equal(terminal.diagnostics.advances, 1);
});
