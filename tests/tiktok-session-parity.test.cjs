const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// TikTok engine parity on the real plan, writer and session: search results that
// load behind the viewer, normalized search terms, comment blocker copy, the cap on
// comments whose text never reached the editor, and resume. Time is virtual.
const ctx = vm.createContext({ setTimeout, clearTimeout, AbortController, URL });
for (const file of ['plan.js', 'comment-writer.js', 'session.js']) {
  const filename = path.join(__dirname, '../browser-extension', file);
  vm.runInContext(fs.readFileSync(filename, 'utf8'), ctx, { filename });
}
const { runSession } = ctx.sessionEngine;
const plain = value => JSON.parse(JSON.stringify(value));
const plan = (patch = {}) => plain(ctx.sessionPlan.validateSettings({ platform: 'tiktok', niche: 'study tips', minutes: 10, enableComments: true, ...patch }));
const MATCHING = 'Study tips work best when you practice a little every day.';
const OFF_NICHE = 'golden hour in lisbon never gets old.';
const ttURL = n => `https://www.tiktok.com/@creator${n}/video/${7000000000000000000n + BigInt(n)}/`;
const serialOf = id => Number(new URL(id).pathname.match(/creator(\d+)/)[1]);

// A modelled TikTok search: each search shows gridSize result cards; the viewer walks
// them in order and more cards load behind it as it advances.
function tiktokWorld(config = {}) {
  const {
    caption = () => OFF_NICHE, gridSize = 6, grow = 6,
    gridMeta = (term, ids) => ({ term, posts: ids }),
    behindMeta = ids => ({ term: null, behindViewer: true, posts: ids }),
    postPatch = () => ({}), outcome = () => 'confirmed', random = () => .5, stopAt = Infinity, checkpoint, failOpen = () => false
  } = config;
  let time = 0, term = null, mode = 'none', index = -1, serial = 0, steps = 0;
  const feed = [];
  const controller = new AbortController();
  const updates = [], attempts = [], searches = [], checkpoints = [], viewed = [];
  const make = () => {
    const n = ++serial;
    return { id: ttURL(n), author: `@creator${n}`, text: caption(n), caption: caption(n), like: true, follow: true, comment: true, ...postPatch(n) };
  };
  const ids = () => feed.map(item => item.id);
  const adapter = {
    update: patch => updates.push({ ...plain(patch), time }),
    checkpoint: async value => { checkpoints.push({ time, value: plain(value) }); },
    search: async name => { searches.push({ term: name, time }); time += 2500; term = name; mode = 'grid'; index = -1; feed.length = 0; for (let i = 0; i < gridSize; i++) feed.push(make()); return true; },
    inspect: async () => {
      time += 150;
      if (mode === 'grid') { const search = gridMeta(term, ids()); return { post: null, posts: ids(), sequence: ids(), ...(search ? { search } : {}) }; }
      if (mode === 'viewer') {
        const item = feed[index];
        if (viewed.at(-1) !== item.id) viewed.push(item.id);
        const search = behindMeta(ids());
        return { post: { ...item, viewer: true, next: true, close: true }, posts: [], sequence: ids(), ...(search ? { search } : {}) };
      }
      return { unavailable: true };
    },
    scroll: async () => { time += 900; return false; },
    open: async id => { time += 900; if (failOpen()) return false; index = ids().indexOf(id); if (index < 0) return false; mode = 'viewer'; return true; },
    advance: async () => { time += 700; index += 1; if (index >= feed.length) for (let i = 0; i < grow; i++) feed.push(make()); return true; },
    leavePost: async () => { time += 800; mode = 'grid'; return true; },
    engage: async (action, item, comment) => {
      attempts.push({ action, id: item.id, comment, time });
      const result = outcome(action, attempts.filter(attempt => attempt.action === action).length, item);
      time += { like: 1500, follow: 2500, comment: 4000 }[action];
      return result;
    }
  };
  const options = {
    random, now: () => time, ...(checkpoint ? { checkpoint } : {}),
    sleep: async ms => { if (++steps > 200000) throw new Error('runaway'); time += Math.max(0, ms); if (time >= stopAt) controller.abort(); }
  };
  return { adapter, options, controller, updates, attempts, searches, checkpoints, viewed, time: () => time,
    run: settings => runSession(settings, adapter, controller.signal, options) };
}
const engaged = h => h.attempts.filter(attempt => ['like', 'follow', 'comment'].includes(attempt.action));
const messages = h => h.updates.filter(update => typeof update.message === 'string').map(update => ({ ...update, message: update.message }));

test('tiktok posts that load behind the search viewer count as search results once this query’s grid was seen', async () => {
  const h = tiktokWorld();
  const stats = await h.run(plan({ customLimits: { comment: 0 } }));
  assert.ok(stats.like > 0 && stats.follow > 0);
  assert.ok(engaged(h).some(attempt => serialOf(attempt.id) > 6), 'a post loaded behind the viewer was liked or followed');
  assert.ok(h.viewed.some(id => serialOf(id) > 12));
  const gridOnly = tiktokWorld({ behindMeta: () => undefined });
  const before = await gridOnly.run(plan({ customLimits: { comment: 0 } }));
  assert.ok(engaged(gridOnly).every(attempt => serialOf(attempt.id) <= 6), 'without the behind-viewer list only the first grid counts');
  assert.ok(stats.like > before.like, `likes ${stats.like} > ${before.like}`);
});

test('the grid behind the tiktok viewer grants nothing unless this run first saw that query’s own grid', async () => {
  for (const [name, gridMeta] of [
    ['no grid metadata', () => undefined],
    ['another query', (term, ids) => ({ term: 'other query', posts: ids })],
    ['a grid only reported behind a viewer', (term, ids) => ({ term: null, behindViewer: true, posts: ids })]
  ]) {
    const h = tiktokWorld({ gridMeta });
    const stats = await h.run(plan());
    assert.equal(engaged(h).length, 0, name);
    assert.equal(stats.like + stats.follow + stats.comment, 0, name);
    assert.ok(messages(h).some(update => update.message.includes('this post does not match your keywords or current search results.')), name);
  }
  // The grid was seen, then a read showed neither a post nor search results (for
  // example a covering prompt). Ownership is dropped until the grid is seen again.
  let reads = 0, opens = 0;
  const interrupted = tiktokWorld({ gridMeta: (term, ids) => ++reads === 1 ? { term, posts: ids } : undefined, failOpen: () => ++opens === 1 });
  const stats = await interrupted.run(plan({ customLimits: { comment: 0 } }));
  assert.ok(stats.like > 0, 'the grid seen first stays eligible');
  assert.ok(engaged(interrupted).every(attempt => serialOf(attempt.id) <= 6), 'cards behind the viewer are not counted after ownership lapsed');
});

test('tiktok search terms match across case, spacing and unicode form', async () => {
  for (const reported of ['STUDY TIPS', '  study   tips ', 'ｓｔｕｄｙ ｔｉｐｓ', 'Study\xa0Tips']) {
    const h = tiktokWorld({ gridMeta: (term, ids) => ({ term: reported, posts: ids }), behindMeta: () => undefined });
    const stats = await h.run(plan({ customLimits: { comment: 0 } }));
    assert.ok(stats.like > 0, reported);
  }
  for (const reported of ['study tip', 'study tips extra', 'studytips']) {
    const h = tiktokWorld({ gridMeta: (term, ids) => ({ term: reported, posts: ids }), behindMeta: () => undefined });
    await h.run(plan({ customLimits: { comment: 0 } }));
    assert.equal(engaged(h).length, 0, reported);
  }
});

test('a failed open costs the same short transition pause on instagram and tiktok', async () => {
  const gaps = {};
  for (const platform of ['instagram', 'tiktok']) {
    const opens = [];
    const h = tiktokWorld({ failOpen: () => opens.push(h.time() - 900) === 1 });
    await h.run(plan({ platform, minutes: 2, customLimits: { like: 0, follow: 0, comment: 0 } }));
    assert.ok(opens.length >= 2, platform);
    // open (900 ms) + the pause + the next page read (150 ms)
    gaps[platform] = opens[1] - opens[0] - 900 - 150;
  }
  assert.equal(gaps.tiktok, gaps.instagram);
  assert.ok(gaps.tiktok >= 500 && gaps.tiktok <= 1800, `pause ${gaps.tiktok} ms`);
});

test('search membership never grants a tiktok comment', async () => {
  const h = tiktokWorld();
  const stats = await h.run(plan());
  assert.ok(stats.like > 0);
  assert.equal(h.attempts.filter(attempt => attempt.action === 'comment').length, 0);
  assert.ok(messages(h).some(update => update.message.includes("comment skipped: this post doesn't mention your keywords.")));
});

test('the tiktok account blocker names tiktok and is reported once per session; the composer one repeats every three minutes', async () => {
  const account = "couldn't find your tiktok account link, so comments are skipped.";
  const composer = "couldn't find one clear comment box on this post.";
  const missing = tiktokWorld({ caption: () => MATCHING, postPatch: () => ({ comment: false, commentBlocker: 'account' }) });
  const stats = await missing.run(plan({ minutes: 20 }));
  assert.equal(messages(missing).filter(update => update.message.includes(account)).length, 1);
  assert.equal(messages(missing).some(update => /instagram/.test(update.message)), false);
  assert.equal(stats.comment, 0);
  assert.ok(stats.like > 0);
  const unclear = tiktokWorld({ caption: () => MATCHING, postPatch: () => ({ comment: false, commentBlocker: 'composer' }) });
  await unclear.run(plan({ minutes: 20 }));
  const times = messages(unclear).filter(update => update.message.includes(composer)).map(update => update.time);
  assert.ok(times.length >= 2, `composer reported ${times.length} times`);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 180000);
  const unknown = tiktokWorld({ caption: () => MATCHING, postPatch: () => ({ comment: false, commentBlocker: 'language' }) });
  await unknown.run(plan());
  assert.ok(messages(unknown).some(update => update.message.includes('comment skipped: its control is not available on this post.')), 'tiktok has no language blocker copy');
});

test('the instagram comment blocker copy and its once-per-session set are unchanged', () => {
  assert.deepEqual(plain(vm.runInContext('COMMENT_BLOCKER_COPY', ctx)), {
    account: "couldn't find your instagram account link, so comments are skipped.",
    language: "instagram isn't in english, so the comment box can't be found. switch instagram to english for comments.",
    composer: "couldn't find one clear comment box on this post."
  });
  assert.deepEqual([...vm.runInContext('ONCE_PER_SESSION_REASONS', ctx)], [
    "couldn't find your instagram account link, so comments are skipped.",
    "instagram isn't in english, so the comment box can't be found. switch instagram to english for comments.",
    'comments are unavailable in this version. reinstall the extension from the setup page.'
  ]);
});

const commentPlan = () => plan({ minutes: 30, customLimits: { like: 0, follow: 0, comment: 8 } });
const commentResults = results => (action, count) => action === 'comment' ? results[count - 1] || 'confirmed' : 'confirmed';

test('a comment whose text never reached the tiktok editor is reported, and a second in a row turns comments off', async () => {
  const h = tiktokWorld({ caption: () => MATCHING, outcome: commentResults(['not-typed', 'not-typed']) });
  const stats = await h.run(commentPlan());
  const attempts = h.attempts.filter(attempt => attempt.action === 'comment');
  assert.equal(attempts.length, 2);
  const skips = messages(h).filter(update => /^comment skipped for/.test(update.message));
  assert.match(skips[0].message, /the comment box stayed empty after typing\. continuing warm-up\.$/);
  assert.match(skips[1].message, /the comment box stayed empty after typing again, so comments are off for this session\. continuing warm-up\.$/);
  assert.equal(stats.comment, 0);
  assert.equal(stats.skipped >= 2, true);
  const last = h.updates.at(-1);
  assert.deepEqual(last.pausedActions, ['comment']);
  assert.deepEqual(last.unconfirmed, { like: 0, follow: 0, comment: 0 });
  assert.deepEqual(last.comments, [], 'nothing was posted, so nothing is recorded');
  const final = h.checkpoints.at(-1).value;
  assert.deepEqual(final.pausedActions, ['comment'], 'the pause survives a resume');
  for (const attempt of attempts) assert.equal(final.usedComments.includes(ctx.commentWriter.commentKey(attempt.comment)), false, 'untyped wording is released');
});

test('a typed tiktok comment resets the untyped count, and other skips neither count nor reset it', async () => {
  const typedBetween = tiktokWorld({ caption: () => MATCHING, outcome: commentResults(['not-typed', 'confirmed', 'not-typed', 'uncertain', 'not-typed', 'confirmed']) });
  const stats = await typedBetween.run(commentPlan());
  assert.ok(typedBetween.attempts.filter(attempt => attempt.action === 'comment').length >= 7);
  assert.deepEqual(typedBetween.updates.at(-1).pausedActions, []);
  assert.ok(stats.comment >= 3);
  const skippedBetween = tiktokWorld({ caption: () => MATCHING, outcome: commentResults(['not-typed', 'skipped', 'not-typed']) });
  await skippedBetween.run(commentPlan());
  assert.equal(skippedBetween.attempts.filter(attempt => attempt.action === 'comment').length, 3);
  assert.deepEqual(skippedBetween.updates.at(-1).pausedActions, ['comment']);
});

test('tiktok comments never use the emoji reply', async () => {
  const practice = 'Daily practice for study tips: a little every day adds up.';
  const tiktok = tiktokWorld({ caption: () => practice });
  await tiktok.run(plan({ minutes: 60, customLimits: { like: 0, follow: 0, comment: 20 } }));
  const texts = tiktok.attempts.filter(attempt => attempt.action === 'comment').map(attempt => attempt.comment);
  assert.ok(texts.length >= 10, `comments: ${texts.length}`);
  assert.ok(texts.every(text => /^[\x20-\x7e]+$/.test(text)), texts.join(' | '));
  assert.ok(texts.some(text => ctx.commentWriter.pools.topics.practice.includes(text)), 'the practice replies are still used');
  assert.equal(new Set(texts).size, texts.length, 'no repeated wording');
});

test('a resumed tiktok session searches its saved keyword first, rebuilds membership and never replays an in-flight like', async () => {
  const inFlightPost = ttURL(900);
  const checkpoint = {
    version: 1,
    stats: { scroll: 3, read: 0, search: 1, open: 1, like: 2, follow: 0, comment: 0, skipped: 0 },
    unconfirmed: { like: 0, follow: 0, comment: 0 }, pausedActions: [], comments: [], seen: [],
    done: { like: [`https://www.tiktok.com/@creator900/video/7000000000000000900`], follow: [], comment: [] }, usedComments: [],
    termIndex: 1, currentSearchTerm: 'study tips', elapsedMs: 120000, remainingMs: 480000,
    cooldowns: { like: 0, follow: 0, comment: 0, engagement: 0, break: 400000 },
    inFlight: { action: 'like', key: 'https://www.tiktok.com/@creator900/video/7000000000000000900', comment: null, post: { id: inFlightPost, author: '@creator900' }, time: 110000 }
  };
  const h = tiktokWorld({ checkpoint, postPatch: n => n === 3 ? { id: inFlightPost, author: '@creator900' } : {} });
  const stats = await h.run(plan({ customLimits: { comment: 0 } }));
  assert.equal(h.searches[0].term, 'study tips');
  assert.equal(h.searches[0].time, 0, 'the saved keyword is searched before anything else');
  assert.ok(stats.like > 2, 'off-niche results from the resumed search are eligible again');
  assert.equal(h.attempts.some(attempt => attempt.id === inFlightPost && attempt.action === 'like'), false, 'the in-flight like is never replayed');
  const settled = h.checkpoints[0].value;
  assert.equal(settled.inFlight, null);
  assert.equal(settled.unconfirmed.like, 1);
});
