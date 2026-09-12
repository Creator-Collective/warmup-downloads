const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

test('the actual downloadable and store archives contain the current reviewed source', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/check-extension-package.mjs')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
});

test('public release links and notes describe the packaged manifest version', () => {
  const root = path.join(__dirname, '..');
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const manifest = read('browser-extension/manifest.json');
  const notes = read(`release-notes/${manifest.version}.json`);
  const release = read('release.json');
  assert.deepEqual(release, {
    version: manifest.version,
    releasedAt: notes.releasedAt,
    summary: notes.summary,
    changes: notes.changes,
    downloadUrl: `https://creator-collective-warmup.vercel.app/creator-collective-extension-${manifest.version}.zip`,
    appUrl: 'https://creator-collective-warmup.vercel.app/',
    setupUrl: 'https://creator-collective-warmup.vercel.app/setup.html'
  });
});

test('release generation rejects dates, versions and notes the student dashboard cannot read', async t => {
  const { releaseMetadata } = await import('../scripts/release-metadata.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-release-notes-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'release-notes'));
  const version = '0.6.33';
  const valid = { releasedAt: '2026-09-12', summary: 'latest release', changes: ['check the installed version'] };
  const write = (notes, targetVersion = version) => fs.writeFileSync(path.join(root, 'release-notes', `${targetVersion}.json`), JSON.stringify(notes));
  for (const invalidVersion of ['123456.1.1', '1.123456.1', '1.1.123456', '1.2', '1.2.3.4', '../1.2.3']) {
    assert.throws(() => releaseMetadata(root, invalidVersion), /invalid extension release version/, invalidVersion);
  }
  for (const invalid of [
    null,
    { ...valid, releasedAt: '2026-02-30' },
    { ...valid, releasedAt: '2026-02-29' },
    { ...valid, releasedAt: '2026-13-01' },
    { ...valid, releasedAt: '2026-9-12' },
    { ...valid, summary: ' ' },
    { ...valid, summary: 'a'.repeat(401) },
    { ...valid, changes: [] },
    { ...valid, changes: Array(13).fill('change') },
    { ...valid, changes: [' '] },
    { ...valid, changes: ['a'.repeat(401)] }
  ]) {
    write(invalid);
    assert.throws(() => releaseMetadata(root, version), /invalid versioned release notes/, JSON.stringify(invalid));
  }
  const boundary = { releasedAt: '2024-02-29', summary: 'a'.repeat(400), changes: Array(12).fill('a'.repeat(400)) };
  const boundaryVersion = '12345.12345.12345';
  write(boundary, boundaryVersion);
  const release = releaseMetadata(root, boundaryVersion);
  assert.equal(release.version, boundaryVersion);
  assert.equal(release.releasedAt, boundary.releasedAt);
  assert.equal(release.summary, boundary.summary);
  assert.deepEqual(release.changes, boundary.changes);
});
