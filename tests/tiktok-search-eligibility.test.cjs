const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({ URL, setTimeout, clearTimeout });
for (const file of ['plan.js', 'comment-writer.js', 'session.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../browser-extension', file), 'utf8'), context);
const { runSession, matchesNiche } = vm.runInContext('({ runSession, matchesNiche })', context);
const settings = patch => JSON.parse(JSON.stringify(context.sessionPlan.validateSettings({
  platform: 'tiktok', minutes: 3, niche: 'personal brand', enableComments: true,
  customLimits: { like: 3, follow: 2, comment: 1 }, ...patch
})));
const url = number => `https://www.tiktok.com/@creator${number}/video/${9000000000000000000n + BigInt(number)}`;
const variant = 'Sharing your process helps people understand your work #brandbuilding';

// A real session timeline, with separate search grids and viewer-only
// recommendations. Time advances for loading, watching and confirmations.
function simulation(options = {}) {
  let time = 0;
  let serial = 0;
  let requestedTerm;
  let grid;
  let viewer = null;
  let viewerIndex = -1;
  let generation = 0;
  let searches = 0;
  let randomState = options.seed ?? 47;
  const controller = new AbortController();
  const updates = [];
  const attempts = [];
  const visits = [];
  const remembered = [];
  const createGrid = () => {
    const posts = Array.from({ length: options.batchSize ?? 12 }, (_, index) => {
      const number = ++serial;
      const caption = options.caption?.(number, requestedTerm) ?? variant;
      return {
        id: url(number), author: `creator${number}`, text: caption, caption,
        viewer: true, like: true, follow: true, comment: true,
        videoRemainingMs: 17000, ...options.post?.(number, requestedTerm)
      };
    });
    const listed = posts.filter((post, index) => !options.recommendations || index % 3 !== 1);
    grid = { posts, listed };
    remembered.push(...listed.map(post => post.id));
  };
  const load = async ms => { time += ms; };
  const adapter = {
    update: patch => updates.push({ ...patch, observedAt: time }),
    search: async term => {
      requestedTerm = term;
      searches++;
      generation++;
      viewer = null;
      createGrid();
      if (options.onSearch) await options.onSearch({ generation, grid, remembered, setTime: value => { time = value; } });
      await load(options.searchMs ?? 2500);
      return options.searchResult;
    },
    inspect: async () => {
      if (viewer) return { post: viewer, ...(options.viewerMetadata ? { search: { term: requestedTerm, posts: [viewer.id] } } : {}) };
      const search = options.metadata === false ? undefined : {
        term: options.metadataTerm?.(requestedTerm, generation) ?? requestedTerm,
        posts: options.metadataPosts?.(grid.listed, generation, remembered) ?? grid.listed.map(post => post.id)
      };
      return { post: null, posts: grid.listed.map(post => post.id), sequence: grid.listed.map(post => post.id), search };
    },
    open: async id => {
      viewerIndex = grid.posts.findIndex(post => post.id === id);
      viewer = grid.posts[viewerIndex];
      visits.push(viewer);
      await load(900);
      return true;
    },
    advance: async () => {
      if (options.abortOnAdvance) controller.abort();
      if (options.sticky) { await load(700); return true; }
      viewer = grid.posts[++viewerIndex];
      await load(700);
      if (viewer) { visits.push(viewer); return true; }
      createGrid();
      return false;
    },
    leavePost: async () => { viewer = null; return true; },
    scroll: async () => { if (options.abortOnScroll) controller.abort(); await load(700); return true; },
    engage: async (action, post, comment, signal) => {
      assert.equal(signal.aborted, false);
      attempts.push({ action, id: post.id, comment, generation, time, listed: grid.listed.some(item => item.id === post.id) });
      await load({ like: 1500, follow: 4500, comment: 7000 }[action]);
      if (options.abortOnEngage) controller.abort();
      return options.outcome ?? 'confirmed';
    }
  };
  const runOptions = {
    now: () => time,
    sleep: load,
    random: () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 4294967296;
    }
  };
  return { adapter, controller, runOptions, attempts, updates, visits, get time() { return time; }, get searches() { return searches; } };
}

async function run(options = {}, patch = {}) {
  const h = simulation(options);
  const plan = settings(patch);
  h.stats = await runSession(plan, h.adapter, h.controller.signal, h.runOptions);
  h.plan = plan;
  return h;
}

test("a captured personal-brand search result can be liked and followed despite a caption that doesn't use the keyword", async () => {
  assert.equal(matchesNiche(variant, ['personal brand']), false);
  assert.equal(context.commentWriter.looseNicheMatch(variant, ['personal brand']), false);
  const h = await run();
  assert.equal(h.stats.like, 3);
  assert.equal(h.stats.follow, 2);
  assert.equal(h.stats.comment, 0, 'search membership does not grant permission to generate a comment');
  assert.ok(h.attempts.every(attempt => attempt.listed));
  assert.ok(h.updates.some(update => /this post doesn't mention your keywords/.test(update.message)));
});

test('viewer recommendations outside the captured grid never become eligible, including forged viewer metadata', async () => {
  const h = await run({ recommendations: true, viewerMetadata: true });
  assert.ok(h.visits.some(post => h.attempts.every(attempt => attempt.id !== post.id)));
  assert.ok(h.stats.like > 0 && h.stats.follow > 0);
  assert.ok(h.attempts.every(attempt => attempt.listed));
});

test('off-niche feeds without grid metadata and grids with the wrong query remain ineligible', async () => {
  for (const options of [{ metadata: false }, { metadataTerm: () => 'personal branding' }, { metadataTerm: () => 'old query' }]) {
    const h = await run(options);
    assert.equal(h.attempts.length, 0);
    assert.ok(h.stats.scroll > 0);
    assert.ok(h.updates.some(update => /does not match your keywords or current search results/.test(update.message)));
  }
});

test('each requested query clears earlier membership before receiving any new grid', async () => {
  let priorPost;
  const h = await run({
    metadataTerm: (term, generation) => generation > 1 ? 'personal brand' : term,
    onSearch: ({ generation, grid }) => {
      if (generation === 1) priorPost = { ...grid.posts.at(-1) };
      else { grid.posts[0] = priorPost; grid.listed[0] = priorPost; }
    }
  }, { minutes: 4, niche: 'personal brand, storytelling', customLimits: { like: 10, follow: 4, comment: 0 } });
  assert.ok(h.searches >= 2);
  assert.ok(h.attempts.some(attempt => attempt.generation === 1));
  assert.equal(h.attempts.some(attempt => attempt.generation === 2), false, 'stale query metadata cannot renew any membership');
});

test('rerunning a session cannot reuse an earlier run’s captured IDs', async () => {
  const first = await run();
  assert.ok(first.stats.like > 0);
  const second = await run({ metadata: false });
  assert.equal(second.attempts.length, 0);
});

test('only canonical TikTok result IDs count and search membership has a fixed 1000-post bound', async () => {
  for (const metadataPosts of [
    posts => posts.map(post => post.id.replace('https:', 'http:')),
    posts => posts.map(post => post.id.replace('www.tiktok.com', 'www.tiktok.com.evil.test')),
    posts => posts.map(post => post.id.replace('https://', 'https://user@')),
    posts => posts.map(post => post.id.replace(/\/@[^/]+\//, '/@different/')),
    posts => Array.from({ length: 1000 }, (_, index) => url(index + 100000)).concat(posts.map(post => post.id))
  ]) {
    const h = await run({ metadataPosts });
    assert.equal(h.attempts.length, 0);
  }
  const h = await run({ metadataPosts: posts => posts.map(post => post.id.replace('www.tiktok.com', 'tiktok.com') + '/?lang=en') });
  assert.ok(h.stats.like > 0, 'host, trailing slash and tracking query differences preserve the same canonical post');
});

test('search membership respects unavailable controls, zero targets, confirmation time and Stop', async () => {
  const missing = await run({ post: () => ({ like: false, follow: false, comment: false }) });
  assert.equal(missing.attempts.length, 0);
  assert.ok(missing.updates.some(update => /its control is not available/.test(update.message)));
  const zero = await run({}, { customLimits: { like: 0, follow: 0, comment: 0 } });
  assert.equal(zero.attempts.length, 0);
  assert.equal(zero.updates.some(update => /skipped:/.test(update.message)), false);
  const deadline = await run({ searchMs: 39000 }, { minutes: 1 });
  assert.equal(deadline.attempts.length, 0);
  const stopped = await run({ abortOnEngage: true });
  assert.equal(stopped.attempts.length, 1);
  assert.match(stopped.updates.at(-1).message, /session stopped/);
});

test('skip explanations appear once per post without counting an attempt or logging cooldowns', async () => {
  const h = await run({ sticky: true, post: () => ({ like: false, follow: false, comment: false }) });
  const skips = h.updates.filter(update => /skipped:/.test(update.message));
  assert.equal(skips.length, 1);
  assert.equal(h.stats.like + h.stats.follow + h.stats.comment, 0);
  assert.equal(h.stats.skipped, 0);
  assert.ok(skips.every(update => !/cooldown|waiting/.test(update.message)));
});

test('safe-comment skips name keyword-bait captions, and on-niche captions keep getting distinct wording', async () => {
  const bait = await run({ caption: () => 'Comment GUIDE below for my personal brand checklist' });
  assert.equal(bait.stats.comment, 0);
  assert.equal(bait.attempts.filter(attempt => attempt.action === 'comment').length, 0);
  assert.ok(bait.updates.some(update => /asks for a keyword reply or giveaway entry/.test(update.message)));
  const repeated = await run({ caption: () => 'Sharing your process makes a personal brand more concrete.' }, {
    minutes: 30, customLimits: { like: 0, follow: 0, comment: 8 }
  });
  assert.equal(repeated.stats.comment, 8);
  const texts = repeated.attempts.filter(attempt => attempt.action === 'comment').map(attempt => attempt.comment);
  assert.equal(texts.length, 8);
  assert.equal(new Set(texts).size, 8);
});

test('Instagram still requires caption relevance even when TikTok-shaped search metadata is present', async () => {
  const h = await run({}, { platform: 'instagram' });
  assert.equal(h.attempts.length, 0);
  const matching = await run({ caption: () => 'Sharing your process makes a personal brand more concrete.' }, { platform: 'instagram' });
  assert.ok(matching.stats.like > 0);
});

test('a sixty-minute mixed TikTok search session reaches supported targets without relying on off-niche recommendations', async t => {
  const details = [
    'Sharing your process makes a personal brand more concrete.',
    'Daily practice helps a personal brand improve every day.',
    'Storytelling makes a personal brand easier to remember.',
    'Video editing gives a personal brand its recognizable style.',
    'Posting consistently helps a personal brand develop its voice.'
  ];
  const scenario = {
    recommendations: true,
    caption: number => number % 4 === 0 ? details[Math.floor(number / 4) % details.length] : variant
  };
  const plan = { minutes: 60, customLimits: { like: 180, follow: 54, comment: 15 } };
  const h = await run(scenario, plan);
  assert.equal(h.time, 3600000);
  assert.ok(h.stats.like >= 170, `likes: ${h.stats.like}`);
  assert.ok(h.stats.follow >= 50, `follows: ${h.stats.follow}`);
  assert.ok(h.stats.comment >= 12, `comments: ${h.stats.comment}`);
  assert.ok(h.attempts.every(attempt => attempt.listed || details.includes(h.visits.find(post => post.id === attempt.id)?.caption)));
  for (const action of ['like', 'follow', 'comment']) {
    assert.ok(h.stats[action] <= h.plan.limits[action]);
    const actionAttempts = h.attempts.filter(attempt => attempt.action === action);
    assert.equal(new Set(actionAttempts.map(attempt => attempt.id)).size, actionAttempts.length);
    assert.ok(actionAttempts.every(attempt => attempt.time <= 3600000 - { like: 22000, follow: 22000, comment: 20000 }[action]));
  }
  assert.equal(new Set(h.attempts.filter(attempt => attempt.action === 'comment').map(attempt => attempt.comment)).size, h.stats.comment);
  const captionOnly = await run({ ...scenario, metadata: false }, plan);
  assert.ok(h.stats.like > captionOnly.stats.like, 'recognizing observed search results removes the previous exact-caption bottleneck');
  t.diagnostic(`simulated confirmed outcomes: ${h.stats.like}/180 likes, ${h.stats.follow}/54 follows, ${h.stats.comment}/15 comments; ${h.stats.scroll} advances in 60 minutes`);
  t.diagnostic(`same simulated feed with previous caption-only eligibility: ${captionOnly.stats.like}/180 likes, ${captionOnly.stats.follow}/54 follows, ${captionOnly.stats.comment}/15 comments`);
});
