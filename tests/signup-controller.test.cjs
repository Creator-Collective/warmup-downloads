const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const extension = path.resolve(__dirname, '../browser-extension');
const ALIAS_ID = '22222222-2222-4222-8222-222222222222';
const CODE_ID = '33333333-3333-4333-8333-333333333333';
const PASSWORD = 'local-test-password-123';
const EMAIL = 'test-creator@example.com';
const panel = { id: 'extension-id', url: 'chrome-extension://extension-id/sidepanel.html', frameId: 0 };
const web = { id: 'extension-id', url: 'https://creator-collective-warmup.vercel.app/', frameId: 0, tab: { id: 8 } };
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, emit(...args) { this.listeners.forEach(fn => fn(...args)); } });
const copy = value => value === undefined ? undefined : structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

function harness(initial = {}, initialLocal = {}) {
  let now = Date.parse('2026-09-08T17:00:00.000Z');
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const storage = copy(initial); const local = copy(initialLocal);
  const tabs = new Map([[7, { id: 7, url: 'https://www.instagram.com/', status: 'complete', windowId: 1 }]]);
  const apiRequests = []; const injections = []; const cancellations = []; const created = []; const access = [];
  const server = {
    alias: { id: ALIAS_ID, email: EMAIL, platform: 'instagram', accountUsername: null },
    verification: null, status: 200, beforeFetch: null, onObserve: null, onAct: null,
    observation: { stage: 'details', signature: 'details:email-password-username:signup', documentId: 'page-1', canSubmit: true, message: 'signup details' },
  };
  let nextTab = 90;
  let nextWindow = 2;
  let incognitoAllowed = false;
  const area = data => ({
    get: async keys => Object.fromEntries((typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(data)).map(key => [key, copy(data[key])])),
    set: async values => { for (const [key, value] of Object.entries(values)) data[key] = copy(value); },
    remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
    setAccessLevel: async options => { access.push(copy(options)); },
  });
  const chrome = {
    sidePanel: { setPanelBehavior: async () => {} },
    runtime: { id: 'extension-id', getURL: value => `chrome-extension://extension-id/${value.replace(/^\//, '')}`, getManifest: () => ({ version: '0.6.1' }), onMessage: event() },
    extension: { isAllowedIncognitoAccess: callback => callback(incognitoAllowed) },
    storage: { session: area(storage), local: area(local), onChanged: event() },
    tabs: {
      get: async id => { if (!tabs.has(id)) throw new Error('tab closed'); return copy(tabs.get(id)); },
      query: async query => [...tabs.values()].filter(tab => !Number.isInteger(query?.windowId) || tab.windowId === query.windowId).map(copy),
      create: async options => { const tab = { id: nextTab++, status: 'complete', windowId: 1, ...options }; tabs.set(tab.id, tab); created.push(copy(tab)); return copy(tab); },
      update: async (id, options) => { const tab = tabs.get(id); if (!tab) throw new Error('tab closed'); Object.assign(tab, options); return copy(tab); },
      onRemoved: event(), onUpdated: event(),
    },
    windows: { create: async options => {
      const tab = { id: nextTab++, url: options.url, status: 'complete', active: true, incognito: options.incognito === true, windowId: nextWindow++ };
      tabs.set(tab.id, tab); created.push(copy(tab));
      return { id: tab.windowId, focused: options.focused === true, incognito: tab.incognito, tabs: [copy(tab)] };
    } },
    scripting: { executeScript: async request => {
      if (request.func.name === 'cancelSignupPage') { cancellations.push({ target: copy(request.target), args: copy(request.args), injectImmediately: request.injectImmediately }); return [{ result: null }]; }
      const tab = tabs.get(request.target.tabId);
      if (!tab) throw new Error('tab closed');
      const input = request.args[0];
      injections.push({ target: copy(request.target), input: copy(input) });
      let result;
      if (input.mode === 'observe') result = server.onObserve ? await server.onObserve(input) : copy(server.observation);
      else result = server.onAct ? await server.onAct(input) : { submitted: true, stage: server.observation.stage, signature: input.expectedSignature, documentId: input.expectedDocument, message: 'submitted once' };
      return [{ result, documentId: `chrome-document-${tab.id}` }];
    } },
  };
  const context = vm.createContext({ chrome, console, URL, crypto: webcrypto, Date: Clock, structuredClone, setTimeout, clearTimeout, AbortController, Uint8Array,
    signupStep: function signupStep() {},
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      apiRequests.push({ url, body: copy(body), method: options.method, credentials: options.credentials, redirect: options.redirect, cache: options.cache, headers: copy(options.headers), signal: options.signal });
      if (server.beforeFetch) await server.beforeFetch(body, options);
      let data;
      if (server.status !== 200) data = { ok: false, error: 'backend rejected' };
      else if (body.action === 'prepare') data = { ok: true, alias: { ...server.alias, platform: body.platform } };
      else if (body.action === 'code') data = { ok: true, verification: server.verification };
      else if (body.action === 'complete') data = { ok: true, alias: { ...server.alias, platform: body.platform, accountUsername: body.username } };
      else throw new Error('unknown native email action');
      return { status: server.status, ok: server.status === 200, json: async () => copy(data) };
    },
  });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(extension, file), 'utf8'), context, { filename: file }));
  vm.runInContext(fs.readFileSync(path.join(extension, 'background.js'), 'utf8'), context, { filename: 'background.js' });
  const message = (request, sender = panel) => new Promise(resolve => {
    const accepted = chrome.runtime.onMessage.listeners[0](request, sender, response => resolve(copy(response)));
    if (!accepted) resolve(undefined);
  });
  const runner = () => ({ id: 'extension-id', url: `chrome-extension://extension-id/signup-runner.html#${storage.signupJob.token}`, frameId: 0, tab: { id: storage.signupJob.runnerTabId } });
  return { chrome, tabs, storage, local, server, apiRequests, injections, cancellations, created, message, runner, access, now: () => now, time: ms => { now += ms; }, incognito: allowed => { incognitoAllowed = allowed; },
    acts: () => injections.filter(item => item.input.mode === 'act'),
    async start(extra = {}) { const response = await message({ type: 'signup-start', platform: 'instagram', username: 'test.creator', password: PASSWORD, ...extra }); assert.equal(response?.ok, true, JSON.stringify(response)); return response; },
    async runnerMessage(type) { return message({ type: `signup-runner-${type}`, token: storage.signupJob.token }, runner()); },
    async ready() { const response = await this.runnerMessage('ready'); assert.equal(response?.ok, true, JSON.stringify(response)); return response; },
    async tick() { return this.runnerMessage('tick'); },
    async details() { await this.start(); await this.ready(); const result = await this.tick(); assert.equal(result.ok, true); assert.equal(this.acts().length, 1); return result; },
  };
}

test('only the exact packaged panel accepts credentials; old website and dashboard commands cannot start signup', async () => {
  const h = harness();
  for (const sender of [web, { ...panel, id: 'other-extension' }, { ...panel, url: 'chrome-extension://extension-id/sidepanel.html?x=1' }, { ...panel, url: 'chrome-extension://extension-id/sidepanel.html#x' }, { ...panel, frameId: 1 }, { ...panel, url: 'https://www.instagram.com/' }]) {
    assert.equal(await h.message({ type: 'signup-start', password: PASSWORD }, sender), undefined);
    assert.equal(await h.message({ type: 'signup-state' }, sender), undefined);
  }
  assert.equal((await h.message({ type: 'signup-connect', dashboardTabId: 2 })).ok, false);
  assert.equal(h.apiRequests.length, 0); assert.equal(h.created.length, 0);
});

test('native start prepares its own email and uses a restricted install capability without cookies or secrets in public state', async () => {
  const h = harness(); const response = await h.start();
  assert.equal(h.created.length, 2);
  assert.equal(h.created[0].url, 'https://www.instagram.com/accounts/emailsignup/');
  assert.match(h.created[1].url, /^chrome-extension:\/\/extension-id\/signup-runner.html#[\w-]+$/);
  assert.equal(h.created[1].active, false);
  const request = h.apiRequests[0];
  assert.equal(request.url, 'https://www.trycreatorcollective.com/api/warmup/native-inbox');
  assert.equal(request.credentials, 'omit'); assert.equal(request.redirect, 'error'); assert.equal(request.cache, 'no-store');
  assert.match(h.local.nativeSignupInstall, /^[a-f0-9]{64}$/);
  assert.equal(request.headers.Authorization, `Bearer ${h.local.nativeSignupInstall}`);
  assert.equal(h.access[0].accessLevel, 'TRUSTED_CONTEXTS');
  assert.deepEqual(Object.keys(request.body).sort(), ['action', 'platform', 'requestId']);
  assert.equal(request.body.requestId, h.storage.signupJob.requestId);
  assert.equal(h.storage.signupJob.password, PASSWORD);
  assert.equal(JSON.stringify(h.local).includes(PASSWORD), false);
  for (const state of [response.data, (await h.message({ type: 'signup-state' })).data]) {
    assert.equal(state.password, undefined); assert.equal(state.token, undefined); assert.equal(state.usedCodeIds, undefined);
    assert.equal(JSON.stringify(state).includes(h.local.nativeSignupInstall), false);
  }
  assert.equal(JSON.stringify(request.body).includes(PASSWORD), false);
});

test('runner messages require the exact runner tab, token, frame and packaged URL and expose no password', async () => {
  const h = harness(); await h.start();
  for (const sender of [panel, web, { ...h.runner(), frameId: 1 }, { ...h.runner(), tab: { id: 999 } }, { ...h.runner(), url: `${h.runner().url}?x=1` }]) {
    const response = await h.message({ type: 'signup-runner-tick', token: h.storage.signupJob.token }, sender);
    assert.equal(response?.ok, false);
  }
  assert.equal((await h.message({ type: 'signup-runner-tick', token: 'wrong' }, h.runner())).ok, false);
  assert.equal(h.injections.length, 0);
  const result = await h.ready();
  assert.equal(result.data.password, undefined); assert.equal(result.data.requestId, undefined);
});

test('normal steps submit once with recorded intent and a pinned Chrome document', async () => {
  const h = harness(); await h.start(); await h.ready();
  h.server.onAct = input => {
    assert.equal(h.storage.signupJob.attempts.length, 1);
    assert.equal(h.storage.signupJob.pendingAction.signature, input.expectedSignature);
    return { submitted: true, stage: 'details', signature: input.expectedSignature, documentId: input.expectedDocument };
  };
  await h.tick(); await h.tick();
  assert.equal(h.acts().length, 1);
  assert.equal(h.injections[0].input.password, undefined);
  assert.equal(h.acts()[0].input.password, PASSWORD);
  assert.deepEqual(h.acts()[0].target.documentIds, [`chrome-document-${h.storage.signupJob.tabId}`]);
  assert.equal(h.storage.signupJob.detailsSubmitted, true);
  h.time(26000); await h.tick();
  assert.equal(h.storage.signupJob.phase, 'paused');
  await h.message({ type: 'signup-continue' }); await h.tick();
  assert.equal(h.acts().length, 1, 'continue cannot replay the same submission');
  h.server.observation.documentId = 'reloaded-document';
  await h.message({ type: 'signup-continue' }); await h.tick();
  assert.equal(h.acts().length, 1, 'a new document cannot bypass the submitted step signature');
});

test('a new verified form step advances while unknown or blocked states pause', async () => {
  for (const stage of ['birthday', 'phone', 'captcha', 'username-unavailable', 'signed-in', 'unknown']) {
    const h = harness(); await h.start(); await h.ready();
    h.server.observation = { ...h.server.observation, stage, signature: stage, canSubmit: false, message: 'manual step' };
    await h.tick(); assert.equal(h.storage.signupJob.phase, 'paused', stage); assert.equal(h.acts().length, 0, stage);
  }
  const h = harness(); await h.details();
  h.server.observation = { ...h.server.observation, signature: 'details:username:next' };
  await h.tick(); assert.equal(h.acts().length, 2);
});

test('signed-in instagram recovery opens private signup without losing the generated email', async () => {
  const h = harness(); h.incognito(true); await h.start(); await h.ready();
  const originalTabId = h.storage.signupJob.tabId;
  h.tabs.get(originalTabId).url = 'https://www.instagram.com/';
  h.server.observation = { stage: 'signed-in', signature: 'existing-feed', documentId: 'feed-page', canSubmit: false, message: 'existing account feed' };
  const paused = await h.tick();
  assert.equal(paused.data.phase, 'paused');
  assert.equal(paused.data.continueLabel, 'open private signup');
  assert.match(paused.data.message, /already signed in/);
  assert.equal(h.local.nativeSignupRecovery.email, EMAIL);
  assert.equal(h.storage.signupJob.password, PASSWORD);
  const continued = await h.message({ type: 'signup-continue' });
  assert.equal(continued.ok, true, JSON.stringify(continued));
  assert.equal(continued.data.phase, 'running');
  assert.equal(h.storage.signupJob.privateSignup, true);
  assert.equal(h.storage.signupJob.needsPrivateSignup, false);
  assert.notEqual(h.storage.signupJob.tabId, originalTabId);
  assert.equal(h.tabs.get(h.storage.signupJob.tabId).incognito, true);
  assert.equal(h.tabs.get(originalTabId).url, 'https://www.instagram.com/');
  h.server.observation = { stage: 'details', signature: 'private-details', documentId: 'private-page', canSubmit: true, message: 'signup details' };
  await h.tick();
  assert.equal(h.acts().length, 1);
  assert.equal(h.acts()[0].input.password, PASSWORD);
});

test('private signup recovery keeps the email saved when incognito access is unavailable', async () => {
  const h = harness(); await h.start(); await h.ready();
  h.tabs.get(h.storage.signupJob.tabId).url = 'https://www.instagram.com/';
  h.server.observation = { stage: 'signed-in', signature: 'existing-feed', documentId: 'feed-page', canSubmit: false, message: 'existing account feed' };
  await h.tick();
  const continued = await h.message({ type: 'signup-continue' });
  assert.equal(continued.ok, true, JSON.stringify(continued));
  assert.equal(continued.data.phase, 'paused');
  assert.equal(continued.data.email, EMAIL);
  assert.equal(continued.data.continueLabel, 'open private signup');
  assert.match(continued.data.message, /allow this extension in incognito/);
  assert.equal(h.created.length, 2);
  assert.equal(h.local.nativeSignupRecovery.email, EMAIL);
  assert.equal(h.storage.signupJob.password, PASSWORD);
});

test('signup waits for the tracked tab URL to load before checking a logged-in redirect', async () => {
  const h = harness(); await h.start(); await h.ready();
  const tab = h.tabs.get(h.storage.signupJob.tabId);
  Object.assign(tab, { url: '', pendingUrl: 'https://www.instagram.com/accounts/emailsignup/', status: 'loading' });
  const loading = await h.tick();
  assert.equal(loading.data.phase, 'running');
  assert.equal(h.injections.length, 0);
  assert.equal(h.local.nativeSignupRecovery.email, EMAIL);
  Object.assign(tab, { url: 'https://www.instagram.com/', pendingUrl: undefined, status: 'complete' });
  h.server.observation = { stage: 'signed-in', documentId: 'feed-page', canSubmit: false };
  const loaded = await h.tick();
  assert.equal(loaded.data.continueLabel, 'open private signup');
  assert.equal(h.acts().length, 0);
});

test('an existing private login pauses without opening more windows or submitting details', async () => {
  const h = harness(); h.incognito(true); await h.start(); await h.ready();
  h.server.observation = { stage: 'signed-in', documentId: 'feed-page', canSubmit: false };
  await h.tick(); await h.message({ type: 'signup-continue' });
  const paused = await h.tick();
  assert.equal(paused.data.phase, 'paused');
  assert.match(paused.data.message, /private window is also signed in/);
  await h.message({ type: 'signup-continue' }); await h.tick();
  assert.equal(h.created.length, 3);
  assert.equal(h.acts().length, 0);
  assert.equal(h.local.nativeSignupRecovery.email, EMAIL);
});

test('stop during the private access check prevents a new window from opening', async () => {
  const h = harness(); await h.start(); await h.ready();
  h.server.observation = { stage: 'signed-in', documentId: 'feed-page', canSubmit: false };
  await h.tick();
  const access = deferred();
  h.chrome.extension.isAllowedIncognitoAccess = callback => { access.promise.then(callback); };
  const continuing = h.message({ type: 'signup-continue' });
  await settle();
  await h.message({ type: 'signup-stop' });
  access.resolve(true);
  await continuing;
  assert.equal(h.created.length, 2);
  assert.equal(h.storage.signupJob.phase, 'stopped');
  assert.equal(h.storage.signupJob.password, '');
  assert.equal(h.local.nativeSignupRecovery.email, EMAIL);
});

test('no injection reaches an untrusted host, another platform, incognito or a pending document', async () => {
  for (const patch of [{ url: 'https://www.instagram.com.evil.example/accounts/emailsignup/' }, { url: 'https://www.tiktok.com/signup' }, { incognito: true }, { pendingUrl: 'https://www.instagram.com/accounts/login/' }, { status: 'loading' }]) {
    const h = harness(); await h.start(); await h.ready(); Object.assign(h.tabs.get(h.storage.signupJob.tabId), patch);
    await h.tick(); assert.equal(h.injections.length, 0); assert.notEqual(h.storage.signupJob.phase, 'complete');
  }
});

test('stop, either tab closing, navigation away, discard and expiry erase credentials', async () => {
  for (const reason of ['stop', 'platform-close', 'runner-close', 'navigation', 'discard', 'expiry']) {
    const h = harness(); await h.start();
    if (reason === 'stop') await h.message({ type: 'signup-stop' });
    if (reason.endsWith('close')) {
      const id = reason === 'platform-close' ? h.storage.signupJob.tabId : h.storage.signupJob.runnerTabId;
      h.tabs.delete(id); h.chrome.tabs.onRemoved.emit(id); await settle();
    }
    if (reason === 'navigation') h.chrome.tabs.onUpdated.emit(h.storage.signupJob.tabId, { url: 'https://example.com/' });
    if (reason === 'discard') h.chrome.tabs.onUpdated.emit(h.storage.signupJob.tabId, { discarded: true });
    if (reason === 'expiry') h.time(31 * 60000);
    await settle(); const response = await h.message({ type: 'signup-state' });
    assert.equal(response.data.active, false, reason); assert.equal(h.storage.signupJob.password, '', reason);
    assert.equal(h.injections.length, 0, reason); assert.equal(h.local.nativeSignupRecovery.email, EMAIL);
  }
});

test('signup and warm-up exclude each other in either start order', async () => {
  const warming = harness({ job: { phase: 'running' } });
  assert.equal((await warming.message({ type: 'signup-start', platform: 'instagram', username: 'test.creator', password: PASSWORD })).ok, false);
  assert.equal(warming.created.length, 0); assert.equal(warming.apiRequests.length, 0);
  const signing = harness(); await signing.start();
  assert.equal((await signing.message({ type: 'start', tabId: 7, settings: { minutes: 1, niche: 'branding' } }, web)).ok, false);
  assert.equal(signing.created.length, 2);
});

test('email codes are polled at most every five seconds and consumed before the guarded act', async () => {
  const h = harness(); await h.details(); h.time(1000);
  h.server.observation = { stage: 'email-code', signature: 'email-code:verify', documentId: 'page-1', canSubmit: true };
  await h.tick(); await h.tick();
  assert.equal(h.apiRequests.filter(request => request.body.action === 'code').length, 1);
  assert.equal(h.acts().length, 1);
  h.time(5000); h.server.verification = { id: CODE_ID, code: '654321', receivedAt: new Date(h.now()).toISOString() };
  h.server.onAct = input => {
    assert.ok(h.storage.signupJob.usedCodeIds.includes(CODE_ID));
    assert.equal(input.password, undefined); assert.equal(input.code, '654321');
    return { submitted: true, stage: 'email-code', signature: input.expectedSignature, documentId: input.expectedDocument };
  };
  const result = await h.tick();
  const request = h.apiRequests.filter(item => item.body.action === 'code').at(-1);
  assert.equal(request.body.requestId, h.storage.signupJob.requestId); assert.equal(request.body.platform, 'instagram');
  assert.equal(request.body.since, h.storage.signupJob.since);
  assert.equal(h.acts().length, 2);
  assert.equal(JSON.stringify(h.storage).includes('654321'), false);
  assert.equal(JSON.stringify(result).includes('654321'), false);
  assert.equal(JSON.stringify(request.body).includes('654321'), false);
});

test('fresh-code validation rejects stale, future, malformed, pre-start and already consumed codes', async () => {
  for (const kind of ['stale', 'future', 'time', 'code', 'pre-start', 'consumed']) {
    const h = harness(); await h.details(); h.time(12 * 60000);
    h.server.observation = { stage: 'email-code', signature: 'email-code:verify', documentId: 'page-1', canSubmit: true };
    const times = { stale: h.now() - 11 * 60000, future: h.now() + 1, 'pre-start': Date.parse(h.storage.signupJob.since) - 1 };
    h.server.verification = { id: CODE_ID, code: kind === 'code' ? 'not-a-code' : '654321', receivedAt: kind === 'time' ? 'not-a-time' : new Date(times[kind] ?? h.now()).toISOString() };
    if (kind === 'consumed') h.storage.signupJob.usedCodeIds.push(CODE_ID);
    await h.tick(); assert.equal(h.acts().length, 1, kind); assert.equal(h.storage.signupJob.phase, 'paused', kind);
  }
});

test('an unready recipient or occupied code field never requests or consumes an email code', async () => {
  const h = harness(); await h.details(); h.time(26000);
  h.server.observation = { stage: 'email-code', signature: 'email-code:verify', documentId: 'page-1', canSubmit: false, message: 'check the recipient or previous code' };
  await h.tick();
  assert.equal(h.apiRequests.filter(request => request.body.action === 'code').length, 0);
  assert.equal(h.storage.signupJob.usedCodeIds.length, 0); assert.equal(h.acts().length, 1);
});

test('completion needs a submitted signup, matching authenticated username and matching saved email', async () => {
  for (const kind of ['no-submission', 'other-user', 'confirmed']) {
    const h = harness();
    if (kind === 'no-submission') { await h.start(); await h.ready(); } else await h.details();
    h.server.observation = { stage: 'complete', documentId: 'profile-document', canSubmit: false, username: kind === 'other-user' ? 'somebody.else' : 'TEST.CREATOR' };
    await h.tick();
    assert.equal(h.storage.signupJob.phase, kind === 'confirmed' ? 'complete' : 'paused', kind);
    assert.equal(h.apiRequests.filter(request => request.body.action === 'complete').length, kind === 'confirmed' ? 1 : 0, kind);
    if (kind === 'confirmed') { assert.equal(h.storage.signupJob.password, ''); assert.equal(h.local.nativeSignupRecovery.phase, 'complete'); }
  }
  const h = harness(); await h.details();
  h.server.observation = { stage: 'complete', signature: 'authenticated-profile', documentId: 'profile-document', username: 'test.creator' };
  h.server.alias.email = 'other@example.com'; await h.tick();
  assert.equal(h.storage.signupJob.phase, 'paused'); assert.equal(h.storage.signupJob.password, '');
});

test('failed or uncertain platform submission is never automatically retried or marked complete', async () => {
  for (const kind of ['false', 'throw', 'changed-document']) {
    const h = harness(); await h.start(); await h.ready();
    h.server.onAct = input => {
      if (kind === 'throw') throw new Error('response lost after click');
      return { submitted: kind !== 'false', signature: input.expectedSignature, documentId: kind === 'changed-document' ? 'other-document' : input.expectedDocument };
    };
    await h.tick(); h.time(26000); await h.message({ type: 'signup-continue' }); await h.tick();
    assert.equal(h.acts().length, 1, kind); assert.equal(h.storage.signupJob.detailsSubmitted, false, kind);
  }
});

test('stop aborts a pending native API request before it can open tabs or revive credentials', async () => {
  const h = harness(); const entered = deferred(); const release = deferred();
  h.server.beforeFetch = async () => { entered.resolve(); await release.promise; };
  const start = h.message({ type: 'signup-start', platform: 'instagram', username: 'test.creator', password: PASSWORD });
  await entered.promise; const stop = await h.message({ type: 'signup-stop' });
  assert.equal(stop.data.phase, 'stopped'); assert.equal(h.apiRequests[0].signal.aborted, true);
  release.resolve(); assert.equal((await start).ok, false);
  assert.equal(h.created.length, 0); assert.equal(h.storage.signupJob.password, ''); assert.equal(h.storage.signupJob.phase, 'stopped');
});

test('stop or tab closure during a delayed observation prevents later act and stale state revival', async () => {
  for (const reason of ['stop', 'close']) {
    const h = harness(); await h.start(); await h.ready(); const entered = deferred(); const release = deferred();
    h.server.onObserve = async () => { entered.resolve(); await release.promise; return copy(h.server.observation); };
    const tick = h.tick(); await entered.promise;
    if (reason === 'stop') await h.message({ type: 'signup-stop' });
    else { h.tabs.delete(h.storage.signupJob.tabId); h.chrome.tabs.onRemoved.emit(h.storage.signupJob.tabId); await settle(); }
    assert.equal(h.storage.signupJob.password, '', reason);
    release.resolve(); assert.equal((await tick).ok, false, reason);
    assert.equal(h.acts().length, 0, reason); assert.equal(h.storage.signupJob.phase, 'stopped', reason);
  }
});

test('stop during a deferred platform lookup prevents any credential injection', async () => {
  const h = harness(); await h.start(); await h.ready(); const entered = deferred(); const release = deferred();
  const originalGet = h.chrome.tabs.get;
  h.chrome.tabs.get = async id => { const snapshot = await originalGet(id); if (id === h.storage.signupJob.tabId) { entered.resolve(); await release.promise; } return snapshot; };
  const tick = h.tick(); await entered.promise; await h.message({ type: 'signup-stop' }); release.resolve();
  assert.equal((await tick).ok, false); assert.equal(h.injections.length, 0); assert.equal(h.storage.signupJob.password, '');
});

test('a stale storage snapshot cannot revive signup after stop or tab removal', async () => {
  for (const reason of ['stop', 'close']) {
    const h = harness(); await h.start(); await h.ready(); const entered = deferred(); const release = deferred();
    const originalGet = h.chrome.storage.session.get; let delayed = false;
    h.chrome.storage.session.get = async keys => { const snapshot = await originalGet(keys); if (keys === 'signupJob' && !delayed) { delayed = true; entered.resolve(); await release.promise; } return snapshot; };
    const tick = h.tick(); await entered.promise;
    if (reason === 'stop') await h.message({ type: 'signup-stop' });
    else { h.chrome.tabs.onRemoved.emit(h.storage.signupJob.tabId); await settle(); }
    release.resolve(); assert.equal((await tick).ok, false);
    assert.equal(h.injections.length, 0); assert.equal(h.storage.signupJob.password, ''); assert.equal(h.storage.signupJob.phase, 'stopped');
  }
});

test('runner refresh stops an existing job, preserving email recovery without replaying actions', async () => {
  const h = harness(); await h.details();
  const refreshed = await h.ready();
  assert.equal(refreshed.data.phase, 'stopped'); assert.equal(h.storage.signupJob.password, '');
  await h.tick(); assert.equal(h.acts().length, 1);
  const recovered = harness({}, h.local); const state = await recovered.message({ type: 'signup-state' });
  assert.equal(state.data.phase, 'recovery'); assert.equal(state.data.email, EMAIL); assert.equal(state.data.active, false);
  assert.equal(recovered.injections.length, 0); assert.equal(recovered.apiRequests.length, 0);
});

test('install capability stays stable across completed and stopped jobs on the same device', async () => {
  const h = harness(); await h.start(); const capability = h.local.nativeSignupInstall;
  await h.message({ type: 'signup-stop' }); await h.start({ platform: 'tiktok', username: 'test_creator' });
  assert.equal(h.local.nativeSignupInstall, capability);
  assert.equal(h.apiRequests.at(-1).headers.Authorization, `Bearer ${capability}`);
  assert.notEqual(h.apiRequests[0].body.requestId, h.apiRequests.at(-1).body.requestId);
});

test('stop dispatches the in-page cancellation token while an act is still settling', async () => {
  const h = harness(); await h.start(); await h.ready(); const entered = deferred(); const release = deferred();
  h.server.onAct = async input => { entered.resolve(); await release.promise; return { submitted: false, signature: input.expectedSignature, documentId: input.expectedDocument }; };
  const token = h.storage.signupJob.token; const tabId = h.storage.signupJob.tabId;
  const ticking = h.tick(); await entered.promise; await h.message({ type: 'signup-stop' });
  assert.equal(h.cancellations.length, 1);
  assert.deepEqual(h.cancellations[0], { target: { tabId }, args: [token, 'instagram'], injectImmediately: true });
  assert.equal(h.acts()[0].input.actionToken, token); assert.equal(h.storage.signupJob.password, '');
  release.resolve(); assert.equal((await ticking).ok, false); assert.equal(h.storage.signupJob.phase, 'stopped');
});

test('terminal cleanup wins after a delayed intent write and prevents any platform act', async () => {
  const h = harness(); await h.start(); await h.ready(); const entered = deferred(); const release = deferred();
  const originalSet = h.chrome.storage.session.set; let held = false;
  h.chrome.storage.session.set = async values => { if (values.signupJob?.pendingAction && !held) { held = true; entered.resolve(); await release.promise; } return originalSet(values); };
  const ticking = h.tick(); await entered.promise;
  const stopping = h.message({ type: 'signup-stop' }); await settle();
  assert.equal(h.cancellations.length, 1, 'page cancellation is sent before waiting for the write');
  release.resolve(); await Promise.all([ticking, stopping]);
  assert.equal(h.acts().length, 0); assert.equal(h.storage.signupJob.phase, 'stopped'); assert.equal(h.storage.signupJob.password, '');
});

test('a start already queued before stop cannot restart signup after the stopped request settles', async () => {
  const h = harness(); const entered = deferred(); const release = deferred();
  h.server.beforeFetch = async () => { entered.resolve(); await release.promise; };
  const input = { type: 'signup-start', platform: 'instagram', username: 'test.creator', password: PASSWORD };
  const first = h.message(input); await entered.promise;
  const queued = h.message(input); await h.message({ type: 'signup-stop' }); release.resolve();
  assert.equal((await first).ok, false); assert.equal((await queued).ok, false);
  assert.equal(h.apiRequests.length, 1); assert.equal(h.created.length, 0); assert.equal(h.storage.signupJob.password, '');
});

test('failed preparation preserves existing mailbox history and restart recovery', async () => {
  const h = harness(); await h.start(); await h.message({ type: 'signup-stop' });
  const first = copy(h.local.nativeSignupRecovery);
  h.server.status = 503;
  const failure = await h.message({ type: 'signup-start', platform: 'instagram', username: 'another.creator', password: PASSWORD });
  assert.equal(failure.ok, false);
  assert.deepEqual(h.local.nativeSignupRecovery, first);
  assert.deepEqual(h.local.nativeSignupAccounts, [first]);
  assert.equal(h.local.nativeSignupPending.phase, 'error'); assert.equal(h.local.nativeSignupPending.email, undefined);
  assert.notEqual(h.local.nativeSignupPending.requestId, first.requestId);
  const restarted = harness({}, h.local);
  const result = await restarted.message({ type: 'signup-state' });
  assert.equal(result.data.email, EMAIL); assert.equal(result.data.username, 'test.creator');
  assert.equal(JSON.stringify(h.local).includes(PASSWORD), false);
});

test('prepared accounts keep a per-request history and failed prepare retries its same idempotent request', async () => {
  const h = harness(); await h.start(); await h.message({ type: 'signup-stop' });
  const firstId = h.local.nativeSignupRecovery.requestId;
  await h.start({ username: 'another.creator' });
  assert.equal(h.local.nativeSignupAccounts.length, 2);
  assert.equal(h.local.nativeSignupAccounts[0].requestId, firstId);
  assert.equal(h.local.nativeSignupAccounts[1].username, 'another.creator');
  await h.message({ type: 'signup-stop' }); assert.equal(h.local.nativeSignupAccounts.length, 2);
  const failed = harness(); failed.server.status = 503;
  const input = { type: 'signup-start', platform: 'instagram', username: 'test.creator', password: PASSWORD };
  assert.equal((await failed.message(input)).ok, false);
  const requestId = failed.apiRequests[0].body.requestId;
  failed.server.status = 200; await failed.start();
  assert.equal(failed.apiRequests[1].body.requestId, requestId);
  assert.equal(failed.local.nativeSignupAccounts.length, 1);
  assert.equal(failed.local.nativeSignupPending, null);
});
