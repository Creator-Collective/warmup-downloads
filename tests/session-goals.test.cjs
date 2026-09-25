const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Goal pacing rules on the real engine: search membership, same-post actions, the
// burst cap, watch and rotation pacing, revisit grace, the draft lift, skip copy
// throttling and comment reservations. Time is virtual throughout.
function engine(files = ['plan.js', 'comment-writer.js', 'session.js']) {
  const context = vm.createContext({ setTimeout, clearTimeout, AbortController, URL });
  for (const file of files) {
    const filename = path.join(__dirname, '../browser-extension', file);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  }
  return context;
}
const ctx = engine();
const { runSession, actionSpacing, expectedActions, postIdentity } = vm.runInContext('({ runSession, actionSpacing, expectedActions, postIdentity })', ctx);
const { commentWriter } = ctx;
const plain = value => JSON.parse(JSON.stringify(value));
const plan = (patch = {}, context = ctx) => plain(context.sessionPlan.validateSettings({ niche: 'study tips', minutes: 10, enableComments: true, ...patch }));
const seeded = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const igURL = code => `https://www.instagram.com/p/${code}/`;
const MATCHING = 'Study tips work best when you practice a little every day.';
const OFF_NICHE = 'golden hour in lisbon never gets old.';
const messages = h => h.updates.filter(update => typeof update.message === 'string');
const engaged = h => h.attempts.filter(attempt => ['like', 'follow', 'comment'].includes(attempt.action));

function harness(overrides = {}) {
  let time = 0;
  let index = 0;
  const calls = [];
  const updates = [];
  const controller = new AbortController();
  const adapter = {
    update: patch => updates.push(patch),
    search: async term => calls.push(['search', term]),
    inspect: async () => ({ post: { id: `post-${index++}`, author: 'author-1', text: 'study tips', caption: MATCHING, like: true, follow: true, comment: true } }),
    open: async url => calls.push(['open', url]),
    leavePost: async () => {},
    scroll: async () => { calls.push(['scroll']); return true; },
    engage: async (action, post, comment) => { calls.push([action, post.id, comment]); return 'confirmed'; },
    ...overrides
  };
  const options = { random: () => 0.999, now: () => time, sleep: async ms => { time += ms; } };
  return { adapter, options, calls, updates, controller, time: () => time };
}

// A modelled instagram keyword grid with a post viewer. Each feed is one query's
// grid; the viewer walks the feed in order, including tiles the grid did not list.
function world(config = {}) {
  const {
    post = (term, index) => ({ id: igURL(`${term.replace(/\W/g, '')}${index}`), text: 'study tips', caption: MATCHING }),
    listed = () => true, gridSize = 24, grow = 12, scrollMs = 900,
    gridMeta = (term, ids) => ({ term, posts: ids }),
    viewerMeta = (term, ids) => ({ term: null, behindViewer: true, posts: ids }),
    outcome = () => 'confirmed', draftState = null, random = () => .5, stopAt = Infinity, checkpoint, sticky = false
  } = config;
  let time = 0, term = null, mode = 'none', loaded = 0, index = -1, openedAt = 0, steps = 0;
  const controller = new AbortController();
  const feeds = new Map();
  const updates = [], attempts = [], searches = [], checkpoints = [], drafts = [], viewed = [];
  const itemAt = i => {
    if (!feeds.has(term)) feeds.set(term, []);
    const list = feeds.get(term);
    while (list.length <= i) {
      const n = list.length;
      list.push({ author: `/author_${term.replace(/\W/g, '')}_${n}/`, like: true, follow: true, comment: true, ...post(term, n) });
    }
    return list[i];
  };
  const gridIds = () => Array.from({ length: loaded }, (_, i) => itemAt(i)).filter((item, i) => listed(item, term, i)).map(item => item.id);
  const video = item => {
    if (!item.videoMs) return { videoPlayback: null, videoRemainingMs: null };
    const position = Math.min(item.videoMs, time - openedAt);
    const playing = position < item.videoMs;
    return { videoPlayback: { positionMs: position, durationMs: item.videoMs, rate: 1, playing, ended: !playing, source: item.id }, videoRemainingMs: playing ? item.videoMs - position : null };
  };
  const view = item => ({
    id: item.id, author: item.author, text: item.text, caption: item.caption, viewer: true, next: true,
    like: item.like, follow: item.follow, comment: item.comment, ...(item.commentBlocker ? { commentBlocker: item.commentBlocker } : {}), ...video(item)
  });
  const current = () => mode === 'viewer' ? itemAt(index) : null;
  const adapter = {
    update: patch => updates.push({ ...plain(patch), time, viewing: current()?.id ?? null }),
    checkpoint: async value => { checkpoints.push({ time, value: plain(value) }); },
    search: async name => { searches.push({ term: name, time }); time += 2500; term = name; mode = 'grid'; loaded = gridSize; index = -1; return true; },
    inspect: async () => {
      time += 150;
      if (mode === 'grid') {
        const ids = gridIds();
        const search = gridMeta(term, ids);
        return { post: null, posts: ids, sequence: ids, ...(search ? { search } : {}) };
      }
      if (mode === 'viewer') {
        const item = current();
        if (viewed.at(-1) !== item.id) viewed.push(item.id);
        const search = viewerMeta(term, gridIds(), item);
        return { post: view(item), posts: [], sequence: gridIds(), ...(search ? { search } : {}) };
      }
      return { unavailable: true };
    },
    scroll: async () => { time += scrollMs; loaded += grow; return true; },
    open: async id => {
      time += 900;
      const i = Array.from({ length: loaded }, (_, n) => itemAt(n).id).indexOf(id);
      if (i < 0) return false;
      mode = 'viewer'; index = i; openedAt = time;
      return true;
    },
    advance: async () => {
      time += 700;
      if (!sticky) { index += 1; if (index >= loaded) loaded += grow || 12; }
      openedAt = time;
      return true;
    },
    leavePost: async () => { time += 800; mode = 'grid'; return true; },
    engage: async (action, item, comment) => {
      attempts.push({ action, id: item.id, comment, time, term });
      const result = outcome(action, attempts.filter(attempt => attempt.action === action).length, item);
      time += { like: 1500, follow: 2500, comment: 4000 }[action];
      return result;
    },
    ...(draftState ? { draftState: async comment => { drafts.push({ time, comment, id: current()?.id }); return draftState(drafts.length, comment); } } : {})
  };
  const options = {
    random, now: () => time, ...(checkpoint ? { checkpoint } : {}),
    sleep: async ms => { if (++steps > 200000) throw new Error('runaway'); time += Math.max(0, ms); if (time >= stopAt) controller.abort(); }
  };
  return {
    adapter, options, controller, updates, attempts, searches, checkpoints, drafts, viewed, time: () => time,
    run: settings => runSession(settings, adapter, controller.signal, options)
  };
}

test('instagram posts from the current keyword grid can be liked and followed without repeating the keyword', async () => {
  const h = world({ post: (term, index) => ({ id: igURL(`grid${index}`), text: OFF_NICHE, caption: OFF_NICHE }) });
  const stats = await h.run(plan());
  assert.ok(stats.like > 0, `likes: ${stats.like}`);
  assert.ok(stats.follow > 0, `follows: ${stats.follow}`);
  assert.equal(stats.comment, 0, 'search membership never grants a comment');
  assert.equal(h.attempts.filter(attempt => attempt.action === 'comment').length, 0);
  assert.ok(messages(h).some(update => update.message.includes("comment skipped: this post doesn't mention your keywords.")));
});

test('viewer metadata grants nothing before the same-term grid was seen', async () => {
  const h = world({ post: (term, index) => ({ id: igURL(`grid${index}`), text: OFF_NICHE, caption: OFF_NICHE }), gridMeta: () => undefined });
  const stats = await h.run(plan());
  assert.equal(engaged(h).length, 0);
  assert.equal(stats.like + stats.follow + stats.comment, 0);
  assert.ok(messages(h).some(update => update.message.includes("this post isn't from your search and doesn't mention your keywords.")));
});

test('a new search clears earlier grid membership', async () => {
  // The first grid lists 60 tiles; the second query's viewer then reaches unviewed
  // first-grid tiles that the second grid never listed.
  const h = world({
    gridSize: 60,
    post: (term, index) => term === 'first' || index % 2 === 0
      ? { id: igURL(`${term === 'first' ? 'f' : 's'}${term === 'first' ? index : index / 2}`), text: OFF_NICHE, caption: OFF_NICHE }
      : { id: igURL(`f${30 + (index - 1) / 2}`), text: OFF_NICHE, caption: OFF_NICHE, stale: true },
    listed: item => !item.stale
  });
  const stats = await h.run(plan({ niche: 'first, second', minutes: 4, enableComments: false }));
  const second = h.searches.find(search => search.term === 'second');
  assert.ok(second, 'the second keyword was searched');
  const early = engaged(h).filter(attempt => attempt.time < second.time);
  const late = engaged(h).filter(attempt => attempt.time > second.time);
  assert.ok(early.length > 0 && early.every(attempt => /\/p\/f\d+\/$/.test(attempt.id)), 'first-grid posts are exempt during their own search');
  assert.ok(late.length > 0, 'second-grid posts are exempt during their search');
  assert.ok(late.every(attempt => /\/p\/s\d+\/$/.test(attempt.id)), `earlier ids stay exempt: ${late.map(attempt => attempt.id)}`);
  assert.ok(h.viewed.some(id => /\/p\/f3\d\/$/.test(id)), 'the second viewer did reach unlisted first-grid tiles');
  assert.ok(stats.like > 0);
});

test('a grid for another query grants nothing', async () => {
  const h = world({ post: (term, index) => ({ id: igURL(`grid${index}`), text: OFF_NICHE, caption: OFF_NICHE }), gridMeta: (term, ids) => ({ term: 'other', posts: ids }) });
  const stats = await h.run(plan());
  assert.equal(engaged(h).length, 0);
  assert.equal(stats.like + stats.follow, 0);
});

test('viewer posts the grid did not list are not treated as search results', async () => {
  const h = world({ post: (term, index) => ({ id: igURL(`${index % 2 ? 'rec' : 'grid'}${index}`), text: OFF_NICHE, caption: OFF_NICHE }), listed: item => item.id.includes('/grid') });
  const stats = await h.run(plan());
  assert.ok(stats.like > 0);
  assert.ok(h.viewed.some(id => id.includes('/rec')));
  assert.ok(engaged(h).every(attempt => attempt.id.includes('/grid')));
  assert.ok(messages(h).some(update => update.message.includes("this post isn't from your search and doesn't mention your keywords.")));
});

test('tiktok links inside an instagram grid are ignored', async () => {
  const h = world({ post: (term, index) => ({ id: `https://www.tiktok.com/@creator${index}/video/${9000 + index}`, text: OFF_NICHE, caption: OFF_NICHE }) });
  await h.run(plan());
  assert.ok(h.viewed.length > 0);
  assert.equal(engaged(h).length, 0);
});

// The cooldown each action had just before it started, from the last checkpoint saved without a reservation.
const allowedAt = (h, attempt) => {
  const before = h.checkpoints.filter(item => item.time <= attempt.time && item.value.inFlight === null).at(-1);
  return before.time + before.value.cooldowns[attempt.action];
};

test('a second, different action on one post waits a short gap and its own spacing', async () => {
  const h = world({ sticky: true });
  const settings = plan({ customLimits: { comment: 0 } });
  await h.run(settings);
  const [first, second, ...rest] = engaged(h);
  assert.equal(rest.length, 0);
  assert.deepEqual([first.action, second.action], ['like', 'follow']);
  assert.equal(first.id, second.id);
  assert.ok(second.time - first.time >= 2500 * settings.pauseScale, `gap: ${second.time - first.time}`);
  assert.ok(second.time >= allowedAt(h, second), 'the follow never beats its own spacing');
});

test('a post never receives more than two actions', async () => {
  const sticky = world({ sticky: true });
  await sticky.run(plan());
  assert.equal(engaged(sticky).length, 2);
  assert.equal(new Set(engaged(sticky).map(attempt => attempt.action)).size, 2);
  for (const seed of [1, 2, 3]) {
    const stream = world({ random: seeded(seed) });
    await stream.run(plan({ minutes: 20, customLimits: { like: 60, follow: 20, comment: 6 } }));
    const perPost = new Map();
    for (const attempt of engaged(stream)) perPost.set(attempt.id, (perPost.get(attempt.id) || 0) + 1);
    assert.ok(Math.max(...perPost.values()) <= 2, `seed ${seed}`);
    assert.ok([...perPost.values()].some(count => count === 2), `seed ${seed}: second actions happen`);
  }
});

// Every 'watching this post...' hold, with how long it holds and whether it was due.
const holdsOf = (h, settings) => h.updates.flatMap((update, index) => {
  if (update.message !== 'watching this post...') return [];
  const until = h.updates.slice(index + 1).find(item => item.phase === 'pause' && Number.isFinite(item.nextActionAt));
  const due = ['like', 'follow', 'comment'].some(action =>
    expectedActions(settings, action, update.time) > h.attempts.filter(attempt => attempt.action === action && attempt.time <= update.time).length);
  return [{ time: update.time, heldMs: until.nextActionAt - update.time, due, engagedPost: h.attempts.some(attempt => attempt.id === update.viewing && attempt.time <= update.time) }];
});

test('holding on a post for a second action is short and only for an action that is due', async () => {
  // Without likes, the only hold is the same-post rule: 8 s × pace at most.
  let sameHolds = 0;
  for (const [config, patch] of [
    [{ sticky: true }, { customLimits: { like: 0 } }],
    [{ random: seeded(4) }, { minutes: 20, customLimits: { like: 0, follow: 30, comment: 10 } }],
    [{ random: seeded(5) }, { minutes: 20, pace: 'slow', customLimits: { like: 0, follow: 20, comment: 8 } }]
  ]) {
    const h = world(config);
    const settings = plan(patch);
    await h.run(settings);
    for (const hold of holdsOf(h, settings)) {
      assert.ok(hold.engagedPost, `hold at ${hold.time} is on a post that already had an action`);
      assert.ok(hold.heldMs <= 8000 * settings.pauseScale, `held ${hold.heldMs} ms`);
      assert.ok(hold.due, `hold at ${hold.time} without a due action`);
      sameHolds += 1;
    }
  }
  assert.ok(sameHolds > 0, 'same-post holds were exercised');
  // With likes on, the existing like hold (12 s × pace at most) is unchanged.
  for (const seed of [6, 7]) {
    const h = world({ random: seeded(seed) });
    const settings = plan({ minutes: 20, customLimits: { like: 60, follow: 20, comment: 6 } });
    await h.run(settings);
    for (const hold of holdsOf(h, settings)) {
      assert.ok(hold.heldMs <= 12000 * settings.pauseScale, `held ${hold.heldMs} ms`);
      assert.ok(hold.due, `hold at ${hold.time} without a due action`);
    }
  }
});

test('slow pace doubles every per-action minimum spacing', async () => {
  const h = world({ random: seeded(7) });
  const settings = plan({ minutes: 20, pace: 'slow', customLimits: { like: 60, follow: 20, comment: 6 } });
  assert.equal(settings.pauseScale, 2);
  await h.run(settings);
  for (const action of ['like', 'follow', 'comment']) {
    const times = engaged(h).filter(attempt => attempt.action === action).map(attempt => attempt.time);
    assert.ok(times.length > 1, action);
    const minimum = actionSpacing(settings, action)[0] * settings.pauseScale;
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= minimum, `${action} gap ${times[i] - times[i - 1]} < ${minimum}`);
  }
});

test('no more than six actions start in any rolling minute', async () => {
  let busiest = 0;
  for (const [seed, customLimits] of [[1, {}], [2, {}], [3, { like: 180, follow: 60, comment: 20 }], [4, { like: 180, follow: 60, comment: 20 }], [5, { like: 180, follow: 60, comment: 20 }]]) {
    const h = world({ random: seeded(seed) });
    await h.run(plan({ minutes: 20, customLimits }));
    const starts = engaged(h).map(attempt => attempt.time).sort((a, b) => a - b);
    for (let i = 0; i < starts.length; i++) {
      const inWindow = starts.filter(time => time >= starts[i] && time - starts[i] < 60000).length;
      busiest = Math.max(busiest, inWindow);
      assert.ok(inWindow <= 6, `seed ${seed}: ${inWindow} actions within a minute`);
    }
  }
  assert.ok(busiest >= 5, `the cap is exercised: ${busiest}`);
});

test('instagram full-video watches come every five posts or more', async () => {
  for (const [random, fixed] of [[() => .5, true], [seeded(11), false], [seeded(12), false]]) {
    const h = world({ random, stopAt: 3600000, post: (term, index) => ({ id: igURL(`clip${index}`), text: OFF_NICHE, caption: OFF_NICHE, videoMs: 30000 }) });
    let fullWatches = [];
    const update = h.adapter.update;
    h.adapter.update = patch => {
      if (patch.message === 'staying for the rest of this video…') fullWatches.push(h.viewed.length);
      if (h.viewed.length >= 200) h.controller.abort();
      update(patch);
    };
    await h.run(plan({ minutes: 120, enableComments: false }));
    assert.ok(h.viewed.length >= 200, `viewed ${h.viewed.length}`);
    assert.ok(fullWatches.length > 10);
    const gaps = fullWatches.slice(1).map((count, index) => count - fullWatches[index]);
    assert.ok(gaps.every(gap => gap >= 3), `gaps: ${gaps}`);
    if (fixed) assert.ok(gaps.every(gap => gap >= 5), `fixed pacing gaps: ${gaps}`);
  }
});

test('instagram rotates keywords every six minutes and tiktok keeps two-minute rotation', async () => {
  for (const [platform, expected] of [['instagram', 7], ['tiktok', 20]]) {
    let index = 0;
    const searches = [];
    const h = harness({
      search: async term => searches.push(term),
      inspect: async () => ({ post: { id: `viewer-${index}`, text: 'study tips', viewer: true, next: true } }),
      advance: async () => { index++; return true; }
    });
    h.options.random = () => 0;
    await runSession(plan({ platform, niche: 'first, second, third', minutes: 40, mix: { like: 0, follow: 0, comment: 0 } }), h.adapter, h.controller.signal, h.options);
    assert.equal(searches.length, expected, platform);
    assert.deepEqual(searches.slice(0, 4), ['first', 'second', 'third', 'first']);
  }
});

const resumed = (patch = {}) => ({
  version: 1,
  stats: { scroll: 0, read: 0, search: 1, open: 0, like: 0, follow: 0, comment: 0, skipped: 0 },
  unconfirmed: { like: 0, follow: 0, comment: 0 }, pausedActions: [], comments: [], seen: [],
  done: { like: [], follow: [], comment: [] }, usedComments: [],
  termIndex: 1, currentSearchTerm: 'study tips', elapsedMs: 60000, remainingMs: 540000,
  cooldowns: { like: 0, follow: 0, comment: 0, engagement: 0, break: 400000 }, inFlight: null,
  ...patch
});

test('a revisited keyword grid that is still growing gets time to reach unseen posts', async () => {
  // The first 60 tiles were seen before; each slow scroll adds 12 more.
  const seen = Array.from({ length: 60 }, (_, index) => `instagram:tile${index}`);
  const h = world({
    post: (term, index) => ({ id: igURL(`tile${index}`), text: OFF_NICHE, caption: OFF_NICHE }),
    gridSize: 12, grow: 12, scrollMs: 8000, stopAt: 150000, checkpoint: resumed({ seen })
  });
  const stats = await h.run(plan({ customLimits: { like: 0, follow: 0, comment: 0 } }));
  assert.ok(h.time() >= 150000);
  assert.equal(h.searches.length, 1, 'no recovery search while the grid keeps growing');
  assert.ok(stats.open >= 1, 'an unseen post was opened');
  assert.ok(h.viewed.some(id => /tile(6\d|[7-9]\d)\//.test(id)));
});

test('a revisited grid that never grows still recovers after thirty seconds', async () => {
  const seen = Array.from({ length: 12 }, (_, index) => `instagram:tile${index}`);
  const h = world({
    post: (term, index) => ({ id: igURL(`tile${index}`), text: OFF_NICHE, caption: OFF_NICHE }),
    gridSize: 12, grow: 0, checkpoint: resumed({ seen })
  });
  await assert.rejects(h.run(plan({ customLimits: { like: 0, follow: 0, comment: 0 } })), /still isn't showing new posts/);
  assert.ok(h.searches.length >= 2);
  const firstRecovery = h.searches[1].time - h.searches[0].time;
  assert.ok(firstRecovery >= 30000 && firstRecovery <= 45000, `first recovery after ${firstRecovery} ms`);
  assert.ok(messages(h).some(update => /results stopped advancing/.test(update.message)));
});

const LIFTED = 'the comment box is clear again. comments are back on.';
const commentsOnly = (patch = {}) => plan({ minutes: 20, customLimits: { like: 0, follow: 0, comment: 6 }, ...patch });
const commentResults = results => (action, count) => action === 'comment' ? results[count - 1] || 'confirmed' : 'confirmed';
const commentAttempts = h => h.attempts.filter(attempt => attempt.action === 'comment');

test('a retained draft is lifted once after two clear checks on another post', async () => {
  const h = world({ outcome: commentResults(['draft-retained']), draftState: () => 'absent' });
  const stats = await h.run(commentsOnly());
  const [draft, ...later] = commentAttempts(h);
  const retained = messages(h).find(update => /comment skipped for/.test(update.message));
  assert.match(retained.message, /comments are paused until the comment box is clear/);
  const [first, second] = h.drafts;
  assert.ok(first && second);
  assert.equal(first.comment, draft.comment);
  assert.ok(first.time - draft.time >= 90000, `first check after ${first.time - draft.time} ms`);
  assert.ok(h.drafts.every(check => check.id !== draft.id), 'checks run on a different post');
  assert.ok(second.time - first.time >= 15000);
  const lifts = messages(h).filter(update => update.message === LIFTED);
  assert.equal(lifts.length, 1);
  assert.ok(lifts[0].time >= second.time);
  assert.equal(h.drafts.length, 2, 'no more checks after the lift');
  assert.ok(later.length > 0, 'comments come back');
  assert.ok(later[0].time - lifts[0].time >= 120000, `next comment ${later[0].time - lifts[0].time} ms after the lift`);
  assert.ok(later.every(attempt => attempt.comment !== draft.comment), 'the retained wording is never reused');
  assert.equal(stats.comment, later.length);
  assert.deepEqual(h.updates.at(-1).pausedActions, []);
});

test('a present draft resets the clear-check count', async () => {
  const h = world({ outcome: commentResults(['draft-retained']), draftState: count => ['absent', 'present', 'absent', 'absent'][count - 1] || 'absent' });
  await h.run(commentsOnly());
  assert.equal(h.drafts.length, 4);
  const lift = messages(h).find(update => update.message === LIFTED);
  assert.ok(lift.time >= h.drafts[3].time, 'the lift waits for two clear checks in a row');
  for (let i = 1; i < h.drafts.length; i++) assert.ok(h.drafts[i].time - h.drafts[i - 1].time >= 15000);
});

test('an uncertain submit with a possible draft never lifts', async () => {
  const h = world({ outcome: commentResults(['uncertain-draft']), draftState: () => 'absent' });
  await h.run(commentsOnly());
  assert.equal(commentAttempts(h).length, 1);
  assert.equal(h.drafts.length, 0);
  assert.equal(messages(h).some(update => update.message === LIFTED), false);
  assert.ok(messages(h).some(update => /comments are off for this session/.test(update.message)));
  assert.deepEqual(h.updates.at(-1).pausedActions, ['comment']);
});

test('a second retained draft after a lift keeps comments off for the session', async () => {
  const h = world({ outcome: commentResults(['draft-retained', 'draft-retained']), draftState: () => 'absent' });
  await h.run(commentsOnly());
  const attempts = commentAttempts(h);
  assert.equal(attempts.length, 2);
  assert.equal(messages(h).filter(update => update.message === LIFTED).length, 1);
  const retained = messages(h).filter(update => /comment skipped for/.test(update.message));
  assert.match(retained[0].message, /paused until the comment box is clear/);
  assert.match(retained[1].message, /comments are off for this session/);
  assert.ok(h.drafts.every(check => check.time < attempts[1].time), 'no checks after the second draft');
  assert.deepEqual(h.updates.at(-1).pausedActions, ['comment']);
});

// These four replace 'tiktok retained drafts never lift'. TikTok now answers the same
// read-only draft check, so its retained drafts follow Instagram's one-time lift rules.
const ttURL = (term, index) => `https://www.tiktok.com/@${term.replace(/\W/g, '')}${index}/video/${7000000000000000000n + BigInt(index)}/`;
const tiktokWorld = config => world({ post: (term, index) => ({ id: ttURL(term, index), author: `@${term.replace(/\W/g, '')}${index}`, text: 'study tips', caption: MATCHING }), ...config });
const tiktokCommentsOnly = () => commentsOnly({ platform: 'tiktok' });

test('a tiktok retained draft is lifted once after two clear checks on another post', async () => {
  const h = tiktokWorld({ outcome: commentResults(['draft-retained']), draftState: () => 'absent' });
  const stats = await h.run(tiktokCommentsOnly());
  const [draft, ...later] = commentAttempts(h);
  assert.match(messages(h).find(update => /comment skipped for/.test(update.message)).message, /comments are paused until the comment box is clear/);
  const [first, second] = h.drafts;
  assert.ok(first && second);
  assert.equal(first.comment, draft.comment);
  assert.ok(first.time - draft.time >= 90000, `first check after ${first.time - draft.time} ms`);
  assert.ok(h.drafts.every(check => check.id !== draft.id), 'checks run on a different post');
  assert.ok(second.time - first.time >= 15000);
  const lifts = messages(h).filter(update => update.message === LIFTED);
  assert.equal(lifts.length, 1);
  assert.ok(lifts[0].time >= second.time);
  assert.equal(h.drafts.length, 2, 'no more checks after the lift');
  assert.ok(later.length > 0, 'comments come back');
  assert.ok(later[0].time - lifts[0].time >= 120000, `next comment ${later[0].time - lifts[0].time} ms after the lift`);
  assert.ok(later.every(attempt => attempt.comment !== draft.comment), 'the retained wording is never reused');
  assert.equal(stats.comment, later.length);
  assert.deepEqual(h.updates.at(-1).pausedActions, []);
});

test('a present tiktok draft resets the clear-check count', async () => {
  const h = tiktokWorld({ outcome: commentResults(['draft-retained']), draftState: count => ['absent', 'present', 'absent', 'absent'][count - 1] || 'absent' });
  await h.run(tiktokCommentsOnly());
  assert.equal(h.drafts.length, 4);
  assert.ok(messages(h).find(update => update.message === LIFTED).time >= h.drafts[3].time, 'the lift waits for two clear checks in a row');
  for (let i = 1; i < h.drafts.length; i++) assert.ok(h.drafts[i].time - h.drafts[i - 1].time >= 15000);
});

test('an uncertain tiktok submit with a possible draft never lifts', async () => {
  const h = tiktokWorld({ outcome: commentResults(['uncertain-draft']), draftState: () => 'absent' });
  await h.run(tiktokCommentsOnly());
  assert.equal(commentAttempts(h).length, 1);
  assert.equal(h.drafts.length, 0);
  assert.equal(messages(h).some(update => update.message === LIFTED), false);
  assert.ok(messages(h).some(update => /comments are off for this session/.test(update.message)));
  assert.deepEqual(h.updates.at(-1).pausedActions, ['comment']);
});

test('a second retained tiktok draft after a lift keeps comments off for the session', async () => {
  const h = tiktokWorld({ outcome: commentResults(['draft-retained', 'draft-retained']), draftState: () => 'absent' });
  await h.run(tiktokCommentsOnly());
  const attempts = commentAttempts(h);
  assert.equal(attempts.length, 2);
  assert.equal(messages(h).filter(update => update.message === LIFTED).length, 1);
  const retained = messages(h).filter(update => /comment skipped for/.test(update.message));
  assert.match(retained[0].message, /paused until the comment box is clear/);
  assert.match(retained[1].message, /comments are off for this session/);
  assert.ok(h.drafts.every(check => check.time < attempts[1].time), 'no checks after the second draft');
  assert.deepEqual(h.updates.at(-1).pausedActions, ['comment']);
});

test('without a draft check, a retained draft keeps comments off for the session', async () => {
  const h = world({ outcome: commentResults(['draft-retained']) });
  await h.run(commentsOnly());
  assert.equal(commentAttempts(h).length, 1);
  const retained = messages(h).find(update => /comment skipped for/.test(update.message));
  assert.match(retained.message, /comments are off for this session/);
  assert.equal(messages(h).some(update => update.message === LIFTED), false);
});

test('the same skip reason is reported at most once every three minutes', async () => {
  const h = world({ post: (term, index) => ({ id: igURL(`off${index}`), text: OFF_NICHE, caption: OFF_NICHE }), gridMeta: () => undefined, viewerMeta: () => undefined });
  await h.run(plan());
  const reasons = ["this post isn't from your search and doesn't mention your keywords.", "this post doesn't mention your keywords."];
  for (const reason of reasons) {
    const times = messages(h).filter(update => update.message.includes(`skipped: ${reason}`)).map(update => update.time);
    assert.ok(times.length >= 2, `${reason} reported ${times.length} times`);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 180000, `${reason} repeated after ${times[i] - times[i - 1]} ms`);
  }
  assert.ok(h.viewed.length > 20);
});

test('a missing account link is reported once per session', async () => {
  const h = world({ post: (term, index) => ({ id: igURL(`post${index}`), text: 'study tips', caption: MATCHING, comment: false, commentBlocker: 'account' }) });
  const stats = await h.run(plan({ minutes: 20 }));
  const reports = messages(h).filter(update => update.message.includes("couldn't find your instagram account link, so comments are skipped."));
  assert.equal(reports.length, 1);
  assert.equal(stats.comment, 0);
  assert.ok(stats.like > 0);
});

test('a missing comment writer turns comments off with one clear message and keeps strict matching', async () => {
  const context = engine();
  vm.runInContext('delete globalThis.commentWriter', context);
  assert.equal(context.commentWriter, undefined);
  const h = world({
    post: (term, index) => ({ id: igURL(`${index % 2 ? 'loose' : 'strict'}${index}`), text: index % 2 ? 'studying tips daily' : 'study tips', caption: index % 2 ? 'studying tips daily' : MATCHING }),
    gridMeta: () => undefined, viewerMeta: () => undefined
  });
  const stats = await vm.runInContext('runSession', context)(plan({}, context), h.adapter, h.controller.signal, h.options);
  assert.equal(commentAttempts(h).length, 0);
  assert.equal(stats.comment, 0);
  assert.equal(messages(h).filter(update => update.message.includes('comments are unavailable in this version. reinstall the extension from the setup page.')).length, 1);
  assert.ok(stats.like > 0);
  assert.ok(engaged(h).every(attempt => attempt.id.includes('/strict')), 'only strict keyword matches get likes and follows');
});

// Finds a post whose writer reply comes from a template, so its template key is reserved too.
function templatePost() {
  for (let index = 0; index < 500; index++) {
    const id = igURL(`tpl${index}`);
    const result = commentWriter.writeComment({ caption: MATCHING, text: 'study tips', terms: ['study tips'], used: [], postId: postIdentity(id) });
    if (result.source === 'template') return { id, result };
  }
  throw new Error('no template reply found');
}

for (const outcome of ['skipped', 'confirmed']) test(`a ${outcome} template comment ${outcome === 'skipped' ? 'frees' : 'keeps'} both its wording and its template`, async () => {
  const { id, result } = templatePost();
  const h = world({ sticky: true, post: () => ({ id, text: 'study tips', caption: MATCHING }), outcome: () => outcome });
  await h.run(plan({ customLimits: { like: 0, follow: 0, comment: 1 } }));
  const [attempt] = commentAttempts(h);
  assert.equal(attempt.comment, result.text);
  const keys = [commentWriter.commentKey(result.text), result.templateKey];
  const reserved = h.checkpoints.find(item => item.value.inFlight?.action === 'comment');
  for (const key of keys) assert.ok(reserved.value.usedComments.includes(key), `reserved before typing: ${key}`);
  const after = h.checkpoints.find(item => item.time > attempt.time && item.value.inFlight === null);
  const final = h.checkpoints.at(-1);
  for (const key of keys) {
    assert.equal(after.value.usedComments.includes(key), outcome === 'confirmed', key);
    assert.equal(final.value.usedComments.includes(key), outcome === 'confirmed', key);
  }
});
