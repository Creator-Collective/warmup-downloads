const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({ setTimeout, clearTimeout, AbortController, URL });
for (const file of ['plan.js', 'session.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../browser-extension', file), 'utf8'), ctx);
const { runSession } = ctx.sessionEngine;
const plain = value => JSON.parse(JSON.stringify(value));
const settings = (patch = {}) => plain(ctx.sessionPlan.validateSettings({ minutes: 3, niche: 'study tips', enableComments: true, ...patch }));

function harness({ checkpoint, remainingMs, start = 0, stopAt = Infinity } = {}) {
  let time = start;
  let index = 0;
  const controller = new AbortController();
  const snapshots = [];
  const calls = [];
  const updates = [];
  const adapter = {
    checkpoint: async snapshot => snapshots.push(plain(snapshot)),
    update: patch => updates.push(plain(patch)),
    search: async term => { calls.push(['search', term]); },
    inspect: async () => ({ post: { id: `https://www.instagram.com/p/post-${index++}/`, author: `author-${index}`, text: 'study tips', caption: 'Study tips work best when you practice a little every day.', like: true, follow: true, comment: true } }),
    open: async id => { calls.push(['open', id]); return true; },
    scroll: async () => true,
    leavePost: async () => true,
    engage: async (action, post, comment) => { calls.push([action, post.id, comment, time]); return 'confirmed'; }
  };
  const options = {
    checkpoint, remainingMs, random: () => 0.999, now: () => time,
    sleep: async ms => { time += Math.min(ms, stopAt - time); if (time >= stopAt) controller.abort(); }
  };
  return { adapter, options, controller, snapshots, calls, updates, time: () => time, last: () => snapshots.at(-1) };
}

function saved(patch = {}) {
  return {
    version: 1,
    stats: { scroll: 0, read: 0, search: 0, open: 0, like: 0, follow: 0, comment: 0, skipped: 0 },
    unconfirmed: { like: 0, follow: 0, comment: 0 }, pausedActions: [], comments: [], seen: [],
    done: { like: [], follow: [], comment: [] }, usedComments: [],
    termIndex: 1, currentSearchTerm: 'study tips', elapsedMs: 60000, remainingMs: 120000,
    cooldowns: { like: 0, follow: 0, comment: 0, engagement: 0, break: 240000 }, inFlight: null,
    ...patch
  };
}

test('multiple resumes use only remaining active time without resetting the original duration', async () => {
  const plan = settings({ minutes: 2, customLimits: { like: 0, follow: 0, comment: 0 } });
  const first = harness({ stopAt: 28000 });
  await runSession(plan, first.adapter, first.controller.signal, first.options);
  assert.equal(first.last().elapsedMs, 28000);
  assert.equal(first.last().remainingMs, 92000);
  const second = harness({ checkpoint: first.last(), remainingMs: 120000, start: 900000, stopAt: 937000 });
  await runSession(plan, second.adapter, second.controller.signal, second.options);
  assert.equal(second.last().elapsedMs, 65000);
  assert.equal(second.last().remainingMs, 55000);
  const third = harness({ checkpoint: second.last(), start: 1500000 });
  await runSession(plan, third.adapter, third.controller.signal, third.options);
  assert.equal(third.time() - 1500000, 55000);
  assert.equal(third.last().elapsedMs, 120000);
  assert.equal(third.last().remainingMs, 0);
  assert.ok(third.last().stats.scroll > second.last().stats.scroll);
});

test('resume retains completed counts, action caps, comment history, and used wording', async () => {
  const plan = settings({ minutes: 6, customLimits: { like: 3, follow: 2, comment: 2 } });
  const first = harness();
  first.options.random = () => 0.5;
  first.adapter.engage = async (action, post, comment) => {
    first.calls.push([action, post.id, comment]);
    if (action === 'comment') first.controller.abort();
    return 'confirmed';
  };
  await runSession(plan, first.adapter, first.controller.signal, first.options);
  const before = first.last();
  assert.equal(before.stats.comment, 1);
  assert.equal(before.comments.length, 1);
  assert.equal(before.usedComments[0], before.comments[0].text);
  const second = harness({ checkpoint: before, start: 500000 });
  second.options.random = () => 0.5;
  await runSession(plan, second.adapter, second.controller.signal, second.options);
  const after = second.last();
  for (const action of ['like', 'follow', 'comment']) {
    assert.equal(after.stats[action], before.stats[action] + second.calls.filter(call => call[0] === action).length);
    assert.ok(after.stats[action] + after.unconfirmed[action] <= plan.limits[action]);
    assert.ok(before.done[action].every(key => after.done[action].includes(key)));
  }
  assert.equal(after.stats.comment, 2);
  assert.deepEqual(after.comments[0], before.comments[0]);
  assert.notEqual(after.comments[1].text, before.comments[0].text);
  assert.ok(before.seen.every(key => after.seen.includes(key)));
});

test('resume restarts the current keyword and still rotates to the next keyword', async () => {
  const checkpoint = saved({ termIndex: 2, currentSearchTerm: 'storytelling' });
  const h = harness({ checkpoint });
  await runSession(settings({ niche: 'study tips, storytelling, editing', customLimits: { like: 0, follow: 0, comment: 0 } }), h.adapter, h.controller.signal, h.options);
  assert.deepEqual(h.calls.filter(call => call[0] === 'search').slice(0, 2), [['search', 'storytelling'], ['search', 'editing']]);
});

test('seen posts and followed authors stay excluded after resuming', async () => {
  const oldPost = 'https://www.instagram.com/reel/old-post/';
  const newPost = 'https://www.instagram.com/p/new-post/';
  const checkpoint = saved({ seen: ['instagram:old-post'], done: { like: [], follow: ['already-followed'], comment: [] } });
  const h = harness({ checkpoint });
  let post = null;
  h.adapter.inspect = async () => ({ post, posts: [oldPost, newPost] });
  h.adapter.open = async id => {
    h.calls.push(['open', id]);
    post = { id, author: 'already-followed', text: 'study tips', like: true, follow: true };
    return true;
  };
  h.adapter.leavePost = async () => { h.controller.abort(); return true; };
  await runSession(settings({ customLimits: { like: 0, follow: 1, comment: 0 } }), h.adapter, h.controller.signal, h.options);
  assert.deepEqual(h.calls.filter(call => call[0] === 'open'), [['open', newPost]]);
  assert.equal(h.calls.some(call => call[0] === 'follow'), false);
});

test('a saved in-flight action reserves its cap and is never replayed', async () => {
  const id = 'https://www.instagram.com/p/stopped-post/';
  const checkpoint = saved({ inFlight: { action: 'like', key: 'instagram:stopped-post', comment: null, post: { id, author: 'creator' }, time: 59000 } });
  const h = harness({ checkpoint });
  await runSession(settings({ customLimits: { like: 1, follow: 0, comment: 0 } }), h.adapter, h.controller.signal, h.options);
  assert.equal(h.calls.some(call => call[0] === 'like'), false);
  assert.equal(h.last().stats.like, 0);
  assert.equal(h.last().unconfirmed.like, 1);
  assert.ok(h.last().done.like.includes('instagram:stopped-post'));
  assert.equal(h.last().inFlight, null);
  const again = harness({ checkpoint: { ...h.last(), remainingMs: 10000 } });
  await runSession(settings({ customLimits: { like: 1, follow: 0, comment: 0 } }), again.adapter, again.controller.signal, again.options);
  assert.equal(again.last().unconfirmed.like, 1);
});

test('an interrupted comment stays uncertain and paused across subsequent resumes', async () => {
  const checkpoint = saved({ inFlight: { action: 'comment', key: 'instagram:stopped-comment', comment: 'a little practice feels doable', post: { id: 'https://www.instagram.com/p/stopped-comment/', author: 'creator' }, time: 59000 } });
  const h = harness({ checkpoint, stopAt: 30000 });
  await runSession(settings({ customLimits: { like: 0, follow: 0, comment: 2 } }), h.adapter, h.controller.signal, h.options);
  assert.equal(h.calls.some(call => call[0] === 'comment'), false);
  assert.deepEqual(h.last().pausedActions, ['comment']);
  assert.equal(h.last().unconfirmed.comment, 1);
  assert.equal(h.last().comments[0].status, 'uncertain');
  assert.equal(h.last().usedComments[0], checkpoint.inFlight.comment);
  const next = harness({ checkpoint: h.last(), start: 900000 });
  await runSession(settings({ customLimits: { like: 0, follow: 0, comment: 2 } }), next.adapter, next.controller.signal, next.options);
  assert.equal(next.calls.some(call => call[0] === 'comment'), false);
  assert.equal(next.last().unconfirmed.comment, 1);
  assert.equal(next.last().comments.length, 1);
});

test('remaining cooldowns survive long pauses between session segments', async () => {
  const checkpoint = saved({ cooldowns: { like: 40000, follow: 0, comment: 0, engagement: 20000, break: 240000 } });
  const h = harness({ checkpoint, start: 1000000 });
  await runSession(settings({ customLimits: { like: 1, follow: 0, comment: 0 } }), h.adapter, h.controller.signal, h.options);
  const likes = h.calls.filter(call => call[0] === 'like');
  assert.equal(likes.length, 1);
  assert.ok(likes[0][3] >= 1040000);
});

test('every engagement has a durable reservation before its adapter starts', async () => {
  const h = harness({ checkpoint: saved() });
  h.options.random = () => 0.5;
  h.adapter.engage = async (action, post, comment) => {
    const reservation = h.last();
    assert.equal(reservation.inFlight.action, action);
    assert.equal(reservation.inFlight.post.id, post.id);
    assert.ok(reservation.done[action].includes(reservation.inFlight.key));
    if (action === 'comment') assert.ok(reservation.usedComments.includes(comment));
    h.calls.push([action, post.id]);
    return 'confirmed';
  };
  await runSession(settings({ customLimits: { like: 1, follow: 1, comment: 1 } }), h.adapter, h.controller.signal, h.options);
  assert.equal(h.calls.filter(call => ['like', 'follow', 'comment'].includes(call[0])).length, 3);
  assert.equal(h.last().inFlight, null);
});

test('checkpoint write failures prevent engagement and preserve the original failure', async () => {
  const h = harness({ checkpoint: saved() });
  h.adapter.checkpoint = async snapshot => {
    if (snapshot.inFlight) throw new Error('could not save the session');
    h.snapshots.push(plain(snapshot));
  };
  await assert.rejects(runSession(settings({ customLimits: { like: 1, follow: 0, comment: 0 } }), h.adapter, h.controller.signal, h.options), /could not save the session/);
  assert.equal(h.calls.some(call => call[0] === 'like'), false);
  assert.equal(h.last().unconfirmed.like, 0);
  const failed = harness();
  failed.adapter.inspect = async () => { throw new Error('the original page failure'); };
  let saves = 0;
  failed.adapter.checkpoint = async () => { if (++saves > 3) throw new Error('cleanup failed'); };
  await assert.rejects(runSession(settings(), failed.adapter, failed.controller.signal, failed.options), /the original page failure/);
});

test('a thrown engagement is checkpointed as uncertain before returning its error', async () => {
  const h = harness({ checkpoint: saved() });
  h.adapter.engage = async () => { throw new Error('the page closed during submission'); };
  await assert.rejects(runSession(settings({ customLimits: { like: 0, follow: 0, comment: 1 } }), h.adapter, h.controller.signal, h.options), /page closed during submission/);
  assert.equal(h.last().unconfirmed.comment, 1);
  assert.deepEqual(h.last().pausedActions, ['comment']);
  assert.equal(h.last().inFlight, null);
  assert.equal(h.last().comments.length, 1);
  assert.equal(h.last().comments[0].status, 'uncertain');
});
