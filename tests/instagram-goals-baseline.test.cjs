const test = require('node:test');
const assert = require('node:assert/strict');
const { runBaseline, summarize, SCENARIOS, SEEDS } = require('./fixtures/instagram-goals-world.cjs');

// Golden Instagram baseline, recorded at d5865be (extension 0.6.57) before any TikTok
// parity change. Each run is the real plan, comment writer and engine at 40 minutes with
// the default targets (60 likes, 18 follows, 7 comments), two keywords and a fixed seed,
// against the frozen instagram world in fixtures/instagram-goals-world.cjs.
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
  'mixed/1': {stats:{scroll:154,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:4,skipResults:2,draftChecks:2,viewed:148,endedAt:2400000,digest:'a727e2b130a9f17501b11f0c'},
  'mixed/2': {stats:{scroll:173,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:5,skipResults:2,draftChecks:2,viewed:167,endedAt:2400134,digest:'32fb1bfe779aaa0a740f80d3'},
  'mixed/3': {stats:{scroll:178,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:6,skipResults:2,draftChecks:2,viewed:169,endedAt:2400000,digest:'abae63b98bb6a4cb4a4b3a91'},
  'mixed/4': {stats:{scroll:184,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:4,skipResults:2,draftChecks:2,viewed:175,endedAt:2400000,digest:'2698e8d9f42990482cb81a72'},
  'mixed/5': {stats:{scroll:167,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:8,skipResults:2,draftChecks:2,viewed:161,endedAt:2400000,digest:'42300492abc468467771bc59'},
  'mixed/6': {stats:{scroll:169,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:2,skipResults:2,draftChecks:2,viewed:164,endedAt:2400000,digest:'3a2379eadc96f504038abd4d'},
  'mixed/7': {stats:{scroll:166,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:3,skipResults:2,draftChecks:2,viewed:159,endedAt:2400000,digest:'803fb98022f91e7525a5c637'},
  'mixed/8': {stats:{scroll:169,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:5,skipResults:2,draftChecks:2,viewed:163,endedAt:2400000,digest:'9f807bad6dd0d61e3fc34b62'},
  'mixed/9': {stats:{scroll:164,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:3,skipResults:2,draftChecks:2,viewed:157,endedAt:2400000,digest:'8023fa55e404d5145bbee82e'},
  'mixed/10': {stats:{scroll:181,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:4,skipResults:2,draftChecks:2,viewed:172,endedAt:2400000,digest:'5f3d3f57b9938651422ee1af'},
  'mixed/11': {stats:{scroll:160,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:5,skipResults:2,draftChecks:2,viewed:153,endedAt:2400000,digest:'f90026a216bccdaaefe5b1e7'},
  'mixed/12': {stats:{scroll:184,read:0,search:7,open:7,like:54,follow:16,comment:7,skipped:10},unconfirmed:{like:6,follow:2,comment:0},paused:[],attempts:{like:60,follow:18,comment:9},searches:'study tips|exam prep|study tips|exam prep|study tips|exam prep|study tips',skipNotes:6,skipResults:2,draftChecks:2,viewed:175,endedAt:2400000,digest:'016ee3ad5c21a0574b02b28d'},
  'corpus/1': {stats:{scroll:177,read:0,search:7,open:7,like:60,follow:18,comment:5,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:5},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:11,skipResults:0,draftChecks:0,viewed:169,endedAt:2400098,digest:'c8faa8b34d257f834e3af164'},
  'corpus/2': {stats:{scroll:196,read:0,search:7,open:7,like:60,follow:18,comment:4,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:4},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:10,skipResults:0,draftChecks:0,viewed:187,endedAt:2400000,digest:'b2ff6c81d5ce268a3f184e5d'},
  'corpus/3': {stats:{scroll:181,read:0,search:7,open:7,like:60,follow:18,comment:5,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:5},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:9,skipResults:0,draftChecks:0,viewed:173,endedAt:2400000,digest:'eefe3f7c4441a9faceabc361'},
  'corpus/4': {stats:{scroll:177,read:0,search:7,open:7,like:60,follow:18,comment:4,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:4},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:10,skipResults:0,draftChecks:0,viewed:169,endedAt:2400596,digest:'288a9bbec79d846f95eda5c3'},
  'corpus/5': {stats:{scroll:181,read:0,search:7,open:7,like:60,follow:18,comment:5,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:5},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:10,skipResults:0,draftChecks:0,viewed:172,endedAt:2400000,digest:'f09d5afbfbc6f7ea95ae49c4'},
  'corpus/6': {stats:{scroll:180,read:0,search:7,open:7,like:60,follow:18,comment:4,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:4},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:11,skipResults:0,draftChecks:0,viewed:171,endedAt:2400000,digest:'be1366b7a7d6f556efef190a'},
  'corpus/7': {stats:{scroll:181,read:0,search:7,open:7,like:60,follow:18,comment:4,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:4},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:10,skipResults:0,draftChecks:0,viewed:172,endedAt:2400000,digest:'89258a56dcb7e41d5c077ae9'},
  'corpus/8': {stats:{scroll:176,read:0,search:7,open:7,like:60,follow:18,comment:5,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:5},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:9,skipResults:0,draftChecks:0,viewed:167,endedAt:2400000,digest:'8522da66b5203c6387d41aa1'},
  'corpus/9': {stats:{scroll:184,read:0,search:7,open:7,like:60,follow:18,comment:4,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:4},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:10,skipResults:0,draftChecks:0,viewed:176,endedAt:2400000,digest:'11c5082904b0db960f5e07e6'},
  'corpus/10': {stats:{scroll:185,read:0,search:7,open:7,like:60,follow:18,comment:5,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:5},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:9,skipResults:0,draftChecks:0,viewed:176,endedAt:2400000,digest:'adfdad72a6d2c425751d4645'},
  'corpus/11': {stats:{scroll:192,read:0,search:7,open:7,like:60,follow:18,comment:3,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:3},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:11,skipResults:0,draftChecks:0,viewed:183,endedAt:2400098,digest:'03c08c4c1119f2cbf7ee4a02'},
  'corpus/12': {stats:{scroll:186,read:0,search:7,open:7,like:60,follow:18,comment:3,skipped:0},unconfirmed:{like:0,follow:0,comment:0},paused:[],attempts:{like:60,follow:18,comment:3},searches:'fitness|workout|fitness|workout|fitness|workout|fitness',skipNotes:10,skipResults:0,draftChecks:0,viewed:177,endedAt:2400000,digest:'5ce869ce7e47388635e4eba5'},
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
