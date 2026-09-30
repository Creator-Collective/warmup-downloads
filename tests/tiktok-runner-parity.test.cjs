const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const guards = require('../browser-extension/guards.js');
const { commentComposer, fixture } = require('./fixtures/tiktok-comment-composer.cjs');

// TikTok runner parity: the Next/Close transition allowance (with Next accepting
// whichever post TikTok lands on), the remembered search, the read-only draft check,
// draft recovery without clear polls, ignored pastes, and like/follow confirmation
// cost. The clock is virtual and only moves when the runner sleeps.
const source = fs.readFileSync(path.join(__dirname, '../browser-extension/runner.js'), 'utf8');
const sessionSource = fs.readFileSync(path.join(__dirname, '../browser-extension/session.js'), 'utf8');
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
const SEARCH = 'https://www.tiktok.com/search?q=personal%20brand';
const FIRST = 'https://www.tiktok.com/@creator/video/7300000000000000001/';
const SECOND = 'https://www.tiktok.com/@creator/video/7300000000000000002/';
const OTHER = 'https://www.tiktok.com/@someone/video/7300000000000000099/';
const canonical = url => { const u = new URL(url); return `https://www.tiktok.com${u.pathname.replace(/\/?$/, '/')}`; };
const isPost = url => /^\/@[\w.-]+\/(?:video|photo)\/\d+\/?$/.test(new URL(url).pathname);

function runner(operation) {
  let now = 1800000000000;
  const calls = [], log = [], elements = new Map();
  const job = { token: 'test-token', tabId: 7, runnerTabId: 90, deadline: now + 600000, phase: 'starting', settings: { minutes: 10, platform: 'tiktok' }, stats: {}, activity: [], message: 'starting' };
  const chrome = {
    runtime: { sendMessage: async message => { calls.push(message); return { ok: true, data: message.type === 'runner-job' ? job : null }; } },
    tabs: { get: async () => ({ url: SEARCH, status: 'complete' }), update: async () => ({}), create: async () => { throw new Error('unexpected temporary tab'); }, remove: async () => {}, onUpdated: event() },
    storage: { onChanged: event() },
    scripting: { executeScript: async () => [{ result: { posts: [], post: null } }] }
  };
  const node = () => ({ textContent: '', disabled: false, dataset: {}, scrollTop: 0, addEventListener() {}, replaceChildren() {}, append() {}, click() {}, classList: { toggle() {} } });
  const ctx = vm.createContext({
    chrome, URL, console, AbortController, setInterval, clearInterval, clearTimeout,
    Date: { now: () => now },
    setTimeout: (fn, ms) => setTimeout(() => { if (ms < 3000) now += ms; fn(); }, ms >= 3000 ? 100 : 0),
    location: { hash: '#test-token' }, platforms: guards.platforms, validPlatform: guards.validPlatform, platformURL: guards.platformURL, instagramURL: guards.instagramURL,
    document: { getElementById: id => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); }, createElement: node, body: { classList: { toggle() {} } }, addEventListener() {} },
    sessionEngine: { runSession: operation }, commentHistory: require('../comment-history.js'), sessionResults: require('../session-results.js')
  });
  const h = {
    ctx, chrome, job, calls, log, elements, now: () => now, advance: ms => { now += ms; },
    run: expression => vm.runInContext(expression, ctx),
    reads: () => log.filter(item => item.read).map(item => ({ action: item.read, at: item.at, tabId: item.tabId })),
    terminal: () => calls.find(call => call.patch && ['complete', 'stopped', 'error'].includes(call.patch.phase))?.patch,
    async finish() {
      vm.runInContext(source, ctx);
      for (let i = 0; i < 800 && !h.terminal(); i++) await new Promise(resolve => setTimeout(resolve, 2));
      assert.ok(h.terminal(), 'the runner must settle');
      return h.terminal();
    },
    page(answer) {
      chrome.scripting.executeScript = async request => {
        const read = request.args?.[0] === 'inspectTikTok' ? request.args[1]?.action || 'page' : null;
        log.push({ at: now, files: Boolean(request.files), read, tabId: request.target.tabId, func: request.func ? String(request.func) : null, args: request.args });
        return answer(request);
      };
    }
  };
  return h;
}
const kindOf = request => typeof request.args?.[1] !== 'number' ? null : /click-close/.test(request.func) ? 'close' : /click-next/.test(request.func) ? 'next' : 'open';

// A TikTok search tab with a viewer. onNext decides where TikTok's Next lands.
function navigation(onNext) {
  let current = SEARCH;
  const clicks = [];
  const h = runner(async (settings, adapter, signal) => {
    h.results = [];
    h.results.push(await adapter.search('personal brand'));
    h.results.push(await adapter.open(FIRST));
    h.moved = await adapter.advance({ id: FIRST, viewer: true, next: true }, signal);
    if (!h.moved && !signal.aborted) h.left = await adapter.leavePost({ id: FIRST, viewer: true, close: true }, signal);
    h.idle = h.run('expectedDestination');
    h.active = h.run('viewerNavigation');
    h.landed = (await adapter.inspect()).post?.id ?? null;
    if (h.after) h.after(signal);
  });
  const change = url => { current = url; h.chrome.tabs.onUpdated.listeners[0](7, { url }); };
  h.chrome.tabs.get = async () => ({ id: 7, url: current, status: 'complete' });
  h.chrome.tabs.update = async (id, options) => { change(options.url); };
  h.page(request => {
    if (request.files) return [{ result: null }];
    const kind = kindOf(request);
    if (kind) {
      clicks.push(kind);
      if (kind === 'close') { change(SEARCH + '&lang=en'); return [{ result: true }]; }
      if (kind === 'open') { change(FIRST.replace(/\/$/, '') + '?q=personal%20brand'); return [{ result: true }]; }
      return [{ result: onNext({ change, h }) }];
    }
    const post = isPost(current) ? { id: canonical(current), viewer: true, next: true, close: true } : null;
    return [{ result: { posts: [FIRST, SECOND], sequence: [FIRST, SECOND], post } }];
  });
  return { h, change, clicks, current: () => current };
}

test('a tiktok Next that lands on a different valid post continues from that post', async () => {
  const f = navigation(({ change }) => { change(FIRST); change(OTHER.replace(/\/$/, '') + '?lang=en&is_from_webapp=1'); return true; });
  const terminal = await f.h.finish();
  assert.equal(terminal.phase, 'complete');
  assert.deepEqual(f.h.results, [true, true]);
  assert.equal(f.h.moved, true);
  assert.equal(f.h.landed, OTHER, 'the landed post is the current post');
  assert.equal(f.h.idle, OTHER.replace(/\/$/, '') + '?lang=en&is_from_webapp=1');
  assert.equal(f.h.active, null);
  assert.deepEqual(f.clicks, ['open', 'next']);
});

test('tiktok Next permits its own source and the same-search intermediate before the predicted target', async () => {
  const f = navigation(({ change }) => { change(FIRST); change(SEARCH.replace('%20', '+') + '&lang=en'); change(SECOND); return true; });
  const terminal = await f.h.finish();
  assert.equal(terminal.phase, 'complete');
  assert.equal(f.h.moved, true);
  assert.equal(f.h.idle, SECOND);
  assert.equal(f.h.landed, SECOND);
  assert.deepEqual(f.clicks, ['open', 'next']);
});

test('tiktok Next can settle back on its search without another stale Close click', async () => {
  const f = navigation(({ change }) => { change(SEARCH + '&lang=en'); return true; });
  const terminal = await f.h.finish();
  assert.equal(terminal.phase, 'complete');
  assert.equal(f.h.moved, false);
  assert.equal(f.h.left, true);
  assert.equal(f.h.landed, null);
  assert.deepEqual(f.clicks, ['open', 'next'], 'no Close after settling on the search');
});

test('tiktok transitions still stop on other searches, profiles, sign-in and other sites', async () => {
  for (const destination of [
    'https://www.tiktok.com/search?q=other', 'https://www.tiktok.com/@someone', 'https://www.tiktok.com/login',
    'https://www.tiktok.com/foryou', 'https://example.com/@someone/video/7300000000000000099/', 'http://www.tiktok.com/@someone/video/7300000000000000099/'
  ]) {
    const f = navigation(({ change }) => { change(destination); return true; });
    const terminal = await f.h.finish();
    assert.equal(terminal.phase, 'stopped', destination);
    assert.match(terminal.message, /session stopped because the tiktok page changed/, destination);
    assert.equal(f.h.run('viewerNavigation'), null, destination);
  }
});

test('only tiktok Next accepts an unpredicted post: opening or closing onto another post still stops', async () => {
  for (const kind of ['open', 'close']) {
    let current = SEARCH;
    const h = runner(async (settings, adapter, signal) => {
      await adapter.search('personal brand');
      if (kind === 'open') await adapter.open(FIRST);
      else { current = FIRST; h.run(`expectedDestination = '${FIRST}'`); await adapter.leavePost({ id: FIRST, viewer: true, close: true }, signal); }
    });
    const change = url => { current = url; h.chrome.tabs.onUpdated.listeners[0](7, { url }); };
    h.chrome.tabs.get = async () => ({ id: 7, url: current, status: 'complete' });
    h.chrome.tabs.update = async (id, options) => { change(options.url); };
    h.page(request => {
      if (request.files) return [{ result: null }];
      if (kindOf(request)) { change(OTHER); return [{ result: true }]; }
      return [{ result: { posts: [FIRST], sequence: [FIRST], post: isPost(current) ? { id: canonical(current), viewer: true, close: true } : null } }];
    });
    const terminal = await h.finish();
    assert.equal(terminal.phase, 'stopped', kind);
    assert.match(terminal.message, /tiktok page changed/, kind);
  }
});

test('the tiktok transition allowance ends on success and on failed clicks; idle navigation to any post stops', async () => {
  for (const failed of [false, true]) {
    const f = navigation(({ change }) => { if (failed) return false; change(SECOND); return true; });
    f.h.after = signal => {
      assert.equal(signal.aborted, false);
      f.change(OTHER);
      assert.equal(signal.aborted, true);
    };
    const terminal = await f.h.finish();
    assert.equal(f.h.active, null);
    assert.equal(terminal.phase, 'stopped');
  }
});

test('a slow failed tiktok Next restores its source after the allowance and then closes to the search', async () => {
  const f = navigation(({ h }) => { h.advance(17000); return false; });
  const terminal = await f.h.finish();
  assert.equal(terminal.phase, 'complete');
  assert.equal(f.h.moved, false);
  assert.equal(f.h.left, true);
  assert.deepEqual(f.clicks, ['open', 'next', 'close']);
  assert.equal(f.h.idle, SEARCH + '&lang=en');
  assert.equal(f.h.active, null);
});

test('tiktok opens, Next and Close allow their source, target and current search for sixteen seconds', async () => {
  const during = [];
  const f = navigation(({ change, h }) => {
    during.push(JSON.parse(h.run('JSON.stringify({ destinations: viewerNavigation.destinations, remainingMs: viewerNavigation.deadline - Date.now(), expected: expectedDestination, anyPost: viewerNavigation.anyPost })')));
    change(SECOND); return true;
  });
  const executeScript = f.h.chrome.scripting.executeScript;
  f.h.chrome.scripting.executeScript = async request => {
    if (kindOf(request) === 'open') during.push(JSON.parse(f.h.run('JSON.stringify({ destinations: viewerNavigation.destinations, remainingMs: viewerNavigation.deadline - Date.now(), expected: expectedDestination, anyPost: viewerNavigation.anyPost })')));
    return executeScript(request);
  };
  await f.h.finish();
  assert.deepEqual(during, [
    { destinations: [SEARCH, FIRST, SEARCH], remainingMs: 16000, expected: FIRST, anyPost: false },
    { destinations: [FIRST.replace(/\/$/, '') + '?q=personal%20brand', SECOND, SEARCH], remainingMs: 16000, expected: SECOND, anyPost: true }
  ]);
});

test('tiktok searches become the current search, including the video results tab', async () => {
  const seen = [];
  let current = 'https://www.tiktok.com/foryou';
  const h = runner(async (settings, adapter) => {
    seen.push(h.run('currentSearchURL'));
    seen.push(await adapter.search('café & co'), h.run('currentSearchURL'));
    seen.push(await h.run("navigate('https://www.tiktok.com/foryou')"), h.run('currentSearchURL'));
    seen.push(await h.run("navigate('https://www.tiktok.com/search/video?q=second')"), h.run('currentSearchURL'));
  });
  h.chrome.tabs.get = async () => ({ id: 7, url: current, status: 'complete' });
  h.chrome.tabs.update = async (id, options) => { current = options.url; };
  h.page(request => [{ result: request.files ? null : { posts: [FIRST], post: null } }]);
  assert.equal((await h.finish()).phase, 'complete');
  const cafe = 'https://www.tiktok.com/search?q=caf%C3%A9%20%26%20co';
  assert.deepEqual(seen, [undefined, true, cafe, true, cafe, true, 'https://www.tiktok.com/search/video?q=second']);
});

test('the tiktok draft check reads up to three times, half a second apart, and never reads for blank text', async () => {
  for (const item of [
    { comment: '', answers: [], state: 'unknown', reads: 0 },
    { comment: 'nice one', answers: [{ known: true, holding: true }], state: 'present', reads: 1 },
    { comment: 'nice one', answers: [{ known: true, holding: false }], state: 'absent', reads: 1 },
    { comment: 'nice one', answers: [{ known: false }, { known: false }, { known: true, holding: false }], state: 'absent', reads: 3 },
    { comment: 'nice one', answers: Array(12).fill(null), state: 'unknown', reads: 9 }
  ]) {
    let state;
    const h = runner(async (settings, adapter) => { state = await adapter.draftState(item.comment); });
    const answers = [...item.answers];
    h.page(request => [{ result: request.files ? null : answers.shift() }]);
    assert.equal((await h.finish()).phase, 'complete');
    assert.equal(state, item.state, JSON.stringify(item));
    const reads = h.reads();
    assert.equal(reads.length, item.reads, JSON.stringify(item));
    if (item.reads === 3) assert.deepEqual(reads.slice(1).map((read, index) => read.at - reads[index].at), [500, 500]);
  }
});

// The real tiktok.js composer behind the virtual runner.
async function tiktokComment(configure = () => {}) {
  const composer = commentComposer();
  let result;
  const h = runner(async (settings, adapter) => { result = await adapter.engage('comment', { ...composer.request, viewer: true }, composer.request.comment); });
  h.chrome.tabs.get = async () => ({ id: 7, url: composer.request.id, status: 'complete' });
  h.page(request => {
    if (request.files) { composer.load(); return [{ result: null }]; }
    return [{ result: composer.inject(request.func, request.args) }];
  });
  configure(composer, h);
  const terminal = await h.finish();
  const submits = h.log.filter(entry => entry.func?.includes("action: 'click-comment-submit'")).map(entry => entry.at);
  return { composer, h, result, terminal, submits, checks: h.reads().filter(read => read.action === 'draft-state'),
    clears: h.log.filter(entry => entry.func?.includes("action: 'comment-clear'") || entry.read === 'comment-cleared').length };
}

test('an unsent tiktok draft goes straight to the read-only check with no clear attempts or polls', async () => {
  for (const [name, configure, expected] of [
    ['Post never enabled while the text is in the editor', composer => { composer.state.onInput = () => { composer.submit.disabled = true; }; }, 'draft-retained'],
    ['a manual edit after typing', composer => { composer.state.onInput = field => { field.textContent = 'my own comment'; composer.interact('input'); }; }, 'draft-retained'],
    ['the paste was ignored', composer => { composer.state.ignorePaste = true; }, 'not-typed']
  ]) {
    const f = await tiktokComment(configure);
    assert.equal(f.result, expected, name);
    assert.equal(f.composer.submitted, 0, name);
    assert.equal(f.clears, 0, `${name}: no clear attempt or clear poll`);
    assert.equal(f.checks.length, 1, name);
    assert.equal(f.checks[0].at, f.submits.at(-1), `${name}: the check follows the last submit check at once`);
    assert.equal(f.terminal.phase, 'complete', name);
  }
});

test('a text mismatch or unowned editor is never reported as an ignored paste', async () => {
  for (const [name, configure] of [
    ['partial text', composer => { composer.state.onInput = field => { field.textContent = 'this setup tip'; }; }],
    ['editor replaced by an empty one', composer => { composer.state.onInput = () => { composer.replaceField(''); }; }]
  ]) {
    const f = await tiktokComment(configure);
    assert.notEqual(f.result, 'not-typed', name);
    assert.equal(f.composer.submitted, 0, name);
  }
});

test('a lost tiktok frame is a clean skip before typing and a checked result after it', async () => {
  const lost = () => new Error('Frame with ID 0 was removed.');
  const beforeTyping = await tiktokComment((composer, h) => {
    const execute = h.chrome.scripting.executeScript;
    // Ownership is claimed by the comment-field read while no draft is pending.
    h.chrome.scripting.executeScript = async request => request.args?.[1]?.action === 'comment-field' ? Promise.reject(lost()) : execute(request);
  });
  assert.equal(beforeTyping.result, 'skipped');
  assert.equal(beforeTyping.checks.length, 0);
  assert.deepEqual(beforeTyping.composer.inputs, []);
  for (const [textRemains, expected] of [[false, 'skipped'], [true, 'draft-retained']]) {
    const f = await tiktokComment((composer, h) => {
      const execute = h.chrome.scripting.executeScript;
      h.chrome.scripting.executeScript = async request => {
        const answer = await execute(request);
        if (request.args?.[0] === 'comment') { if (!textRemains) composer.replaceField(''); throw lost(); }
        return answer;
      };
    });
    assert.equal(f.result, expected, `text remains: ${textRemains}`);
    assert.equal(f.checks.length, 1);
    assert.equal(f.composer.submitted, 0);
    assert.equal(f.terminal.phase, 'complete');
  }
  const unreadable = await tiktokComment((composer, h) => {
    const execute = h.chrome.scripting.executeScript;
    h.chrome.scripting.executeScript = async request => {
      const answer = await execute(request);
      if (request.args?.[1]?.action === 'draft-state') return [{ result: null }];
      if (request.args?.[0] === 'comment') { composer.replaceField(''); throw lost(); }
      return answer;
    };
  });
  assert.equal(unreadable.result, 'draft-retained', 'an unreadable check never becomes a clean skip');
  assert.equal(unreadable.checks.length, 9);
});

test('a restriction seen by the tiktok draft check stops the session and still warns about the draft', async () => {
  const message = 'tiktok limited activity. the session has stopped; wait before starting another session.';
  const f = await tiktokComment((composer, h) => {
    const execute = h.chrome.scripting.executeScript;
    h.chrome.scripting.executeScript = async request => {
      const answer = await execute(request);
      if (request.args?.[1]?.action === 'draft-state') return [{ result: { blocked: message, blockReason: 'rate-limit' } }];
      if (request.args?.[0] === 'comment') throw new Error('Frame with ID 0 was removed.');
      return answer;
    };
  });
  assert.equal(f.checks.length, 1);
  assert.deepEqual({ phase: f.terminal.phase, message: f.terminal.message }, { phase: 'error', message: 'a comment draft may remain in tiktok. review it before restarting.' });
  assert.equal(f.composer.submitted, 0);
});

test('a non-english tiktok page stops the session before any navigation', async () => {
  const page = fixture({ href: SEARCH });
  page.document.documentElement = { getAttribute: name => name === 'lang' ? 'de-DE' : null };
  const navigations = [];
  const h = runner(async (settings, adapter) => { await adapter.search('personal brand'); });
  h.chrome.tabs.get = async () => ({ id: 7, url: SEARCH, status: 'complete' });
  h.chrome.tabs.update = async (id, options) => { navigations.push(options.url); };
  h.page(request => {
    if (request.files) { page.load(); return [{ result: null }]; }
    return [{ result: page.inject(request.func, request.args) }];
  });
  const terminal = await h.finish();
  assert.equal(terminal.phase, 'error');
  assert.match(terminal.message, /^tiktok isn't in english, so the session can't read its warnings\. switch tiktok to english, then start a new session\./);
  assert.deepEqual(navigations, []);
  assert.deepEqual(page.clicks, []);
});

// Worst case: the in-place check never confirms and the fresh page never confirms.
const budget = action => {
  const match = sessionSource.match(/const confirmationBudgetMs = \{ like: platform === 'tiktok' \? (\d+) : \d+, follow: (\d+), comment: \d+ \};/);
  assert.ok(match, 'the session keeps its confirmation budget');
  return Number(action === 'like' ? match[1] : match[2]);
};
async function confirmation(action, { inPlace = () => false, fresh = () => false } = {}) {
  const created = [], removed = [];
  let result, startedAt, endedAt, inPlaceReads = 0;
  const confirmationTab = { id: 81, url: FIRST, status: 'complete' };
  const h = runner(async (settings, adapter) => {
    startedAt = h.now();
    result = await adapter.engage(action, { id: FIRST, author: '@creator' });
    endedAt = h.now();
  });
  h.chrome.tabs.get = async tabId => tabId === 81 ? confirmationTab : { id: 7, url: FIRST, status: 'complete' };
  h.chrome.tabs.create = async options => { created.push(JSON.parse(JSON.stringify(options))); return confirmationTab; };
  h.chrome.tabs.remove = async tabId => { removed.push(tabId); };
  h.page(request => {
    if (request.files) return [{ result: null }];
    if (request.target.tabId === 81) return [{ result: { confirmed: fresh() } }];
    if (request.args?.[1]?.action === `verify-${action}`) return [{ result: { confirmed: inPlace(++inPlaceReads) } }];
    if (request.args?.[0] === action) return [{ result: true }];
    return [{ result: { post: null, posts: [] } }];
  });
  await h.finish();
  return { result, elapsed: endedAt - startedAt, created, removed, inPlaceReads, freshReads: h.reads().filter(read => read.tabId === 81).length };
}

test('the always-fresh tiktok like and follow check fits inside the session confirmation budget', async () => {
  for (const action of ['like', 'follow']) {
    const worst = await confirmation(action);
    assert.equal(worst.result, 'uncertain', action);
    assert.equal(worst.inPlaceReads, action === 'like' ? 6 : 10, action);
    assert.deepEqual(worst.created, [{ url: FIRST, active: false }], action);
    assert.deepEqual(worst.removed, [81], action);
    assert.ok(worst.freshReads >= 1, action);
    assert.ok(worst.elapsed <= budget(action), `${action}: ${worst.elapsed} ms of ${budget(action)} ms`);
    const kept = await confirmation(action, { inPlace: () => true, fresh: () => true });
    assert.equal(kept.result, 'confirmed', action);
    assert.equal(kept.inPlaceReads, 1, `${action}: the in-place check stops at its first success`);
    assert.equal(kept.freshReads, 1, action);
    assert.deepEqual(kept.created, [{ url: FIRST, active: false }], `${action}: a kept action still gets its fresh page`);
    const reverted = await confirmation(action, { inPlace: () => true });
    assert.equal(reverted.result, 'uncertain', `${action}: shown in place but gone on a fresh page`);
    assert.ok(reverted.elapsed <= budget(action), action);
  }
});
