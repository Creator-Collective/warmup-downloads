const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { validateSettings } = require('../plan.js');
const root = path.resolve(__dirname, '..');
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
function view({ supports = true, running = true, legacyTikTok = false } = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), { url: 'chrome-extension://extension-id/sidepanel.html', runScripts: 'outside-only' });
  const { window } = dom;
  const requests = [];
  const storage = new Map();
  Object.defineProperty(window, 'localStorage', { value: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } });
  const timers = new Map();
  let state = { running, phase: running ? 'running' : 'ready', sessionId: 'session-1', canChangeFocus: running, deadline: Date.now() + 120000,
    settings: running ? validateSettings({ platform: 'instagram', minutes: 5, niche: 'branding', enableComments: true, customLimits: { like: 3, follow: 2, comment: 1 } }) : undefined,
    tabId: 8, message: 'watching a video.', activity: [{ time: '2026-09-19T18:00:42Z', message: 'watching a video.' }], stats: {} };
  if (legacyTikTok) state.settings = { ...state.settings, platform: 'tiktok' };
  let responder;
  window.setInterval = (fn, ms) => { timers.set(ms, fn); return 1; };
  window.chrome = { runtime: { sendMessage: async message => {
    requests.push(message);
    if (responder) { const result = await responder(message); if (result !== undefined) return result; }
    if (message.type === 'hello') return { ok: true, data: { supportsFocus: supports, state } };
    if (message.type === 'tabs') return { ok: true, data: [{ id: 8, title: 'Instagram - creator videos' }] };
    if (message.type === 'set-focus') { state = { ...state, settings: { ...state.settings, focus: message.focus } }; return { ok: true, data: state }; }
    if (message.type === 'stop') { state = { ...state, running: false, canChangeFocus: false, phase: 'stopped' }; }
    return { ok: true, data: state };
  } } };
  for (const name of ['plan.js', 'comment-history.js', 'session-results.js', 'dashboard.js', 'select-ui.js']) window.eval(fs.readFileSync(path.join(root, name), 'utf8'));
  return { dom, window, requests, $: id => window.document.getElementById(id), poll: () => timers.get(1500)(),
    state: () => state, respond: fn => { responder = fn; }, change(value) { const select = window.document.getElementById('focus'); select.value = value; select.dispatchEvent(new window.Event('change', { bubbles: true })); } };
}

test('active focus stays editable while session settings stay locked, and acknowledgements persist the preference', async t => {
  const h = view(); t.after(() => h.dom.window.close()); await tick();
  assert.equal(h.$('settings').disabled, true);
  assert.equal(h.$('focus').disabled, false);
  const limits = JSON.stringify(h.state().settings.limits);
  h.change('follow'); await tick();
  assert.deepEqual({ ...h.requests.find(r => r.type === 'set-focus') }, { type: 'set-focus', sessionId: 'session-1', focus: 'follow' });
  assert.equal(h.$('focus').value, 'follow');
  assert.equal(JSON.stringify(h.state().settings.limits), limits);
  assert.equal(JSON.parse(h.window.localStorage.getItem('cc-web-session')).profiles.instagram.focus, 'follow');
  assert.match(h.$('focus-status').textContent, /remaining targets/);
});

test('old extensions keep ordinary sessions usable without offering unsupported focus changes', async t => {
  const h = view({ supports: false, running: false }); t.after(() => h.dom.window.close()); await tick();
  assert.equal(h.$('focus-controls').hidden, true);
  assert.equal(h.$('start').disabled, false);
  h.change('comment'); await tick();
  assert.equal(h.requests.some(r => r.type === 'set-focus'), false);
});

test('an older installed tiktok session keeps stop available without changing instagram controls or focus', async t => {
  const h = view({ legacyTikTok: true }); t.after(() => h.dom.window.close()); await tick();
  assert.equal(h.$('platform').value, 'instagram');
  assert.equal(h.$('niche').value, 'personal branding');
  assert.equal(h.$('focus-controls').hidden, true);
  assert.equal(h.$('stop').hidden, false);
  h.change('follow'); await tick();
  assert.equal(h.requests.some(request => request.type === 'set-focus'), false);
  h.$('stop').click(); await tick();
  assert.equal(h.requests.some(request => request.type === 'stop'), true);
  assert.equal(h.$('stop').hidden, true);
  assert.equal(h.$('niche').value, 'personal branding');
});

test('failed focus updates restore the acknowledged choice and keep a useful error', async t => {
  const h = view(); t.after(() => h.dom.window.close()); await tick();
  h.respond(message => message.type === 'set-focus' ? { ok: false, error: 'could not apply focus.' } : undefined);
  h.change('comment'); await tick();
  assert.equal(h.$('focus').value, 'balanced');
  assert.equal(h.$('focus').disabled, false);
  assert.equal(h.$('focus-status').textContent, 'could not apply focus.');
});

test('a late focus response cannot revive a stopped session', async t => {
  const h = view(); t.after(() => h.dom.window.close()); await tick();
  let resolve;
  const active = structuredClone(h.state());
  h.respond(message => message.type === 'set-focus' ? new Promise(done => { resolve = done; }) : undefined);
  h.change('like'); await tick();
  assert.equal(h.$('focus').disabled, true);
  h.$('stop').click(); await tick();
  assert.equal(h.$('stop').hidden, true);
  resolve({ ok: true, data: { ...active, settings: { ...active.settings, focus: 'like' } } }); await tick();
  assert.equal(h.$('stop').hidden, true);
  assert.equal(h.$('settings').disabled, false);
  assert.equal(h.$('focus-status').hidden, true);
});

test('an old in-flight poll cannot overwrite an acknowledged focus change', async t => {
  const h = view(); t.after(() => h.dom.window.close()); await tick();
  let resolve;
  const old = structuredClone(h.state());
  h.respond(message => message.type === 'state' ? new Promise(done => { resolve = done; }) : undefined);
  const polling = h.poll(); await tick();
  h.change('follow'); await tick();
  resolve({ ok: true, data: old }); await polling;
  assert.equal(h.$('focus').value, 'follow');
});

test('activity timestamps include seconds and machine-readable time; only the instagram tab picker remains', async t => {
  const h = view(); t.after(() => h.dom.window.close()); await tick();
  const time = h.window.document.querySelector('#activity time');
  assert.match(time.textContent, /:\d{2}:42/);
  assert.equal(time.dateTime, '2026-09-19T18:00:42.000Z');
  assert.equal(h.$('platform').type, 'hidden');
  assert.equal(h.$('platform').value, 'instagram');
  assert.equal(h.$('platform').closest('.select-control'), null);
  assert.equal(h.window.document.querySelector('option[value="tiktok"]'), null);
  assert.equal(h.$('instagram-tab').closest('.select-control').querySelector('img').getAttribute('src'), 'platform-instagram.svg');
  assert.equal(h.$('pace'), null);
  assert.equal(h.$('mix-like'), null);
});
