'use strict';
// TikTok efficiency world for tests/tiktok-efficiency.test.cjs (the gate on the shipped
// engine), tiktok-efficiency-window.test.cjs and tiktok-efficiency-results.test.cjs.
//
// Real code under test: plan.js, comment-writer.js and session.js (the engine), and the
// page-facing half of runner.js (inspect, engage, performEngagement, the comment draft
// checks and the fresh-page like/follow confirmation), against tiktok.js running in the
// small DOM fixture of tiktok-comment-composer.cjs, as in tiktok-complete-flow. Search,
// open, Next, close and scroll are modelled, as in the instagram world.
//
// Shared with the golden instagram world (fixtures/instagram-goals-world.cjs): the caption
// scenarios and their outcome patterns, the seeds, 40 minutes at the default targets, and
// the cost of each shared step (inspect 150 ms, open 900, Next 700, close 800, scroll 900).
// An instagram outcome becomes the matching page behaviour here: 'uncertain' is a like or
// follow shown in place and gone on the fresh page, 'draft-retained' is a Post button that
// never becomes available, 'skipped' is a comment box that never appears.
//
// TikTok realism on top, from the plan critique:
// - finite results per keyword, rendered 12 at a time, that can run out
// - a fresh confirmation tab that is still loading for 2-6 s, polled by the real runner
// - a search page that takes 2-6 s to load and a viewer that takes 1-3 s to render
// - some captions absent, and some opens refused (a covered card)
// - searches counted from the engine's own keyword searches only; closing a viewer back
//   to its results is not a search
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { fixture, commentComposer } = require('./tiktok-comment-composer.cjs');
const { SCENARIOS, SEEDS, MINUTES, MATCHING, seeded, plain } = require('./instagram-goals-world.cjs');
const { platforms, validPlatform, platformURL, warmupDiagnostics } = require('../../browser-extension/guards.js');

const extension = path.join(__dirname, '../../browser-extension');
const read = file => fs.readFileSync(path.join(extension, file), 'utf8');
const RUNNER = read('runner.js');
const SESSION = read('session.js');
const RUNNER_FUNCTIONS = Object.freeze(['currentPlatform', 'platformConfig', 'assertRunning', 'sameDestination', 'transientPageError', 'countDiagnostic',
  'noteBlock', 'blockError', 'recoverPageStep', 'execute', 'inspect', 'draftStateWithRetry', 'recoverCommentDraft', 'verifyEngagementOnFreshPost',
  'engage', 'performEngagement']);
const functionSource = name => {
  const start = RUNNER.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `runner.js has ${name}`);
  return RUNNER.slice(RUNNER.slice(start - 6, start) === 'async ' ? start - 6 : start, RUNNER.indexOf('\n}', start) + 2);
};
const RUNNER_SOURCE = RUNNER_FUNCTIONS.map(functionSource).join('\n');

// The keyword window is read from session.js as shipped. A comparison run may override the
// TikTok value in its own copy of the source; the file on disk is never changed.
const KEYWORD_WINDOW = /(const KEYWORD_WINDOW_MS = Object\.freeze\(\{ instagram: 360000, tiktok: )(\d+)( \}\);)/;
const shippedKeywordWindowMs = () => Number(SESSION.match(KEYWORD_WINDOW)?.[2]);
function engine(keywordWindowMs) {
  let session = SESSION;
  if (keywordWindowMs !== undefined) {
    assert.match(session, KEYWORD_WINDOW, 'session.js still declares the per-platform keyword window');
    session = session.replace(KEYWORD_WINDOW, `$1${keywordWindowMs}$3`);
  }
  const context = vm.createContext({ setTimeout, clearTimeout, AbortController, URL, console });
  for (const [file, source] of [['plan.js', read('plan.js')], ['comment-writer.js', read('comment-writer.js')], ['session.js', session]]) {
    vm.runInContext(source, context, { filename: path.join(extension, file) });
  }
  return context;
}

// Speed only. The composer fixture parses a selector again on every element it tests, which
// dominates a 40-minute run. This applies the same rule with each selector parsed once, and
// only while the fixture's matcher is the exact source it mirrors; otherwise the fixture's
// own matcher runs unchanged.
const FIXTURE_MATCHER_SHA = '9127181d8295c8693e84c91568ae28a8';
const parsedSelectors = new Map();
const parseSelector = selector => {
  if (!parsedSelectors.has(selector)) {
    parsedSelectors.set(selector, selector.split(',').map(part => {
      const rule = part.trim();
      return {
        tag: rule.match(/^[a-z][\w-]*/i)?.[0].toUpperCase(),
        classes: [...rule.replace(/\[[^\]]*\]/g, '').matchAll(/\.([\w-]+)/g)].map(match => match[1]),
        id: rule.match(/#([\w-]+)/)?.[1],
        attrs: [...rule.matchAll(/\[([\w-]+)(\*=|=)?(?:"([^"]*)")?\]/g)].map(([, key, op, value]) => ({ key, op, value }))
      };
    }));
  }
  return parsedSelectors.get(selector);
};
function parsedMatches(selector) {
  return parseSelector(selector).some(rule => {
    if (rule.tag && rule.tag !== this.tagName) return false;
    for (const name of rule.classes) if (!(this.attrs.class || '').split(/\s+/).includes(name)) return false;
    if (rule.id && this.attrs.id !== rule.id) return false;
    for (const { key, op, value } of rule.attrs) {
      if (!(key in this.attrs) || (op === '=' && this.attrs[key] !== value) || (op === '*=' && !this.attrs[key].includes(value))) return false;
    }
    return true;
  });
}
const fastSelectors = h => {
  const prototype = Object.getPrototypeOf(h.body);
  const digest = createHash('sha256').update(prototype.matches.toString()).digest('hex').slice(0, 32);
  if (digest === FIXTURE_MATCHER_SHA) prototype.matches = parsedMatches;
  return h;
};

const GRID = 12;
const GROW = 12;
const CAPTIONLESS_PERCENT = 12;
const OPEN_REFUSED_EVERY = 8;
const COST = Object.freeze({ inspect: 150, open: 900, advance: 700, leave: 800, scroll: 900 });
const hash = text => { let h = 0x811c9dc5; for (const c of text) h = Math.imul(h ^ c.codePointAt(0), 0x01000193) >>> 0; return h; };
const feedName = term => term.replace(/\W/g, '');
const searchURL = term => `https://www.tiktok.com/search?q=${encodeURIComponent(term)}`;
const polled = (ms, step) => Math.ceil(ms / step) * step;
// Enough results per keyword that a normal niche does not run out in 40 minutes, but
// finite: a keyword searched again returns the same list from the top.
const defaultResults = seed => term => 120 + hash(`${seed}/${term}`) % 121;

// Labels for where engine pauses go, from the message shown before each pause. Fixed
// labels only; no message text leaves this file.
function pauseLabel(message = '') {
  if (/^(?:watching|staying for the rest)/.test(message)) return 'watching';
  if (/^(?:liked|followed|commented|couldn't confirm|comment skipped|like skipped|follow skipped|(?:like|follow|comment)(?: \/ \w+)* skipped:)/.test(message)) return 'after-action';
  if (/^(?:opened search|searching for)/.test(message)) return 'search';
  if (/^taking a longer break/.test(message)) return 'break';
  if (/^taking a reading pause/.test(message)) return 'reading';
  // Scrolling past seen results, a failed Next or open, a stalled or replaced search.
  if (/results stopped advancing|search is slow|continuing from your search|scrolling made no progress|unavailable|couldn't open|waiting for the page|scrolled to more/.test(message)) return 'finding-results';
  if (/^the comment box is clear/.test(message)) return 'after-action';
  return 'other';
}

function tiktokWorld(runSession, settings, config = {}) {
  const {
    post = () => ({ caption: MATCHING }), outcome = () => 'confirmed', random = () => .5, worldRandom = () => .5, results = () => Infinity
  } = config;
  const between = (min, max) => min + Math.floor(worldRandom() * (max - min + 1));
  let time = 0, term = null, mode = 'none', loaded = 0, index = -1, steps = 0, opens = 0, nextTab = 80, page = null, lastMessage = '';
  const controller = new AbortController();
  const job = { settings, tabId: 7, deadline: settings.minutes * 60000 };
  const feeds = new Map(), records = new Map(), freshTabs = new Map();
  const updates = [], attempts = [], searches = [], clicks = [], created = [], removed = [], viewed = [], refusedOpens = [], draftChecks = [];
  const spent = {}, paused = {};
  const charge = (label, ms) => { spent[label] = (spent[label] || 0) + ms; };
  const total = () => Math.max(0, results(term));
  const itemAt = n => {
    if (!feeds.has(term)) feeds.set(term, []);
    const list = feeds.get(term);
    const number = [...feeds.keys()].indexOf(term);
    while (list.length <= n) {
      const i = list.length;
      const base = post(term, i);
      const handle = `@${feedName(term)}_${i}`;
      const captionless = hash(`${term}/${i}/caption`) % 100 < CAPTIONLESS_PERCENT;
      list.push({
        id: `https://www.tiktok.com/${handle}/video/${7300000000000 + number * 1000000 + i}/`, handle,
        caption: captionless ? '' : base.caption, videoMs: base.videoMs ?? 9000 + (hash(`${term}/${i}/video`) % 50) * 1000
      });
    }
    return list[n];
  };
  const loadedIds = () => Array.from({ length: loaded }, (_, n) => itemAt(n).id);
  const card = (h, id) => {
    const tile = h.element('div', { 'data-e2e': 'search_top-item' }, '', h.rect(0, 0, 100, 100));
    tile.append(h.element('a', { href: id }, '', h.rect(0, 0, 100, 100)));
    return tile;
  };
  const gridDom = () => {
    const ids = loadedIds();
    const h = fastSelectors(fixture({ href: searchURL(term), postId: ids[0] || 'https://www.tiktok.com/@none/video/1/' }));
    h.article.remove(); h.next.remove();
    for (const id of ids) h.main.append(card(h, id));
    h.context.Date = { now: () => time };
    return h;
  };
  const postDom = (item, modal) => {
    const h = fastSelectors(commentComposer({ modal, postId: item.id }));
    h.author.attrs.href = `https://www.tiktok.com/${item.handle}/`;
    h.author.ownText = item.handle;
    if (item.caption) h.caption.textContent = item.caption; else h.caption.remove();
    Object.assign(h.request, { author: item.handle, caption: item.caption });
    h.context.Date = { now: () => time };
    return h;
  };
  const viewerDom = n => {
    const item = itemAt(n);
    if (!records.has(item.id)) records.set(item.id, { item, like: false, follow: false, planned: {} });
    const record = records.get(item.id);
    const h = postDom(item, true);
    const openedAt = time, duration = item.videoMs / 1000;
    h.video.duration = duration;
    Object.defineProperty(h.video, 'currentTime', { get: () => ((time - openedAt) / 1000) % duration, configurable: true });
    // The composer fixture's comment list covers its Next button; TikTok's arrow sits
    // at the viewer's edge, clear of the panel. At the last result there is no Next.
    h.next.bounds = h.rect(760, 300, 36, 36);
    if (n + 1 >= total()) h.next.hidden = true;
    // The results stay mounted behind the viewer, underneath it for hit tests.
    const grid = h.element('div', {}, '', h.rect(0, 0, 1000, 800));
    for (const id of loadedIds()) grid.append(card(h, id));
    h.body.children.unshift(grid);
    grid.parentElement = h.body;
    for (const action of ['like', 'follow']) {
      const shown = h[action].onClick;
      h[action].onClick = () => {
        clicks.push({ action, id: item.id, time });
        shown();
        // A planned 'uncertain' is shown in place and gone on a fresh load.
        if (record.planned[action] !== 'uncertain') record[action] = true;
      };
    }
    const submit = h.submit.onClick;
    h.submit.onClick = () => { clicks.push({ action: 'comment', id: item.id, time }); submit(); };
    viewed.push(item.id);
    return h;
  };
  const freshDom = record => {
    const h = postDom(record.item, false);
    h.like.attrs['aria-pressed'] = String(record.like);
    h.follow.ownText = record.follow ? 'Following' : 'Follow';
    return h;
  };
  const tab = id => {
    if (id === job.tabId) return { id, url: page.context.location.href, status: 'complete' };
    const fresh = freshTabs.get(id);
    if (!fresh) throw new Error(`No tab with id: ${id}.`);
    return time < fresh.readyAt ? { id, url: '', pendingUrl: fresh.url, status: 'loading' } : { id, url: fresh.url, status: 'complete' };
  };
  const runnerContext = vm.createContext({
    URL, console: { ...console, warn: () => {} }, controller, job, Date: { now: () => time }, platforms, validPlatform, platformURL, warmupDiagnostics,
    pendingDraft: false, pendingEngagement: false, messageQueue: Promise.resolve(), diagnostics: warmupDiagnostics.normalize({}), lastBlock: null,
    sleep: async ms => { controller.signal.throwIfAborted(); time += ms; },
    chrome: {
      tabs: {
        get: async id => tab(id),
        create: async options => {
          const record = records.get(options.url);
          assert.ok(record, 'a fresh confirmation opens only a post the session engaged');
          const id = ++nextTab;
          freshTabs.set(id, { url: options.url, h: freshDom(record), readyAt: time + between(2000, 6000) });
          created.push({ ...options, id, time });
          return { id, url: '', pendingUrl: options.url, status: 'loading' };
        },
        remove: async id => { removed.push(id); freshTabs.delete(id); }
      },
      scripting: {
        executeScript: async input => {
          const fresh = freshTabs.get(input.target.tabId);
          if (input.target.tabId !== job.tabId && !fresh) throw new Error(`No tab with id: ${input.target.tabId}.`);
          const target = fresh?.h || page;
          if (input.files) { target.load(); return [{ result: null }]; }
          const result = await target.inject(input.func, input.args);
          if (fresh) assert.deepEqual(fresh.h.clicks, [], 'a fresh confirmation never clicks anything');
          return [{ result }];
        }
      }
    }
  });
  vm.runInContext(RUNNER_SOURCE, runnerContext);
  const timed = (label, operation) => async (...args) => {
    const start = time;
    try { return await operation(...args); } finally { charge(label, time - start); }
  };
  const adapter = {
    update: patch => {
      if (typeof patch.message === 'string') lastMessage = patch.message;
      updates.push({ ...plain(patch), time });
    },
    search: timed('search', async name => {
      searches.push({ term: name, time });
      time += polled(between(2000, 6000), 500);
      term = name; mode = 'grid'; index = -1;
      loaded = Math.min(GRID, total());
      page = gridDom();
      return loaded > 0;
    }),
    inspect: timed('inspect', async () => { time += COST.inspect; return runnerContext.inspect(); }),
    scroll: timed('scroll', async () => {
      time += COST.scroll;
      if (mode !== 'grid' || loaded >= total()) return false;
      loaded = Math.min(loaded + GROW, total());
      page = gridDom();
      return true;
    }),
    open: timed('open', async id => {
      time += COST.open;
      opens += 1;
      const n = loadedIds().indexOf(id);
      // TikTok checks that the card is rendered and not covered before clicking.
      if (n < 0 || opens % OPEN_REFUSED_EVERY === 0) { refusedOpens.push({ id, time }); return false; }
      time += polled(between(1000, 3000), 400);
      mode = 'viewer'; index = n;
      page = viewerDom(n);
      return true;
    }),
    advance: timed('advance', async (current, signal, hasSeen = () => false) => {
      time += COST.advance;
      if (mode !== 'viewer' || !current?.next || index + 1 >= total() || hasSeen(itemAt(index + 1).id)) return false;
      time += polled(between(1000, 3000), 400);
      index += 1;
      if (index >= loaded) loaded = Math.min(loaded + GROW, total());
      page = viewerDom(index);
      return true;
    }),
    leavePost: timed('leave', async () => {
      time += COST.leave;
      mode = 'grid';
      page = gridDom();
      return true;
    }),
    engage: async (action, target, comment) => {
      const start = time;
      const record = records.get(target.id);
      const count = attempts.filter(attempt => attempt.action === action).length + 1;
      const planned = outcome(action, count, record?.item);
      const attempt = { action, id: target.id, author: target.author, comment, caption: record?.item.caption ?? null, time, term, planned };
      attempts.push(attempt);
      if (record) record.planned = { ...record.planned, [action]: planned };
      if (action === 'comment') {
        const viewer = page;
        viewer.request.comment = comment;
        if (planned === 'draft-retained') viewer.state.onInput = () => { viewer.submit.disabled = true; };
        if (planned === 'skipped') { viewer.footer.hidden = true; viewer.openButton.onClick = () => {}; }
      }
      try {
        attempt.result = await runnerContext.engage(action, target, comment);
        return attempt.result;
      } finally { attempt.endedAt = time; charge(action, time - start); }
    },
    draftState: timed('draft-check', async comment => {
      draftChecks.push({ time });
      return runnerContext.recoverPageStep(() => runnerContext.draftStateWithRetry({ comment })).then(state => state || 'unknown');
    })
  };
  const options = {
    random, now: () => time,
    sleep: async ms => {
      if (++steps > 200000) throw new Error('runaway');
      const label = pauseLabel(lastMessage);
      const wait = Math.max(0, ms);
      paused[label] = (paused[label] || 0) + wait;
      time += wait;
    }
  };
  return {
    adapter, options, controller, job, updates, attempts, searches, clicks, created, removed, viewed, refusedOpens, draftChecks, spent, paused,
    time: () => time, diagnostics: () => runnerContext.diagnostics,
    run: async () => {
      try { return { stats: plain(await runSession(settings, adapter, controller.signal, options)) }; }
      catch (error) { return { error }; }
    }
  };
}

// One TikTok run with the named instagram caption scenario and seed. The engine's random
// stream is the same seeded stream the instagram baseline uses; page timings draw from a
// separate stream, so they never shift the engine's choices by themselves.
async function runTikTok(name, seed, { keywordWindowMs, results = defaultResults(seed) } = {}) {
  const scenario = SCENARIOS[name];
  assert.ok(scenario, `unknown scenario ${name}`);
  const context = engine(keywordWindowMs);
  const runSession = vm.runInContext('runSession', context);
  const settings = plain(context.sessionPlan.validateSettings({ platform: 'tiktok', niche: scenario.niche, minutes: MINUTES, enableComments: true }));
  const config = scenario.config();
  const h = tiktokWorld(runSession, settings, {
    post: config.post, outcome: config.outcome, results,
    random: seeded(seed), worldRandom: seeded(seed * 7919 + 104729)
  });
  const { stats, error } = await h.run();
  return { name, seed, settings, stats, error, h };
}

const counts = (list, key) => list.reduce((map, item) => ({ ...map, [item[key]]: (map[item[key]] || 0) + 1 }), {});
const tally = values => Object.fromEntries(Object.entries(values).filter(([, ms]) => ms > 0).map(([label, ms]) => [label, Math.round(ms / 1000)]));

// Numbers and fixed labels only.
function summarizeTikTok(run) {
  const { h, stats, error } = run;
  const last = h.updates.findLast(update => update.stats) || {};
  const messages = h.updates.filter(update => typeof update.message === 'string').map(update => update.message);
  const diagnostics = h.diagnostics();
  // Fresh-page outcomes (persisted, reverted, ...), summed over the in-place results.
  const fresh = action => Object.values(diagnostics[action].pairs).flatMap(Object.entries)
    .reduce((sum, [code, n]) => ({ ...sum, [code]: (sum[code] || 0) + n }), {});
  return {
    keywords: run.settings.terms.length,
    stats: stats || last.stats,
    unconfirmed: last.unconfirmed,
    paused: last.pausedActions,
    attempts: { like: 0, follow: 0, comment: 0, ...counts(h.attempts, 'action') },
    searches: h.searches.length,
    searchMessages: messages.filter(message => message.startsWith('searching for ')).length,
    recoveries: messages.filter(message => message.startsWith('results stopped advancing')).length,
    viewed: h.viewed.length,
    refusedOpens: h.refusedOpens.length,
    freshTabs: h.created.length,
    fresh: { like: fresh('like'), follow: fresh('follow') },
    endedAt: h.time(),
    stopped: error ? 'error' : null,
    spentSeconds: tally(h.spent),
    pausedSeconds: tally(h.paused)
  };
}

const ACTIONS = Object.freeze(['like', 'follow', 'comment']);
const norm = text => String(text).normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const wordRuns = (text, size) => {
  const words = norm(text).split(' ').filter(Boolean);
  return new Set(words.slice(0, Math.max(0, words.length - size + 1)).map((_, index) => words.slice(index, index + size).join(' ')));
};

// What every run must hold, whatever its reach: each outcome came from the page, every
// count is a real click, nothing is done twice, spacing holds, comments are clean, and
// every confirmation tab was a background tab that was closed again.
function checkInvariants(run, label, { toDeadline = true } = {}) {
  const { h, settings, stats, error } = run;
  if (toDeadline) {
    assert.equal(error, undefined, `${label}: ${error?.message}`);
    assert.ok(h.time() >= h.job.deadline, `${label}: the session runs to its deadline`);
  }
  const last = h.updates.findLast(update => update.stats);
  const final = stats || last.stats;
  for (const attempt of h.attempts) assert.equal(attempt.result, attempt.planned, `${label}: the page produced the scenario's ${attempt.action} outcome`);
  for (const action of ACTIONS) {
    const mine = h.attempts.filter(attempt => attempt.action === action);
    const confirmed = mine.filter(attempt => attempt.result === 'confirmed').length;
    const uncertain = mine.filter(attempt => ['uncertain', 'uncertain-draft'].includes(attempt.result)).length;
    const clicks = h.clicks.filter(click => click.action === action);
    assert.equal(final[action], confirmed, `${label}: counted ${action}s are the confirmed ones`);
    assert.equal(last.unconfirmed[action], uncertain, `${label}: unconfirmed ${action}s are the uncertain ones`);
    assert.equal(clicks.length, confirmed + uncertain, `${label}: every ${action} click is counted once, as confirmed or not`);
    assert.ok(confirmed + uncertain <= settings.limits[action], `${label}: ${action}s stay within the target`);
    assert.equal(new Set(clicks.map(click => click.id)).size, clicks.length, `${label}: no post gets a second ${action} click`);
    const keys = mine.map(attempt => action === 'follow' ? attempt.author : attempt.id);
    assert.equal(new Set(keys).size, keys.length, `${label}: no ${action} is attempted twice`);
  }
  assert.equal(new Set(h.viewed).size, h.viewed.length, `${label}: no post is opened twice`);
  const perPost = new Map();
  for (const attempt of h.attempts) perPost.set(attempt.id, (perPost.get(attempt.id) || 0) + 1);
  assert.ok(Math.max(0, ...perPost.values()) <= 2, `${label}: at most two actions per post`);
  const starts = h.attempts.map(attempt => attempt.time).sort((a, b) => a - b);
  for (const start of starts) assert.ok(starts.filter(time => time >= start && time - start < 60000).length <= 6, `${label}: at most six action starts per minute`);
  const posted = (last.comments || []).map(comment => comment.text);
  assert.equal(new Set(posted.map(norm)).size, posted.length, `${label}: no repeated comment wording`);
  for (const attempt of h.attempts.filter(item => item.action === 'comment')) {
    assert.match(attempt.comment, /^[\x20-\x7e]+$/, `${label}: tiktok comments are plain text`);
    assert.doesNotMatch(attempt.comment, /https?:|www\.|\.com\b|@|#/, `${label}: no links, handles or tags in comments`);
    const caption = wordRuns(attempt.caption, 5);
    assert.deepEqual([...wordRuns(attempt.comment, 5)].filter(words => caption.has(words)), [], `${label}: a comment never copies five caption words in a row`);
  }
  const engagementClicks = h.clicks.filter(click => click.action !== 'comment').length;
  assert.equal(h.created.length, engagementClicks, `${label}: one fresh confirmation tab per like or follow click`);
  assert.ok(h.created.every(tab => tab.active === false), `${label}: confirmation tabs open in the background`);
  assert.deepEqual(h.removed, h.created.map(tab => tab.id), `${label}: every confirmation tab is closed`);
  const searchMessages = h.updates.filter(update => typeof update.message === 'string' && update.message.startsWith('searching for ')).length;
  assert.equal(h.searches.length, searchMessages, `${label}: only the engine's keyword searches are counted`);
}

module.exports = { runTikTok, summarizeTikTok, checkInvariants, shippedKeywordWindowMs, defaultResults, ACTIONS, SCENARIOS, SEEDS, MINUTES, GRID, CAPTIONLESS_PERCENT, OPEN_REFUSED_EVERY };
