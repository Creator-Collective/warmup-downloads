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
    runtime: { id: 'extension-id', getURL: value => `chrome-extension://extension-id/${value.replace(/^\//, '')}`, getManifest: () => ({ version: '0.6.7' }), onMessage: event() },
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
      else if (input.mode === 'fill') result = server.onFill ? await server.onFill(input) : { filled: true, submitted: false, stage: 'birthday', signature: input.expectedSignature, documentId: input.expectedDocument };
      else result = server.onAct ? await server.onAct(input) : { submitted: true, stage: server.observation.stage, signature: input.expectedSignature, documentId: input.expectedDocument, message: 'submitted once' };
      return [{ result, documentId: server.browserDocument || `chrome-document-${tab.id}` }];
    } },
  };
  const context = vm.createContext({ chrome, console, URL, crypto: webcrypto, Date: Clock, structuredClone, setTimeout, clearTimeout, AbortController, Uint8Array,
    signupStep: function signupStep() {},
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      apiRequests.push({ url, body: copy(body), method: options.method, credentials: options.credentials, redirect: options.redirect, cache: options.cache, headers: copy(options.headers), signal: options.signal });
      if (server.beforeFetch) await server.beforeFetch(body, options);
      let data;
      if (server.status !== 200) data = { ok: false, error: server.error || 'backend rejected' };
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
  assert.equal(h.acts()[0].input.birthDate, '2006-05-30');
  assert.equal(h.local.nativeSignupRecovery.birthDate, '2006-05-30');
  assert.equal(h.apiRequests.some(request => 'birthDate' in request.body), false);
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

test('birthday stays bound to the recovered account through stop and private signup', async () => {
  const h = harness(); await h.start(); await h.ready();
  h.storage.signupJob.birthDate = '2001-06-20';
  await h.message({ type: 'signup-stop' });
  const restored = harness({}, h.local); restored.incognito(true);
  await restored.start(); await restored.ready();
  restored.server.observation = { stage: 'signed-in', documentId: 'feed', canSubmit: false };
  await restored.tick();
  assert.equal(restored.storage.signupJob.privateSignup, true);
  restored.server.observation = { stage: 'details', signature: 'details-with-birthday', documentId: 'signup', canSubmit: true };
  await restored.tick();
  assert.equal(restored.acts()[0].input.birthDate, '2001-06-20');
  assert.equal(restored.local.nativeSignupRecovery.birthDate, '2001-06-20');
  assert.equal(restored.storage.signupJob.email, EMAIL);
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

const birthdayForm = { stage: 'birthday', canFill: true, canSubmit: false, signature: 'birthday:full-details:submit', documentId: 'birthday-page', message: 'birthday required' };

test('inline birthday fills known details once without submitting or persisting credentials', async () => {
  const h = harness(); await h.start(); await h.ready();
  h.server.observation = copy(birthdayForm);
  h.server.onFill = input => {
    assert.equal(h.local.nativeSignupRecovery.detailsState, 'uncertain', 'manual submission is possible before the fill result returns');
    assert.equal(h.storage.signupJob.attempts.length, 0);
    return { filled: true, submitted: false, signature: input.expectedSignature, documentId: input.expectedDocument };
  };
  const result = await h.tick();
  assert.equal(result.data.phase, 'paused');
  assert.match(result.data.message, /details filled.*birthday.*press submit/);
  const fills = h.injections.filter(item => item.input.mode === 'fill');
  assert.equal(fills.length, 1);
  assert.equal(fills[0].input.password, PASSWORD);
  assert.equal(fills[0].input.email, EMAIL);
  assert.deepEqual(fills[0].target.documentIds, [`chrome-document-${h.storage.signupJob.tabId}`]);
  assert.equal(h.acts().length, 0);
  assert.equal(h.storage.signupJob.detailsSubmitted, false);
  assert.equal(JSON.stringify(h.local).includes(PASSWORD), false);
  assert.equal(JSON.stringify(result).includes(PASSWORD), false);
  await h.message({ type: 'signup-continue' }); await h.tick();
  assert.equal(h.injections.filter(item => item.input.mode === 'fill').length, 1);
  h.server.observation = { ...birthdayForm, stage: 'details', canSubmit: true };
  await h.message({ type: 'signup-continue' }); await h.tick();
  assert.equal(h.acts().length, 0, 'a manually filled form must not later be auto-submitted');
});

test('manual birthday submission can advance to exact-recipient email verification', async () => {
  const h = harness(); await h.start(); await h.ready();
  h.server.observation = copy(birthdayForm); await h.tick();
  h.server.observation = { stage: 'email-code', signature: 'email:confirm', documentId: 'code-page', canSubmit: true };
  await h.message({ type: 'signup-continue' }); await h.tick();
  assert.equal(h.storage.signupJob.waitingForCode, true);
  assert.equal(h.storage.signupJob.detailsSubmitted, true);
  assert.equal(h.local.nativeSignupRecovery.detailsState, 'sent');
  assert.equal(h.acts().length, 0, 'no email code yet');
  h.time(6000);
  h.server.verification = { id: CODE_ID, code: '654321', receivedAt: new Date(h.now() - 1000).toISOString() };
  await h.tick();
  assert.equal(h.acts().length, 1);
  assert.equal(h.acts()[0].input.code, '654321');
  assert.equal(h.acts()[0].input.password, undefined);
  assert.equal(h.apiRequests.filter(request => request.body.action === 'prepare').length, 1);
});

test('a paused details attempt automatically notices the matching confirmation screen', async () => {
  const h = harness(); await h.start(); await h.ready();
  h.server.onAct = () => ({ submitted: false, message: 'next button not ready' });
  await h.tick();
  assert.equal(h.storage.signupJob.phase, 'paused');
  assert.equal(h.storage.signupJob.detailsSubmitted, false);
  const detailsActs = h.acts().length;
  h.server.observation = { stage: 'email-code', signature: 'confirmation', documentId: 'confirmation-page', canSubmit: true };
  await h.tick();
  assert.equal(h.storage.signupJob.phase, 'running');
  assert.equal(h.storage.signupJob.detailsSubmitted, true);
  assert.equal(h.storage.signupJob.waitingForCode, true);
  assert.equal(h.apiRequests.at(-1).body.action, 'code');
  assert.equal(h.acts().length, detailsActs);
  h.time(6000);
  h.server.verification = { id: CODE_ID, code: '123456', receivedAt: new Date(h.now() - 1000).toISOString() };
  h.server.onAct = input => ({ submitted: true, signature: input.expectedSignature, documentId: input.expectedDocument });
  await h.tick();
  assert.equal(h.acts().at(-1).input.code, '123456');
  assert.equal(h.acts().at(-1).input.password, undefined);
});

test('paused observation cannot resume details, unclear recipients, security checks or invalid code forms', async () => {
  for (const observed of [
    { stage: 'details', canSubmit: true, signature: 'details' },
    { stage: 'unknown', canSubmit: false, message: 'recipient does not match' },
    { stage: 'captcha', canSubmit: false },
    { stage: 'email-code', canSubmit: false, signature: 'code' },
    { stage: 'email-code', canSubmit: true, signature: '' },
  ]) {
    const h = harness(); await h.start(); await h.ready();
    h.server.observation = copy(birthdayForm); await h.tick();
    h.server.observation = { documentId: 'new-step', ...observed };
    const before = h.apiRequests.length;
    await h.tick();
    assert.equal(h.storage.signupJob.phase, 'paused', observed.stage);
    assert.equal(h.acts().length, 0);
    assert.equal(h.apiRequests.length, before);
  }
});

test('a paused new job with no details history does not start verification on its own', async () => {
  const h = harness(); await h.start(); await h.ready();
  h.server.observation = { stage: 'unknown', documentId: 'unknown', canSubmit: false }; await h.tick();
  h.server.observation = { stage: 'email-code', documentId: 'code', signature: 'code', canSubmit: true }; await h.tick();
  assert.equal(h.storage.signupJob.phase, 'paused');
  assert.equal(h.apiRequests.filter(request => request.body.action === 'code').length, 0);
});

test('a code-service failure stays paused instead of repeatedly auto-resuming the same screen', async () => {
  const h = harness(); await h.start(); await h.ready();
  h.server.observation = copy(birthdayForm); await h.tick();
  h.server.observation = { stage: 'email-code', signature: 'confirmation', documentId: 'confirmation-page', canSubmit: true };
  h.server.status = 503;
  await h.tick();
  assert.equal(h.storage.signupJob.phase, 'paused');
  assert.equal(h.storage.signupJob.codeScreenSeen, true);
  const requests = h.apiRequests.length;
  h.time(6000); await h.tick();
  assert.equal(h.storage.signupJob.phase, 'paused');
  assert.equal(h.apiRequests.length, requests);
});

test('restart preserves the prefilled email without risking a second signup', async () => {
  const h = harness(); await h.start(); await h.ready();
  h.server.observation = copy(birthdayForm); await h.tick();
  const restored = harness({}, h.local);
  await restored.start(); await restored.ready();
  assert.equal(restored.storage.signupJob.email, EMAIL);
  assert.equal(restored.storage.signupJob.requestId, h.storage.signupJob.requestId);
  restored.server.observation = copy(birthdayForm); await restored.tick();
  assert.equal(restored.storage.signupJob.phase, 'paused');
  assert.equal(restored.injections.filter(item => item.input.mode !== 'observe').length, 0);
  assert.equal(restored.storage.signupJob.message, 'birthday required');
  assert.equal(restored.storage.signupJob.detailsRetry, null);
});

test('invalid or changed birthday forms never report a successful fill or submit', async () => {
  for (const signature of ['', 'x'.repeat(1000), null]) {
    const h = harness(); await h.start(); await h.ready();
    h.server.observation = { ...birthdayForm, signature }; await h.tick();
    assert.equal(h.injections.filter(item => item.input.mode !== 'observe').length, 0);
    assert.equal(h.storage.signupJob.phase, 'paused');
  }
  for (const outcome of [null, { filled: false }, { filled: true, signature: 'changed', documentId: 'birthday-page' }]) {
    const h = harness(); await h.start(); await h.ready();
    h.server.observation = copy(birthdayForm); h.server.onFill = () => outcome;
    await h.tick();
    assert.equal(h.storage.signupJob.phase, 'paused');
    assert.doesNotMatch(h.storage.signupJob.message, /details filled/);
    assert.equal(h.acts().length, 0);
    assert.equal(h.local.nativeSignupRecovery.detailsState, 'uncertain');
  }
});

test('stop during birthday fill cannot restore credentials or continue signup', async () => {
  const h = harness(); await h.start(); await h.ready();
  const waiting = deferred(); h.server.observation = copy(birthdayForm);
  h.server.onFill = async input => { await waiting.promise; return { filled: true, submitted: false, signature: input.expectedSignature, documentId: input.expectedDocument }; };
  const tick = h.tick(); await settle();
  await h.message({ type: 'signup-stop' }); waiting.resolve(); await tick;
  assert.equal(h.storage.signupJob.phase, 'stopped');
  assert.equal(h.storage.signupJob.password, '');
  assert.equal(h.local.nativeSignupRecovery.email, EMAIL);
  assert.equal(h.local.nativeSignupRecovery.detailsState, 'uncertain');
  assert.equal(h.acts().length, 0);
});

test('signed-in instagram recovery opens private signup without losing the generated email', async () => {
  const h = harness(); h.incognito(true); await h.start(); await h.ready();
  const originalTabId = h.storage.signupJob.tabId;
  h.tabs.get(originalTabId).url = 'https://www.instagram.com/';
  h.server.observation = { stage: 'signed-in', signature: 'existing-feed', documentId: 'feed-page', canSubmit: false, message: 'existing account feed' };
  const continued = await h.tick();
  assert.equal(continued.data.phase, 'running');
  assert.equal(continued.data.continueLabel, null);
  assert.match(continued.data.message, /private signup opened/);
  assert.equal(h.local.nativeSignupRecovery.email, EMAIL);
  assert.equal(h.storage.signupJob.password, PASSWORD);
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
  assert.equal(continued.data.continueLabel, 'retry private signup');
  assert.match(continued.data.message, /allow in incognito/);
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
  assert.equal(loaded.data.continueLabel, 'retry private signup');
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

test('signup time freezes while paused and stopped, then resumes without counting the pause', async () => {
  const h = harness(); await h.start(); await h.ready();
  h.time(3000);
  h.server.observation = { stage: 'birthday', documentId: 'birthday', canSubmit: false };
  const paused = await h.tick();
  assert.equal(paused.data.elapsedMs, 3000);
  h.time(20000);
  assert.equal((await h.message({ type: 'signup-state' })).data.elapsedMs, 3000);
  await h.message({ type: 'signup-continue' });
  h.time(2000);
  assert.equal((await h.message({ type: 'signup-state' })).data.elapsedMs, 5000);
  await h.message({ type: 'signup-stop' });
  h.time(10000);
  assert.equal((await h.message({ type: 'signup-state' })).data.elapsedMs, 5000);
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

test('daily email limits explain the reset, open no tabs, and clear the password', async () => {
  const h = harness(); h.server.status = 429;
  h.server.error = 'account email setup has reached its daily limit. try again tomorrow';
  const result = await h.message({ type: 'signup-start', platform: 'instagram', username: 'test.creator', password: PASSWORD });
  assert.equal(result.ok, false);
  assert.match(result.error, /daily limit/);
  assert.match(result.error, /resets/);
  assert.equal(h.created.length, 0);
  assert.equal(h.storage.signupJob.password, '');
  assert.equal(h.storage.signupJob.phase, 'error');
});

test('retrying the same username after stop reuses its mailbox request instead of creating another', async () => {
  const h = harness(); await h.start();
  const original = copy(h.storage.signupJob);
  await h.message({ type: 'signup-stop' });
  await h.start({ username: 'TEST.CREATOR' }); await h.ready(); await h.tick();
  assert.equal(h.apiRequests[1].body.requestId, original.requestId);
  assert.equal(h.storage.signupJob.email, original.email);
  assert.equal(h.local.nativeSignupAccounts.length, 1);
  assert.equal(h.acts().length, 1);
});

test('reloading before details were sent preserves mailbox recovery and automatic signup', async () => {
  const first = harness(); await first.start();
  const restarted = harness({}, first.local); await restarted.start(); await restarted.ready(); await restarted.tick();
  assert.equal(restarted.apiRequests[0].body.requestId, first.storage.signupJob.requestId);
  assert.equal(restarted.local.nativeSignupAccounts.length, 1);
  assert.equal(restarted.acts().length, 1);
});

test('recovering submitted details never automatically sends the form again', async () => {
  const first = harness(); await first.details();
  const restarted = harness({}, first.local); await restarted.start(); await restarted.ready();
  const state = await restarted.tick();
  assert.equal(state.data.phase, 'paused');
  assert.equal(state.data.continueLabel, 'retry signup');
  assert.equal(restarted.acts().length, 0);
  assert.equal(restarted.storage.signupJob.email, EMAIL);
});

test('legacy saved emails pause for review, then permit exact-recipient email verification', async () => {
  const first = harness(); await first.start();
  const saved = copy(first.local);
  delete saved.nativeSignupRecovery.detailsState;
  delete saved.nativeSignupAccounts[0].detailsState;
  const restarted = harness({}, saved); await restarted.start(); await restarted.ready();
  const state = await restarted.tick();
  assert.equal(state.data.continueLabel, 'retry signup');
  assert.equal(restarted.acts().length, 0);
  restarted.server.observation = { stage: 'email-code', signature: 'manual-email-code', documentId: 'manual-page', canSubmit: true };
  await restarted.message({ type: 'signup-continue' });
  await restarted.tick();
  assert.equal(restarted.apiRequests.at(-1).body.action, 'code');
  assert.equal(restarted.storage.signupJob.detailsSubmitted, true);
});

async function recoveredSignup() {
  const first = harness(); await first.start(); await first.ready();
  first.server.observation = copy(birthdayForm); await first.tick();
  const restored = harness({}, first.local);
  await restored.start(); await restored.ready(); await restored.tick();
  return restored;
}

test('recovered prefill has an actionable retry that sends the same email once', async () => {
  const h = await recoveredSignup();
  assert.equal(h.storage.signupJob.phase, 'paused');
  assert.equal(h.storage.signupJob.continueLabel, 'retry signup');
  assert.equal(h.acts().length, 0);
  const identity = { email: h.storage.signupJob.email, requestId: h.storage.signupJob.requestId, tabId: h.storage.signupJob.tabId };
  const offered = copy(h.storage.signupJob.detailsRetry);
  assert.equal(offered.approved, false);
  await h.tick(); assert.equal(h.acts().length, 0, 'polling is not consent');
  await h.message({ type: 'signup-continue' });
  h.server.onAct = input => {
    assert.equal(h.storage.signupJob.detailsRetry, null, 'consume approval before injecting');
    assert.equal(h.storage.signupJob.attempts.length, 1);
    return { submitted: true, signature: input.expectedSignature, documentId: input.expectedDocument };
  };
  await h.tick();
  assert.equal(h.acts().length, 1);
  assert.equal(h.acts()[0].input.email, identity.email);
  assert.equal(h.acts()[0].input.birthDate, '2006-05-30');
  assert.equal(h.storage.signupJob.requestId, identity.requestId);
  assert.equal(h.storage.signupJob.tabId, identity.tabId);
  assert.equal(h.apiRequests.filter(request => request.body.action === 'prepare').length, 1);
  assert.equal(JSON.stringify(h.local).includes('detailsRetry'), false);
  h.time(26000); await h.tick();
  await h.message({ type: 'signup-continue' }); await h.tick();
  assert.equal(h.acts().length, 1, 'consumed retry cannot replay even on continue');
  h.server.observation.signature = 'changed-form';
  await h.message({ type: 'signup-continue' }); await h.tick();
  assert.equal(h.acts().length, 1, 'a new form signature cannot grant another retry');
});

test('retry approval is pinned to the observed tab, document and form', async () => {
  for (const change of ['document', 'signature', 'tab', 'browser-document']) {
    const h = await recoveredSignup();
    await h.message({ type: 'signup-continue' });
    if (change === 'document') h.server.observation.documentId = 'new-document';
    if (change === 'signature') h.server.observation.signature = 'new-form';
    if (change === 'tab') h.storage.signupJob.tabId = 7;
    if (change === 'browser-document') h.server.browserDocument = 'changed-chrome-document';
    await h.tick();
    assert.equal(h.acts().length, 0, change);
    assert.equal(h.storage.signupJob.phase, 'paused');
    assert.equal(h.storage.signupJob.detailsRetry.approved, false);
  }
});

test('security pauses and stop revoke an approved recovery retry', async () => {
  const h = await recoveredSignup();
  const original = copy(h.server.observation);
  await h.message({ type: 'signup-continue' });
  h.server.observation = { stage: 'captcha', documentId: 'page-1', message: 'security check', canSubmit: false };
  await h.tick();
  assert.equal(h.storage.signupJob.detailsRetry, null);
  assert.equal(h.storage.signupJob.continueLabel, null);
  h.server.observation = original;
  await h.message({ type: 'signup-continue' }); await h.tick();
  assert.equal(h.acts().length, 0);
  assert.equal(h.storage.signupJob.continueLabel, 'retry signup');
  await h.message({ type: 'signup-continue' }); await h.message({ type: 'signup-stop' }); await h.tick();
  assert.equal(h.acts().length, 0);
  assert.equal(h.storage.signupJob.password, '');
  assert.equal(h.storage.signupJob.detailsRetry, null);
});

test('a failed retry is not repeated automatically and restart asks again', async () => {
  const h = await recoveredSignup();
  await h.message({ type: 'signup-continue' });
  h.server.onAct = () => ({ submitted: false, message: 'form changed' });
  await h.tick();
  await h.message({ type: 'signup-continue' }); await h.tick();
  assert.equal(h.acts().length, 1);
  assert.equal(h.storage.signupJob.detailsRetry, null);
  const restarted = harness({}, h.local);
  await restarted.start(); await restarted.ready(); await restarted.tick();
  assert.equal(restarted.acts().length, 0);
  assert.equal(restarted.storage.signupJob.detailsRetry.approved, false);
});

test('unknown forms never receive recovery retry approval', async () => {
  for (const changes of [{ signature: '' }, { signature: 'x'.repeat(1000) }, { canSubmit: false }, { stage: 'unknown' }]) {
    const h = await recoveredSignup();
    h.server.observation = { ...h.server.observation, ...changes };
    await h.message({ type: 'signup-continue' }); await h.tick();
    assert.equal(h.acts().length, 0);
    assert.equal(h.storage.signupJob.detailsRetry, null);
    assert.equal(h.storage.signupJob.continueLabel, null);
  }
});

test('a recovered mailbox mismatch fails before opening any platform tab', async () => {
  const first = harness(); await first.start();
  const restarted = harness({}, first.local);
  restarted.server.alias.email = 'different@example.com';
  const result = await restarted.message({ type: 'signup-start', platform: 'instagram', username: 'test.creator', password: PASSWORD });
  assert.equal(result.ok, false);
  assert.equal(restarted.created.length, 0);
  assert.equal(restarted.local.nativeSignupRecovery.email, EMAIL);
});
