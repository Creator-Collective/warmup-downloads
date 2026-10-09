const test = require('node:test');
const assert = require('node:assert/strict');
const { runBaseline, summarize, SCENARIOS, SEEDS } = require('./fixtures/instagram-goals-world.cjs');

// Golden Instagram baseline, recorded at d5865be (extension 0.6.57) before any TikTok
// parity change. Each run is the real plan, comment writer and engine at 40 minutes with
// the default targets (60 likes, 18 follows, 7 comments), two keywords and a fixed seed,
// against the frozen instagram world in fixtures/instagram-goals-world.cjs.
//
// 0.6.66 re-recorded the mixed and corpus runs on purpose: a post from the current
// keyword search can now get a comment even when its caption never repeats the
// keyword. Corpus comments went from 3-5 of 7 to 7 of 7; matching runs are unchanged.
//
// Every later change must reproduce these numbers and trace digests exactly. The digest
// covers the ordered trace: each action with its post, time and comment wording, each
// search, each activity message and each draft check. A digest-only difference means
// timing, order or wording moved; compare traceOf() output from before and after.
//
// Scope: this pins the Instagram behaviour of session.js, plan.js and comment-writer.js on
// these scenarios. It does not run runner.js, background.js, guards.js or dashboard.js;
// those shared paths are pinned in instagram-runner-baseline.test.cjs and
// instagram-panel-baseline.test.cjs.
const GOLDEN = {
  'matching/1': {stats:{scroll:187,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:0,draftChecks:0,viewed:178,endedAt:2400000,digest:'483a7138c9d80433227f11e2'},
  'matching/2': {stats:{scroll:185,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:0,draftChecks:0,viewed:177,endedAt:2400000,digest:'a5582d8a21caab35c442bb53'},
  'matching/3': {stats:{scroll:183,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:0,draftChecks:0,viewed:175,endedAt:2400022,digest:'6900e969de9a7a535afb9961'},
  'matching/4': {stats:{scroll:174,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:0,draftChecks:0,viewed:166,endedAt:2400000,digest:'481cb1e897783e453096b8a1'},
  'matching/5': {stats:{scroll:187,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:0,draftChecks:0,viewed:179,endedAt:2400000,digest:'4242213a30dd97aa06a8dc9a'},
  'matching/6': {stats:{scroll:179,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:0,draftChecks:0,viewed:170,endedAt:2400000,digest:'b49920aa10f67c09353cabdb'},
  'matching/7': {stats:{scroll:173,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:0,draftChecks:0,viewed:165,endedAt:2400000,digest:'0fb497d3d89e931484ce3cac'},
  'matching/8': {stats:{scroll:177,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:0,draftChecks:0,viewed:168,endedAt:2400000,digest:'ccb4b46827daebd19f147bcd'},
  'matching/9': {stats:{scroll:178,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:0,draftChecks:0,viewed:172,endedAt:2400000,digest:'8ad03eb7587f78aaa64b98fa'},
  'matching/10': {stats:{scroll:183,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:0,draftChecks:0,viewed:175,endedAt:2400000,digest:'ba33c7b7ec604910b99c56e0'},
  'matching/11': {stats:{scroll:199,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:0,draftChecks:0,viewed:188,endedAt:2400000,digest:'f421639d417e9e155f94aaac'},
  'matching/12': {stats:{scroll:186,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:0,draftChecks:0,viewed:177,endedAt:2400000,digest:'6fff461fa933ecc1557330e2'},
  'mixed/1': {stats:{scroll:159,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:2,draftChecks:2,viewed:153,endedAt:2400000,digest:'bcea82dc903f83f240662cd0'},
  'mixed/2': {stats:{scroll:174,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:2,draftChecks:2,viewed:166,endedAt:2400000,digest:'ee08e93bc808a51cf68ff331'},
  'mixed/3': {stats:{scroll:174,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:2,draftChecks:2,viewed:166,endedAt:2400000,digest:'3803346722c70329b67c8b11'},
  'mixed/4': {stats:{scroll:160,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:2,draftChecks:2,viewed:154,endedAt:2400000,digest:'cf7785051d586411283ed50f'},
  'mixed/5': {stats:{scroll:178,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:2,draftChecks:2,viewed:169,endedAt:2400000,digest:'4adf40c1ef234bc79fa9f211'},
  'mixed/6': {stats:{scroll:164,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:2,draftChecks:2,viewed:158,endedAt:2400000,digest:'00b6d9ed6991824b0835dd97'},
  'mixed/7': {stats:{scroll:157,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:2,draftChecks:2,viewed:152,endedAt:2400000,digest:'e7d4c431e3f2dc042947a214'},
  'mixed/8': {stats:{scroll:165,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:2,draftChecks:2,viewed:157,endedAt:2400000,digest:'fe9bde99e33de0b0958c68ac'},
  'mixed/9': {stats:{scroll:151,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:2,draftChecks:2,viewed:145,endedAt:2400000,digest:'b104142cd558df5095031f70'},
  'mixed/10': {stats:{scroll:176,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:2,draftChecks:2,viewed:169,endedAt:2400000,digest:'cbc6c3435bec523f1071881b'},
  'mixed/11': {stats:{scroll:173,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:2,draftChecks:2,viewed:165,endedAt:2400000,digest:'ce34a1eec07bfae186aeb6f8'},
  'mixed/12': {stats:{scroll:161,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:0,skipResults:2,draftChecks:2,viewed:153,endedAt:2400000,digest:'c8eeb6667e01cf7c90ba8d07'},
  'corpus/1': {stats:{scroll:187,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:0,skipResults:0,draftChecks:0,viewed:178,endedAt:2400000,digest:'b45831dbc15b65db4efc8e74'},
  'corpus/2': {stats:{scroll:185,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:0,skipResults:0,draftChecks:0,viewed:177,endedAt:2400000,digest:'33b44322a867f9ec252c2976'},
  'corpus/3': {stats:{scroll:183,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:0,skipResults:0,draftChecks:0,viewed:175,endedAt:2400022,digest:'23e606620adf82317a05c809'},
  'corpus/4': {stats:{scroll:176,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:0,skipResults:0,draftChecks:0,viewed:168,endedAt:2400000,digest:'8c774a646e7fc614f2be5dc2'},
  'corpus/5': {stats:{scroll:187,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:0,skipResults:0,draftChecks:0,viewed:179,endedAt:2400000,digest:'f5dc6ab90d7359bf93428750'},
  'corpus/6': {stats:{scroll:179,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:0,skipResults:0,draftChecks:0,viewed:170,endedAt:2400000,digest:'e90b3fd397aef4d0e386eeda'},
  'corpus/7': {stats:{scroll:173,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:0,skipResults:0,draftChecks:0,viewed:165,endedAt:2400000,digest:'5c8ab12f99c5f823933da8d1'},
  'corpus/8': {stats:{scroll:177,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:0,skipResults:0,draftChecks:0,viewed:168,endedAt:2400000,digest:'3e8080cef0548951ec09497b'},
  'corpus/9': {stats:{scroll:178,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:0,skipResults:0,draftChecks:0,viewed:172,endedAt:2400000,digest:'4f64f518ccbceee7de47ed3d'},
  'corpus/10': {stats:{scroll:183,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:0,skipResults:0,draftChecks:0,viewed:175,endedAt:2400000,digest:'8ecc0b6c77a77209d60809c1'},
  'corpus/11': {stats:{scroll:193,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:1,skipResults:0,draftChecks:0,viewed:184,endedAt:2400000,digest:'c07e50528a2b60c78a9f07a4'},
  'corpus/12': {stats:{scroll:186,read:0,search:7,open:7,like:60,follow:18,comment:7,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:7},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:0,skipResults:0,draftChecks:0,viewed:177,endedAt:2400000,digest:'a517f246d493cc362fa4dea9'},
};

const norm = text => String(text).normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const wordRuns = (text, size) => {
  const words = norm(text).split(' ').filter(Boolean);
  return new Set(words.slice(0, Math.max(0, words.length - size + 1)).map((_, index) => words.slice(index, index + size).join(' ')));
};

test('the golden snapshot covers every scenario and seed', () => {
  assert.deepEqual(Object.keys(GOLDEN), Object.keys(SCENARIOS).flatMap(name => SEEDS.map(seed => `${name}/${seed}`)));
});

for (const name of Object.keys(SCENARIOS)) {
  test(`instagram ${name} captions reproduce the golden 40-minute runs for every seed`, async () => {
    for (const seed of SEEDS) {
      const run = await runBaseline(name, seed);
      const { digest, ...numbers } = summarize(run);
      const { digest: expectedDigest, ...expectedNumbers } = GOLDEN[`${name}/${seed}`];
      assert.deepEqual(numbers, expectedNumbers, `${name}/${seed}: counts changed`);
      assert.equal(digest, expectedDigest, `${name}/${seed}: the ordered trace changed (timing, order or wording)`);

      // Invariants the golden runs already satisfy, checked directly as well.
      const { h, captions } = run;
      const perPost = new Map();
      for (const attempt of h.attempts) perPost.set(attempt.id, (perPost.get(attempt.id) || 0) + 1);
      assert.ok(Math.max(...perPost.values()) <= 2, `${name}/${seed}: at most two actions per post`);
      const starts = h.attempts.map(attempt => attempt.time).sort((a, b) => a - b);
      for (const start of starts) assert.ok(starts.filter(time => time >= start && time - start < 60000).length <= 6, `${name}/${seed}: at most six action starts per minute`);
      const posted = h.updates.at(-1).comments.map(comment => comment.text);
      assert.equal(new Set(posted.map(norm)).size, posted.length, `${name}/${seed}: no repeated comment wording`);
      for (const attempt of h.attempts.filter(item => item.action === 'comment')) {
        assert.doesNotMatch(attempt.comment, /https?:|www\.|\.com\b|@|#/, `${name}/${seed}: no links, handles or tags in comments`);
        const caption = wordRuns(captions.get(attempt.id), 5);
        assert.deepEqual([...wordRuns(attempt.comment, 5)].filter(run => caption.has(run)), [], `${name}/${seed}: a comment never copies five caption words in a row`);
      }
    }
  });
}
