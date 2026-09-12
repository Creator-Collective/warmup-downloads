const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'browser-extension/version-bridge.js'), 'utf8');
const nonce = '0123456789abcdef0123456789abcdef';
const origins = ['https://trycreatorcollective.com', 'https://www.trycreatorcollective.com'];

function bridge(origin = origins[0], topFrame = true) {
  const listeners = [];
  const replies = [];
  let manifestReads = 0;
  const window = {
    addEventListener: (type, listener) => { assert.equal(type, 'message'); listeners.push(listener); },
    postMessage: (message, target) => replies.push({ message: JSON.parse(JSON.stringify(message)), target })
  };
  window.top = topFrame ? window : {};
  const runtime = { getManifest: () => { manifestReads++; return { version: '0.6.33', name: 'private manifest field' }; } };
  const chrome = new Proxy({ runtime }, { get(target, name) { assert.equal(name, 'runtime'); return target[name]; } });
  vm.runInNewContext(script, { window, location: { origin }, chrome });
  const message = (data = { type: 'cc-warmup-version-request', nonce }, overrides = {}) => {
    for (const listener of listeners) listener({ source: window, origin, data, ...overrides });
  };
  return { listeners, replies, message, manifestReads: () => manifestReads, runtime };
}

test('student version check replies only with the installed version and matching nonce', () => {
  for (const origin of origins) {
    const h = bridge(origin);
    h.message();
    assert.deepEqual(h.replies, [{ message: { type: 'cc-warmup-version-response', nonce, version: '0.6.33' }, target: origin }]);
    assert.equal(h.manifestReads(), 1);
  }
});

test('version check registers only on the exact production student origins and top frame', () => {
  for (const origin of ['http://trycreatorcollective.com', 'https://trycreatorcollective.com:444', 'https://trycreatorcollective.com.evil.example', 'https://other.trycreatorcollective.com', 'https://creator-collective-warmup.vercel.app', 'null']) {
    assert.equal(bridge(origin).listeners.length, 0, origin);
  }
  for (const origin of origins) assert.equal(bridge(origin, false).listeners.length, 0);
});

test('version check rejects another window, another origin, commands and malformed nonces', () => {
  const h = bridge();
  h.message(undefined, { source: {} });
  h.message(undefined, { origin: origins[1] });
  h.message(undefined, { origin: 'https://evil.example' });
  for (const value of [undefined, null, '', 'A'.repeat(32), 'g'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), 123, {}, [], `${nonce}\n`]) {
    h.message({ type: 'cc-warmup-version-request', nonce: value });
  }
  for (const type of ['start', 'stop', 'state', 'hello', 'tabs', 'cc-warmup-version-response']) h.message({ type, nonce });
  for (const value of [null, undefined, 'cc-warmup-version-request', []]) h.message(value, { data: value });
  assert.deepEqual(h.replies, []);
  assert.equal(h.manifestReads(), 0);
});

test('version check ignores unrelated request fields and disconnected extension contexts', () => {
  const h = bridge();
  h.message({ type: 'cc-warmup-version-request', nonce, command: 'start', tabId: 123, settings: {}, account: 'ignored' });
  assert.deepEqual(Object.keys(h.replies[0].message).sort(), ['nonce', 'type', 'version']);
  h.runtime.getManifest = () => { throw new Error('extension context invalidated'); };
  assert.doesNotThrow(() => h.message());
  assert.equal(h.replies.length, 1);
});

test('student content script stays isolated from the privileged warm-up bridge', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'browser-extension/manifest.json'), 'utf8'));
  assert.equal(manifest.content_scripts.length, 2);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://creator-collective-warmup.vercel.app/*']);
  assert.deepEqual(manifest.content_scripts[0].js, ['bridge.js']);
  assert.deepEqual(manifest.content_scripts[1], {
    matches: origins.map(origin => `${origin}/*`),
    js: ['version-bridge.js'],
    run_at: 'document_start',
    all_frames: false,
    world: 'ISOLATED'
  });
  assert.doesNotMatch(script, /sendMessage|chrome\.(?:storage|tabs|scripting)|fetch\(/);
});
