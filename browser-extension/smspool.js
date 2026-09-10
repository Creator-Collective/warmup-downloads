'use strict';

// User-owned credentials live only in trusted extension session storage. Never
// return them to runners, websites, injected pages, or persistent account history.
const smsPool = (() => {
  const origin = 'https://api.smspool.net';
  const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
  const phone = value => {
    const digits = String(value || '').replace(/^\+/, '');
    if (!/^[1-9]\d{7,14}$/.test(digits)) throw new Error('smspool has not supplied a usable phone number yet. check the order in smspool.');
    return `+${digits}`;
  };
  async function request(path, body = {}, keyOverride) {
    const key = keyOverride || (await chrome.storage.session.get('smsPoolKey')).smsPoolKey;
    if (!key) throw new Error('connect smspool in phone setup first. reconnect after restarting chrome.');
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch(`${origin}${path}`, { method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...body, key }).toString(), signal: abort.signal });
      const data = await response.json();
      if (data && [0, '0', false].includes(data.success)) { const error = new Error('provider-error'); error.rejected = true; throw error; }
      if (!response.ok || !data) throw new Error('provider-error');
      return data;
    } catch (cause) {
      // Provider errors can echo request data. Only return our own messages.
      const error = new Error('smspool could not complete this request. check your connection, balance and order in smspool.');
      error.rejected = cause?.rejected === true;
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function connect(key) {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9]{32,128}$/.test(key.trim())) throw new Error('enter your smspool secret key from its settings page.');
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    const data = await request('/request/balance', {}, key.trim());
    if (!Number.isFinite(Number(data.balance))) throw new Error('smspool did not confirm this connection. check your key.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key.trim()));
    const credentialId = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    await chrome.storage.session.set({ smsPoolKey: key.trim(), smsPoolCredential: credentialId });
    return { connected: true };
  }
  function service(platform) {
    if (!['instagram', 'tiktok'].includes(platform)) throw new Error('choose instagram or tiktok before selecting a number.');
    return platform === 'instagram' ? 'Instagram' : 'TikTok';
  }
  async function choices(platform = 'instagram') {
    const data = await request('/request/success_rate', { service: service(platform) });
    if (!Array.isArray(data)) throw new Error('smspool did not return its temporary number prices.');
    const options = data.flatMap(item => {
      const country = Number(item.country_id ?? item.country);
      const price = Number(item.low_price);
      if (!Number.isInteger(country) || country <= 0 || typeof item.name !== 'string' || item.name.length >= 100 || !Number.isFinite(price) || price <= 0) return [];
      return [{ id: `${platform}:${country}`, kind: 'temporary', platform, country, name: item.name, price }];
    });
    await chrome.storage.session.set({ [`smsPoolChoices:${platform}`]: options });
    return { connected: true, options };
  }
  async function selection(id, price, platform) {
    service(platform);
    const options = (await chrome.storage.session.get(`smsPoolChoices:${platform}`))[`smsPoolChoices:${platform}`];
    const selected = options?.find(option => option.id === id && option.platform === platform);
    if (!selected) throw new Error('connect smspool and choose a temporary number for this platform first.');
    if (!Number.isFinite(price) || price <= 0 || selected.price > price) throw new Error('refresh the phone prices and choose your number again.');
    return { ...selected, price };
  }
  async function get(requestId) {
    return (await chrome.storage.local.get(`smsPoolRental:${requestId}`))[`smsPoolRental:${requestId}`] || null;
  }
  async function credential(record) {
    const stored = await chrome.storage.session.get(['smsPoolKey', 'smsPoolCredential']);
    if (!stored.smsPoolKey || !stored.smsPoolCredential) throw new Error('reconnect smspool in phone setup.');
    if (record?.credentialId && stored.smsPoolCredential !== record.credentialId) throw new Error('reconnect the smspool account that owns this number.');
    return stored.smsPoolCredential;
  }
  async function save(requestId, record) {
    await chrome.storage.local.set({ [`smsPoolRental:${requestId}`]: record });
    return record;
  }
  function temporary(record, platform) {
    if (!record || record.kind !== 'temporary') throw new Error('this signup has an earlier monthly order. check that number in smspool and finish its phone step manually.');
    if (platform && record.platform !== platform) throw new Error('this number belongs to a different platform. check the saved signup.');
    service(record.platform);
  }
  async function attach(requestId, orderId, platform) {
    service(platform);
    if (!validId(orderId)) throw new Error('enter the order id shown in smspool.');
    const existing = await get(requestId);
    if (existing) temporary(existing, platform);
    if (existing?.orderId && existing.orderId !== orderId) throw new Error('this signup already has a confirmed order. keep using that number.');
    const credentialId = await credential(existing);
    const orders = await request('/request/active');
    if (!Array.isArray(orders)) throw new Error('smspool did not return its active orders.');
    const matches = orders.filter(item => item.order_code === orderId);
    const data = matches.length === 1 ? matches[0] : null;
    if (!data || String(data.service).toLowerCase() !== platform || data.status !== 'pending' || ![undefined, null, '', 0, '0'].includes(data.code) || Boolean(data.full_code) || !Number.isFinite(Number(data.expiry)) || Number(data.expiry) * 1000 <= Date.now()) throw new Error('choose an active, unused temporary order for this platform. check it in smspool.');
    const local = await chrome.storage.local.get(null);
    if (Object.entries(local).some(([key, value]) => key.startsWith('smsPoolRental:') && key !== `smsPoolRental:${requestId}` && value?.orderId === orderId)) throw new Error('this number already belongs to another saved account on this device.');
    return save(requestId, { kind: 'temporary', state: 'ready', credentialId, orderId, platform, phone: phone(data.phonenumber), expiresAt: Number(data.expiry) * 1000 });
  }
  async function ensure(requestId, chosen, assertActive, platform = chosen?.platform) {
    const existing = await get(requestId);
    assertActive();
    const credentialId = await credential(existing);
    assertActive();
    if (existing) {
      temporary(existing, platform);
      if (existing.orderId) return existing;
      throw new Error('a number purchase may already have completed. check smspool and enter its order id in phone setup before continuing. no second number was ordered.');
    }
    temporary(chosen, platform);
    const fresh = (await choices(chosen.platform)).options.find(option => option.id === chosen.id);
    assertActive();
    if (!fresh || fresh.price > chosen.price) throw new Error('the number price changed or is unavailable. stop signup and choose a current price before trying again.');
    // Persist intent before this non-idempotent purchase. Never retry an uncertain
    // charge, even after Stop or a worker restart. The provider enforces the cap.
    await save(requestId, { kind: 'temporary', platform: chosen.platform, state: 'ordering', credentialId, quotedPrice: chosen.price, startedAt: Date.now() });
    try { assertActive(); } catch (error) { await save(requestId, null); throw error; }
    let data;
    try { data = await request('/purchase/sms', { country: fresh.country, service: service(chosen.platform), max_price: chosen.price, pricing_option: 0, quantity: 1, create_token: 0, activation_type: 'SMS' }); }
    catch (error) { if (error.rejected) await save(requestId, null); throw error; }
    if (!validId(data.order_id)) throw new Error('smspool did not confirm the order. check your smspool orders before continuing.');
    // Save the known order before validating details or reacting to Stop.
    let record = await save(requestId, { kind: 'temporary', platform: chosen.platform, state: 'purchased', credentialId, orderId: data.order_id, quotedPrice: chosen.price });
    assertActive();
    const expiresAt = Number(data.expiration) * 1000;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || String(data.service).toLowerCase() !== chosen.platform || !Number.isFinite(Number(data.cost)) || Number(data.cost) > chosen.price) throw new Error('check the confirmed order in smspool. its details do not match this signup.');
    record = await save(requestId, { ...record, phone: phone(data.number || `${data.cc || ''}${data.phonenumber || ''}`), expiresAt });
    assertActive();
    return record;
  }
  async function check(requestId) {
    const record = await get(requestId);
    temporary(record);
    if (!record.orderId) throw new Error('your temporary number order is not confirmed. check phone setup.');
    await credential(record);
    if (!record.phone || !Number.isFinite(record.expiresAt)) throw new Error('check this order in smspool and attach its order id in phone setup.');
    if (record.expiresAt <= Date.now()) throw new Error('this temporary number expired. check the signup and order in smspool. no replacement was purchased.');
    const data = await request('/sms/check', { orderid: record.orderId });
    const status = Number(data.status);
    if ([2, 5, 6].includes(status)) throw new Error('this temporary order expired, was cancelled or was refunded. check smspool. no replacement was purchased.');
    if (![1, 3, 4, 7, 8].includes(status)) throw new Error('smspool returned an unclear order status. check the order there.');
    if (data.expiration != null && (!Number.isFinite(Number(data.expiration)) || Number(data.expiration) * 1000 <= Date.now())) throw new Error('this temporary number expired. check smspool.');
    return { record, data, status };
  }
  async function ready(requestId) {
    const { record, status } = await check(requestId);
    return [1, 3, 4].includes(status) ? record : null;
  }
  async function messages(requestId) {
    const { record, data, status } = await check(requestId);
    if (status !== 3) return [];
    const code = String(data.sms || '');
    if (!/^\d{6}$/.test(code)) throw new Error('check this phone code yourself in smspool. it is not a supported six-digit code.');
    // An order is bound to one requested platform and one activation. The order
    // id is a stable baseline marker without persisting the SMS or its code.
    return [{ ID: record.orderId, sender: service(record.platform), message: code }];
  }
  function verification(messages, baseline, platform) {
    const fresh = messages.filter(item => !baseline.includes(String(item.ID)) && new RegExp(`\\b${platform}\\b`, 'i').test(`${item.sender || ''} ${item.message}`));
    const candidates = fresh.map(item => ({ id: String(item.ID), codes: item.message.match(/(?<!\d)\d{6}(?!\d)/g) || [] })).filter(item => item.codes.length === 1);
    if (candidates.length !== 1) return null;
    return { id: candidates[0].id, code: candidates[0].codes[0] };
  }
  return { connect, choices, selection, get, attach, ensure, ready, messages, verification,
    async state() { return { connected: Boolean((await chrome.storage.session.get('smsPoolKey')).smsPoolKey) }; },
    async disconnect() { await chrome.storage.session.remove(['smsPoolKey', 'smsPoolChoices', 'smsPoolChoices:instagram', 'smsPoolChoices:tiktok', 'smsPoolCredential']); return { connected: false }; }
  };
})();
