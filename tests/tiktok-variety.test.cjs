const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeBrowseHistory, mergeBrowseHistory, normalizeCommentedPosts, mergeCommentedPosts } = require('../browser-extension/guards.js');

// TikTok browsing variety and the no-second-comment rule on the real engine, as
// session-variety and comment-repeat pin them for instagram. A TikTok post is kept
// in browsing and comment history by its canonical address without the trailing slash.
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
const seeded = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const code = (term, index) => `${term.replace(/\W/g, '')}${index}`;
const ttURL = (term, index) => `https://www.tiktok.com/@author_${code(term, index)}/video/${term.length}${String(index).padStart(6, '0')}/`;
const postKey = url => url.replace(/\/$/, '');

// A modelled TikTok keyword grid with a viewer that pages through it in order. Only
// one screen of cards is visible; closing the viewer returns to the opened card.
function world({ post = () => ({}), gridSize = 24, grow = 12, screen = 12, random = seeded(7) } = {}) {
  let time = 0, term = null, mode = 'none', loaded = 0, index = -1, steps = 0, top = 0;
  const controller = new AbortController();
  const feeds = new Map();
  const attempts = [], searches = [], opens = [], viewed = [], moves = [], updates = [], checkpoints = [];
  const itemAt = i => {
    if (!feeds.has(term)) feeds.set(term, []);
    const list = feeds.get(term);
    while (list.length <= i) {
      const n = list.length;
      list.push({ id: ttURL(term, n), author: `@author_${code(term, n)}`, text: 'sat test prep tips', caption: 'sat test prep tips', like: true, follow: true, comment: false, index: n, ...post(term, n) });
    }
    return list[i];
  };
  const gridIds = () => Array.from({ length: loaded }, (_, i) => itemAt(i).id);
  const adapter = {
    update: patch => updates.push({ ...plain(patch), time }),
    checkpoint: async value => { checkpoints.push(plain(value)); },
    search: async name => { searches.push(name); time += 2500; term = name; mode = 'grid'; loaded = gridSize; index = -1; top = 0; return true; },
    inspect: async () => {
      time += 150;
      if (mode === 'grid') { const ids = gridIds(); return { post: null, posts: ids.slice(top, top + screen), sequence: ids, search: { term, posts: ids } }; }
      if (mode === 'viewer') {
        const item = itemAt(index);
        if (viewed.at(-1)?.id !== item.id) viewed.push({ id: item.id, index: item.index, term, time });
        const { index: unused, ...shown } = item;
        return { post: { ...shown, viewer: true, next: true, close: true }, posts: [], sequence: gridIds(), search: { term: null, behindViewer: true, posts: gridIds() } };
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
    engage: async (action, item, comment) => {
      attempts.push({ action, id: item.id, comment, time });
      const target = feeds.get(term)?.find(entry => entry.id === item.id);
      if (target && action === 'like') target.like = false;
      time += { like: 1500, follow: 2500, comment: 4000 }[action];
      return 'confirmed';
    }
  };
  const options = { random, commentSalt: 'salt', now: () => time, sleep: async ms => { if (++steps > 200000) throw new Error('runaway'); time += Math.max(0, ms); } };
  return {
    attempts, searches, opens, viewed, moves, updates, checkpoints, time: () => time,
    commented: () => attempts.filter(attempt => attempt.action === 'comment').map(attempt => attempt.id),
    run: (settings, extra = {}) => runSession(settings, adapter, controller.signal, { ...options, ...extra })
  };
}
const plan = (patch = {}) => plain(ctx.sessionPlan.validateSettings({ platform: 'tiktok', niche: 'sat test, sat test prep', minutes: 20, enableComments: false, customLimits: { like: 45, follow: 10 }, ...patch }));
const usedUpHistory = (usedUp, terms = ['sat test', 'sat test prep']) => terms.flatMap(term => Array.from({ length: usedUp }, (_, i) => postKey(ttURL(term, i))));

test('without browsing variety a tiktok session still walks its results from the top', async () => {
  const h = world();
  await h.run(plan());
  assert.equal(h.searches[0], 'sat test');
  assert.equal(h.opens[0].index, 0);
  assert.equal(h.moves.includes('leave'), false, 'pages straight through with next');
});

test('different tiktok sessions start on different keywords and different posts', async () => {
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

test('a tiktok session pages through a few posts, then leaves the viewer to jump further down the results', async () => {
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
  assert.ok(deepest > 24, `deepest opened card: ${deepest}`);
});

test('a tiktok session opens cards earlier sessions did not show while fresh ones are in reach', async () => {
  const history = usedUpHistory(6);
  const early = [];
  for (let seed = 1; seed <= 12; seed++) {
    const h = world();
    await h.run(plan(), { browseRandom: seeded(seed * 31), history });
    assert.deepEqual(h.opens.filter(open => history.includes(postKey(open.id))), [], `seed ${seed}`);
    const unguarded = world();
    await unguarded.run(plan(), { browseRandom: seeded(seed * 31) });
    early.push(unguarded.opens[0].index);
  }
  assert.ok(early.some(index => index < 6), `without history the first card can be one of the top six: ${early}`);
});

test('repeat tiktok keywords reach new accounts past the posts earlier sessions used up', async () => {
  const usedUp = 60;
  const post = (term, index) => index < usedUp ? { like: false, follow: false } : {};
  const history = usedUpHistory(usedUp);
  const before = await world({ post }).run(plan());
  const results = [];
  for (let seed = 1; seed <= 6; seed++) {
    const h = world({ post });
    const stats = await h.run(plan(), { browseRandom: seeded(seed * 17), history });
    results.push(stats.follow);
    assert.ok(h.attempts.every(attempt => !history.includes(postKey(attempt.id))), 'no attempt on a used-up post');
  }
  assert.ok(before.follow <= 3, `top-down baseline follows: ${before.follow}`);
  assert.ok(Math.min(...results) >= 9, `follows with variety: ${results}`);
});

test('tiktok posts with nothing left to do get a quick look instead of a full watch', async () => {
  const post = () => ({ like: false, follow: false });
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

const MATCHING = 'Study tips work best when you practice a little every day.';
const commentPlan = (patch = {}) => plan({ niche: 'study tips', enableComments: true, customLimits: { like: 0, follow: 0, comment: 8 }, ...patch });
const commentWorld = (patch = () => ({})) => world({ random: () => .5, post: (term, index) => ({ text: MATCHING, caption: MATCHING, like: false, follow: false, comment: true, ...patch(index) }) });

test('a second tiktok session never comments on a post the first one commented on', async () => {
  const first = commentWorld();
  const stats = await first.run(commentPlan());
  assert.ok(stats.comment >= 4, `first session comments: ${stats.comment}`);
  const saved = first.checkpoints.at(-1).done.comment;
  assert.deepEqual([...saved].sort(), first.commented().map(postKey).sort(), 'every commented post is in the saved history');
  assert.deepEqual(mergeCommentedPosts([], saved).map(([id]) => id), saved, 'the device keeps every key the engine saved');
  const unguarded = commentWorld();
  await unguarded.run(commentPlan());
  assert.ok(unguarded.commented().some(id => first.commented().includes(id)), 'same results reach the same posts');
  for (const extra of [{}, { browseRandom: seeded(5) }]) {
    const second = commentWorld();
    const again = await second.run(commentPlan(), { commented: saved, ...extra });
    assert.ok(again.comment >= 4, `second session still comments: ${again.comment}`);
    assert.deepEqual(second.commented().filter(id => first.commented().includes(id)), [], 'no post commented on twice');
  }
});

test('a tiktok post whose page shows your comment is skipped, and the summary says so', async () => {
  const h = commentWorld(index => index % 2 === 0 ? { commented: true } : {});
  const stats = await h.run(commentPlan());
  assert.ok(stats.comment > 0);
  assert.ok(h.commented().every(id => Number(id.match(/studytips(\d+)\//)[1]) % 2 === 1), `commented: ${h.commented()}`);
  const all = commentWorld(() => ({ commented: true }));
  const none = await all.run(commentPlan({ minutes: 10 }));
  assert.equal(none.comment, 0);
  assert.equal(all.attempts.length, 0);
  const summary = all.updates.map(update => update.message).find(message => message?.startsWith('why targets fell short'));
  assert.match(summary, /comments 0\/8: \d+ posts already had your comment/);
});

test('browse and comment history keep tiktok post keys and drop malformed ones', async () => {
  const day = 86400000, now = 400 * day;
  const good = ['https://www.tiktok.com/@creator/video/7300000000000000001', 'https://www.tiktok.com/@some.one_2/photo/12', 'https://www.tiktok.com/@a-b/video/3'];
  const bad = ['https://www.tiktok.com/@creator/video/7300000000000000001/', 'https://tiktok.com/@creator/video/1', 'http://www.tiktok.com/@creator/video/1',
    'https://www.tiktok.com/@creator/video/1?lang=en', 'https://www.tiktok.com/@creator/video/1#top', 'https://www.tiktok.com.evil.example/@creator/video/1',
    'https://evil.example/@creator/video/1', 'https://www.tiktok.com/@creator/live/1', 'https://www.tiktok.com/@creator/video/abc', 'https://www.tiktok.com/creator/video/1',
    'https://www.tiktok.com/@creator/video/1/extra', `https://www.tiktok.com/@${'a'.repeat(41)}/video/1`, 'tiktok:creator:video:1', 'TikTok', 7, null];
  const entries = [...good, ...bad].map(id => [id, now - day]);
  assert.deepEqual(normalizeBrowseHistory(entries, now).map(([id]) => id), good);
  assert.deepEqual(normalizeCommentedPosts(entries, now).map(([id]) => id), good);
  assert.deepEqual(normalizeBrowseHistory([[good[0], now - 15 * day], [good[1], now - day]], now).map(([id]) => id), [good[1]], 'browsing is kept two weeks');
  assert.deepEqual(normalizeCommentedPosts([[good[0], now - 170 * day], [good[1], now - 181 * day]], now).map(([id]) => id), [good[0]], 'comments are kept six months');
  assert.deepEqual(mergeBrowseHistory([[good[0], now - 5000], ['instagram:a', now - 4000]], [good[0], ...bad, good[1]], now), [['instagram:a', now - 4000], [good[0], now], [good[1], now]]);
  assert.deepEqual(mergeCommentedPosts([[good[0], now - 5 * day]], [good[0], ...bad, good[2]], now), [[good[0], now - 5 * day], [good[2], now]]);
  const h = world();
  await h.run(plan({ minutes: 5 }), { browseRandom: seeded(9) });
  const seen = h.checkpoints.at(-1).seen;
  assert.ok(seen.length > 10);
  assert.deepEqual(mergeBrowseHistory([], seen, now).map(([id]) => id), seen, 'every post the engine saw is kept');
});
