const test = require('node:test');
const assert = require('node:assert/strict');
const { runTikTok, summarizeTikTok, checkInvariants, shippedKeywordWindowMs, defaultResults, ACTIONS, SEEDS } = require('./fixtures/tiktok-goals-world.cjs');
const { runBaseline } = require('./fixtures/instagram-goals-world.cjs');

// TikTok search results are finite. A keyword searched again returns the same list from
// the top, and a short list runs out. These runs use the matching captions of the
// efficiency gate (tiktok-efficiency.test.cjs), with the shipped keyword window and with
// the six-minute window of tiktok-efficiency-window.test.cjs.
const REACH = 0.9;
const SIX_MINUTES = 360000;
const WINDOWS = Object.freeze({ shipped: undefined, 'six-minute': SIX_MINUTES });
const STOPPED = "tiktok still isn't showing new posts. session stopped. check the results in tiktok or try different keywords before restarting.";
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const round = value => Math.round(value * 100) / 100;

test('when one keyword runs out early, tiktok keeps its reach on the other keyword', async t => {
  const instagram = [];
  for (const seed of SEEDS) instagram.push((await runBaseline('matching', seed)).stats);
  const baseline = Object.fromEntries(ACTIONS.map(action => [action, average(instagram.map(stats => stats[action]))]));
  const report = {};
  for (const [label, keywordWindowMs] of Object.entries(WINDOWS)) {
    const summaries = [];
    for (const seed of SEEDS) {
      // 'study tips' has only 30 results; 'exam prep' has the gate's usual 120-240.
      const plenty = defaultResults(seed);
      const run = await runTikTok('matching', seed, { keywordWindowMs, results: term => term === 'study tips' ? 30 : plenty(term) });
      checkInvariants(run, `${label} short keyword/${seed}`);
      const summary = summarizeTikTok(run);
      assert.ok(summary.recoveries > 0, `${label}/${seed}: the short keyword ran out and the session moved on`);
      summaries.push(summary);
    }
    const reach = Object.fromEntries(ACTIONS.map(action => [action, average(summaries.map(summary => summary.stats[action]))]));
    report[label] = {
      keywordWindowSeconds: (keywordWindowMs ?? shippedKeywordWindowMs()) / 1000,
      reach: Object.fromEntries(ACTIONS.map(action => [action, round(reach[action])])),
      searches: round(average(summaries.map(summary => summary.searches))), recoveries: round(average(summaries.map(summary => summary.recoveries))),
      findingResultsPauseSeconds: round(average(summaries.map(summary => summary.pausedSeconds['finding-results'] || 0))),
      scrollSeconds: round(average(summaries.map(summary => summary.spentSeconds.scroll || 0)))
    };
    for (const action of ACTIONS) {
      assert.ok(reach[action] >= REACH * baseline[action], `${label} ${action}: tiktok averages ${round(reach[action])}, below 90% of instagram's ${round(baseline[action])}`);
    }
  }
  t.diagnostic(JSON.stringify({ instagram: baseline, ...report }));
});

test('when every keyword runs out, the session stops with a clear message and repeats nothing', async t => {
  const report = {};
  for (const [label, keywordWindowMs] of Object.entries(WINDOWS)) {
    const ended = [];
    for (const seed of SEEDS) {
      const run = await runTikTok('matching', seed, { keywordWindowMs, results: () => 25 });
      assert.equal(run.error?.message, STOPPED, `${label}/${seed}: stops with the clear message`);
      checkInvariants(run, `${label} exhausted/${seed}`, { toDeadline: false });
      assert.ok(run.h.time() < run.h.job.deadline, `${label}/${seed}: stops before the deadline`);
      assert.ok(run.h.viewed.length <= 50, `${label}/${seed}: only the 50 results were opened`);
      const lastAction = Math.max(0, ...run.h.attempts.map(attempt => attempt.endedAt));
      assert.ok(lastAction <= run.h.time(), `${label}/${seed}: no action after the stop`);
      ended.push(summarizeTikTok(run));
    }
    report[label] = {
      stoppedAtMinute: round(average(ended.map(summary => summary.endedAt / 60000))),
      reach: Object.fromEntries(ACTIONS.map(action => [action, round(average(ended.map(summary => summary.stats[action])))])),
      viewed: round(average(ended.map(summary => summary.viewed)))
    };
  }
  t.diagnostic(JSON.stringify(report));
});
