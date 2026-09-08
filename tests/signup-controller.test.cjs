const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const extension = path.resolve(__dirname, '../browser-extension');
const PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const ALIAS_ID = '22222222-2222-4222-8222-222222222222';
const CODE_ID = '33333333-3333-4333-8333-333333333333';
const PASSWORD = 'local-test-password-123';
const panel = { id: 'extension-id', url: 'chrome-extension://extension-id/sidepanel.html', frameId: 0 };
const web = { id: 'extension-id', url: 'https://creator-collective-warmup.vercel.app/', frameId: 0, tab: { id: 8 } };
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, emit(...args) { this.listeners.forEach(fn => fn(...args)); } });
const copy = value => value === undefined ? undefined : structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

function harness(initial = {}) {
  let now = Date.parse('2026-09-08T17:00:00.000Z');
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const storage = copy(initial);
  const tabs = new Map([
    [2, { id: 2, url: 'https://www.trycreatorcollective.com/dashboard', status: 'complete', windowId: 1 }],
    [7, { id: 7, url: 'https://www.instagram.com/', status: 'complete', windowId: 1 }],
  ]);
  const apiRequests = [];
  const injections = [];
  const created = [];
  const server = {
    profile: { id: PROFILE_ID, fullName: 'Test Creator' },
    aliases: [{ id: ALIAS_ID, email: 'test-creator@example.com', platform: null, accountUsername: null }],
    verification: null,
    status: 200,
    beforeFetch: null,
    onFields: null,
  };
  let nextTab = 90;
  const chrome = {
    sidePanel: { setPanelBehavior: async () => {} },
    runtime: { id: 'extension-id', getURL: value => `chrome-extension://extension-id/${value.replace(/^\//, '')}`, getManifest: () => ({ version: '0.5.0' }), onMessage: event() },
    storage: { session: {
      get: async keys => Object.fromEntries((typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(storage)).map(key => [key, copy(storage[key])])),
      set: async values => { for (const [key, value] of Object.entries(values)) storage[key] = copy(value); },
      remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key]; },
    } },
    tabs: {
      get: async id => { if (!tabs.has(id)) throw new Error('tab closed'); return copy(tabs.get(id)); },
      query: async () => [...tabs.values()].map(copy),
      create: async options => { const tab = { id: nextTab++, status: 'complete', windowId: 1, ...options }; tabs.set(tab.id, tab); created.push(copy(tab)); return copy(tab); },
      update: async (id, options) => { const tab = tabs.get(id); if (!tab) throw new Error('tab closed'); Object.assign(tab, options); return copy(tab); },
      onRemoved: event(), onUpdated: event(),
    },
    scripting: { executeScript: async request => {
      const tab = tabs.get(request.target.tabId);
      if (!tab) throw new Error('tab closed');
      if (request.func.name === 'fillSignupFields') {
        injections.push({ tabId: tab.id, args: copy(request.args) });
        const value = server.onFields ? await server.onFields(request.args[0]) : request.args[0].mode === 'inspect-code'
          ? { phase: 'paused', codeReady: true, filled: [], message: 'email verification ready' }
          : { phase: 'filled', filled: [request.args[0].mode === 'code' ? 'code' : 'email'], message: 'review and submit the platform form' };
        return [{ result: value, documentId: `document-${tab.id}` }];
      }
      // Execute the production API bridge, with fetch replaced by an in-memory
      // own-profile endpoint. This checks bridge behavior, not live cookies.
      const location = new URL(tab.url);
      const window = {}; window.top = window;
      const context = vm.createContext({ window, location, URL, AbortController, setTimeout, clearTimeout, fetch: async (url, options) => {
        const body = options.body ? JSON.parse(options.body) : null;
        apiRequests.push({ url, body: copy(body), method: options.method, credentials: options.credentials, redirect: options.redirect, cache: options.cache });
        assert.equal(url, '/api/account-setup');
        assert.equal(options.credentials, 'same-origin');
        assert.equal(options.redirect, 'error');
        assert.equal(options.cache, 'no-store');
        if (server.beforeFetch) await server.beforeFetch(body);
        let data;
        let status = server.status;
        if (status !== 200) data = { ok: false, error: status === 403 ? 'profile changed' : 'connection unavailable' };
        else if (!body) data = { ok: true, profile: server.profile, aliases: server.aliases };
        else if (body.expectedProfileId !== server.profile.id) { status = 403; data = { ok: false, error: 'profile changed' }; }
        else if (body.action === 'generate') data = { ok: true, alias: { ...server.aliases[0], platform: body.platform } };
        else if (body.action === 'code') data = { ok: true, verification: server.verification };
        else if (body.action === 'complete') data = { ok: true, alias: { ...server.aliases[0], accountUsername: body.username, platform: body.platform } };
        else { status = 400; data = { ok: false, error: 'unknown action' }; }
        return { status, ok: status === 200, json: async () => copy(data) };
      }, args: copy(request.args) });
      const result = await vm.runInContext(`(${request.func.toString()})(...args)`, context);
      return [{ result, documentId: `document-${tab.id}` }];
    } },
  };
  const context = vm.createContext({ chrome, console, URL, crypto: webcrypto, Date: Clock, structuredClone, setTimeout, clearTimeout, AbortController });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(extension, file), 'utf8'), context, { filename: file }));
  vm.runInContext(fs.readFileSync(path.join(extension, 'background.js'), 'utf8'), context, { filename: 'background.js' });
  const message = (request, sender = panel) => new Promise(resolve => {
    const accepted = chrome.runtime.onMessage.listeners[0](request, sender, response => resolve(copy(response)));
    if (!accepted) resolve(undefined);
  });
  return { chrome, tabs, storage, server, apiRequests, injections, created, message, now: () => now, tick: ms => { now += ms; },
    async connect() { const response = await message({ type: 'signup-connect', dashboardTabId: 2 }); assert.equal(response?.ok, true, JSON.stringify(response)); return response; },
    async start(extra = {}) { await this.connect(); const response = await message({ type: 'signup-start', platform: 'instagram', aliasId: ALIAS_ID, username: 'test.creator', fullName: 'Test Creator', password: PASSWORD, ...extra }); assert.equal(response?.ok, true, JSON.stringify(response)); return response; },
  };
}

test('signup credentials and private state are accepted only from the exact packaged side panel', async () => {
  const h = harness();
  const attempts = [web, { ...panel, id: 'other-extension' }, { ...panel, url: 'chrome-extension://extension-id/runner.html' }, { ...panel, frameId: 1 }, { ...panel, url: 'https://www.instagram.com/' }];
  for (const sender of attempts) {
    assert.equal(await h.message({ type: 'signup-start', password: PASSWORD }, sender), undefined);
    assert.equal(await h.message({ type: 'signup-state' }, sender), undefined);
  }
  assert.equal(h.apiRequests.length, 0);
  assert.equal(h.created.length, 0);
  assert.equal(h.storage.signupJob, undefined);
});

test('public signup state excludes passwords, profile identity and verification codes', async () => {
  const h = harness();
  const result = await h.start();
  assert.equal(h.storage.signupJob.password, PASSWORD);
  for (const state of [result.data, (await h.message({ type: 'signup-state' })).data]) {
    assert.equal(state.password, undefined);
    assert.equal(state.profileId, undefined);
    assert.equal(state.usedCodeIds, undefined);
    assert.equal(JSON.stringify(state).includes(PASSWORD), false);
  }
  assert.equal(JSON.stringify(h.apiRequests).includes(PASSWORD), false);
});

test('dashboard connection rejects wrong hosts and incognito without making a request', async () => {
  for (const patch of [{ url: 'https://www.trycreatorcollective.com.evil.example/dashboard' }, { url: 'https://www.trycreatorcollective.com/login' }, { incognito: true }]) {
    const h = harness(); Object.assign(h.tabs.get(2), patch);
    const response = await h.message({ type: 'signup-connect', dashboardTabId: 2 });
    assert.equal(response.ok, false);
    assert.equal(h.apiRequests.length, 0);
  }
});

test('platform host changes and pending navigation never receive signup credentials', async () => {
  for (const patch of [{ url: 'https://www.instagram.com.evil.example/accounts/emailsignup/' }, { url: 'https://www.tiktok.com/signup' }, { pendingUrl: 'https://www.instagram.com/accounts/login/' }, { status: 'loading' }]) {
    const h = harness(); await h.start();
    Object.assign(h.tabs.get(h.storage.signupJob.tabId), patch);
    await h.message({ type: 'signup-continue' });
    assert.equal(h.injections.length, 0);
    assert.notEqual(h.storage.signupJob.phase, 'complete');
  }
});

test('stopping, closing either connected tab, and expiry erase the saved password', async () => {
  for (const reason of ['stop', 'platform-close', 'dashboard-close', 'expiry']) {
    const h = harness(); await h.start();
    if (reason === 'stop') await h.message({ type: 'signup-stop' });
    if (reason.endsWith('close')) {
      const id = reason === 'platform-close' ? h.storage.signupJob.tabId : 2;
      h.tabs.delete(id); h.chrome.tabs.onRemoved.emit(id); await settle();
    }
    if (reason === 'expiry') h.tick(31 * 60 * 1000);
    const response = await h.message({ type: 'signup-state' });
    assert.equal(response.data.active, false, reason);
    assert.equal(h.storage.signupJob.password, '', reason);
    assert.equal(h.injections.length, 0, reason);
  }
});

test('a stopped signup remains stopped when delayed tab completion arrives', async () => {
  const h = harness(); await h.start();
  const tabId = h.storage.signupJob.tabId;
  await h.message({ type: 'signup-stop' });
  h.chrome.tabs.onUpdated.emit(tabId, { status: 'complete' }); await settle();
  assert.equal(h.injections.length, 0);
  assert.equal(h.storage.signupJob.phase, 'stopped');
  assert.equal(h.storage.signupJob.password, '');
});

test('signup and warm-up cannot run together in either start order', async () => {
  const warming = harness({ job: { phase: 'running' } }); await warming.connect();
  const rejected = await warming.message({ type: 'signup-start', platform: 'instagram', aliasId: ALIAS_ID, username: 'test.creator', fullName: 'Test Creator', password: PASSWORD });
  assert.equal(rejected.ok, false); assert.equal(warming.created.length, 0);
  const signing = harness(); await signing.start();
  const response = await signing.message({ type: 'start', tabId: 7, settings: { minutes: 1, niche: 'branding' } }, web);
  assert.equal(response.ok, false); assert.equal(signing.created.length, 1);
});

test('switching the dashboard account stops signup before platform injection', async () => {
  const h = harness(); await h.start();
  h.server.profile = { id: '44444444-4444-4444-8444-444444444444', fullName: 'Other Creator' };
  const response = await h.message({ type: 'signup-continue' });
  assert.equal(response.ok, false);
  assert.equal(h.storage.signupJob.password, '');
  assert.equal(h.storage.signupJob.phase, 'stopped');
  assert.equal(h.storage.signupConnection, undefined);
  assert.equal(h.injections.length, 0);
});

test('generation binds its mutation to the connected profile and rejects a mid-request account switch', async () => {
  const h = harness(); await h.connect();
  h.server.beforeFetch = async body => { if (body?.action === 'generate') h.server.profile = { id: '44444444-4444-4444-8444-444444444444', fullName: 'Other Creator' }; };
  const response = await h.message({ type: 'signup-generate', platform: 'instagram' });
  assert.equal(response.ok, false);
  const request = h.apiRequests.find(item => item.body?.action === 'generate');
  assert.equal(request.body.expectedProfileId, PROFILE_ID);
});

test('fresh email codes are platform-scoped, consumed before fill, and never returned or persisted', async () => {
  const h = harness(); await h.start({ platform: 'tiktok' }); h.tick(1000);
  h.server.verification = { id: CODE_ID, code: '654321', receivedAt: new Date(h.now()).toISOString() };
  h.server.onFields = input => {
    if (input.mode === 'inspect-code') return { codeReady: true };
    if (input.mode === 'code') assert.ok(h.storage.signupJob.usedCodeIds.includes(CODE_ID));
    return { phase: 'filled', message: 'review the filled code', filled: ['code'] };
  };
  const response = await h.message({ type: 'signup-code' });
  assert.equal(response.ok, true, JSON.stringify(response));
  const request = h.apiRequests.find(item => item.body?.action === 'code');
  assert.equal(request.body.platform, 'tiktok'); assert.equal(request.body.aliasId, ALIAS_ID); assert.equal(request.body.expectedProfileId, PROFILE_ID);
  const filled = h.injections.filter(item => item.args[0].mode === 'code');
  assert.equal(filled.length, 1); assert.equal(filled[0].args[0].code, '654321'); assert.equal(filled[0].args[0].password, undefined);
  assert.equal(JSON.stringify(response).includes('654321'), false);
  assert.equal(JSON.stringify(h.storage).includes('654321'), false);
  assert.equal((await h.message({ type: 'signup-code' })).ok, false);
  assert.equal(h.injections.filter(item => item.args[0].mode === 'code').length, 1);
});

test('stale, future, malformed and pre-signup verification codes never fill a platform field', async () => {
  for (const kind of ['stale', 'future', 'malformed-time', 'bad-code', 'before-start', 'missing']) {
    const h = harness(); await h.start(); h.tick(12 * 60 * 1000);
    const times = { stale: h.now() - 11 * 60 * 1000, future: h.now() + 1, 'before-start': Date.parse(h.storage.signupJob.since) - 1 };
    h.server.verification = kind === 'missing' ? null : { id: CODE_ID, code: kind === 'bad-code' ? '6543217' : '654321', receivedAt: kind === 'malformed-time' ? 'not-a-time' : new Date(times[kind] ?? h.now()).toISOString() };
    const response = await h.message({ type: 'signup-code' });
    assert.equal(response.ok, false, kind);
    assert.equal(h.injections.filter(item => item.args[0].mode === 'code').length, 0, kind);
  }
});

test('stop while the dashboard is responding prevents later credential injection and state revival', async () => {
  const h = harness(); await h.start();
  const entered = deferred(); const release = deferred();
  h.server.beforeFetch = async body => { if (!body) { entered.resolve(); await release.promise; } };
  const filling = h.message({ type: 'signup-continue' }); await entered.promise;
  const stopping = h.message({ type: 'signup-stop' });
  await settle();
  const stoppedBeforeReply = h.storage.signupJob.phase === 'stopped';
  release.resolve();
  await Promise.all([filling, stopping]);
  assert.equal(stoppedBeforeReply, true, 'stop must not wait behind the network request');
  assert.equal(h.injections.length, 0);
  assert.equal(h.storage.signupJob.phase, 'stopped');
  assert.equal(h.storage.signupJob.password, '');
});

function formFixture({ platform = 'instagram', url, text = '', fields = [], challenge = false } = {}) {
  const events = [];
  let submits = 0;
  class Input {
    constructor(spec) { Object.assign(this, { name: '', id: '', type: 'text', autocomplete: '', placeholder: '', disabled: false, readOnly: false, isConnected: true, hidden: false, _value: '', attributes: {} }, spec); }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    getBoundingClientRect() { return { width: this.hidden ? 0 : 100, height: this.hidden ? 0 : 30 }; }
    getAttribute(name) { return this.attributes[name] || null; }
    dispatchEvent(event) { events.push({ name: this.name, type: event.type }); return true; }
  }
  const inputs = fields.map(field => new Input(field));
  const window = {}; window.top = window;
  const document = {
    body: { innerText: text },
    querySelectorAll: selector => selector === 'input' ? inputs : selector === 'iframe' && challenge ? [{ src: 'https://captcha.example/challenge', title: 'captcha', getBoundingClientRect: () => ({ width: 100, height: 30 }) }] : [],
    querySelector: () => null,
    forms: [{ submit() { submits++; }, requestSubmit() { submits++; } }],
  };
  const context = vm.createContext({ window, document, location: { href: url || `https://www.${platform}.com/${platform === 'instagram' ? 'accounts/emailsignup/' : 'signup/phone-or-email/email'}` }, URL, HTMLInputElement: Input, Event: class Event { constructor(type) { this.type = type; } }, getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1' }) });
  vm.runInContext(fs.readFileSync(path.join(extension, 'signup-fields.js'), 'utf8'), context);
  return { inputs, events, submits: () => submits, fill(input = {}) { context.request = { platform, ...input }; return copy(vm.runInContext('fillSignupFields(request)', context)); } };
}

test('visible signup fields fill without overwriting a different value or submitting the form', () => {
  const fields = [{ name: 'email', type: 'email' }, { name: 'fullName' }, { name: 'username' }, { name: 'password', type: 'password' }];
  const f = formFixture({ fields });
  const input = { mode: 'details', email: 'test@example.com', fullName: 'Test Creator', username: 'test.creator', password: PASSWORD };
  assert.equal(f.fill(input).phase, 'filled');
  assert.deepEqual(f.inputs.map(field => field.value), [input.email, input.fullName, input.username, input.password]);
  assert.equal(f.submits(), 0); assert.equal(f.events.length, 8);
  const existing = formFixture({ fields: [{ name: 'email', type: 'email', _value: 'someone-else@example.com' }, ...fields.slice(1)] });
  assert.equal(existing.fill(input).phase, 'paused');
  assert.equal(existing.events.length, 0); assert.equal(existing.inputs[0].value, 'someone-else@example.com');
});

test('signup fixtures pause for phone, captcha and incomplete birthday checks', () => {
  const cases = [
    { text: 'Enter the code we sent to your phone', fields: [{ name: 'code', autocomplete: 'one-time-code' }] },
    { text: 'Security check', challenge: true, fields: [{ name: 'email' }] },
    { text: 'When is your birthday?', fields: [{ name: 'birthday', type: 'date' }, { name: 'email' }] },
  ];
  for (const sample of cases) {
    const f = formFixture(sample);
    const result = f.fill({ mode: 'inspect-code' });
    assert.equal(result.phase, 'paused'); assert.notEqual(result.codeReady, true);
    assert.equal(f.events.length, 0); assert.equal(f.submits(), 0);
  }
});

test('signup fixtures reject ambiguous, hidden and outside-signup fields', () => {
  for (const sample of [
    { fields: [{ name: 'email' }, { name: 'email' }] },
    { fields: [{ name: 'email', hidden: true }] },
    { url: 'https://www.instagram.com/accounts/login/', fields: [{ name: 'email' }] },
    { url: 'https://www.instagram.com.evil.example/accounts/emailsignup/', fields: [{ name: 'email' }] },
  ]) {
    const f = formFixture(sample);
    assert.equal(f.fill({ mode: 'details', email: 'test@example.com' }).phase, 'paused');
    assert.equal(f.events.length, 0);
  }
});

test('email-code fixtures accept the complete selected address in visible text or an email field', () => {
  const email = 'test-creator@example.com';
  for (const sample of [
    { text: `Enter the confirmation code sent to ${email}`, fields: [{ name: 'code' }] },
    { text: 'Confirm your email with the code we sent.', fields: [{ name: 'email', type: 'email', _value: email.toUpperCase() }, { name: 'code' }] },
  ]) {
    const f = formFixture(sample);
    assert.equal(f.fill({ mode: 'inspect-code', email }).codeReady, true);
    assert.equal(f.fill({ mode: 'code', email, code: '654321' }).phase, 'filled');
    assert.equal(f.inputs.find(field => field.name === 'code').value, '654321');
    assert.equal(f.submits(), 0);
  }
});

test('email-code fixtures reject masked, missing and different recipients, including address substrings', () => {
  const email = 'test-creator@example.com';
  for (const recipient of ['other@example.com', 't***@example.com', 'your email', `other-${email}`, `${email}.evil.example`]) {
    for (const mode of ['inspect-code', 'code']) {
      const f = formFixture({ text: `Enter the email code sent to ${recipient}`, fields: [{ name: 'code', autocomplete: 'one-time-code' }] });
      const result = f.fill({ mode, email, code: '654321' });
      assert.notEqual(result.codeReady, true, recipient);
      assert.equal(result.phase, 'paused', recipient);
      assert.equal(f.events.length, 0, recipient);
      assert.equal(f.inputs[0].value, '', recipient);
    }
  }
});

test('an occupied verification field is rejected before a new code is fetched or consumed', async () => {
  const h = harness(); await h.start(); h.tick(1000);
  const f = formFixture({ text: `Enter the email code sent to ${h.storage.signupJob.email}`, fields: [{ name: 'code', _value: '111111' }] });
  h.server.verification = { id: CODE_ID, code: '654321', receivedAt: new Date(h.now()).toISOString() };
  h.server.onFields = input => f.fill(input);
  const response = await h.message({ type: 'signup-code' });
  assert.equal(response.ok, false);
  assert.match(response.error, /previous code|clear/i);
  assert.equal(h.apiRequests.filter(item => item.body?.action === 'code').length, 0);
  assert.deepEqual(h.storage.signupJob.usedCodeIds, []);
  assert.equal(f.inputs[0].value, '111111');
  assert.equal(f.events.length, 0);
});

test('a birthday already entered by the user allows other details to fill without editing it', () => {
  const f = formFixture({ text: 'When is your birthday?', fields: [{ name: 'birthday', type: 'date', _value: '2000-01-01' }, { name: 'email', type: 'email' }] });
  assert.equal(f.fill({ mode: 'details', email: 'test@example.com' }).phase, 'filled');
  assert.equal(f.inputs[0].value, '2000-01-01');
  assert.ok(f.events.every(event => event.name === 'email'));
});

for (const change of ['closed', 'navigated']) {
  test(`dashboard ${change} during deferred platform lookup prevents injection and password revival`, async () => {
    const h = harness(); await h.start();
    const platformTabId = h.storage.signupJob.tabId;
    const priorRequests = h.apiRequests.length;
    const entered = deferred(); const release = deferred();
    const originalGet = h.chrome.tabs.get;
    h.chrome.tabs.get = async id => {
      const snapshot = await originalGet(id);
      if (id === platformTabId) { entered.resolve(); await release.promise; }
      return snapshot;
    };
    const filling = h.message({ type: 'signup-continue' });
    await entered.promise;
    assert.equal(h.apiRequests.length, priorRequests + 1, 'dashboard identity was already checked before platform lookup');
    if (change === 'closed') {
      h.tabs.delete(2);
      h.chrome.tabs.onRemoved.emit(2);
    } else {
      h.tabs.get(2).url = 'https://www.trycreatorcollective.com/login';
      h.chrome.tabs.onUpdated.emit(2, { url: h.tabs.get(2).url });
    }
    await settle();
    const stoppedBeforeLookupFinished = h.storage.signupJob.phase === 'stopped' && h.storage.signupJob.password === '';
    release.resolve();
    const response = await filling;
    await settle();
    assert.equal(stoppedBeforeLookupFinished, true, 'tab invalidation must not wait behind a pending signup command');
    assert.equal(response.ok, false);
    assert.equal(h.injections.length, 0);
    assert.equal(h.storage.signupJob.phase, 'stopped');
    assert.equal(h.storage.signupJob.password, '');
    assert.equal((await h.message({ type: 'signup-state' })).data.active, false);
  });
}

for (const interruption of ['stop', 'dashboard-close']) {
  test(`stale starting snapshot after ${interruption} cannot resume automatic field filling`, async () => {
    const h = harness(); await h.start();
    assert.equal(h.storage.signupJob.phase, 'starting');
    const platformTabId = h.storage.signupJob.tabId;
    const entered = deferred(); const release = deferred();
    const originalGet = h.chrome.storage.session.get;
    let delayNextJobRead = true;
    h.chrome.storage.session.get = async keys => {
      const snapshot = await originalGet(keys);
      if (keys === 'signupJob' && delayNextJobRead) {
        delayNextJobRead = false;
        assert.equal(snapshot.signupJob.phase, 'starting');
        entered.resolve();
        await release.promise;
      }
      return snapshot;
    };
    h.chrome.tabs.onUpdated.emit(platformTabId, { status: 'complete' });
    await entered.promise;
    if (interruption === 'stop') await h.message({ type: 'signup-stop' });
    else {
      h.tabs.delete(2);
      h.chrome.tabs.onRemoved.emit(2);
      await settle();
    }
    const clearedBeforeStaleRead = h.storage.signupJob.phase === 'stopped' && h.storage.signupJob.password === '';
    release.resolve();
    await settle();
    const state = await h.message({ type: 'signup-state' });
    assert.equal(clearedBeforeStaleRead, true);
    assert.equal(h.injections.length, 0, 'the delayed starting snapshot must not authorize autofill');
    assert.equal(h.storage.signupJob.phase, 'stopped');
    assert.equal(h.storage.signupJob.password, '');
    assert.equal(state.data.active, false);
  });
}
