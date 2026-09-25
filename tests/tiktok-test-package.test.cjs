const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createHash, createPublicKey, webcrypto } = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const { JSDOM } = require('jsdom');

// The separate TikTok-only test build. The packager runs for real into a temporary
// folder with a temporary build record; the committed record and every instagram
// release file must be left exactly as they were.
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'browser-extension');
const flavor = path.join(root, 'flavors', 'tiktok');
const script = path.join(root, 'scripts', 'package-tiktok-test.mjs');
const FOLDER = 'creator-collective-tiktok-test';
const TIKTOK_ID = 'pgkkhpbafojddlaaijcebdjdagakhaca';
const TIKTOK_PATTERNS = ['https://www.tiktok.com/*', 'https://tiktok.com/*'];
const FLAVOR_FILES = ['manifest.json', 'features.js', 'sidepanel.html', 'runner.html', 'tiktok-test.html'];
const PANEL = { id: 'extension-id', url: 'chrome-extension://extension-id/sidepanel.html' };
const sha256 = data => createHash('sha256').update(data).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const read = file => fs.readFileSync(file);
const instagramManifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
const releaseFiles = JSON.parse(fs.readFileSync(path.join(root, 'store', 'build-manifest.json'), 'utf8')).files;
const emptyRecord = { build: 0, base: null, contentSha256: null };

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-tiktok-package-test-'));
const out = path.join(work, 'out');
const record = path.join(work, 'build.json');
const unpacked = path.join(work, 'unpacked');
const run = (args, cwd = root, file = script) => spawnSync(process.execPath, [file, ...args], { cwd, encoding: 'utf8' });
const writeRecord = (value, file = record) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const staged = name => path.join(unpacked, FOLDER, name);

// Everything the instagram release and this repository keep, hashed before any run.
function protectedFiles() {
  const files = [
    ...fs.readdirSync(extension).map(name => path.join(extension, name)),
    ...fs.readdirSync(root).filter(name => /^creator-collective-extension-.*\.zip$/.test(name)).map(name => path.join(root, name)),
    ...fs.readdirSync(path.join(root, 'store')).map(name => path.join(root, 'store', name)),
    ...['release.json', 'setup.html', 'index.html', 'package.json', '.gitignore'].map(name => path.join(root, name)),
    ...fs.readdirSync(flavor).map(name => path.join(flavor, name))
  ];
  return Object.fromEntries(files.filter(file => fs.statSync(file).isFile()).map(file => [path.relative(root, file), sha256(read(file))]));
}
const before = protectedFiles();
const distBefore = fs.existsSync(path.join(root, 'dist'));
let first;

test.before(() => {
  writeRecord(emptyRecord);
  const result = run(['--out', out, '--build-record', record, '--next-build']);
  assert.equal(result.status, 0, result.stderr);
  first = { version: `${instagramManifest.version}.1`, stdout: result.stdout };
  fs.mkdirSync(unpacked);
  execFileSync('unzip', ['-q', path.join(out, `${FOLDER}-${first.version}.zip`), '-d', unpacked]);
});
test.after(() => fs.rmSync(work, { recursive: true, force: true }));

test('the zip holds one tiktok test folder: the instagram files without the two website scripts, plus the test page', () => {
  const zip = path.join(out, `${FOLDER}-${first.version}.zip`);
  const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split(/\r?\n/);
  assert.ok(entries.every(entry => entry.startsWith(`${FOLDER}/`)), 'a single top folder that is not creator-collective-extension');
  const expected = [...releaseFiles.filter(name => !['bridge.js', 'version-bridge.js'].includes(name)), 'tiktok-test.html'].sort();
  assert.deepEqual(entries.filter(entry => !entry.endsWith('/')).map(entry => entry.slice(FOLDER.length + 1)).sort(), expected);
  assert.equal(expected.length, releaseFiles.length - 1);
  assert.deepEqual(fs.readdirSync(out).sort(), ['SHA256SUMS.txt', `${FOLDER}-${first.version}.zip`]);
  assert.equal(fs.readFileSync(path.join(out, 'SHA256SUMS.txt'), 'utf8'), `${sha256(read(zip))}  ${FOLDER}-${first.version}.zip\n`);
  assert.match(first.stdout, new RegExp(`extension id ${TIKTOK_ID}`));
});

test('every packaged file equals browser-extension/ except the flavor files', () => {
  for (const name of fs.readdirSync(path.join(unpacked, FOLDER))) {
    if (FLAVOR_FILES.includes(name)) continue;
    assert.ok(read(staged(name)).equals(read(path.join(extension, name))), name);
  }
  assert.ok(read(staged('features.js')).equals(read(path.join(flavor, 'features.js'))));
  assert.ok(read(staged('tiktok-test.html')).equals(read(path.join(flavor, 'tiktok-test.html'))));
  // The session tab differs only by its brand link, which opens the test page instead of the instagram website.
  const runner = fs.readFileSync(staged('runner.html'), 'utf8');
  assert.equal(runner.split('href="tiktok-test.html"').length, 2);
  assert.equal(runner.replace('href="tiktok-test.html"', 'href="https://creator-collective-warmup.vercel.app/"'), fs.readFileSync(path.join(extension, 'runner.html'), 'utf8'));
});

test('the manifest is tiktok only, with its own name, a fixed id and a four-part version', () => {
  const manifest = JSON.parse(fs.readFileSync(staged('manifest.json'), 'utf8'));
  assert.equal(manifest.name, 'Creator Collective TikTok Warm-up (test)');
  assert.equal(manifest.description, 'test build: run a timed niche browsing session on tiktok, with targets and activity you control.');
  assert.equal(manifest.action.default_title, 'Open TikTok warm-up (test)');
  assert.deepEqual(manifest.host_permissions, TIKTOK_PATTERNS);
  assert.deepEqual(manifest.host_permissions, [...require('../browser-extension/guards.js').platforms.tiktok.patterns]);
  for (const key of ['content_scripts', 'externally_connectable', 'web_accessible_resources', 'optional_host_permissions', 'update_url']) assert.equal(Object.hasOwn(manifest, key), false, key);
  assert.equal(manifest.version, first.version);
  assert.match(manifest.version, /^\d+\.\d+\.\d+\.\d+$/);
  assert.equal(manifest.version_name, `${instagramManifest.version} tiktok test 1`);
  // Chrome derives an unpacked extension's id from this public key instead of its
  // folder, so a newer build loaded from another folder replaces the old one.
  const der = createPublicKey({ key: Buffer.from(manifest.key, 'base64'), format: 'der', type: 'spki' }).export({ type: 'spki', format: 'der' });
  const id = [...sha256(der).slice(0, 32)].map(digit => String.fromCharCode(97 + parseInt(digit, 16))).join('');
  assert.equal(id, TIKTOK_ID);
  assert.ok(fs.readFileSync(path.join(flavor, 'tiktok-test.html'), 'utf8').includes(`<code>${TIKTOK_ID}</code>`));
  assert.ok(fs.readFileSync(path.join(root, 'TESTING-TIKTOK.md'), 'utf8').includes(TIKTOK_ID));
  assert.equal(Object.hasOwn(instagramManifest, 'key'), false, 'the instagram build keeps no key');
  // Everything else is the instagram manifest: same permissions, worker, icons, policy and panel.
  const rest = value => { const copy = { ...value, action: { ...value.action } }; for (const key of ['name', 'description', 'version', 'version_name', 'host_permissions', 'content_scripts', 'key']) delete copy[key]; delete copy.action.default_title; return copy; };
  assert.deepEqual(rest(manifest), rest(instagramManifest));
});

test('the side panel and the test page open the test instructions, never the instagram website', () => {
  const panel = fs.readFileSync(staged('sidepanel.html'), 'utf8');
  assert.ok(panel.includes('<input id="platform" type="hidden" value="tiktok">'));
  assert.ok(panel.includes('<body class="side-panel">'));
  assert.ok(panel.includes('<h1>tiktok warm-up (test)</h1>'));
  const links = [...panel.matchAll(/href="([^"]+)"/g)].map(match => match[1]).filter(href => !/\.(?:png|css)$/.test(href));
  assert.deepEqual(links, ['tiktok-test.html', 'tiktok-test.html', 'tiktok-test.html']);
  assert.doesNotMatch(panel, /https?:|vercel|setup\.html/);
  const visible = new JSDOM(panel).window.document.body.textContent;
  assert.doesNotMatch(visible, /instagram/i, 'no flash of instagram text before the scripts run');
  const page = fs.readFileSync(staged('tiktok-test.html'), 'utf8');
  assert.doesNotMatch(page, /<script\b/i, 'the test page is static');
  assert.doesNotMatch(page, /\b(?:href|src)="https?:/i);
  for (const id of ['install', 'update', 'protocol', 'privacy', 'remove']) assert.ok(page.includes(`id="${id}"`), id);
  // The protocol runs in this order: hand-made like and follow, read-only checks, small targets, default targets.
  const order = ['likes and follows you make by hand', 'check five pages, read only', 'small targets', 'default targets'].map(text => page.indexOf(text));
  assert.ok(order.every(index => index > page.indexOf('id="protocol"')), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  for (const text of ['every one of them reads <code>ok to persisted</code>', 'none is timed-out', 'at least 90% of like checks and of follow checks', 'none reads <code>to reverted</code>']) assert.ok(page.includes(text), text);
});

// The packaged service worker, loaded from the unzipped folder with its own features.js.
function worker(folder) {
  const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
  const badges = [], queries = [];
  const tabs = [{ id: 7, title: 'instagram', url: 'https://www.instagram.com/' }, { id: 8, title: 'tiktok', url: 'https://www.tiktok.com/' }];
  let job;
  const chrome = {
    action: { setBadgeText: async value => { badges.push(value.text); }, setBadgeBackgroundColor: async () => {} },
    sidePanel: { setPanelBehavior: async () => {} },
    runtime: { id: 'extension-id', getURL: p => `chrome-extension://extension-id/${p.replace(/^\//, '')}`, getManifest: () => manifest, onMessage: event(), onStartup: event() },
    storage: { session: { get: async () => ({ job: structuredClone(job) }), set: async value => { job = structuredClone(value.job); } } },
    tabs: { query: async request => { queries.push(plain(request)); return tabs; }, get: async id => tabs.find(tab => tab.id === id), create: async options => ({ id: 99, ...options }), remove: async () => {}, update: async () => ({}), onRemoved: event(), onUpdated: event() }
  };
  const ctx = vm.createContext({ chrome, console, URL, crypto: webcrypto, structuredClone });
  ctx.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(folder, file), 'utf8'), ctx, { filename: file }));
  vm.runInContext(fs.readFileSync(path.join(folder, 'background.js'), 'utf8'), ctx, { filename: 'background.js' });
  const message = (request, sender = PANEL) => new Promise(resolve => {
    if (!chrome.runtime.onMessage.listeners[0](request, sender, response => resolve(plain(response)))) resolve(undefined);
  });
  return { chrome, badges, queries, message };
}

test('the packaged worker runs as the tiktok build, with its test tools and a TT badge', async () => {
  const h = worker(path.join(unpacked, FOLDER));
  assert.deepEqual(h.badges, ['TT']);
  h.chrome.runtime.onStartup.listeners.forEach(listener => listener());
  assert.deepEqual(h.badges, ['TT', 'TT'], 'set again when chrome starts');
  const hello = await h.message({ type: 'hello' });
  assert.equal(hello.ok, true);
  assert.equal(hello.data.version, first.version);
  assert.deepEqual(hello.data.platforms, ['tiktok']);
  assert.equal(hello.data.testTools, true);
  assert.deepEqual(await h.message({ type: 'tabs', platform: 'tiktok' }), { ok: true, data: [{ id: 8, title: 'tiktok' }] });
  assert.deepEqual(h.queries, [{ url: TIKTOK_PATTERNS }]);
  assert.deepEqual(await h.message({ type: 'tabs', platform: 'instagram' }), { ok: false, error: 'this test build runs tiktok only.' });
  assert.equal(h.queries.length, 1, 'an instagram request never reaches chrome.tabs');
  const report = await h.message({ type: 'test-report' });
  assert.match(report.data.text, new RegExp(`^creator collective test report\nversion ${first.version.replace(/\./g, '\\.')}\n`));
});

test('the packaged side panel connects to its own worker as tiktok', async t => {
  const folder = path.join(unpacked, FOLDER);
  const h = worker(folder);
  const dom = new JSDOM(fs.readFileSync(path.join(folder, 'sidepanel.html'), 'utf8'), { url: PANEL.url, runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  const requests = [];
  const storage = new Map();
  Object.defineProperty(window, 'localStorage', { value: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } });
  window.setInterval = () => 1;
  window.chrome = { runtime: { sendMessage: message => { requests.push(plain(message)); return h.message(plain(message)); } } };
  for (const name of ['plan.js', 'comment-history.js', 'session-results.js', 'dashboard.js', 'select-ui.js']) window.eval(fs.readFileSync(path.join(folder, name), 'utf8'));
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
  const $ = id => window.document.getElementById(id);
  assert.equal($('connection').textContent, 'connected');
  assert.equal($('platform').value, 'tiktok');
  assert.equal($('tab-label').textContent, 'tiktok tab');
  assert.equal($('open-instagram').textContent, 'open tiktok ↗');
  assert.equal($('instagram-tab').value, '8');
  assert.ok($('test-tools'), 'test tools appear in the test build');
  assert.deepEqual(requests, [{ type: 'hello' }, { type: 'tabs', platform: 'tiktok' }]);
});

test('the flavor features file sets the tiktok list and never throws where chrome is missing or fails', async () => {
  const source = fs.readFileSync(path.join(flavor, 'features.js'), 'utf8');
  assert.ok(source.includes("const productFeatures = Object.freeze({ accountSignup: false, platforms: Object.freeze(['tiktok']), testTools: true });"));
  const evaluate = context => { vm.runInContext(`${source}\n;globalThis.features = productFeatures;`, vm.createContext(context)); return plain(context.features); };
  assert.deepEqual(evaluate({}), { accountSignup: false, platforms: ['tiktok'], testTools: true });
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    evaluate({ chrome: { action: { setBadgeText: () => { throw new Error('no badge'); } }, runtime: {} } });
    evaluate({ chrome: { action: { setBadgeText: () => Promise.reject(new Error('no badge')), setBadgeBackgroundColor: () => Promise.reject(new Error('no color')) }, runtime: { onStartup: { addListener: () => { throw new Error('no events'); } } } } });
    await new Promise(resolve => setImmediate(resolve));
  } finally { process.off('unhandledRejection', onUnhandled); }
  assert.deepEqual(unhandled, []);
});

test('a rebuild of the same content keeps its number and zips to the same bytes', () => {
  const zip = path.join(out, `${FOLDER}-${first.version}.zip`);
  const bytes = read(zip);
  const saved = fs.readFileSync(record, 'utf8');
  assert.deepEqual(Object.keys(JSON.parse(saved)), ['build', 'base', 'contentSha256']);
  assert.equal(JSON.parse(saved).build, 1);
  const again = run(['--out', out, '--build-record', record]);
  assert.equal(again.status, 0, again.stderr);
  assert.ok(read(zip).equals(bytes));
  const bump = run(['--out', out, '--build-record', record, '--next-build']);
  assert.equal(bump.status, 1);
  assert.match(bump.stderr, /nothing changed since .*\.1\. rebuild it without --next-build/);
  assert.equal(fs.readFileSync(record, 'utf8'), saved);
});

test('changed content needs --next-build, which raises the build number', () => {
  const older = path.join(work, 'older.json');
  writeRecord({ build: 1, base: instagramManifest.version, contentSha256: '0'.repeat(64) }, older);
  const refused = run(['--out', path.join(work, 'older-out'), '--build-record', older]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /changed since .*\.1\. run with --next-build/);
  assert.equal(fs.existsSync(path.join(work, 'older-out')), false, 'nothing is written when the build number is stale');
  const bumped = run(['--out', path.join(work, 'older-out'), '--build-record', older, '--next-build']);
  assert.equal(bumped.status, 0, bumped.stderr);
  assert.equal(JSON.parse(fs.readFileSync(older, 'utf8')).build, 2);
  const manifest = JSON.parse(execFileSync('unzip', ['-p', path.join(work, 'older-out', `${FOLDER}-${instagramManifest.version}.2.zip`), `${FOLDER}/manifest.json`], { encoding: 'utf8' }));
  assert.equal(manifest.version, `${instagramManifest.version}.2`);
  assert.equal(manifest.version_name, `${instagramManifest.version} tiktok test 2`);
  assert.equal(manifest.key, JSON.parse(fs.readFileSync(staged('manifest.json'), 'utf8')).key, 'the id stays the same across builds');
});

test('build numbers restart only when the instagram base moves forward, and never go back', async () => {
  const { nextRecord } = await import('../scripts/package-tiktok-test.mjs');
  const content = 'a'.repeat(64);
  assert.deepEqual(nextRecord(emptyRecord, { base: '0.6.58', content, next: true }).record, { build: 1, base: '0.6.58', contentSha256: content });
  assert.deepEqual(nextRecord({ build: 4, base: '0.6.58', contentSha256: 'b'.repeat(64) }, { base: '0.6.58', content, next: true }).record, { build: 5, base: '0.6.58', contentSha256: content });
  assert.deepEqual(nextRecord({ build: 4, base: '0.6.57', contentSha256: content }, { base: '0.6.58', content, next: true }).record, { build: 1, base: '0.6.58', contentSha256: content });
  assert.throws(() => nextRecord({ build: 4, base: '0.6.58', contentSha256: 'b'.repeat(64) }, { base: '0.6.57', content, next: true }), /went back from 0\.6\.58 to 0\.6\.57/);
  assert.throws(() => nextRecord({ build: 4, base: '0.6.57', contentSha256: content }, { base: '0.6.58', content, next: false }), /changed since 0\.6\.57\.4/);
  assert.throws(() => nextRecord(emptyRecord, { base: '0.6.58', content, next: false }), /no tiktok test build is numbered yet/);
  assert.deepEqual(nextRecord({ build: 4, base: '0.6.58', contentSha256: content }, { base: '0.6.58', content, next: false }), { record: { build: 4, base: '0.6.58', contentSha256: content }, changed: false });
  for (const bad of [null, [], { build: -1, base: null, contentSha256: null }, { build: 1.5, base: '0.6.58', contentSha256: content }, { build: 0, base: '0.6.58', contentSha256: null },
    { build: 2, base: '0.6', contentSha256: content }, { build: 2, base: '0.6.58', contentSha256: 'xyz' }, { build: 65535, base: '0.6.58', contentSha256: content }]) {
    assert.throws(() => nextRecord(bad, { base: '0.6.58', content, next: true }), /build record is not valid/, JSON.stringify(bad));
  }
});

test('the committed build record is a valid record for this flavor', () => {
  const committed = JSON.parse(fs.readFileSync(path.join(flavor, 'build.json'), 'utf8'));
  assert.deepEqual(Object.keys(committed), ['build', 'base', 'contentSha256']);
  assert.ok(Number.isSafeInteger(committed.build) && committed.build >= 0);
  if (committed.build > 0) {
    assert.match(committed.base, /^\d+\.\d+\.\d+$/);
    assert.match(committed.contentSha256, /^[0-9a-f]{64}$/);
  }
});

test('markup changes upstream stop the build instead of shipping instagram links or text', async () => {
  const { tiktokSidePanel, tiktokRunner } = await import('../scripts/package-tiktok-test.mjs');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.equal(tiktokSidePanel(index), fs.readFileSync(staged('sidepanel.html'), 'utf8'));
  assert.throws(() => tiktokSidePanel(index.replace('<input id="platform" type="hidden" value="instagram">', '')), /expected 1 match/);
  assert.throws(() => tiktokSidePanel(index.replace('</nav>', '<a href="privacy.html">privacy</a></nav>')), /expected 0 match/);
  assert.throws(() => tiktokSidePanel(index.replace('<h2>settings</h2>', '<h2>instagram settings</h2>')), /instagram text is left/);
  const runner = fs.readFileSync(path.join(extension, 'runner.html'), 'utf8');
  assert.throws(() => tiktokRunner(runner.replace('</main>', '<a href="https://creator-collective-warmup.vercel.app/">home</a></main>')), /expected 1 match/);
  assert.throws(() => tiktokRunner(runner.replace('</main>', '<img src="https://creator-collective-warmup.vercel.app/x.png"></main>')), /instagram website is left/);
});

test('the packager refuses outputs inside the repository and unknown options', () => {
  for (const args of [['--out', path.join(root, 'store')], ['--out', root], ['--out', path.join(extension)], ['--build-record', path.join(root, 'release.json')], ['--surprise']]) {
    const result = run([...args, '--next-build']);
    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, /tiktok test package failed/);
  }
});

// A copy of just the files the packager reads, so its source checks can be tried
// against broken mirrors without touching the real repository.
function sandbox() {
  const copy = fs.mkdtempSync(path.join(work, 'repo-'));
  for (const dir of ['browser-extension', 'flavors', 'scripts']) fs.cpSync(path.join(root, dir), path.join(copy, dir), { recursive: true });
  fs.mkdirSync(path.join(copy, 'store'));
  fs.copyFileSync(path.join(root, 'store', 'build-manifest.json'), path.join(copy, 'store', 'build-manifest.json'));
  for (const name of ['index.html', 'comment-history.js', 'session-results.js', 'dashboard.js', 'select-ui.js', 'signup-ui.js', 'phone-ui.js', 'plan.js', 'dashboard.css', 'inter.woff2', 'cc-logo.webp', 'platform-instagram.svg', 'platform-tiktok.svg', 'INTER-LICENSE.txt']) {
    fs.copyFileSync(path.join(root, name), path.join(copy, name));
  }
  writeRecord(emptyRecord, path.join(copy, 'flavors', 'tiktok', 'build.json'));
  return { copy, run: () => run(['--next-build'], copy, path.join(copy, 'scripts', 'package-tiktok-test.mjs')) };
}

test('the packager builds from matching sources without the instagram release check, and stops on stale mirrors or unlisted files', () => {
  const good = sandbox();
  const built = good.run();
  assert.equal(built.status, 0, built.stderr);
  assert.match(built.stdout, /^tiktok test build \d+\.\d+\.\d+\.1 /, 'the script ran from a symlinked temporary path');
  assert.ok(fs.existsSync(path.join(good.copy, 'dist', `${FOLDER}-${instagramManifest.version}.1.zip`)), 'no release.json, setup.html or instagram zips are needed');
  for (const [name, change, message] of [
    ['stale mirror', copy => fs.appendFileSync(path.join(copy, 'dashboard.js'), '\n// edited\n'), /browser-extension\/dashboard\.js is not a copy of dashboard\.js/],
    ['stale side panel', copy => fs.appendFileSync(path.join(copy, 'index.html'), '\n'), /sidepanel\.html is not generated from index\.html/],
    ['unlisted file', copy => fs.writeFileSync(path.join(copy, 'browser-extension', 'extra.js'), ''), /browser-extension\/extra\.js is not in the release file list/],
    ['missing file', copy => fs.rmSync(path.join(copy, 'browser-extension', 'tiktok.js')), /release file list names a missing file: tiktok\.js/],
    ['bad key', copy => {
      const file = path.join(copy, 'flavors', 'tiktok', 'manifest.overrides.json');
      fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), key: 'bm90IGEga2V5' }));
    }, /key is not a valid public key/],
    ['extra permission', copy => {
      const file = path.join(copy, 'flavors', 'tiktok', 'manifest.overrides.json');
      fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), host_permissions: [...TIKTOK_PATTERNS, 'https://www.instagram.com/*'] }));
    }, /host permissions are not exactly the tiktok patterns/],
    ['instagram features', copy => fs.copyFileSync(path.join(extension, 'features.js'), path.join(copy, 'flavors', 'tiktok', 'features.js')), /must set platforms \['tiktok'\]/]
  ]) {
    const broken = sandbox();
    change(broken.copy);
    const result = broken.run();
    assert.equal(result.status, 1, name);
    assert.match(result.stderr, message, name);
    assert.equal(fs.existsSync(path.join(broken.copy, 'dist')), false, `${name}: nothing is written`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(broken.copy, 'flavors', 'tiktok', 'build.json'), 'utf8')).build, 0, `${name}: the build number is not used up`);
  }
});

test('packaging never changed browser-extension/, the instagram release files or the committed build record', () => {
  assert.deepEqual(protectedFiles(), before);
  assert.equal(fs.existsSync(path.join(root, 'dist')), distBefore, 'tests write only to a temporary folder');
});
