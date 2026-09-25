const test = require('node:test');
const assert = require('node:assert/strict');
const { runTikTok, summarizeTikTok, checkInvariants, shippedKeywordWindowMs, ACTIONS, SCENARIOS, SEEDS, MINUTES } = require('./fixtures/tiktok-goals-world.cjs');
const { runBaseline } = require('./fixtures/instagram-goals-world.cjs');

// The per-scenario gate for the TikTok keyword window (KEYWORD_WINDOW_MS in session.js).
//
// These are the runs of tiktok-efficiency.test.cjs with the TikTok window pinned to
// instagram's six minutes in this test's own copy of session.js (the file on disk is not
// changed). session.js ships that same window, which the first test checks.
//
// With six-minute windows each scenario, not only the average, reaches at least 90% of
// the instagram baseline for each target, in 7 searches instead of 20. The earlier two-
// minute window fell short on corpus comments (about 3.3 against instagram's 4.25): in
// that scenario both keywords' results hold the few commentable captions at the same
// positions, two-minute windows walk the two lists in step, so those posts arrive in pairs
// less than the two-minute comment spacing apart and the second of each pair is passed over.
const SIX_MINUTES = 360000;
const REACH = 0.9;
const totalMs = MINUTES * 60000;
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const round = value => Math.round(value * 100) / 100;

test('tiktok ships instagram\'s six-minute keyword window', () => {
  assert.equal(shippedKeywordWindowMs(), SIX_MINUTES);
});

for (const name of Object.keys(SCENARIOS)) {
  test(`six-minute tiktok keyword windows reach at least 90% of instagram's ${name} baseline for each target`, async t => {
    const summaries = [], instagram = [];
    for (const seed of SEEDS) {
      const run = await runTikTok(name, seed, { keywordWindowMs: SIX_MINUTES });
      checkInvariants(run, `six-minute ${name}/${seed}`);
      const summary = summarizeTikTok(run);
      const windowMs = Math.max(10000, Math.min(SIX_MINUTES, totalMs / summary.keywords));
      assert.ok(summary.searches <= Math.ceil(totalMs / windowMs) + summary.recoveries, `${name}/${seed}: ${summary.searches} searches`);
      if (!summary.recoveries) assert.equal(summary.searches, Math.ceil(totalMs / windowMs), `${name}/${seed}: one search per six-minute window`);
      summaries.push(summary);
      instagram.push((await runBaseline(name, seed)).stats);
    }
    const reach = Object.fromEntries(ACTIONS.map(action => [action, {
      tiktok: average(summaries.map(summary => summary.stats[action])), instagram: average(instagram.map(stats => stats[action]))
    }]));
    t.diagnostic(JSON.stringify({
      scenario: name, keywordWindowSeconds: SIX_MINUTES / 1000,
      reach: Object.fromEntries(ACTIONS.map(action => [action, { tiktok: round(reach[action].tiktok), instagram: round(reach[action].instagram) }])),
      searches: round(average(summaries.map(summary => summary.searches))), recoveries: round(average(summaries.map(summary => summary.recoveries))),
      viewed: round(average(summaries.map(summary => summary.viewed)))
    }));
    for (const action of ACTIONS) {
      assert.ok(reach[action].tiktok >= REACH * reach[action].instagram,
        `${name} ${action}: tiktok averages ${round(reach[action].tiktok)}, below 90% of instagram's ${round(reach[action].instagram)}`);
    }
  });
}
