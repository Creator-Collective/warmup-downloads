const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');
const { validateSettings } = require('../plan.js');
const { normalizeCommentedPosts, mergeCommentedPosts } = require('../browser-extension/guards.js');

// The reported case: a later session went back to reels an earlier session had
// already commented on and commented again. A post never gets a second comment,
// whether the earlier comment came from this session, an earlier session on this
// device, or shows on the post from anywhere else.
function engine() {
  const context = vm.createContext({ setTimeout, clearTimeout, AbortController, URL });
  for (const file of ['plan.js', 'comment-writer.js', 'session.js']) {
    const filename = path.join(__dirname, '../browser-extension', file);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  }
  return context;
}
const ctx = engine();
const { runSession } = vm.runInContext('({ runSession })', ctx);
const plain = value => JSON.parse(JSON.stringify(value));
const plan = (patch = {}) => plain(ctx.sessionPlan.validateSettings({ niche: 'study tips', minutes: 20, enableComments: true, customLimits: { like: 0, follow: 0, comment: 8 }, ...patch }));
const MATCHING = 'Study tips work best when you practice a little every day.';
const igURL = index => `https://www.instagram.com/p/post${index}/`;

// One keyword grid with a viewer that pages through it in order. Every post has a
// matching caption and a comment box, so only the repeat rule can hold a comment back.
function world({ post = () => ({}) } = {}) {
  let time = 0, mode = 'none', loaded = 0, index = -1, steps = 0, term = null;
  const controller = new AbortController();
  const items = [];
  const attempts = [], updates = [], checkpoints = [];
  const itemAt = i => {
    while (items.length <= i) items.push({ id: igURL(items.length), author: `/author_${items.length}/`, text: MATCHING, caption: MATCHING, like: false, follow: false, comment: true, ...post(items.length) });
    return items[i];
  };
  const ids = () => Array.from({ length: loaded }, (_, i) => itemAt(i).id);
  const adapter = {
    update: patch => updates.push(plain(patch)),
    checkpoint: async value => { checkpoints.push(plain(value)); },
    search: async name => { time += 2500; term = name; mode = 'grid'; loaded = 24; index = -1; return true; },
    inspect: async () => {
      time += 150;
      if (mode === 'grid') return { post: null, posts: ids(), sequence: ids(), search: { term, posts: ids() } };
      if (mode === 'viewer') {
        const item = itemAt(index);
        return { post: { ...item, viewer: true, next: true }, posts: [], sequence: ids(), search: { term: null, behindViewer: true, posts: ids() } };
      }
      return { unavailable: true };
    },
    scroll: async () => { time += 900; loaded += 12; return true; },
    open: async id => { time += 900; const i = ids().indexOf(id); if (i < 0) return false; mode = 'viewer'; index = i; return true; },
    advance: async () => { time += 700; index += 1; if (index >= loaded) loaded += 12; return true; },
    leavePost: async () => { time += 800; mode = 'grid'; return true; },
    engage: async (action, item, comment) => { attempts.push({ action, id: item.id, comment }); time += 4000; return 'confirmed'; }
  };
  const options = { random: () => .5, commentSalt: 'salt', now: () => time, sleep: async ms => { if (++steps > 200000) throw new Error('runaway'); time += Math.max(0, ms); } };
  return {
    attempts, updates, checkpoints,
    commented: () => attempts.filter(attempt => attempt.action === 'comment').map(attempt => attempt.id),
    run: (settings, extra = {}) => runSession(settings, adapter, controller.signal, { ...options, ...extra })
  };
}
const identity = url => `instagram:${new URL(url).pathname.split('/')[2]}`;

test('a second session over the same results never comments on a post the first one commented on', async () => {
  const first = world();
  const stats = await first.run(plan());
  assert.ok(stats.comment >= 4, `first session comments: ${stats.comment}`);
  const saved = first.checkpoints.at(-1).done.comment;
  assert.deepEqual([...saved].sort(), first.commented().map(identity).sort(), 'every commented post is in the saved history');

  // Before the fix the second session walked the same grid and commented on the same posts again.
  const unguarded = world();
  await unguarded.run(plan());
  assert.ok(unguarded.commented().some(id => first.commented().includes(id)), 'same results reach the same posts');

  const second = world();
  const again = await second.run(plan(), { commented: saved });
  assert.ok(again.comment >= 4, `second session still comments: ${again.comment}`);
  assert.deepEqual(second.commented().filter(id => first.commented().includes(id)), [], 'no post commented on twice');
});

test('a post that already shows your comment is skipped, even with no saved history', async () => {
  const h = world({ post: index => index % 2 === 0 ? { commented: true } : {} });
  const stats = await h.run(plan());
  assert.ok(stats.comment > 0);
  assert.ok(h.commented().every(id => Number(id.match(/post(\d+)/)[1]) % 2 === 1), `commented: ${h.commented()}`);
});

test('when repeats are why comments fell short, the summary says so', async () => {
  const h = world({ post: () => ({ commented: true }) });
  const stats = await h.run(plan({ minutes: 10 }));
  assert.equal(stats.comment, 0);
  assert.equal(h.attempts.length, 0);
  const summary = h.updates.map(update => update.message).find(message => message?.startsWith('why targets fell short'));
  assert.match(summary, /comments 0\/8: \d+ posts already had your comment/);
});

test('commented posts are kept for six months, capped, and keep their first time', () => {
  const day = 86400000, now = 400 * day;
  const kept = normalizeCommentedPosts([['instagram:recent', now - 170 * day], ['instagram:old', now - 181 * day], ['tiktok:x', now], ['instagram:bad id', now], 'junk'], now);
  assert.deepEqual(kept, [['instagram:recent', now - 170 * day]]);
  const merged = mergeCommentedPosts([['instagram:a', now - 5 * day]], ['instagram:a', 'instagram:b', 'https://evil.example/x'], now);
  assert.deepEqual(merged, [['instagram:a', now - 5 * day], ['instagram:b', now]]);
  const many = mergeCommentedPosts([], Array.from({ length: 5200 }, (_, i) => `instagram:p${i}`), now);
  assert.equal(many.length, 5000);
  assert.equal(many.at(-1)[0], 'instagram:p5199');
});

function background(job, localStorage) {
  let saved = structuredClone(job), local = {};
  const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
  const tabs = [{ id: 7, url: 'https://www.instagram.com/', windowId: 3 }, { id: 90, windowId: 3 }];
  const chrome = {
    sidePanel: { setPanelBehavior: async () => {} },
    runtime: { id: 'extension-id', getURL: p => `chrome-extension://extension-id/${p.replace(/^\//, '')}`, getManifest: () => ({ version: 'test' }), onMessage: event(), getContexts: async () => [] },
    storage: {
      session: { get: async () => ({ job: structuredClone(saved) }), set: async value => { saved = structuredClone(value.job); } },
      local: localStorage || { get: async key => (key in local ? { [key]: structuredClone(local[key]) } : {}), set: async value => { Object.assign(local, structuredClone(value)); } }
    },
    tabs: { query: async () => tabs, get: async id => tabs.find(tab => tab.id === id), create: async options => ({ id: 91, ...options }), remove: async () => {}, update: async () => {}, onRemoved: event(), onUpdated: event() }
  };
  const context = vm.createContext({ chrome, console, URL, crypto: webcrypto, structuredClone, Date });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(__dirname, '../browser-extension', file), 'utf8'), context));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../browser-extension/background.js'), 'utf8'), context);
  const message = request => new Promise(resolve => {
    const source = { id: 'extension-id', url: `chrome-extension://extension-id/runner.html#${saved.token}`, tab: { id: saved.runnerTabId } };
    if (!chrome.runtime.onMessage.listeners[0](request, source, resolve)) resolve(undefined);
  });
  return { message, local: () => local, job: () => saved };
}
const settings = validateSettings({ platform: 'instagram', minutes: 10, niche: 'study tips', enableComments: true });
const runningJob = () => ({ sessionId: 's1', token: 'token-1', runnerTabId: 90, tabId: 7, settings, phase: 'running', stopRequested: false, deadline: Date.now() + 600000, stats: {}, unconfirmed: {}, pausedActions: [], comments: [], activity: [], message: 'running', checkpoint: null });
const checkpoint = comment => ({
  version: 1, stats: { scroll: 0, read: 0, search: 1, open: 1, like: 0, follow: 0, comment: comment.length, skipped: 0 }, unconfirmed: { like: 0, follow: 0, comment: 0 },
  pausedActions: [], comments: [], seen: comment, done: { like: [], follow: [], comment }, usedComments: [], termIndex: 0, currentSearchTerm: null,
  elapsedMs: 60000, remainingMs: 540000, cooldowns: { like: 0, follow: 0, comment: 0, engagement: 0, break: 0 }, inFlight: null
});

test('a comment is remembered on this device as soon as the session saves it, and handed to the next session', async () => {
  const h = background(runningJob());
  assert.deepEqual(plain((await h.message({ type: 'runner-commented', token: 'token-1' })).data), []);
  const saved = await h.message({ type: 'runner-checkpoint', token: 'token-1', checkpoint: checkpoint(['instagram:one']) });
  assert.equal(saved.ok, true);
  await h.message({ type: 'runner-checkpoint', token: 'token-1', checkpoint: checkpoint(['instagram:one', 'instagram:two']) });
  assert.deepEqual(plain(h.local().commentedPosts.map(([id]) => id)), ['instagram:one', 'instagram:two']);
  assert.deepEqual(plain((await h.message({ type: 'runner-commented', token: 'token-1' })).data), ['instagram:one', 'instagram:two']);
});

test('a storage failure never blocks saving or starting a session', async () => {
  const broken = { get: async () => { throw new Error('quota'); }, set: async () => { throw new Error('quota'); } };
  const h = background(runningJob(), broken);
  assert.deepEqual(plain(await h.message({ type: 'runner-commented', token: 'token-1' })), { ok: true, data: [] });
  const saved = await h.message({ type: 'runner-checkpoint', token: 'token-1', checkpoint: checkpoint(['instagram:one']) });
  assert.equal(saved.ok, true);
  assert.deepEqual(plain(h.job().checkpoint.done.comment), ['instagram:one']);
});

// Modelled instagram desktop markup (not a capture of the live site).
const source = fs.readFileSync(path.join(__dirname, '../browser-extension/instagram.js'), 'utf8');
const sidebar = '<div class="nav"><a href="/"><span>Home</span></a><a href="/me/"><img alt="me\'s profile picture"><span>Profile</span></a></div>';
const row = (author, text, post = 'ABC', id = 1) => `<li><a href="/${author}/"><img alt="${author}'s profile picture"></a><h3><a href="/${author}/">${author}</a></h3><span>${text}</span><a href="/p/${post}/c/${id}/"><time>9h</time></a><div role="button">Reply</div></li>`;
const dialog = comments => `<div role="dialog"><article><img alt="Photo by creator"><a href="/creator/">creator</a><div role="button">Follow</div><h1>${MATCHING}</h1><a href="/p/ABC/">1h</a><ul>${comments}</ul><section><div role="button"><svg aria-label="Like"></svg></div><div role="button"><svg aria-label="Comment"></svg></div><div role="button"><svg aria-label="Save"></svg></div></section><form><textarea aria-label="Add a comment…" placeholder="Add a comment…"></textarea><div role="button">Post</div></form></article></div>`;
function inspect(body) {
  const dom = new JSDOM(`<!doctype html><html lang="en"><body>${body}</body></html>`, { url: 'https://www.instagram.com/p/ABC/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.Element.prototype.getBoundingClientRect = () => ({ left: 1, top: 1, width: 10, height: 10, right: 11, bottom: 11 });
  window.document.elementFromPoint = () => null;
  window.innerWidth = 1280; window.innerHeight = 800;
  window.eval(source);
  return window.inspectInstagram({}).post;
}

test('the post reports when it already shows a comment from your own account', () => {
  for (const [name, comments, expected] of [
    ['your comment', row('me', 'the financial advice disclaimer 😭'), true],
    ['your comment under other people', row('someone', 'great tips') + row('me', 'so true', 'ABC', 2), true],
    ['your comment with a different letter case', row('Me', 'so true'), true],
    ['only other people', row('someone', 'great tips') + row('other', 'love this', 'ABC', 2), false],
    ['no comments', '', false],
    ['your comment on another post', row('me', 'so true', 'XYZ'), false],
    ['someone mentioning you', `<li><a href="/someone/">someone</a><span>hey <a href="/me/">@me</a></span><a href="/p/ABC/c/5/"><time>1d</time></a></li>`, false]
  ]) assert.equal(inspect(sidebar + `<main role="main"></main>` + dialog(comments)).commented, expected, name);
});
