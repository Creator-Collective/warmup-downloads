import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseMetadata } from './release-metadata.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, 'browser-extension');
const read = file => readFileSync(path.join(root, file));
const manifest = JSON.parse(read('browser-extension/manifest.json'));
const version = manifest.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('invalid extension release version');
const files = ['manifest.json','features.js','background.js','bridge.js','version-bridge.js','guards.js','signup.js','signup-fields.js','signup-phone.js','smspool.js','phone-ui.js','signup-runner.js','signup-runner.html','signup-ui.js','plan.js','session.js','instagram.js','tiktok.js','runner.js','runner.html','sidepanel.html','dashboard.js','dashboard.css','comment-history.js','inter.woff2','INTER-LICENSE.txt','icon-16.png','icon-32.png','icon-48.png','icon-128.png'];
const errors = [];
const equal = (actual, expected, message) => { if (!actual.equals(expected)) errors.push(message); };
const setup = read('setup.html').toString();
if (JSON.parse(read('package.json')).version !== version) errors.push('package and extension versions differ');
equal(read('release.json'), Buffer.from(JSON.stringify(releaseMetadata(root, version), null, 2) + '\n'), 'public release metadata differs from the current versioned notes');
if (!read('.vercelignore').toString().split(/\r?\n/).includes('!release.json')) errors.push('public release metadata is missing from the deploy allowlist');
const downloads = [...setup.matchAll(/href="(creator-collective-extension-[^"]+\.zip)"/g)].map(match => match[1]);
if (downloads.length !== 1 || downloads[0] !== `creator-collective-extension-${version}.zip`) errors.push('setup download does not point to the current release');
if (!setup.includes(`updating to version ${version}`) || !setup.includes(`card should show version ${version}`)) errors.push('setup version instructions are stale');
const build = JSON.parse(read('store/build-manifest.json'));
if (build.version !== version || JSON.stringify([...build.files].sort()) !== JSON.stringify([...files].sort())) errors.push('store file list or version differs from the release');
for (const file of ['comment-history.js','dashboard.js','signup-ui.js','phone-ui.js','plan.js','dashboard.css','INTER-LICENSE.txt']) {
  equal(read(file), read(`browser-extension/${file}`), `shared source is stale in the extension: ${file}`);
}
const origin = 'https://creator-collective-warmup.vercel.app';
const panel = read('index.html').toString().replace('<body>', '<body class="side-panel">')
  .replace(/href="(\/|setup\.html|privacy\.html)"/g, (_, value) => `href="${origin}/${value === '/' ? '' : value}" target="_blank" rel="noopener"`);
equal(Buffer.from(panel), read('browser-extension/sidepanel.html'), 'side panel does not match the public dashboard');
for (const [name, prefix] of [[`creator-collective-extension-${version}.zip`, 'creator-collective-extension/'], [`store/chrome-web-store-${version}.zip`, '']]) {
  const archive = path.join(root, name);
  try {
    const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim().split(/\r?\n/).filter(entry => !entry.endsWith('/'));
    const expected = files.map(file => prefix + file);
    if (JSON.stringify(entries.sort()) !== JSON.stringify(expected.sort())) errors.push(`${name}: missing, extra or duplicate files`);
    for (const file of files) {
      const contents = execFileSync('unzip', ['-p', archive, prefix + file], { stdio: ['ignore','pipe','pipe'], maxBuffer: 2 * 1024 * 1024 });
      equal(contents, readFileSync(path.join(extension, file)), `${name}: stale ${file}`);
    }
  } catch { errors.push(`${name}: missing or unreadable archive`); }
}
if (errors.length) {
  console.error(`release package check failed:\n${errors.map(error => `- ${error}`).join('\n')}\nrun npm run package:extension after updating release versions.`);
  process.exitCode = 1;
} else console.log(`release ${version}: both ${files.length}-file archives and dashboard mirrors match source`);
