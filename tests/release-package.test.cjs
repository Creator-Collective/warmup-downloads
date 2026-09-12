const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('the actual downloadable and store archives contain the current reviewed source', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/check-extension-package.mjs')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
});
