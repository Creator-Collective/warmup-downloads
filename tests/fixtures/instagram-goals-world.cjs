'use strict';
// Frozen harness for the golden Instagram baseline (tests/instagram-goals-baseline.test.cjs).
//
// world() is a verbatim copy of the modelled instagram keyword grid and post viewer in
// tests/session-goals.test.cjs at d5865be, taking the engine's runSession as a parameter.
// It is copied, not shared, so later edits to session-goals cannot move the golden numbers.
//
// Scope: this runs only plan.js, comment-writer.js and session.js. The browser adapter is
// a model, so it proves nothing about runner.js, background.js, guards.js or dashboard.js.
// Those shared paths are pinned separately (instagram-runner-baseline, instagram-panel-baseline).
//
// The caption scenarios and cost model are exported so a later TikTok efficiency run can
// reuse them, and a difference then means platform code, not the harness.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const corpus = require('./comment-captions.cjs');

const extension = path.join(__dirname, '../../browser-extension');

// A fresh engine per run: no state can leak from one seed or scenario into the next.
function engine(files = ['plan.js', 'comment-writer.js', 'session.js']) {
  const context = vm.createContext({ setTimeout, clearTimeout, AbortController, URL });
  for (const file of files) {
    const filename = path.join(extension, file);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  }
  return context;
}
const plain = value => JSON.parse(JSON.stringify(value));
const seeded = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const igURL = code => `https://www.instagram.com/p/${code}/`;
const MATCHING = 'Study tips work best when you practice a little every day.';
const EXAM = 'Exam prep gets easier when you plan the whole week before.';
const OFF_NICHE = 'golden hour in lisbon never gets old.';

// A modelled instagram keyword grid with a post viewer. Each feed is one query's
// grid; the viewer walks the feed in order, including tiles the grid did not list.
function world(runSession, config = {}) {
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

const CORPUS = corpus.flatMap(niche => niche.captions);
const feedName = term => term.replace(/\W/g, '');

// Caption scenarios, each run at 40 minutes with the default targets (60 likes, 18 follows,
// 7 comments) and two keywords, so keyword rotation is exercised.
const SCENARIOS = Object.freeze({
  // Every caption mentions a keyword: pure pacing, spacing and rotation.
  matching: Object.freeze({ niche: 'study tips, exam prep', config: () => ({}) }),
  // One post in three mentions a keyword; the rest count only through grid membership.
  // Some posts are videos, a few likes and follows end unconfirmed, one comment is a clean
  // skip, and the second comment leaves a draft that the read-only check later finds clear.
  mixed: Object.freeze({
    niche: 'study tips, exam prep',
    config: () => ({
      post: (term, index) => {
        const caption = index % 3 === 0 ? (index % 2 ? EXAM : MATCHING) : OFF_NICHE;
        return { id: igURL(`${feedName(term)}${index}`), text: caption, caption, ...(index % 4 === 1 ? { videoMs: 12000 + (index % 5) * 9000 } : {}) };
      },
      outcome: (action, count) => {
        if (action === 'comment') return count === 2 ? 'draft-retained' : count === 4 ? 'skipped' : 'confirmed';
        if (action === 'like' && count % 9 === 0) return 'uncertain';
        if (action === 'follow' && count % 7 === 0) return 'uncertain';
        return 'confirmed';
      },
      draftState: () => 'absent'
    })
  }),
  // Realistic captions from the comment corpus across fifteen niches. Most do not mention
  // the keywords, so the writer's matching, its skip reasons and its wording are exercised.
  corpus: Object.freeze({
    niche: 'fitness, workout',
    config: () => ({
      post: (term, index) => {
        const caption = CORPUS[(index * 7 + term.length) % CORPUS.length];
        return { id: igURL(`${feedName(term)}${index}`), text: caption, caption };
      }
    })
  })
});
const SEEDS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
const MINUTES = 40;

const counts = (list, key) => list.reduce((map, item) => ({ ...map, [item[key]]: (map[item[key]] || 0) + 1 }), {});

// One golden run: the real plan, writer and engine against the frozen world. The outcome
// wrapper only records each engaged post's caption; it never changes a result.
async function runBaseline(name, seed) {
  const scenario = SCENARIOS[name];
  const context = engine();
  const runSession = vm.runInContext('runSession', context);
  const settings = plain(context.sessionPlan.validateSettings({ niche: scenario.niche, minutes: MINUTES, enableComments: true }));
  const config = scenario.config();
  const captions = new Map();
  const outcome = config.outcome || (() => 'confirmed');
  const h = world(runSession, { ...config, outcome: (action, count, item) => { captions.set(item.id, item.caption); return outcome(action, count, item); }, random: seeded(seed) });
  const stats = plain(await h.run(settings));
  return { settings, stats, h, captions };
}

// The full ordered trace: every action with its post, time and comment wording, every
// search, every activity message and every read-only draft check.
function traceOf({ h }) {
  return {
    attempts: h.attempts.map(({ action, id, comment, time, term }) => [action, id, comment ?? null, time, term]),
    searches: h.searches.map(({ term, time }) => [term, time]),
    messages: h.updates.filter(update => typeof update.message === 'string').map(update => [update.time, update.message]),
    drafts: h.drafts.map(({ time, comment, id }) => [time, comment, id])
  };
}

// Compact numbers for the snapshot, plus a digest of the full ordered trace.
function summarize(run) {
  const { stats, h } = run;
  const messages = h.updates.filter(update => typeof update.message === 'string');
  const last = h.updates.at(-1);
  const trace = traceOf(run);
  return {
    stats,
    unconfirmed: last.unconfirmed,
    paused: last.pausedActions,
    attempts: { like: 0, follow: 0, comment: 0, ...counts(h.attempts, 'action') },
    searches: h.searches.map(search => search.term).join('|'),
    skipNotes: messages.filter(update => / skipped: /.test(update.message)).length,
    skipResults: messages.filter(update => / skipped for /.test(update.message)).length,
    draftChecks: h.drafts.length,
    viewed: h.viewed.length,
    endedAt: h.time(),
    digest: createHash('sha256').update(JSON.stringify(trace)).digest('hex').slice(0, 24)
  };
}

module.exports = { engine, world, seeded, igURL, plain, runBaseline, traceOf, summarize, SCENARIOS, SEEDS, MINUTES, MATCHING, EXAM, OFF_NICHE };
