const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');
const KEY = 'k'.repeat(32);
const source = fs.readFileSync(require.resolve('../browser-extension/smspool.js'), 'utf8');
function harness(local = {}, session = {}) {
  const calls = [];
  const area = object => ({ get: async keys => Object.fromEntries((keys == null ? Object.keys(object) : typeof keys === 'string' ? [keys] : keys).map(key => [key, structuredClone(object[key])])), set: async values => Object.assign(object, structuredClone(values)), remove: async keys => keys.forEach(key => delete object[key]), setAccessLevel: async value => assert.equal(value.accessLevel, 'TRUSTED_CONTEXTS') });
  const h = { local, session, calls, price: 20, stock: 1, available: 1, messages: [], onRequest: null, rejectPurchase: false, failPurchase: false };
  const context = vm.createContext({ chrome: { storage: { local: area(local), session: area(session) } }, URLSearchParams, AbortController, setTimeout, clearTimeout, TextEncoder, Uint8Array, crypto: webcrypto,
    fetch: async (url, options) => {
      const body = Object.fromEntries(new URLSearchParams(options.body));
      calls.push({ path: new URL(url).pathname, body, options });
      if (h.onRequest) await h.onRequest(new URL(url).pathname);
      const path = new URL(url).pathname;
      if (path === '/purchase/rental' && h.failPurchase) throw new Error('provider accidentally echoed ' + KEY);
      const data = path === '/request/balance' ? { balance: '100' } : path === '/rental/retrieve_all' ? { success: 1, data: [{ ID: 6, name: 'United States', pricing: { 30: h.price }, single_service: null }, { ID: 7, name: 'Single-service', pricing: { 30: 10 }, single_service: '{}' }] } : path === '/rental/stock' ? { success: 1, count: h.stock } : path === '/purchase/rental' ? h.rejectPurchase ? { success: 0 } : { success: 1, rental_code: 'RENTAL1', expiry: Math.floor(Date.now() / 1000) + 2592000 } : path === '/rental/retrieve_status' ? { success: 1, status: { available: h.available, phonenumber: '12025550199', expiry: Math.floor(Date.now() / 1000) + 2592000, auto_extend: 0 } } : path === '/rental/retrieve_messages' ? { success: 1, messages: h.messages } : path === '/rental/info' ? { type: 1, rental_code: body.rental_code, phonenumber: '12025550199', expiration_date: Math.floor(Date.now() / 1000) + 2592000, auto_extend: 0, service: null } : null;
      return { ok: true, json: async () => data };
    }
  });
  vm.runInContext(source, context);
  h.api = vm.runInContext('smsPool', context);
  h.connect = async () => { await h.api.connect(KEY); await h.api.choices(); return h.api.selection('6', 20, 30); };
  h.orders = () => calls.filter(call => call.path === '/purchase/rental');
  return h;
}
test('the user key stays in trusted session storage and is absent from choices, receipts and persistent history', async () => {
  const h = harness(); const chosen = await h.connect();
  assert.equal((await h.api.state()).connected, true);
  assert.equal((await h.api.choices()).options.length, 1);
  const rental = await h.api.ensure('signup-1', chosen, () => {});
  assert.equal(rental.rentalCode, 'RENTAL1');
  assert.equal(JSON.stringify(h.local).includes(KEY), false);
  assert.equal(JSON.stringify(chosen).includes(KEY), false);
  for (const call of h.calls) { assert.equal(call.body.key, KEY); assert.equal(call.options.credentials, 'omit'); assert.equal(call.options.redirect, 'error'); }
  await h.api.disconnect(); assert.equal((await h.api.state()).connected, false);
  assert.equal((await h.api.get('signup-1')).rentalCode, 'RENTAL1');
});
test('an existing rental is reused without purchasing or consulting new prices', async () => {
  const h = harness(); const chosen = await h.connect();
  await h.api.ensure('signup-1', chosen, () => {}); h.price = 100;
  await h.api.ensure('signup-1', chosen, () => {});
  assert.equal(h.orders().length, 1);
});
test('changed prices and zero stock cannot trigger a purchase', async () => {
  for (const kind of ['price', 'stock']) {
    const h = harness(); const chosen = await h.connect();
    if (kind === 'price') h.price = 21; else h.stock = 0;
    await assert.rejects(h.api.ensure('signup-1', chosen, () => {}));
    assert.equal(h.orders().length, 0);
  }
});
test('a network timeout is never retried, including after a worker restart', async () => {
  const h = harness(); const chosen = await h.connect(); h.failPurchase = true;
  await assert.rejects(h.api.ensure('signup-1', chosen, () => {}), error => !error.message.includes(KEY));
  assert.equal(h.orders().length, 1);
  const restarted = harness(h.local, h.session);
  await assert.rejects(restarted.api.ensure('signup-1', chosen, () => {}), /may already have completed/);
  assert.equal(restarted.orders().length, 0);
});
test('an explicitly rejected purchase can be retried after correcting the provider problem', async () => {
  const h = harness(); const chosen = await h.connect(); h.rejectPurchase = true;
  await assert.rejects(h.api.ensure('signup-1', chosen, () => {}));
  assert.equal(await h.api.get('signup-1'), null);
  h.rejectPurchase = false;
  await h.api.ensure('signup-1', chosen, () => {});
  assert.equal(h.orders().length, 2);
});
test('Stop during purchase preserves its receipt but prevents subsequent signup actions', async () => {
  const h = harness(); const chosen = await h.connect(); let stopped = false;
  h.onRequest = async path => { if (path === '/purchase/rental') stopped = true; };
  await assert.rejects(h.api.ensure('signup-1', chosen, () => { if (stopped) throw new Error('stopped'); }), /stopped/);
  assert.equal((await h.api.get('signup-1')).rentalCode, 'RENTAL1');
  assert.equal(h.orders().length, 1);
});
test('activation is checked without ordering replacements and expiry is retained', async () => {
  const h = harness(); const chosen = await h.connect(); await h.api.ensure('signup-1', chosen, () => {});
  h.available = 0; assert.equal(await h.api.ready('signup-1'), null);
  h.available = 1; const rental = await h.api.ready('signup-1');
  assert.equal(rental.phone, '+12025550199'); assert.ok(rental.expiresAt > Date.now()); assert.equal(rental.autoExtend, false);
  assert.equal(h.orders().length, 1);
});
test('reconnecting a different provider account cannot use another account’s saved rental', async () => {
  const h = harness(); const chosen = await h.connect(); await h.api.ensure('signup-1', chosen, () => {});
  await h.api.connect('x'.repeat(32));
  await assert.rejects(h.api.ready('signup-1'), /owns this rental/);
  await assert.rejects(h.api.messages('signup-1'), /owns this rental/);
});
test('attach recovers an uncertain order and refuses a rental already assigned to another account', async () => {
  const h = harness(); await h.connect();
  await h.api.attach('signup-1', 'RENTAL1');
  assert.equal((await h.api.get('signup-1')).phone, '+12025550199');
  await assert.rejects(h.api.attach('signup-2', 'RENTAL1'), /another saved account/);
  assert.equal(h.orders().length, 0);
});
test('codes must be new, unambiguous and explicitly identify the selected platform', () => {
  const { api } = harness();
  const messages = [{ ID: 1, sender: 'Instagram', message: 'Your verification code is 123456' }];
  assert.equal(api.verification(messages, ['1'], 'instagram'), null);
  assert.equal(api.verification(messages, [], 'tiktok'), null);
  assert.equal(api.verification([{ ID: 2, message: 'code 234567' }], [], 'instagram'), null);
  assert.equal(api.verification([{ ID: 2, message: 'Instagram codes 234567 and 345678' }], [], 'instagram'), null);
  assert.equal(api.verification([...messages, { ID: 2, message: 'Instagram code 234567' }], [], 'instagram'), null);
  assert.deepEqual(JSON.parse(JSON.stringify(api.verification(messages, [], 'instagram'))), { id: '1', code: '123456' });
});

test('another panel refreshing prices cannot raise an already displayed purchase quote', async () => {
  const h = harness(); await h.connect(); h.price = 21; await h.api.choices();
  await assert.rejects(h.api.selection('6', 20, 30), /refresh/);
  assert.equal(h.orders().length, 0);
});
