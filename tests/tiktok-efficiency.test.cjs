const test = require('node:test');
const assert = require('node:assert/strict');
const { runTikTok, summarizeTikTok, checkInvariants, shippedKeywordWindowMs, ACTIONS, SCENARIOS, SEEDS, MINUTES } = require('./fixtures/tiktok-goals-world.cjs');
const { runBaseline } = require('./fixtures/instagram-goals-world.cjs');

// The "same efficiency" gate for the TikTok test build, on the engine as shipped.
//
// Each run is the real plan, comment writer and engine, with runner.js confirming every
// like, follow and comment against tiktok.js in the DOM fixture, for 40 minutes at the
// default targets (60 likes, 18 follows, 7 comments), two keywords and a fixed seed. The
// caption scenarios, outcome patterns and seeds are the golden instagram baseline's
// (instagram-goals-baseline.test.cjs), so a difference in reach comes from TikTok code:
// fresh-page confirmation, the keyword window, watch-only viewing, the plain-text writer.
// On top: finite results, 2-6 s confirmation tabs and search loads, 1-3 s viewer renders,
// absent captions and refused opens (see fixtures/tiktok-goals-world.cjs).
//
// Gate: averaged over every scenario and seed, TikTok reaches at least 90% of the
// instagram baseline for likes, follows and comments (instagram itself averages about
// 58/60, 17.3/18 and 6.1/7 here), with zero duplicate actions in every run.
//
// Per scenario the gate is in tiktok-efficiency-window.test.cjs. The shipped TikTok keyword
// window is instagram's six minutes; with the earlier two-minute window corpus comments
// reached only about 3.3 against instagram's 4.25.
const REACH = 0.9;
const totalMs = MINUTES * 60000;
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const round = value => Math.round(value * 100) / 100;

const runs = new Map();
function tiktokRuns(name) {
  if (!runs.has(name)) {
    runs.set(name, (async () => {
      const summaries = [];
      for (const seed of SEEDS) {
        const run = await runTikTok(name, seed);
        checkInvariants(run, `tiktok ${name}/${seed}`);
        summaries.push(summarizeTikTok(run));
      }
      return summaries;
    })());
  }
  return runs.get(name);
}
async function instagramAverages(name) {
  const stats = [];
  for (const seed of SEEDS) stats.push((await runBaseline(name, seed)).stats);
  return Object.fromEntries(ACTIONS.map(action => [action, average(stats.map(item => item[action]))]));
}
const averages = summaries => Object.fromEntries(ACTIONS.map(action => [action, average(summaries.map(summary => summary.stats[action]))]));
const seconds = (summaries, key) => {
  const labels = [...new Set(summaries.flatMap(summary => Object.keys(summary[key])))].sort();
  return Object.fromEntries(labels.map(label => [label, Math.round(average(summaries.map(summary => summary[key][label] || 0)))]));
};

test('the tiktok efficiency runs use the instagram baseline scenarios, seeds and targets', async () => {
  assert.deepEqual(Object.keys(SCENARIOS), ['matching', 'mixed', 'corpus']);
  assert.equal(SEEDS.length, 12);
  const run = await runTikTok('matching', SEEDS[0]);
  assert.equal(run.settings.platform, 'tiktok');
  assert.equal(run.settings.minutes, 40);
  assert.deepEqual(run.settings.limits, { like: 60, follow: 18, comment: 7 });
  assert.equal(run.settings.terms.length, 2);
});

for (const name of Object.keys(SCENARIOS)) {
  test(`tiktok ${name} captions: 12 seeds run to the deadline with zero duplicate actions`, async t => {
    const summaries = await tiktokRuns(name);
    const windowMs = Math.max(10000, Math.min(shippedKeywordWindowMs(), totalMs / summaries[0].keywords));
    for (const [index, summary] of summaries.entries()) {
      // Keyword searches only: one per keyword window, plus one per recovery.
      assert.ok(summary.searches <= Math.ceil(totalMs / windowMs) + summary.recoveries, `${name}/${SEEDS[index]}: ${summary.searches} searches`);
      if (!summary.recoveries) assert.equal(summary.searches, Math.ceil(totalMs / windowMs), `${name}/${SEEDS[index]}: one search per keyword window`);
    }
    t.diagnostic(JSON.stringify({
      scenario: name, keywordWindowSeconds: windowMs / 1000,
      reach: Object.fromEntries(Object.entries(averages(summaries)).map(([action, value]) => [action, round(value)])),
      unconfirmed: Object.fromEntries(ACTIONS.map(action => [action, round(average(summaries.map(summary => summary.unconfirmed[action])))])),
      searches: round(average(summaries.map(summary => summary.searches))), recoveries: round(average(summaries.map(summary => summary.recoveries))),
      viewed: round(average(summaries.map(summary => summary.viewed))), refusedOpens: round(average(summaries.map(summary => summary.refusedOpens))),
      stepSeconds: seconds(summaries, 'spentSeconds'), pauseSeconds: seconds(summaries, 'pausedSeconds')
    }));
  });
}

test('tiktok reaches at least 90% of the instagram baseline for each target on average', async t => {
  const tiktok = [], instagram = [], table = {};
  for (const name of Object.keys(SCENARIOS)) {
    const summaries = await tiktokRuns(name);
    const baseline = await instagramAverages(name);
    tiktok.push(...summaries.map(summary => summary.stats));
    instagram.push(baseline);
    const reach = averages(summaries);
    table[name] = Object.fromEntries(ACTIONS.map(action => [action, { tiktok: round(reach[action]), instagram: round(baseline[action]) }]));
  }
  // Every scenario has the same 12 seeds, so the mean of the instagram scenario means is
  // the instagram mean over the same 36 runs.
  const overall = Object.fromEntries(ACTIONS.map(action => [action, {
    tiktok: average(tiktok.map(stats => stats[action])), instagram: average(instagram.map(stats => stats[action]))
  }]));
  t.diagnostic(JSON.stringify({ perScenario: table, overall: Object.fromEntries(ACTIONS.map(action => [action, {
    tiktok: round(overall[action].tiktok), instagram: round(overall[action].instagram), share: round(overall[action].tiktok / overall[action].instagram)
  }])) }));
  for (const action of ACTIONS) {
    const { tiktok: reached, instagram: baseline } = overall[action];
    assert.ok(reached >= REACH * baseline, `${action}: tiktok averages ${round(reached)}, below 90% of instagram's ${round(baseline)}`);
  }
});
