const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../signup-ui.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const ids = [...html.matchAll(/id="(signup-[^"]+)"/g)].map(match => match[1]);
const ready = { phase: 'ready', active: false, message: 'ready' };
const active = { phase: 'filled', active: true, message: 'submit on the platform', platform: 'instagram', email: 'one@example.com', username: 'requested.name', tabId: 8 };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

function harness({ panel = true, respond } = {}) {
  const nodes = new Map();
  const requests = [];
  const timers = [];
  const element = id => {
    assert.ok(ids.includes(id), `missing html element ${id}`);
    if (!nodes.has(id)) nodes.set(id, {
      value: id === 'signup-platform' ? 'instagram' : '', textContent: '', hidden: false,
      disabled: false, listeners: {}, options: [], open: false,
      addEventListener(type, handler) { this.listeners[type] = handler; },
      replaceChildren(...children) { this.options = children; this.value = children[0]?.value || ''; },
      reportValidity() { return true; },
      querySelectorAll() { return ids.filter(item => /signup-(password|username|start|connect|complete|platform|email)$/.test(item)).map(element); },
    });
    return nodes.get(id);
  };
  const defaults = message => {
    if (message.type === 'signup-state') return ready;
    if (message.type === 'signup-dashboard-tabs') return [{ id: 4, title: 'student dashboard' }];
    if (message.type === 'signup-connect') return {
      profile: { id: 'student-1', fullName: 'creator name' },
      aliases: [{ id: 'email-1', email: 'one@example.com', platform: 'instagram', accountUsername: null }, { id: 'email-2', email: 'two@example.com', platform: 'tiktok', accountUsername: null }],
    };
    if (message.type === 'signup-start') return active;
    if (message.type === 'signup-stop') return { phase: 'stopped', active: false, message: 'stopped' };
    if (message.type === 'signup-complete') return { ...active, phase: 'complete', active: false, username: message.username };
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
    Option: function(text, value) { this.text = text; this.value = value; },
    setInterval(handler, delay) { timers.push({ handler, delay }); },
    window: { addEventListener() {} },
  });
  vm.runInContext(source, context);
  const node = suffix => element(`signup-${suffix}`);
  const click = suffix => node(suffix).listeners.click();
  const submit = suffix => node(suffix).listeners.submit({ preventDefault() {} });
  return { node, click, submit, requests, timers };
}

test('the website never contacts signup runtime and leaves its controls disabled', async () => {
  const h = harness({ panel: false });
  await settle();
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.length, 0);
  for (const id of ['password', 'username', 'start', 'complete']) assert.equal(h.node(id).disabled, true);
  assert.match(html, /open the extension side panel to create an account/);
});

test('student connection selects only emails for the chosen platform', async () => {
  const h = harness();
  await settle();
  await h.click('connect');
  assert.equal(h.requests.find(request => request.type === 'signup-connect').dashboardTabId, 4);
  assert.equal(h.node('email').value, 'email-1');
  assert.equal(h.node('full-name').value, 'creator name');
  h.node('platform').value = 'tiktok';
  h.node('platform').listeners.change();
  assert.equal(h.node('email').value, 'email-2');
  assert.deepEqual(h.node('email').options.map(option => option.value), ['', 'email-2']);
});

test('start clears the password immediately, locks setup fields, and waits for explicit completion', async () => {
  let resolveStart;
  const h = harness({ respond: message => message.type === 'signup-start' ? new Promise(resolve => { resolveStart = resolve; }) : undefined });
  await settle();
  await h.click('connect');
  h.node('username').value = '@requested.name';
  h.node('password').value = 'test-only-password';
  const start = h.submit('form');
  assert.equal(h.node('password').value, '');
  assert.equal(h.node('fields').disabled, true);
  const payload = h.requests.find(request => request.type === 'signup-start');
  assert.equal(payload.username, 'requested.name');
  assert.equal(payload.password, 'test-only-password');
  assert.equal(payload.aliasId, 'email-1');
  resolveStart({ ok: true, data: active });
  await start;
  assert.equal(h.node('fields').disabled, true);
  assert.equal(h.node('actual-username').disabled, false);
  assert.equal(h.requests.some(request => request.type === 'signup-complete'), false);
  h.node('actual-username').value = 'actual.name';
  await h.submit('completion-form');
  assert.equal(h.requests.find(request => request.type === 'signup-complete').username, 'actual.name');
  assert.equal(h.node('active-controls').hidden, true);
});

test('failed start still clears the password and preserves its error through a poll', async () => {
  const h = harness({ respond: message => message.type === 'signup-start' ? Promise.resolve({ ok: false, error: 'signup tab closed' }) : undefined });
  await settle();
  await h.click('connect');
  h.node('password').value = 'test-only-password';
  await h.submit('form');
  assert.equal(h.node('password').value, '');
  await h.timers[0].handler();
  assert.equal(h.node('error').textContent, 'signup tab closed');
  assert.equal(h.node('error').hidden, false);
});

test('polling is limited to one pending request and cannot replace a newer button result', async () => {
  let holdPoll = false;
  let resolvePoll;
  const h = harness({ respond: message => message.type === 'signup-state' && holdPoll ? new Promise(resolve => { resolvePoll = resolve; }) : undefined });
  await settle();
  await h.click('connect');
  h.node('password').value = 'test-only-password';
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

test('repeated active snapshots keep the confirmed username draft and disconnect clears account fields', async () => {
  const h = harness({ respond: message => message.type === 'signup-state' ? Promise.resolve({ ok: true, data: active }) : undefined });
  await settle();
  h.node('actual-username').value = 'different.actual.name';
  await h.timers[0].handler();
  assert.equal(h.node('actual-username').value, 'different.actual.name');
  h.node('password').value = 'test-only-password';
  await h.click('disconnect');
  assert.equal(h.node('password').value, '');
  assert.equal(h.node('actual-username').value, '');
  assert.equal(h.node('fields').disabled, true);
});
