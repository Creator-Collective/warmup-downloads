const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../signup-ui.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const ids = [...html.matchAll(/id="(signup-[^"]+)"/g)].map(match => match[1]);
const ready = { phase: 'ready', active: false, message: 'ready' };
const active = { phase: 'creating', active: true, message: 'creating your account', platform: 'instagram', email: 'one@example.com', username: 'requested.name', tabId: 8 };
const paused = { ...active, phase: 'paused', message: 'enter your birthday on instagram, then continue' };
const stopped = { phase: 'stopped', active: false, message: 'stopped' };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

function harness({ panel = true, respond } = {}) {
  const nodes = new Map();
  const requests = [];
  const timers = [];
  const windowListeners = {};
  const element = id => {
    assert.ok(ids.includes(id), `missing html element ${id}`);
    if (!nodes.has(id)) nodes.set(id, {
      value: id === 'signup-platform' ? 'instagram' : '', textContent: '', hidden: false,
      disabled: false, listeners: {}, open: false, valid: true,
      addEventListener(type, handler) { this.listeners[type] = handler; },
      reportValidity() { return this.valid; },
      querySelectorAll() { return ids.filter(item => /signup-(password|username|start|platform|show|continue|stop)$/.test(item)).map(element); },
    });
    return nodes.get(id);
  };
  const defaults = message => {
    if (message.type === 'signup-state') return ready;
    if (message.type === 'signup-start') return active;
    if (message.type === 'signup-stop') return stopped;
    return active;
  };
  const context = vm.createContext({
    document: { getElementById: element },
    location: panel ? { protocol: 'chrome-extension:', pathname: '/sidepanel.html' } : { protocol: 'https:', pathname: '/' },
    chrome: { runtime: { sendMessage: async message => {
      requests.push(structuredClone(message));
      const custom = respond?.(message);
      if (custom !== undefined) return custom;
      return { ok: true, data: defaults(message) };
    } } },
    setInterval(handler, delay) { timers.push({ handler, delay }); },
    window: { addEventListener(type, handler) { windowListeners[type] = handler; } },
  });
  vm.runInContext(source, context);
  const node = suffix => element(`signup-${suffix}`);
  const click = suffix => node(suffix).listeners.click();
  const submit = suffix => node(suffix).listeners.submit({ preventDefault() {} });
  return { node, click, submit, requests, timers, windowListeners };
}

test('the website never contacts signup runtime and leaves its controls disabled', async () => {
  const h = harness({ panel: false });
  await settle();
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.length, 0);
  for (const id of ['password', 'username', 'start', 'platform', 'show', 'continue', 'stop']) assert.equal(h.node(id).disabled, true);
  assert.match(html, /open the extension side panel to create an account/);
});

test('setup is native with only platform, username, and password fields', async () => {
  const h = harness();
  await settle();
  assert.deepEqual(h.requests.map(request => request.type), ['signup-state']);
  assert.equal(h.node('fields').disabled, false);
  assert.equal(h.node('start').disabled, false);
  assert.equal(h.node('platform').value, 'instagram');
  assert.equal(h.node('username').maxLength, 30);
  h.node('platform').value = 'tiktok';
  h.node('platform').listeners.change();
  assert.equal(h.node('username').maxLength, 24);
  assert.doesNotMatch(html, /signup-(dashboard|connect|disconnect|full-name|generate|completion|actual-username)/);
  assert.equal(h.node('email-row').hidden, true);
});

test('start sends only signup details, clears the password immediately, and can be stopped while pending', async () => {
  let resolveStart;
  const h = harness({ respond: message => message.type === 'signup-start' ? new Promise(resolve => { resolveStart = resolve; }) : undefined });
  await settle();
  h.node('username').value = '@requested.name';
  h.node('password').value = 'test-only-password';
  const start = h.submit('form');
  assert.equal(h.node('password').value, '');
  assert.equal(h.node('fields').disabled, true);
  assert.equal(h.node('active-controls').hidden, false);
  assert.equal(h.node('stop').disabled, false);
  assert.equal(h.node('show').hidden, true);
  assert.equal(h.node('continue').hidden, true);
  assert.deepEqual(h.requests.find(request => request.type === 'signup-start'), {
    type: 'signup-start', platform: 'instagram', username: 'requested.name', password: 'test-only-password',
  });
  resolveStart({ ok: true, data: active });
  await start;
  assert.equal(h.node('fields').disabled, true);
  assert.equal(h.node('email').textContent, 'one@example.com');
  assert.equal(h.node('email-row').hidden, false);
  assert.equal(h.node('show').hidden, false);
  assert.equal(h.node('continue').hidden, true);
});

test('invalid details and repeated submits do not send signup requests', async () => {
  let resolveStart;
  const h = harness({ respond: message => message.type === 'signup-start' ? new Promise(resolve => { resolveStart = resolve; }) : undefined });
  await settle();
  h.node('form').valid = false;
  await h.submit('form');
  assert.equal(h.requests.some(request => request.type === 'signup-start'), false);
  h.node('form').valid = true;
  const start = h.submit('form');
  await h.submit('form');
  assert.equal(h.requests.filter(request => request.type === 'signup-start').length, 1);
  resolveStart({ ok: true, data: active });
  await start;
  await h.submit('form');
  assert.equal(h.requests.filter(request => request.type === 'signup-start').length, 1);
});

test('continue is available only for a paused signup and resumes normal progress', async () => {
  let nextState = active;
  const h = harness({ respond: message => message.type === 'signup-state' ? { ok: true, data: nextState } : undefined });
  await settle();
  await h.click('continue');
  assert.equal(h.requests.some(request => request.type === 'signup-continue'), false);
  nextState = { ...paused, continueLabel: 'open private signup' };
  await h.timers[0].handler();
  assert.equal(h.node('continue').hidden, false);
  assert.equal(h.node('continue').disabled, false);
  assert.equal(h.node('continue').textContent, 'open private signup');
  await h.click('continue');
  assert.equal(h.requests.filter(request => request.type === 'signup-continue').length, 1);
  assert.equal(h.node('continue').hidden, true);
  assert.equal(h.node('message').textContent, active.message);
});

test('failed start still clears the password and preserves its error through a poll', async () => {
  const h = harness({ respond: message => message.type === 'signup-start' ? Promise.resolve({ ok: false, error: 'signup tab closed' }) : undefined });
  await settle();
  h.node('password').value = 'test-only-password';
  await h.submit('form');
  assert.equal(h.node('password').value, '');
  assert.equal(h.node('fields').disabled, false);
  assert.equal(h.node('active-controls').hidden, true);
  await h.timers[0].handler();
  assert.equal(h.node('error').textContent, 'signup tab closed');
  assert.equal(h.node('error').hidden, false);
  assert.equal(h.node('message').hidden, true);
});

test('polling is limited to one pending request and cannot replace a newer stop result', async () => {
  let holdPoll = false;
  let resolvePoll;
  const h = harness({ respond: message => message.type === 'signup-state' && holdPoll ? new Promise(resolve => { resolvePoll = resolve; }) : undefined });
  await settle();
  await h.submit('form');
  holdPoll = true;
  const poll = h.timers[0].handler();
  const count = h.requests.length;
  await h.timers[0].handler();
  assert.equal(h.requests.length, count);
  await h.click('stop');
  resolvePoll({ ok: true, data: active });
  await poll;
  assert.equal(h.node('active-controls').hidden, true);
  assert.equal(h.node('message').textContent, 'stopped');
  assert.equal(h.timers[0].delay, 2000);
});

test('a late start response cannot restore a signup after stop', async () => {
  let resolveStart;
  const h = harness({ respond: message => message.type === 'signup-start' ? new Promise(resolve => { resolveStart = resolve; }) : undefined });
  await settle();
  h.node('password').value = 'test-only-password';
  const start = h.submit('form');
  await h.click('stop');
  assert.equal(h.node('active-controls').hidden, true);
  resolveStart({ ok: true, data: active });
  await start;
  assert.equal(h.node('message').textContent, 'stopped');
  assert.equal(h.node('email-row').hidden, true);
  assert.equal(h.node('fields').disabled, false);
  assert.equal(h.node('password').value, '');
});

test('a late continue error cannot replace a successful stop', async () => {
  let resolveContinue;
  const h = harness({ respond: message => {
    if (message.type === 'signup-state') return { ok: true, data: paused };
    if (message.type === 'signup-continue') return new Promise(resolve => { resolveContinue = resolve; });
  } });
  await settle();
  const continuation = h.click('continue');
  await h.click('stop');
  resolveContinue({ ok: false, error: 'outdated error' });
  await continuation;
  assert.equal(h.node('message').textContent, 'stopped');
  assert.equal(h.node('error').hidden, true);
  assert.equal(h.node('fields').disabled, false);
});

test('reopening restores public account details, completion needs no extra form, and drafts survive repeated polls', async () => {
  let nextState = { ...active, platform: 'tiktok' };
  const h = harness({ respond: message => message.type === 'signup-state' ? { ok: true, data: nextState } : undefined });
  await settle();
  assert.equal(h.node('section').open, true);
  assert.equal(h.node('username').value, active.username);
  assert.equal(h.node('platform').value, 'tiktok');
  assert.equal(h.node('password').value, '');
  nextState = { ...nextState, phase: 'complete', active: false, message: 'your account is ready' };
  await h.timers[0].handler();
  assert.equal(h.node('active-controls').hidden, true);
  assert.equal(h.node('fields').disabled, false);
  assert.equal(h.node('message').textContent, 'your account is ready');
  assert.equal(h.node('email').textContent, active.email);
  assert.equal(h.requests.some(request => request.type === 'signup-complete'), false);
  h.node('username').value = 'next.account';
  await h.timers[0].handler();
  assert.equal(h.node('username').value, 'next.account');
});

test('password is cleared when the panel leaves and when signup stops', async () => {
  const h = harness({ respond: message => message.type === 'signup-state' ? { ok: true, data: active } : undefined });
  await settle();
  h.node('password').value = 'test-only-password';
  h.windowListeners.pagehide();
  assert.equal(h.node('password').value, '');
  h.node('password').value = 'test-only-password';
  await h.click('stop');
  assert.equal(h.node('password').value, '');
});
