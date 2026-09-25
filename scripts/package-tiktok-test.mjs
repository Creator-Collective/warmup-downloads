// Builds the separate TikTok-only test extension from the same browser-extension/
// source as the instagram build, plus the files in flavors/tiktok/.
//
//   node scripts/package-tiktok-test.mjs               rebuild the recorded test build
//   node scripts/package-tiktok-test.mjs --next-build  number a changed build (n + 1)
//   --out <dir>            write the zip somewhere other than dist/
//   --build-record <file>  use another build record (tests only)
//
// It stages in a temporary folder and writes only the zip and SHA256SUMS.txt, plus
// flavors/tiktok/build.json when --next-build numbers a new build. It never writes
// browser-extension/, release.json, store/, setup.html or the instagram zips, and it
// does not need the instagram release check to pass: it checks only that the side
// panel sources are mirrored and that every staged file equals its source.
import { createHash, createPublicKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const extension = path.join(root, 'browser-extension');
const flavor = path.join(root, 'flavors', 'tiktok');
const FOLDER = 'creator-collective-tiktok-test';
const TEST_PAGE = 'tiktok-test.html';
const ORIGIN = 'https://creator-collective-warmup.vercel.app';
// Content scripts for the instagram website and the student page. The test build
// has neither, so it can never answer those pages instead of the instagram build.
const LEFT_OUT = Object.freeze(['bridge.js', 'version-bridge.js']);
// Files that differ from browser-extension/ on purpose. Everything else is byte-equal.
const FLAVOR_FILES = Object.freeze(['manifest.json', 'features.js', 'sidepanel.html', 'runner.html', TEST_PAGE]);
// Root files that scripts/package-extension.mjs mirrors into browser-extension/.
const MIRRORS = Object.freeze(['comment-history.js', 'session-results.js', 'dashboard.js', 'select-ui.js', 'signup-ui.js', 'phone-ui.js', 'plan.js',
  'dashboard.css', 'inter.woff2', 'cc-logo.webp', 'platform-instagram.svg', 'platform-tiktok.svg', 'INTER-LICENSE.txt']);
const FIXED_TIME = new Date('2026-01-01T00:00:00Z');
const sha256 = data => createHash('sha256').update(data).digest('hex');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const inside = (parent, child) => { const relative = path.relative(parent, child); return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)); };

// Replaces exactly `count` matches, so a markup change upstream stops the build
// instead of shipping instagram text or links in the tiktok panel.
function replaceExact(text, search, replacement, count, what) {
  const found = text.split(search).length - 1;
  if (found !== count) throw new Error(`${what}: expected ${count} match(es) for ${JSON.stringify(search)}, found ${found}`);
  return text.split(search).join(replacement);
}

// JSON merge patch (RFC 7396): objects merge, null removes a key, anything else replaces.
function mergePatch(target, patch) {
  if (!isObject(patch)) return patch;
  const result = isObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = mergePatch(result[key], value);
  }
  return result;
}

export function extensionIdFromKey(key) {
  const der = createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' }).export({ type: 'spki', format: 'der' });
  return [...sha256(der).slice(0, 32)].map(digit => String.fromCharCode(97 + parseInt(digit, 16))).join('');
}

export function tiktokSidePanel(index) {
  const hrefs = { '/': 1, 'setup.html': 2, 'privacy.html': 0 };
  for (const [value, count] of Object.entries(hrefs)) replaceExact(index, `href="${value}"`, '', count, 'side panel link');
  let panel = index.replace(/href="(\/|setup\.html|privacy\.html)"/g, (_, value) => `href="${TEST_PAGE}${value === 'privacy.html' ? '#privacy' : ''}" target="_blank" rel="noopener"`);
  for (const [search, replacement] of [
    ['<body>', '<body class="side-panel">'],
    ['<title>auto warm-up · creator collective</title>', '<title>tiktok warm-up test · creator collective</title>'],
    ['aria-label="creator collective warm-up home"', 'aria-label="tiktok test build instructions"'],
    ['<h1>auto warm-up</h1>', '<h1>tiktok warm-up (test)</h1>'],
    ['<input id="platform" type="hidden" value="instagram">', '<input id="platform" type="hidden" value="tiktok">'],
    ['>instagram tab</label>', '>tiktok tab</label>'],
    ['data-icon="instagram"', 'data-icon="tiktok"'],
    ['open instagram ↗', 'open tiktok ↗']
  ]) panel = replaceExact(panel, search, replacement, 1, 'side panel');
  // Element ids (instagram-tab, open-instagram) are what dashboard.js looks up; no
  // visible text or other attribute may still say instagram.
  if (/instagram/i.test(panel.replace(/\b(?:id|for)="[^"]*"/g, ''))) throw new Error('side panel: instagram text is left after the tiktok replacements');
  return panel;
}

export function tiktokRunner(runner) {
  const page = replaceExact(runner, `href="${ORIGIN}/"`, `href="${TEST_PAGE}"`, 1, 'runner brand link');
  if (page.includes(ORIGIN)) throw new Error('runner: a link to the instagram website is left');
  return page;
}

function instagramSidePanel(index) {
  return index.replace('<body>', '<body class="side-panel">')
    .replace(/href="(\/|setup\.html|privacy\.html)"/g, (_, value) => `href="${ORIGIN}/${value === '/' ? '' : value}" target="_blank" rel="noopener"`);
}

function features(source) {
  const context = vm.createContext({});
  vm.runInContext(`${source}\n;globalThis.__features = productFeatures;`, context);
  const value = JSON.parse(JSON.stringify(context.__features));
  if (JSON.stringify(value) !== JSON.stringify({ accountSignup: false, platforms: ['tiktok'], testTools: true })) {
    throw new Error("flavors/tiktok/features.js must set platforms ['tiktok'], testTools true and accountSignup false");
  }
}

async function tiktokManifest(guards) {
  const base = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  const overrides = JSON.parse(await readFile(path.join(flavor, 'manifest.overrides.json'), 'utf8'));
  for (const key of ['version', 'version_name', 'manifest_version', 'permissions', 'externally_connectable', 'web_accessible_resources', 'optional_host_permissions']) {
    if (Object.hasOwn(overrides, key)) throw new Error(`manifest overrides may not set ${key}`);
  }
  if (!/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(base.version)) throw new Error('browser-extension/manifest.json has no three-part version');
  const manifest = mergePatch(base, overrides);
  const problems = [];
  if (JSON.stringify(manifest.host_permissions) !== JSON.stringify([...guards.platforms.tiktok.patterns])) problems.push('host permissions are not exactly the tiktok patterns');
  if (JSON.stringify(manifest.permissions) !== JSON.stringify(base.permissions)) problems.push('permissions differ from the instagram build');
  for (const key of ['content_scripts', 'externally_connectable', 'web_accessible_resources', 'optional_host_permissions', 'update_url']) if (Object.hasOwn(manifest, key)) problems.push(`${key} must be absent`);
  for (const key of ['name', 'description']) if (manifest[key] === base[key]) problems.push(`${key} must differ from the instagram build`);
  if (manifest.action?.default_title === base.action?.default_title) problems.push('action title must differ from the instagram build');
  if (!/tiktok/i.test(manifest.name) || !/\(test\)/.test(manifest.name)) problems.push('name must say tiktok and (test)');
  let id = null;
  try { id = extensionIdFromKey(manifest.key); } catch { problems.push('key is not a valid public key'); }
  if (problems.length) throw new Error(`tiktok manifest:\n- ${problems.join('\n- ')}`);
  return { base: base.version, manifest, id };
}

// The manifest with its version fields set, keeping the source key order.
function versioned(manifest, version, versionName) {
  const result = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (key === 'version_name') continue;
    if (key === 'version') { result.version = version; if (versionName) result.version_name = versionName; } else result[key] = value;
  }
  return result;
}

async function checkSources() {
  const errors = [];
  for (const file of MIRRORS) {
    const [source, mirror] = await Promise.all([readFile(path.join(root, file)), readFile(path.join(extension, file)).catch(() => null)]);
    if (!mirror || !source.equals(mirror)) errors.push(`browser-extension/${file} is not a copy of ${file}`);
  }
  const index = await readFile(path.join(root, 'index.html'), 'utf8');
  if (instagramSidePanel(index) !== await readFile(path.join(extension, 'sidepanel.html'), 'utf8')) errors.push('browser-extension/sidepanel.html is not generated from index.html');
  const listed = JSON.parse(await readFile(path.join(root, 'store', 'build-manifest.json'), 'utf8')).files;
  if (!Array.isArray(listed) || new Set(listed).size !== listed.length || !listed.every(file => typeof file === 'string' && /^[\w.-]+$/.test(file))) errors.push('store/build-manifest.json has no usable file list');
  const present = (await readdir(extension, { withFileTypes: true })).filter(entry => entry.isFile() && !entry.name.startsWith('.')).map(entry => entry.name);
  for (const file of present) if (!listed?.includes?.(file)) errors.push(`browser-extension/${file} is not in the release file list`);
  for (const file of listed || []) if (!present.includes(file)) errors.push(`release file list names a missing file: ${file}`);
  for (const file of LEFT_OUT) if (!listed?.includes?.(file)) errors.push(`expected ${file} in the release file list`);
  if (errors.length) throw new Error(`sources are not ready for a tiktok test build:\n- ${errors.join('\n- ')}\nrun npm run package:extension to refresh the mirrors.`);
  return { index, files: listed.filter(file => !LEFT_OUT.includes(file)) };
}

async function stage(folder, files, generated) {
  await mkdir(folder, { mode: 0o755 });
  const names = [...new Set([...files, TEST_PAGE])].sort();
  for (const name of names) {
    const target = path.join(folder, name);
    if (Object.hasOwn(generated, name)) await writeFile(target, generated[name]);
    else await copyFile(path.join(extension, name), target);
    await chmod(target, 0o644);
    await utimes(target, FIXED_TIME, FIXED_TIME);
  }
  await utimes(folder, FIXED_TIME, FIXED_TIME);
  return names;
}

async function verifyStaged(folder, names, generated, manifest) {
  const errors = [];
  if (JSON.stringify(Object.keys(generated).sort()) !== JSON.stringify([...FLAVOR_FILES].sort())) errors.push('generated files are not exactly the flavor files');
  for (const file of LEFT_OUT) if (names.includes(file)) errors.push(`${file} must not ship`);
  for (const file of FLAVOR_FILES) if (!names.includes(file)) errors.push(`${file} is missing`);
  // Only the flavor files may differ from browser-extension/.
  for (const name of names) {
    const expected = FLAVOR_FILES.includes(name) ? Buffer.from(generated[name] ?? '') : await readFile(path.join(extension, name));
    if (!(await readFile(path.join(folder, name))).equals(expected)) errors.push(`${name} differs from ${FLAVOR_FILES.includes(name) ? 'its flavor source' : `browser-extension/${name}`}`);
  }
  const references = [manifest.background?.service_worker, manifest.side_panel?.default_path, ...Object.values(manifest.icons || {}), ...Object.values(manifest.action?.default_icon || {})];
  const background = await readFile(path.join(folder, 'background.js'), 'utf8');
  for (const call of background.matchAll(/importScripts\(([^)]*)\)/g)) references.push(...[...call[1].matchAll(/'([^']+)'/g)].map(match => match[1]));
  for (const page of names.filter(name => name.endsWith('.html'))) {
    const html = await readFile(path.join(folder, page), 'utf8');
    if (/\b(?:href|src)="https?:/i.test(html)) errors.push(`${page} links outside the extension`);
    for (const match of html.matchAll(/\b(?:href|src)="([^"#?]+)/g)) if (!/^(?:https?|chrome|mailto):/i.test(match[1])) references.push(match[1]);
  }
  for (const reference of references) if (!reference || !names.includes(reference)) errors.push(`missing referenced file: ${reference}`);
  if (/<script\b/i.test(generated[TEST_PAGE])) errors.push(`${TEST_PAGE} must stay static, without scripts`);
  if (errors.length) throw new Error(`staged tiktok test build failed its checks:\n- ${errors.join('\n- ')}`);
}

async function contentHash(folder, names, manifest) {
  const hash = createHash('sha256');
  for (const name of names) {
    const bytes = name === 'manifest.json' ? Buffer.from(JSON.stringify(versioned(manifest, undefined, undefined))) : await readFile(path.join(folder, name));
    hash.update(`${name}\0${sha256(bytes)}\n`);
  }
  return hash.digest('hex');
}

const parts = version => version.split('.').map(Number);
const compareVersions = (a, b) => { for (let i = 0; i < 3; i += 1) if (parts(a)[i] !== parts(b)[i]) return parts(a)[i] - parts(b)[i]; return 0; };

// The record says which test build number belongs to which content. A rebuild of
// the same content keeps its number; changed content needs --next-build.
export function nextRecord(record, { base, content, next }) {
  const valid = isObject(record) && Number.isSafeInteger(record.build) && record.build >= 0 && record.build < 65535 &&
    (record.build === 0 ? record.base === null && record.contentSha256 === null
      : typeof record.base === 'string' && /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(record.base) && /^[0-9a-f]{64}$/.test(record.contentSha256));
  if (!valid) throw new Error('the build record is not valid');
  const same = record.build > 0 && record.base === base && record.contentSha256 === content;
  if (!next) {
    if (record.build === 0) throw new Error('no tiktok test build is numbered yet. run with --next-build.');
    if (!same) throw new Error(`the tiktok test build changed since ${record.base}.${record.build}. run with --next-build to number the new build.`);
    return { record, changed: false };
  }
  if (same) throw new Error(`nothing changed since ${record.base}.${record.build}. rebuild it without --next-build.`);
  if (record.build > 0 && compareVersions(base, record.base) < 0) throw new Error(`the instagram base version went back from ${record.base} to ${base}`);
  // A new instagram base starts the count again; the full version still rises.
  const build = record.build > 0 && record.base === base ? record.build + 1 : 1;
  return { record: { build, base, contentSha256: content }, changed: true };
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' }, 'build-record': { type: 'string' }, 'next-build': { type: 'boolean', default: false } }, strict: true, allowPositionals: false });
  const dist = path.join(root, 'dist');
  const out = path.resolve(values.out || dist);
  const recordPath = path.resolve(values['build-record'] || path.join(flavor, 'build.json'));
  if (inside(root, out) && !inside(dist, out)) throw new Error('--out must be dist/ or a folder outside the repository');
  if (inside(root, recordPath) && recordPath !== path.join(flavor, 'build.json')) throw new Error('--build-record must be flavors/tiktok/build.json or a file outside the repository');

  const guards = createRequire(import.meta.url)(path.join(extension, 'guards.js'));
  const { index, files } = await checkSources();
  const { base, manifest, id } = await tiktokManifest(guards);
  const featureSource = await readFile(path.join(flavor, 'features.js'), 'utf8');
  features(featureSource);
  const generated = {
    'features.js': featureSource,
    'sidepanel.html': tiktokSidePanel(index),
    'runner.html': tiktokRunner(await readFile(path.join(extension, 'runner.html'), 'utf8')),
    [TEST_PAGE]: await readFile(path.join(flavor, TEST_PAGE), 'utf8')
  };
  let record;
  try { record = JSON.parse(await readFile(recordPath, 'utf8')); } catch { throw new Error(`can't read the build record ${recordPath}`); }
  const staging = await mkdtemp(path.join(tmpdir(), 'cc-tiktok-test-'));
  try {
    const folder = path.join(staging, FOLDER);
    // Staged and checked first with the plain base version; the numbered version goes in once the record allows it.
    const draft = { ...generated, 'manifest.json': `${JSON.stringify(versioned(manifest, base, undefined), null, 2)}\n` };
    const names = await stage(folder, files, draft);
    await verifyStaged(folder, names, draft, manifest);
    const content = await contentHash(folder, names, manifest);
    const { record: current, changed } = nextRecord(record, { base, content, next: values['next-build'] });
    if (changed) await writeFile(recordPath, `${JSON.stringify(current, null, 2)}\n`);
    const version = `${base}.${current.build}`;
    const final = { ...draft, 'manifest.json': `${JSON.stringify(versioned(manifest, version, `${base} tiktok test ${current.build}`), null, 2)}\n` };
    await writeFile(path.join(folder, 'manifest.json'), final['manifest.json']);
    await utimes(path.join(folder, 'manifest.json'), FIXED_TIME, FIXED_TIME);
    await verifyStaged(folder, names, final, manifest);
    await mkdir(out, { recursive: true });
    const zipName = `${FOLDER}-${version}.zip`;
    const zip = path.join(out, zipName);
    await rm(zip, { force: true });
    // Fixed times, modes, order and no extra attributes: the same build zips to the same bytes.
    execFileSync('/usr/bin/zip', ['-q', '-X', zip, `${FOLDER}/`, ...names.map(name => `${FOLDER}/${name}`)], { cwd: staging, env: { ...process.env, TZ: 'UTC' } });
    const digest = sha256(await readFile(zip));
    await writeFile(path.join(out, 'SHA256SUMS.txt'), `${digest}  ${zipName}\n`);
    console.log(`tiktok test build ${version} (${base} tiktok test ${current.build}), extension id ${id}`);
    const shown = file => { const relative = path.relative(process.cwd(), file); return relative && !relative.startsWith('..') ? relative : file; };
    console.log(`${shown(zip)}\nsha256 ${digest}`);
    if (changed) console.log(`numbered a new build. commit ${shown(recordPath)}.`);
  } finally { await rm(staging, { recursive: true, force: true }); }
}

// Run only as a script (tests import the helpers). Compare real paths, since a
// temporary folder can be reached through a symlink such as /var -> /private/var.
const invokedPath = (() => { try { return realpathSync(process.argv[1]); } catch { return null; } })();
if (invokedPath === realpathSync(import.meta.filename)) {
  main().catch(error => { console.error(`tiktok test package failed: ${error.message}`); process.exitCode = 1; });
}
