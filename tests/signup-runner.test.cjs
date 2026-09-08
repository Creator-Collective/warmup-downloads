const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function runnerHarness(handler) {
  const requests = []; const timers = new Map(); let nextTimer = 1;
  const elements = new Map(); const listeners = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', disabled: false, events: {}, addEventListener(name, fn) { this.events[name] = fn; }, click() { this.events.click?.(); } });
    return elements.get(id);
  };
  const context = vm.createContext({
    location: { hash: '#test-job-token' },
    document: { getElementById: element, addEventListener: (name, fn) => listeners.set(name, fn) },
    setTimeout: (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    chrome: { runtime: { sendMessage: async request => { requests.push(structuredClone(request)); return handler(request, requests.length); } }, storage: { onChanged: { addListener: fn => listeners.set('storage', fn) } } },
  });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../browser-extension/signup-runner.js'), 'utf8'), context);
  return { requests, timers, element, listeners, async fire() { const [id, timer] = timers.entries().next().value; timers.delete(id); await timer.fn(); await settle(); } };
}
const ok = data => ({ ok: true, data });
const active = { phase: 'running', active: true, message: 'working', nextPollMs: 1500 };

test('dedicated runner sends only its token and command and serially polls normal and email steps', async () => {
  let ticks = 0;
  const h = runnerHarness(request => ok(request.type.endsWith('tick') ? { ...active, nextPollMs: ++ticks === 1 ? 5000 : 1500 } : active));
  await settle();
  assert.deepEqual(h.requests.map(request => request.type), ['signup-runner-ready', 'signup-runner-tick']);
  assert.equal([...h.timers.values()][0].ms, 5000);
  await h.fire(); assert.equal([...h.timers.values()][0].ms, 1500);
  for (const request of h.requests) { assert.deepEqual(Object.keys(request).sort(), ['token', 'type']); assert.equal(request.token, 'test-job-token'); }
});

test('stop interrupts a pending tick and a delayed response cannot restart polling', async () => {
  const pending = deferred();
  const h = runnerHarness(request => request.type.endsWith('tick') ? pending.promise : ok(request.type.endsWith('stop') ? { phase: 'stopped', active: false, message: 'stopped' } : active));
  await settle(); h.element('stop').click(); await settle();
  assert.equal(h.requests.at(-1).type, 'signup-runner-stop');
  assert.equal(h.element('status').textContent, 'stopped');
  pending.resolve(ok(active)); await settle();
  assert.equal(h.timers.size, 0); assert.equal(h.element('status').textContent, 'stopped');
});

test('paused jobs stay visible and completion stops the polling loop', async () => {
  let ticks = 0;
  const h = runnerHarness(request => ok(request.type.endsWith('tick') ? ++ticks === 1 ? { ...active, phase: 'paused', message: 'enter your birthday' } : { phase: 'complete', active: false, message: 'account ready' } : active));
  await settle(); assert.equal(h.element('status').textContent, 'paused'); assert.equal(h.timers.size, 1);
  await h.fire(); assert.equal(h.element('status').textContent, 'complete'); assert.equal(h.timers.size, 0); assert.equal(h.element('stop').disabled, true);
});

test('runner failures request controller cleanup and Escape sends stop', async () => {
  const h = runnerHarness(request => request.type.endsWith('tick') ? { ok: false, error: 'connection failed' } : ok(active));
  await settle(); assert.equal(h.requests.at(-1).type, 'signup-runner-stop'); assert.equal(h.timers.size, 0);
  const other = runnerHarness(request => ok(request.type.endsWith('stop') ? { phase: 'stopped', active: false, message: 'stopped' } : active));
  await settle(); other.listeners.get('keydown')({ key: 'Escape' }); await settle();
  assert.equal(other.requests.at(-1).type, 'signup-runner-stop'); assert.equal(other.timers.size, 0);
});
