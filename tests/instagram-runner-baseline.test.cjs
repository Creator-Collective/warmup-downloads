const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const guards = require('../browser-extension/guards.js');
const commentComposer = require('./fixtures/comment-composer.cjs');

// Instagram pins for the runner.js paths the TikTok parity work will widen: the Next and
// Close transition allowance (navigateViewer), the remembered search (currentSearchURL),
// the read-only draft check (draftStateWithRetry), unsent-draft recovery
// (recoverCommentDraft) and like/follow confirmation (verifyEngagementOnFreshPost).
// Recorded at d5865be. Exact counts, gaps and messages here are today's Instagram
// behaviour and must not move when those paths gain TikTok branches.
const source = fs.readFileSync(path.join(__dirname, '../browser-extension/runner.js'), 'utf8');
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
const SEARCH = 'https://www.instagram.com/explore/search/keyword/?q=drop%20shipping';
const FIRST = 'https://www.instagram.com/p/first/';
const SECOND = 'https://www.instagram.com/p/second/';

// A runner tab on a virtual clock: the clock only moves when the runner sleeps.
function runner(operation, { platform = 'instagram' } = {}) {
  let now = 1800000000000;
  const calls = [], sleeps = [], log = [], elements = new Map();
  const job = { token: 'test-token', tabId: 7, runnerTabId: 90, deadline: now + 600000, phase: 'starting', settings: { minutes: 10, ...(platform ? { platform } : {}) }, stats: {}, activity: [], message: 'starting' };
  const chrome = {
    runtime: { sendMessage: async message => { calls.push(message); return { ok: true, data: message.type === 'runner-job' ? job : null }; } },
    tabs: { get: async () => ({ url: 'https://www.instagram.com/', status: 'complete' }), update: async () => ({}), create: async () => { throw new Error('unexpected temporary tab'); }, remove: async () => {}, onUpdated: event() },
    storage: { onChanged: event() },
    scripting: { executeScript: async () => [{ result: { posts: [], post: null } }] }
  };
  const node = () => ({ textContent: '', disabled: false, dataset: {}, scrollTop: 0, addEventListener() {}, replaceChildren() {}, append() {}, click() {}, classList: { toggle() {} } });
  const ctx = vm.createContext({
    chrome, URL, console, AbortController, setInterval, clearInterval, clearTimeout,
    Date: { now: () => now },
    setTimeout: (fn, ms) => setTimeout(() => { if (ms < 3000) { sleeps.push(ms); now += ms; } fn(); }, ms >= 3000 ? 100 : 0),
    location: { hash: '#test-token' }, platforms: guards.platforms, validPlatform: guards.validPlatform, platformURL: guards.platformURL, instagramURL: guards.instagramURL,
    document: { getElementById: id => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); }, createElement: node, body: { classList: { toggle() {} } }, addEventListener() {} },
    sessionEngine: { runSession: operation }, commentHistory: require('../comment-history.js'), sessionResults: require('../session-results.js')
  });
  // Every page read (an inspector call with its request), with the virtual time it ran.
  const reads = () => log.filter(item => item.read).map(item => ({ action: item.read, at: item.at }));
  const h = {
    ctx, chrome, job, calls, sleeps, log, reads, elements, now: () => now,
    run: expression => vm.runInContext(expression, ctx),
    terminal: () => calls.find(call => call.patch && ['complete', 'stopped', 'error'].includes(call.patch.phase))?.patch,
    async finish() {
      vm.runInContext(source, ctx);
      for (let i = 0; i < 500 && !h.terminal(); i++) await new Promise(resolve => setTimeout(resolve, 2));
      assert.ok(h.terminal(), 'the runner must settle');
      return h.terminal();
    },
    // Wraps executeScript so every injection is logged before the page answers it.
    page(answer) {
      chrome.scripting.executeScript = async request => {
        const read = request.args?.[0] === 'inspectInstagram' ? request.args[1]?.action || 'page' : null;
        log.push({ at: now, files: Boolean(request.files), read, tabId: request.target.tabId, func: request.func ? String(request.func) : null, args: request.args });
        return answer(request);
      };
    }
  };
  return h;
}
const gaps = times => times.slice(1).map((time, index) => time - times[index]);

test('instagram Next and Close allow exactly their source, target and current search for sixteen seconds', async () => {
  let current = SEARCH; const during = []; const results = [];
  const h = runner(async (settings, adapter, signal) => {
    results.push(await adapter.search('drop shipping'));
    results.push(await adapter.open(FIRST));
    results.push(await adapter.advance({ id: FIRST, viewer: true, next: true }, signal));
    results.push(h.run('expectedDestination'), h.run('viewerNavigation'));
    results.push(await adapter.leavePost({ id: SECOND, viewer: true }, signal));
    results.push(h.run('expectedDestination'), h.run('viewerNavigation'), signal.aborted);
  });
  h.chrome.tabs.get = async () => ({ url: current, status: 'complete' });
  h.chrome.tabs.update = async (id, options) => { current = options.url; };
  h.page(request => {
    if (request.files) return [{ result: null }];
    if (typeof request.args?.[1] === 'number') {
      during.push(JSON.parse(h.run('JSON.stringify({ destinations: viewerNavigation.destinations, remainingMs: viewerNavigation.deadline - Date.now(), expected: expectedDestination })')));
      const close = /action: 'close'/.test(request.func.toString());
      current = close ? SEARCH : current === SEARCH ? FIRST : SECOND;
      h.chrome.tabs.onUpdated.listeners[0](7, { url: current });
      return [{ result: true }];
    }
    return [{ result: { posts: [FIRST, SECOND], sequence: [FIRST, SECOND], post: /\/p\//.test(current) ? { id: current, viewer: true, next: true } : null } }];
  });
  const terminal = await h.finish();
  assert.equal(terminal.phase, 'complete');
  assert.deepEqual(results, [true, true, true, SECOND, null, true, SEARCH, null, false]);
  assert.deepEqual(during, [
    { destinations: [SEARCH, FIRST, SEARCH], remainingMs: 16000, expected: FIRST },
    { destinations: [FIRST, SECOND, SEARCH], remainingMs: 16000, expected: SECOND },
    { destinations: [SECOND, SEARCH, SEARCH], remainingMs: 16000, expected: SEARCH }
  ]);
});

test('an instagram transition allowance never outlives the session deadline', async () => {
  let current = FIRST; let remainingMs;
  const h = runner(async (settings, adapter, signal) => {
    h.job.deadline = h.now() + 5000;
    h.run(`expectedDestination = '${FIRST}'; viewerSequence = ['${FIRST}', '${SECOND}']`);
    await adapter.advance({ id: FIRST, viewer: true, next: true }, signal);
  });
  h.chrome.tabs.get = async () => ({ url: current, status: 'complete' });
  h.page(request => {
    if (request.files) return [{ result: null }];
    if (typeof request.args?.[1] === 'number') { remainingMs = h.run('viewerNavigation.deadline - Date.now()'); current = SECOND; return [{ result: true }]; }
    return [{ result: { sequence: [FIRST, SECOND], post: { id: current, viewer: true, next: true } } }];
  });
  await h.finish();
  assert.equal(remainingMs, 5000);
});

test('instagram Next refuses to click when the page already left the expected post', async () => {
  const h = runner(async (settings, adapter, signal) => {
    h.run(`expectedDestination = '${FIRST}'; viewerSequence = ['${FIRST}', '${SECOND}']`);
    await adapter.advance({ id: FIRST, viewer: true, next: true }, signal);
  });
  h.chrome.tabs.get = async () => ({ url: 'https://www.instagram.com/p/other/', status: 'complete' });
  h.page(request => request.files ? [{ result: null }] : [{ result: { sequence: [FIRST, SECOND], post: { id: FIRST, viewer: true, next: true } } }]);
  const terminal = await h.finish();
  assert.deepEqual({ phase: terminal.phase, message: terminal.message }, { phase: 'error', message: 'session stopped because the instagram page changed.' });
  assert.equal(h.log.filter(item => typeof item.args?.[1] === 'number').length, 0, 'no click was sent');
});

test('instagram searches load the encoded keyword grid first and only keyword grids become the current search', async () => {
  for (const platform of ['instagram', null]) {
    const seen = []; const order = []; let current = 'https://www.instagram.com/';
    const h = runner(async (settings, adapter) => {
      seen.push(h.run('currentSearchURL'));
      seen.push(await adapter.search('café & co'), h.run('currentSearchURL'));
      seen.push(await h.run("navigate('https://www.instagram.com/')"), h.run('currentSearchURL'));
      seen.push(await adapter.search('second'), h.run('currentSearchURL'));
    }, { platform });
    h.chrome.tabs.get = async () => ({ url: current, status: 'complete' });
    h.chrome.tabs.update = async (id, options) => { order.push(['update', options.url]); current = options.url; };
    h.page(request => { if (!request.files) order.push(['read', current]); return [{ result: request.files ? null : { posts: [FIRST], post: null } }]; });
    assert.equal((await h.finish()).phase, 'complete');
    const cafe = 'https://www.instagram.com/explore/search/keyword/?q=caf%C3%A9%20%26%20co';
    const second = 'https://www.instagram.com/explore/search/keyword/?q=second';
    assert.deepEqual(seen, [undefined, true, cafe, true, cafe, true, second], String(platform));
    // Instagram navigates straight away; it never inspects the old page before loading a search.
    assert.deepEqual(order, [['update', cafe], ['read', cafe], ['update', 'https://www.instagram.com/'], ['read', 'https://www.instagram.com/'], ['update', second], ['read', second]]);
  }
});

test('the instagram draft check reads up to three times, half a second apart, and never reads for blank text', async () => {
  const cases = [
    { comment: '', answers: [], state: 'unknown', reads: 0 },
    { comment: '   ', answers: [], state: 'unknown', reads: 0 },
    { comment: 'nice one', answers: [{ known: true, holding: true }], state: 'present', reads: 1 },
    { comment: 'nice one', answers: [{ known: true, holding: false }], state: 'absent', reads: 1 },
    { comment: 'nice one', answers: [{ known: false }, { known: false }, { known: true, holding: false }], state: 'absent', reads: 3 },
    { comment: 'nice one', answers: [{ known: false }, { known: false }, { known: false }, { known: true, holding: true }], state: 'unknown', reads: 3 },
    // An unreadable page is retried inside each read (three tries), for nine reads in all.
    { comment: 'nice one', answers: Array(12).fill(null), state: 'unknown', reads: 9 }
  ];
  for (const item of cases) {
    let state;
    const h = runner(async (settings, adapter) => { state = await adapter.draftState(item.comment); });
    const answers = [...item.answers];
    h.page(request => [{ result: request.files ? null : answers.shift() }]);
    assert.equal((await h.finish()).phase, 'complete');
    assert.equal(state, item.state, JSON.stringify(item));
    const reads = h.reads();
    assert.equal(reads.length, item.reads, JSON.stringify(item));
    for (const read of h.log.filter(entry => entry.read)) assert.deepEqual(JSON.parse(JSON.stringify(read.args[1])), { action: 'draft-state', comment: item.comment });
    if (item.reads === 3) assert.deepEqual(gaps(reads.map(read => read.at)), [500, 500]);
  }
});

test('a restriction seen by the instagram draft check stops the session with its own message', async () => {
  let rejected;
  const h = runner(async (settings, adapter) => { await adapter.draftState('nice one').catch(error => { rejected = error.message; throw error; }); });
  h.page(request => [{ result: request.files ? null : { blocked: 'instagram needs your attention. the session has stopped.' } }]);
  const terminal = await h.finish();
  assert.equal(rejected, 'instagram needs your attention. the session has stopped.');
  assert.deepEqual({ phase: terminal.phase, message: terminal.message }, { phase: 'stopped', message: 'instagram needs your attention. the session has stopped.' });
  assert.equal(h.reads().length, 1);
});

// The real instagram.js composer. Post never becomes available, so the runner recovers.
async function unsentDraft(configure = () => {}) {
  const composer = commentComposer();
  composer.submit.disabled = true;
  let result;
  const h = runner(async (settings, adapter) => { result = await adapter.engage('comment', { ...composer.request, viewer: true }, composer.request.comment); });
  h.page(request => {
    if (request.files) { composer.load(); return [{ result: null }]; }
    return [{ result: composer.inject(request.func, request.args) }];
  });
  configure(composer, h);
  const terminal = await h.finish();
  const clearAt = h.log.find(entry => entry.func?.includes("action: 'comment-clear'")).at;
  const polls = h.reads().filter(read => read.action === 'comment-cleared').map(read => read.at - clearAt);
  const checks = h.reads().filter(read => read.action === 'draft-state').map(read => read.at);
  return { composer, h, result, terminal, polls, checks };
}

test('an untouched instagram draft is cleared and confirmed clear on the first poll', async () => {
  const f = await unsentDraft();
  assert.equal(f.result, 'skipped');
  assert.equal(f.terminal.phase, 'complete');
  assert.deepEqual(f.polls, [250]);
  assert.deepEqual(f.checks, []);
  assert.equal(f.composer.field.value, '');
  assert.equal(f.h.log.filter(entry => entry.func?.includes("action: 'comment-clear'")).length, 1);
});

test('an edited instagram draft gets five clear polls, then one read-only check, and is kept', async () => {
  const f = await unsentDraft(composer => { composer.state.onInput = field => { field.value = 'my own edited comment'; }; });
  assert.equal(f.result, 'draft-retained');
  assert.deepEqual(f.polls, [250, 650, 1050, 1450, 1850]);
  assert.equal(f.checks.length, 1);
  assert.equal(f.composer.field.value, 'my own edited comment');
  assert.equal(f.composer.submitted, 0);
});

test('after five failed clear polls the instagram draft check decides between skip and kept draft', async () => {
  for (const [answers, expected, checks] of [
    [[{ known: true, holding: false }], 'skipped', 1],
    [[{ known: false }, { known: false }, { known: false }], 'draft-retained', 3]
  ]) {
    const f = await unsentDraft((composer, h) => {
      const inject = composer.inject;
      composer.inject = (func, args) => {
        if (args?.[1]?.action === 'comment-cleared') return { cleared: false };
        if (args?.[1]?.action === 'draft-state') return answers.shift();
        return inject(func, args);
      };
    });
    assert.equal(f.result, expected);
    assert.equal(f.polls.length, 5);
    assert.equal(f.checks.length, checks);
    if (checks === 3) assert.deepEqual(gaps(f.checks), [500, 500]);
    assert.equal(f.composer.submitted, 0);
  }
});

// A like or follow on a stubbed instagram viewer. inPlace and fresh say when each read confirms.
async function engagement(action, { inPlace = () => false, fresh = () => false, tab = {} } = {}) {
  const id = FIRST; const created = []; const removed = [];
  let result; let inPlaceReads = 0;
  const confirmationTab = { id: 81, url: id, status: 'complete', ...tab };
  const h = runner(async (settings, adapter) => { result = await adapter.engage(action, { id, author: '/creator/' }); });
  h.chrome.tabs.get = async tabId => tabId === 81 ? confirmationTab : { id: 7, url: id, status: 'complete' };
  h.chrome.tabs.create = async options => { created.push(JSON.parse(JSON.stringify(options))); return confirmationTab; };
  h.chrome.tabs.remove = async tabId => { removed.push(tabId); };
  h.page(request => {
    if (request.files) return [{ result: null }];
    if (request.target.tabId === 81) return [{ result: { confirmed: fresh() } }];
    if (request.args?.[0] === action) return [{ result: true }];
    if (request.args?.[1]?.action === `verify-${action}`) return [{ result: { confirmed: inPlace(++inPlaceReads) } }];
    return [{ result: { post: null, posts: [] } }];
  });
  const terminal = await h.finish();
  const verifies = h.reads().filter(read => read.action === `verify-${action}`);
  const freshReads = h.log.filter(entry => entry.tabId === 81 && entry.func);
  return { result, terminal, created, removed, verifies, freshReads, h };
}

test('instagram likes confirm only in place: six reads, 750 ms apart, and never a temporary tab', async () => {
  const unconfirmed = await engagement('like');
  assert.equal(unconfirmed.result, 'uncertain');
  assert.equal(unconfirmed.verifies.length, 6);
  assert.deepEqual(gaps(unconfirmed.verifies.map(read => read.at)), [750, 750, 750, 750, 750]);
  assert.deepEqual(unconfirmed.created, []);
  const confirmed = await engagement('like', { inPlace: count => count === 2 });
  assert.equal(confirmed.result, 'confirmed');
  assert.equal(confirmed.verifies.length, 2);
  assert.deepEqual(confirmed.created, []);
});

test('an instagram follow confirmed in place never opens a temporary tab', async () => {
  const f = await engagement('follow', { inPlace: () => true });
  assert.equal(f.result, 'confirmed');
  assert.equal(f.verifies.length, 1);
  assert.deepEqual(f.created, []);
});

test('an instagram follow opens one inactive temporary tab only after ten failed in-place reads', async () => {
  for (const [freshConfirms, expected] of [[true, 'confirmed'], [false, 'uncertain']]) {
    const f = await engagement('follow', { fresh: () => freshConfirms });
    assert.equal(f.result, expected);
    assert.equal(f.verifies.length, 10);
    assert.deepEqual(gaps(f.verifies.map(read => read.at)), Array(9).fill(750));
    assert.deepEqual(f.created, [{ url: FIRST, active: false }]);
    assert.ok(f.freshReads.length >= 1);
    assert.ok(f.freshReads.every(entry => entry.args[0] === 'inspectInstagram' && entry.args[2] === 'follow'));
    assert.deepEqual(f.removed, [81]);
  }
});

test('the instagram fresh follow check trusts only the exact post address', async () => {
  const f = await engagement('follow', { fresh: () => true, tab: { url: FIRST.replace(/\/$/, '') } });
  assert.equal(f.result, 'uncertain');
  assert.equal(f.freshReads.length, 0);
  assert.deepEqual(f.removed, [], 'a tab showing another address is left alone');
});

test('instagram runner labels and the refreshed-tab stop keep their wording', async () => {
  let labels;
  const h = runner(async () => { labels = [h.elements.get('message').textContent, h.elements.get('show-instagram').textContent]; });
  assert.equal((await h.finish()).phase, 'complete');
  assert.deepEqual(labels, ['connecting to instagram…', 'show instagram']);
  const refreshed = runner(async () => { throw new Error('the engine must not run again'); });
  refreshed.job.phase = 'running';
  const terminal = await refreshed.finish();
  assert.deepEqual({ phase: terminal.phase, message: terminal.message }, { phase: 'stopped', message: 'session stopped after its tab refreshed. check instagram before restarting.' });
  assert.ok(refreshed.calls.some(call => call.type === 'runner-stop'));
});
