const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const guards = require('../browser-extension/guards.js');
const { fixture } = require('./fixtures/tiktok-comment-composer.cjs');

// TikTok only renders a viewer's like/follow/comment panel and loads more
// results while its tab is on screen. A background tab showed a viewer's video
// for 20+ seconds without that panel, so every post looked like it had nothing
// to like, follow or comment on.
const id = 'https://www.tiktok.com/@creator/video/123/';

test('a plain tiktok read says when its tab is in the background', () => {
  const viewer = fixture({ href: 'https://www.tiktok.com/search?q=branding', modal: true });
  assert.equal(viewer.inspect().hidden, undefined);
  viewer.document.visibilityState = 'hidden';
  assert.equal(viewer.inspect().hidden, true);
  assert.equal(viewer.inspect().post.id, id, 'the post is still read');
  assert.equal(viewer.inspect({ id, action: 'verify-like' }).hidden, undefined, 'action replies are unchanged');
  const grid = fixture({ href: 'https://www.tiktok.com/search?q=branding' });
  grid.document.visibilityState = 'hidden';
  assert.equal(grid.inspect().post, null);
  assert.equal(grid.inspect().hidden, true);
  grid.document.visibilityState = 'visible';
  assert.equal(grid.inspect().hidden, undefined);
});

test('a tiktok post says whether its like/follow panel has rendered, liked or not', () => {
  const page = fixture({ href: 'https://www.tiktok.com/search?q=branding', modal: true });
  assert.equal(page.inspect().post.details, true);
  page.like.attrs['aria-pressed'] = 'true';
  assert.equal(page.inspect().post.like, false);
  assert.equal(page.inspect().post.details, true, 'an already-liked post has loaded');
  const loading = fixture({ href: 'https://www.tiktok.com/search?q=branding', modal: true });
  loading.like.hidden = true;
  assert.equal(loading.inspect().post.details, false);
});

const source = fs.readFileSync(path.join(__dirname, '../browser-extension/runner.js'), 'utf8');
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
const SEARCH = 'https://www.tiktok.com/search?q=personal%20brand';
const FIRST = 'https://www.tiktok.com/@creator/video/7300000000000000001/';

// The real runner with a virtual clock that only moves when it sleeps.
function runner(operation, answer, platform = 'tiktok') {
  let now = 1800000000000;
  let url = platform === 'tiktok' ? SEARCH : 'https://www.instagram.com/explore/search/keyword/?q=brand';
  const calls = [], reads = [];
  const job = { token: 'test-token', tabId: 7, runnerTabId: 90, deadline: now + 600000, phase: 'starting', settings: { minutes: 10, platform }, stats: {}, activity: [], message: 'starting' };
  const chrome = {
    runtime: { sendMessage: async message => { calls.push(message); return { ok: true, data: message.type === 'runner-job' ? job : null }; } },
    tabs: { get: async () => ({ id: 7, url, status: 'complete' }), update: async () => ({}), create: async () => { throw new Error('unexpected temporary tab'); }, remove: async () => {}, onUpdated: event() },
    storage: { onChanged: event() },
    scripting: {
      executeScript: async request => {
        if (request.files) return [{ result: null }];
        if (typeof request.args?.[1] === 'number') { url = FIRST.replace(/\/$/, '?q=personal%20brand'); return [{ result: true }]; }
        reads.push(now);
        return [{ result: answer(reads.length, now) }];
      }
    }
  };
  const node = () => ({ textContent: '', disabled: false, dataset: {}, scrollTop: 0, addEventListener() {}, replaceChildren() {}, append() {}, click() {}, classList: { toggle() {} } });
  const elements = new Map();
  const ctx = vm.createContext({
    chrome, URL, console, AbortController, setInterval, clearInterval, clearTimeout,
    Date: { now: () => now },
    setTimeout: (fn, ms) => setTimeout(() => { if (ms < 3000) now += ms; fn(); }, ms >= 3000 ? 100 : 0),
    location: { hash: '#test-token' }, platforms: guards.platforms, validPlatform: guards.validPlatform, platformURL: guards.platformURL, instagramURL: guards.instagramURL,
    document: { getElementById: key => { if (!elements.has(key)) elements.set(key, node()); return elements.get(key); }, createElement: node, body: { classList: { toggle() {} } }, addEventListener() {} },
    sessionEngine: { runSession: operation }, commentHistory: require('../comment-history.js'), sessionResults: require('../session-results.js')
  });
  const terminal = () => calls.find(call => call.patch && ['complete', 'stopped', 'error'].includes(call.patch.phase))?.patch;
  return {
    calls, reads, now: () => now,
    messages: () => calls.filter(call => call.type === 'runner-update' && typeof call.patch?.message === 'string').map(call => call.patch.message),
    async finish() {
      vm.runInContext(source, ctx);
      for (let i = 0; i < 800 && !terminal(); i++) await new Promise(resolve => setTimeout(resolve, 2));
      assert.ok(terminal(), 'the runner must settle');
      return terminal();
    }
  };
}

test('a tiktok session waits while its tab is in the background and says why', async () => {
  let page, startedAt, endedAt;
  const h = runner(async (settings, adapter) => {
    startedAt = h.now();
    page = await adapter.inspect();
    endedAt = h.now();
  }, count => ({ posts: [FIRST], post: null, ...(count <= 3 ? { hidden: true } : {}) }));
  assert.equal((await h.finish()).phase, 'complete');
  assert.equal(page.hidden, undefined, 'the engine gets the on-screen page');
  assert.deepEqual(Array.from(page.posts), [FIRST]);
  assert.equal(h.reads.length, 4);
  assert.equal(endedAt - startedAt, 6000);
  const messages = h.messages();
  assert.ok(messages.includes('tiktok is in the background, so it stopped loading posts. switch back to the tiktok tab to keep going.'));
  assert.ok(messages.includes('tiktok is back on screen. continuing…'));
});

test('an on-screen tiktok page is read once, with no background message', async () => {
  let page;
  const h = runner(async (settings, adapter) => { page = await adapter.inspect(); }, () => ({ posts: [FIRST], post: null }));
  assert.equal((await h.finish()).phase, 'complete');
  assert.deepEqual(Array.from(page.posts), [FIRST]);
  assert.equal(h.reads.length, 1);
  assert.ok(!h.messages().some(message => /background/.test(message)));
});

test('a background tab can still end the session on time', async () => {
  const h = runner(async (settings, adapter) => { await adapter.inspect(); }, () => ({ posts: [], post: null, hidden: true }));
  const end = await h.finish();
  assert.equal(end.phase, 'complete');
  assert.ok(h.now() >= 1800000000000 + 600000);
});

const viewerPost = details => ({ id: FIRST, author: '@creator', viewer: true, next: true, close: true, like: details, follow: details, comment: false, text: '', caption: '', details });

test('opening a tiktok post waits for its like/follow panel before the session judges it', async () => {
  let opened, openedAt, startedAt;
  const h = runner(async (settings, adapter) => {
    await adapter.search('personal brand');
    startedAt = h.now();
    opened = await adapter.open(FIRST);
    openedAt = h.now();
  }, (count, now) => {
    if (count <= 2) return { posts: [FIRST], sequence: [FIRST], post: null };
    return { posts: [FIRST], sequence: [FIRST], post: viewerPost(count >= 6) };
  });
  assert.equal((await h.finish()).phase, 'complete');
  assert.equal(opened, true);
  assert.equal(h.reads.length, 6, 'reads continue until the panel shows');
  assert.ok(openedAt - startedAt < 6000);
});

test('a tiktok post whose panel never loads is still opened after a bounded wait', async () => {
  let opened, openedAt, startedAt;
  const h = runner(async (settings, adapter) => {
    await adapter.search('personal brand');
    startedAt = h.now();
    opened = await adapter.open(FIRST);
    openedAt = h.now();
  }, count => count <= 2 ? { posts: [FIRST], sequence: [FIRST], post: null } : { posts: [FIRST], sequence: [FIRST], post: viewerPost(false) });
  assert.equal((await h.finish()).phase, 'complete');
  assert.equal(opened, true);
  assert.ok(openedAt - startedAt >= 6000, `${openedAt - startedAt} ms`);
  assert.ok(openedAt - startedAt < 8000, `${openedAt - startedAt} ms`);
});

test('instagram never waits on tab visibility', async () => {
  let page;
  const h = runner(async (settings, adapter) => { page = await adapter.inspect(); }, () => ({ posts: [], post: null, hidden: true }), 'instagram');
  assert.equal((await h.finish()).phase, 'complete');
  assert.equal(h.reads.length, 1);
  assert.equal(page.hidden, true);
});
