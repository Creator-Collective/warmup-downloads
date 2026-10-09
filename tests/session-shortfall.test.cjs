const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeCheckpoint } = require('../browser-extension/guards.js');

// Why targets fell short, on the real engine with virtual time: each post counts
// once per action under its first blocking reason, the line appears only when
// time runs out, and the counts survive stop and resume.
const ctx = vm.createContext({ setTimeout, clearTimeout, AbortController, URL });
for (const file of ['plan.js', 'comment-writer.js', 'session.js']) {
  const filename = path.join(__dirname, '../browser-extension', file);
  vm.runInContext(fs.readFileSync(filename, 'utf8'), ctx, { filename });
}
const { runSession } = vm.runInContext('({ runSession })', ctx);
const plain = value => JSON.parse(JSON.stringify(value));
const plan = (patch = {}) => plain(ctx.sessionPlan.validateSettings({ niche: 'study tips', minutes: 10, enableComments: true, ...patch }));
const igURL = code => `https://www.instagram.com/p/${code}/`;
const MATCHING = 'Study tips work best when you practice a little every day.';
const OFF_NICHE = 'golden hour in lisbon never gets old.';
const SUMMARY = /^why targets fell short: /;

// A keyword grid with a post viewer, as in the goals tests. Every post gets its
// own author unless the post function names one.
function world({ post = () => ({}), sticky = false, stopAt = Infinity, abortAtDeadline = false, checkpoint, start = 0, gridTerm = 'study tips' } = {}) {
  let time = start, mode = 'none', loaded = 0, index = -1, steps = 0, term = null;
  const controller = new AbortController();
  const items = [], updates = [], attempts = [], checkpoints = [];
  const itemAt = i => {
    while (items.length <= i) {
      const n = items.length;
      items.push({ id: igURL(`${term}${n}`), author: `/author_${n}/`, text: MATCHING, caption: MATCHING, like: true, follow: true, comment: true, ...post(n) });
    }
    return items[i];
  };
  const gridIds = () => Array.from({ length: loaded }, (_, i) => itemAt(i).id);
  let deadline = Infinity;
  const adapter = {
    update: patch => { updates.push({ ...plain(patch), time }); if (Number.isFinite(patch.deadline)) deadline = patch.deadline; },
    checkpoint: async value => { checkpoints.push(plain(value)); },
    search: async name => { time += 2500; term = name.replace(/\W/g, ''); mode = 'grid'; loaded = 24; index = -1; return true; },
    inspect: async () => {
      time += 150;
      if (mode === 'grid') { const ids = gridIds(); return { post: null, posts: ids, sequence: ids, search: { term: gridTerm, posts: ids } }; }
      const item = itemAt(index);
      return { post: { ...item, viewer: true, next: true, videoPlayback: null, videoRemainingMs: null }, posts: [], sequence: gridIds(), search: { term: null, behindViewer: true, posts: gridIds() } };
    },
    scroll: async () => { time += 900; loaded += 12; return true; },
    open: async id => { time += 900; const i = gridIds().indexOf(id); if (i < 0) return false; mode = 'viewer'; index = i; return true; },
    advance: async () => { time += 700; if (!sticky) { index += 1; if (index >= loaded) loaded += 12; } return true; },
    leavePost: async () => { time += 800; mode = 'grid'; return true; },
    engage: async (action, item, comment) => {
      attempts.push({ action, id: item.id, author: item.author, comment, time });
      time += { like: 1500, follow: 2500, comment: 4000 }[action];
      if (action === 'follow') for (const other of items) if (other.author === item.author) other.follow = false;
      if (action === 'like') itemAt(index).like = false;
      return 'confirmed';
    }
  };
  const options = {
    random: () => .5, now: () => time, ...(checkpoint ? { checkpoint } : {}),
    sleep: async (ms, signal) => {
      if (++steps > 200000) throw new Error('runaway');
      time += Math.max(0, ms);
      if (time >= stopAt) controller.abort(new Error('session stopped. you have control.'));
      // The runner's timer ends the last pause at the deadline instead of the engine.
      if (abortAtDeadline && time >= deadline) controller.abort(new Error('time’s up. your session is complete.'));
      signal?.throwIfAborted();
    }
  };
  return {
    updates, attempts, checkpoints, controller, time: () => time,
    summaries: () => updates.map(update => update.message).filter(message => SUMMARY.test(message || '')),
    run: settings => runSession(settings, adapter, controller.signal, options)
  };
}

test('posts with no follow button explain a follow shortfall and suggest new keywords', async () => {
  const h = world({ post: () => ({ follow: false }) });
  const stats = await h.run(plan({ customLimits: { like: 0, follow: 5, comment: 0 } }));
  assert.equal(stats.follow, 0);
  const [summary, ...rest] = h.summaries();
  assert.equal(rest.length, 0);
  assert.match(summary, /^why targets fell short: follows 0\/5: \d+ posts had no follow button, usually because you already follow the account\. different keywords reach new accounts\.$/);
  const counted = Number(summary.match(/: (\d+) posts had/)[1]);
  const viewed = new Set(h.checkpoints.at(-1).seen).size;
  assert.ok(counted > 1 && counted <= viewed, `counted ${counted} of ${viewed} viewed posts`);
  const last = h.updates.at(-1).message;
  assert.equal(last, 'time’s up. your session is complete.', 'the summary comes just before the final line');
});

test('each post counts once per action however often it is inspected', async () => {
  const h = world({ sticky: true, post: () => ({ follow: false, like: false }) });
  await h.run(plan({ customLimits: { like: 5, follow: 5, comment: 0 } }));
  const [summary] = h.summaries();
  assert.match(summary, /follows 0\/5: 1 post had no follow button/);
  assert.match(summary, /likes 0\/5: 1 post was already liked or had no like button/);
  assert.deepEqual(h.checkpoints.at(-1).shortfall.follow, { control: 1, repeat: 0, 'off-niche': 0 });
});

test('more posts from an account already followed count as repeats', async () => {
  const h = world({ post: n => ({ author: `/author_${n % 2}/` }) });
  const stats = await h.run(plan({ customLimits: { like: 0, follow: 5, comment: 0 } }));
  assert.equal(stats.follow, 2, 'only two accounts exist');
  const [summary] = h.summaries();
  assert.match(summary, /^why targets fell short: follows 2\/5: \d+ posts were from accounts already followed this session\. different keywords reach new accounts\.$/);
  assert.ok(h.checkpoints.at(-1).shortfall.follow.repeat > 1);
});

test('search posts without a keyword in the caption still get likes, follows and comments', async () => {
  const h = world({ post: () => ({ text: OFF_NICHE, caption: OFF_NICHE }) });
  const stats = await h.run(plan({ customLimits: { like: 3, follow: 2, comment: 3 } }));
  assert.deepEqual([stats.like, stats.follow, stats.comment], [3, 2, 3]);
  assert.deepEqual(h.summaries(), []);
});

test('posts outside the search that never name a keyword explain every shortfall', async () => {
  const h = world({ gridTerm: 'another search', post: () => ({ text: OFF_NICHE, caption: OFF_NICHE }) });
  const stats = await h.run(plan({ customLimits: { like: 3, follow: 2, comment: 3 } }));
  assert.deepEqual([stats.like, stats.follow, stats.comment], [0, 0, 0]);
  const [summary] = h.summaries();
  assert.match(summary, /^why targets fell short: follows 0\/2: \d+ posts weren't from your search and didn't mention your keywords\. likes 0\/3: \d+ posts weren't from your search and didn't mention your keywords\. comments 0\/3: \d+ posts weren't from your search and didn't mention your keywords\.$/);
});

test('no summary when every target is reached', async () => {
  const h = world();
  const stats = await h.run(plan({ customLimits: { like: 3, follow: 2, comment: 1 } }));
  assert.deepEqual([stats.like, stats.follow, stats.comment], [3, 2, 1]);
  assert.deepEqual(h.summaries(), []);
});

test('the summary still appears when the runner timer ends the final pause', async () => {
  const h = world({ abortAtDeadline: true, post: () => ({ follow: false }) });
  await assert.rejects(h.run(plan({ customLimits: { like: 0, follow: 5, comment: 0 } })), /time’s up/);
  assert.equal(h.summaries().length, 1);
  assert.match(h.summaries()[0], /follows 0\/5: \d+ posts had no follow button/);
});

test('stopping early shows no summary, and a resumed session keeps the earlier counts', async () => {
  const settings = plan({ customLimits: { like: 0, follow: 5, comment: 0 } });
  const first = world({ stopAt: 240000, post: () => ({ follow: false }) });
  await assert.rejects(first.run(settings), /session stopped/);
  assert.deepEqual(first.summaries(), [], 'a stop before time runs out has no summary');
  const saved = normalizeCheckpoint(first.checkpoints.at(-1), settings);
  assert.ok(saved);
  const before = saved.shortfall.follow.control;
  assert.ok(before > 0);
  assert.equal(saved.assessed.length, before);

  const second = world({ checkpoint: saved, start: 900000, post: () => ({ follow: false }) });
  await second.run(settings);
  const after = Number(second.summaries()[0].match(/: (\d+) posts had no follow button/)[1]);
  assert.ok(after > before, `${after} > ${before}`);
  assert.equal(second.checkpoints.at(-1).shortfall.follow.control, after);
});

test('checkpoints keep valid shortfall counts and drop invalid ones without blocking resume', () => {
  const settings = plan({ customLimits: { like: 2, follow: 2, comment: 1 } });
  const base = {
    version: 1, stats: { scroll: 0, read: 0, search: 1, open: 0, like: 0, follow: 0, comment: 0, skipped: 0 },
    unconfirmed: { like: 0, follow: 0, comment: 0 }, pausedActions: [], comments: [], seen: [],
    done: { like: [], follow: [], comment: [] }, usedComments: [], termIndex: 1, currentSearchTerm: null,
    elapsedMs: 60000, remainingMs: 540000, cooldowns: { like: 0, follow: 0, comment: 0, engagement: 0, break: 400000 }, inFlight: null
  };
  const shortfall = { like: { control: 2, 'off-niche': 0 }, follow: { control: 1, repeat: 3, 'off-niche': 0 }, comment: { 'off-niche': 4 } };
  const assessed = ['like instagram:a', 'follow instagram:a'];
  const kept = normalizeCheckpoint({ ...base, shortfall, assessed }, settings);
  assert.deepEqual(kept.shortfall, shortfall);
  assert.deepEqual(kept.assessed, assessed);
  assert.equal(Object.hasOwn(normalizeCheckpoint(base, settings), 'shortfall'), false, 'older checkpoints still resume');
  for (const change of [
    { shortfall: { ...shortfall, follow: { control: -1 } } },
    { shortfall: { ...shortfall, like: { control: 1.5 } } },
    { shortfall: { ...shortfall, comment: { 'Not A Reason!': 1 } } },
    { shortfall: { like: shortfall.like, follow: shortfall.follow } },
    { shortfall: 'many' },
    { assessed: 'like instagram:a' },
    { assessed: [''] }
  ]) {
    const normalized = normalizeCheckpoint({ ...base, shortfall, assessed, ...change }, settings);
    assert.ok(normalized, JSON.stringify(change));
    assert.equal(Object.hasOwn(normalized, 'shortfall'), false, JSON.stringify(change));
    assert.equal(Object.hasOwn(normalized, 'assessed'), false, JSON.stringify(change));
  }
});
