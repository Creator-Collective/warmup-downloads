const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { validateSettings } = require('../plan.js');
const { normalizeBrowseHistory, mergeBrowseHistory } = require('../browser-extension/guards.js');

// Instagram browsing variety on the real engine: each run starts on a different
// keyword and tile, pages through a few posts, jumps further down the results,
// passes over posts earlier sessions showed and skims posts with nothing left to do.
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
const plan = (patch = {}) => plain(ctx.sessionPlan.validateSettings({ niche: 'sat test, sat test prep', minutes: 20, enableComments: false, customLimits: { like: 45, follow: 10 }, ...patch }));
const seeded = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const code = (term, index) => `${term.replace(/\W/g, '')}${index}`;
const igURL = value => `https://www.instagram.com/p/${value}/`;

// A modelled keyword grid per query with a post viewer that pages through it in
// order. Only one screen of tiles is visible; opening centres the chosen tile and
// closing the viewer returns to that spot, like the real results page.
function world({ post = () => ({}), gridSize = 24, grow = 12, screen = 12, random = seeded(7) } = {}) {
  let time = 0, term = null, mode = 'none', loaded = 0, index = -1, steps = 0, top = 0;
  const controller = new AbortController();
  const feeds = new Map();
  const attempts = [], searches = [], opens = [], viewed = [], moves = [], updates = [];
  const itemAt = i => {
    if (!feeds.has(term)) feeds.set(term, []);
    const list = feeds.get(term);
    while (list.length <= i) {
      const n = list.length;
      list.push({ id: igURL(code(term, n)), author: `/author_${code(term, n)}/`, text: 'sat test prep tips', caption: 'sat test prep tips', like: true, follow: true, comment: false, index: n, ...post(term, n) });
    }
    return list[i];
  };
  const gridIds = () => Array.from({ length: loaded }, (_, i) => itemAt(i).id);
  const adapter = {
    update: patch => updates.push({ ...plain(patch), time }),
    checkpoint: async () => {},
    search: async name => { searches.push(name); time += 2500; term = name; mode = 'grid'; loaded = gridSize; index = -1; top = 0; return true; },
    inspect: async () => {
      time += 150;
      if (mode === 'grid') { const ids = gridIds(); return { post: null, posts: ids.slice(top, top + screen), sequence: ids, search: { term, posts: ids } }; }
      if (mode === 'viewer') {
        const item = itemAt(index);
        if (viewed.at(-1)?.id !== item.id) viewed.push({ id: item.id, index: item.index, term, time });
        return { post: { id: item.id, author: item.author, text: item.text, caption: item.caption, viewer: true, next: true, like: item.like, follow: item.follow, comment: item.comment }, posts: [], sequence: gridIds(), search: { term: null, behindViewer: true, posts: gridIds() } };
      }
      return { unavailable: true };
    },
    scroll: async () => { time += 900; top += screen / 2; if (top + 2 * screen > loaded) loaded += grow; moves.push('scroll'); return true; },
    open: async id => {
      time += 900;
      const i = gridIds().indexOf(id);
      if (i < 0) return false;
      opens.push({ id, index: i, term });
      mode = 'viewer'; index = i; top = Math.max(0, i - screen / 2); moves.push('open');
      return true;
    },
    advance: async () => { time += 700; index += 1; if (index >= loaded) loaded += grow; moves.push('next'); return true; },
    leavePost: async () => { time += 800; mode = 'grid'; moves.push('leave'); return true; },
    engage: async (action, item) => {
      attempts.push({ action, id: item.id, time });
      const target = feeds.get(term)?.find(entry => entry.id === item.id);
      if (target && action === 'like') target.like = false;
      time += { like: 1500, follow: 2500, comment: 4000 }[action];
      return 'confirmed';
    }
  };
  const options = { random, now: () => time, sleep: async ms => { if (++steps > 200000) throw new Error('runaway'); time += Math.max(0, ms); } };
  return {
    adapter, controller, attempts, searches, opens, viewed, moves, updates, time: () => time,
    run: (settings, extra = {}) => runSession(settings, adapter, controller.signal, { ...options, ...extra })
  };
}

test('without browsing variety a session still walks its results from the top', async () => {
  const h = world();
  await h.run(plan());
  assert.equal(h.searches[0], 'sat test');
  assert.equal(h.opens[0].index, 0);
  assert.equal(h.moves.includes('leave'), false, 'pages straight through with next');
});

test('different sessions start on different keywords and different posts', async () => {
  const firstTerms = new Set(), firstPosts = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const h = world();
    await h.run(plan(), { browseRandom: seeded(seed * 101) });
    firstTerms.add(h.searches[0]);
    firstPosts.add(`${h.opens[0].term}:${h.opens[0].index}`);
  }
  assert.deepEqual([...firstTerms].sort(), ['sat test', 'sat test prep']);
  assert.ok(firstPosts.size >= 6, `first posts: ${[...firstPosts]}`);
});

test('a session pages through a few posts, then jumps further down the results', async () => {
  const h = world();
  await h.run(plan(), { browseRandom: seeded(3) });
  let chain = 0, longest = 0;
  for (const move of h.moves) {
    if (move === 'next') longest = Math.max(longest, ++chain);
    else if (move !== 'scroll') chain = 0;
  }
  assert.ok(h.moves.filter(move => move === 'leave').length >= 3, `jumps: ${h.moves.filter(move => move === 'leave').length}`);
  assert.ok(longest >= 3 && longest <= 9, `longest run of next: ${longest}`);
  const deepest = Math.max(...h.opens.map(open => open.index));
  assert.ok(deepest > 24, `deepest opened tile: ${deepest}`);
});

// The reported case: the top results were all shown in earlier sessions, already
// liked, and their authors already followed, so they offer nothing new.
test('repeat keywords reach new accounts past the posts earlier sessions used up', async () => {
  const usedUp = 60;
  const post = (term, index) => index < usedUp ? { like: false, follow: false } : {};
  const history = ['sat test', 'sat test prep'].flatMap(term => Array.from({ length: usedUp }, (_, i) => `instagram:${code(term, i)}`));
  const baseline = world({ post });
  const before = await baseline.run(plan());
  const results = [];
  for (let seed = 1; seed <= 6; seed++) {
    const h = world({ post });
    const stats = await h.run(plan(), { browseRandom: seeded(seed * 17), history });
    results.push(stats.follow);
    assert.ok(h.attempts.every(attempt => Number(attempt.id.match(/(\d+)\/$/)[1]) >= usedUp), 'no attempt on a used-up post');
  }
  assert.ok(before.follow <= 3, `top-down baseline follows: ${before.follow}`);
  assert.ok(Math.min(...results) >= 9, `follows with variety: ${results}`);
});

test('without any saved history, a stretch of used-up posts still triggers a longer jump', async () => {
  const usedUp = 60;
  const post = (term, index) => index < usedUp ? { like: false, follow: false } : {};
  const results = [];
  for (let seed = 1; seed <= 6; seed++) {
    const h = world({ post });
    results.push((await h.run(plan(), { browseRandom: seeded(seed * 17) })).follow);
    assert.ok(h.updates.some(update => update.message === 'nothing new to like or follow here. jumping further down the results…'));
  }
  assert.ok(Math.min(...results) >= 8, `follows without history: ${results}`);
});

test('once every target is met, viewing goes back to ordinary watches', async () => {
  const h = world();
  const stats = await h.run(plan({ minutes: 20, customLimits: { like: 2, follow: 1 } }), { browseRandom: seeded(5) });
  assert.equal(stats.like, 2);
  assert.equal(stats.follow, 1);
  assert.equal(h.updates.some(update => update.message?.startsWith('nothing new to like or follow here')), false);
});

test('posts with nothing left to do get a quick look instead of a full watch', async () => {
  const post = () => ({ like: false, follow: false });
  // Time from reaching a post to reaching the next one through the viewer.
  const stay = h => {
    const gaps = h.viewed.slice(1).flatMap((item, i) => item.term === h.viewed[i].term && item.index === h.viewed[i].index + 1 ? [item.time - h.viewed[i].time] : []).sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)];
  };
  const plainRun = world({ post });
  await plainRun.run(plan({ minutes: 10 }));
  const varied = world({ post });
  await varied.run(plan({ minutes: 10 }), { browseRandom: seeded(11) });
  assert.ok(stay(varied) < stay(plainRun) * 0.7, `median stay ${stay(varied)}ms vs ${stay(plainRun)}ms`);
});

test('variety keeps the engagement limits: search membership, burst cap and targets', async () => {
  const post = (term, index) => index % 3 === 0 ? {} : { text: 'golden hour in lisbon', caption: 'golden hour in lisbon' };
  for (let seed = 1; seed <= 4; seed++) {
    const h = world({ post });
    const stats = await h.run(plan(), { browseRandom: seeded(seed * 29) });
    assert.ok(stats.like <= 45 && stats.follow <= 10);
    const starts = h.attempts.map(attempt => attempt.time);
    for (const start of starts) assert.ok(starts.filter(time => time >= start && time < start + 60000).length <= 6, 'at most 6 actions start in any minute');
  }
});

test('browse history keeps two weeks of instagram posts, newest last, capped', () => {
  const now = 50 * 86400000;
  const kept = normalizeBrowseHistory([['instagram:abc', now - 1000], ['instagram:old', now - 15 * 86400000], ['https://evil.example/x', now], ['instagram:bad id', now], 'junk', ['instagram:future', now + 3600000]], now);
  assert.deepEqual(kept, [['instagram:abc', now - 1000]]);
  const merged = mergeBrowseHistory([['instagram:a', now - 5000], ['instagram:b', now - 4000]], ['instagram:a', 'instagram:c', 'tiktok:x', 7], now);
  assert.deepEqual(merged, [['instagram:b', now - 4000], ['instagram:a', now], ['instagram:c', now]]);
  const many = mergeBrowseHistory([], Array.from({ length: 3500 }, (_, i) => `instagram:p${i}`), now);
  assert.equal(many.length, 3000);
  assert.equal(many.at(-1)[0], 'instagram:p3499');
  assert.deepEqual(normalizeBrowseHistory({ not: 'a list' }, now), []);
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
  const message = (request, source) => new Promise(resolve => { if (!chrome.runtime.onMessage.listeners[0](request, source, resolve)) resolve(undefined); });
  const runner = () => ({ id: 'extension-id', url: `chrome-extension://extension-id/runner.html#${saved.token}`, tab: { id: saved.runnerTabId } });
  return { message, runner, local: () => local, job: () => saved };
}

test('a finished session hands the posts it showed to the next session', async () => {
  const settings = validateSettings({ platform: 'instagram', minutes: 10, niche: 'sat test' });
  const job = { sessionId: 's1', token: 'token-1', runnerTabId: 90, tabId: 7, settings, phase: 'running', stopRequested: false, deadline: Date.now() + 60000, stats: {}, unconfirmed: {}, pausedActions: [], comments: [], activity: [], message: 'running',
    checkpoint: { seen: ['instagram:one', 'instagram:two', 'https://www.tiktok.com/@x/video/1'] } };
  const h = background(job);
  assert.deepEqual(plain((await h.message({ type: 'runner-history', token: 'token-1' }, h.runner())).data), []);
  const done = await h.message({ type: 'runner-update', token: 'token-1', patch: { phase: 'complete', message: 'time’s up. your session is complete.' } }, h.runner());
  assert.equal(done.ok, true);
  assert.deepEqual(plain(h.local().browseHistory.instagram.map(([id]) => id)), ['instagram:one', 'instagram:two']);
  assert.deepEqual(plain((await h.message({ type: 'runner-history', token: 'token-1' }, h.runner())).data), ['instagram:one', 'instagram:two']);
});

test('a history storage failure never blocks a session', async () => {
  const settings = validateSettings({ platform: 'instagram', minutes: 10, niche: 'sat test' });
  const broken = { get: async () => { throw new Error('quota'); }, set: async () => { throw new Error('quota'); } };
  const h = background({ sessionId: 's1', token: 'token-1', runnerTabId: 90, tabId: 7, settings, phase: 'running', stopRequested: false, deadline: Date.now() + 60000, stats: {}, unconfirmed: {}, pausedActions: [], comments: [], activity: [], message: 'running', checkpoint: { seen: ['instagram:one'] } }, broken);
  const history = await h.message({ type: 'runner-history', token: 'token-1' }, h.runner());
  assert.deepEqual(plain(history), { ok: true, data: [] });
  const done = await h.message({ type: 'runner-update', token: 'token-1', patch: { phase: 'complete', message: 'time’s up. your session is complete.' } }, h.runner());
  assert.equal(done.ok, true);
  assert.equal(h.job().phase, 'complete');
});
