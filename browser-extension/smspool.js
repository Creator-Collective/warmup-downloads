'use strict';

// User-owned credentials live only in trusted extension session storage. Never
// return them to runners, websites, injected pages, or persistent account history.
const smsPool = (() => {
  const origin = 'https://api.smspool.net';
  const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
  const phone = value => {
    const digits = String(value || '').replace(/^\+/, '');
    if (!/^[1-9]\d{7,14}$/.test(digits)) throw new Error('smspool has not supplied a usable phone number yet. check the rental in smspool.');
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
      const error = new Error('smspool could not complete this request. check your connection, balance and rental in smspool.');
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
  async function choices() {
    const data = await request('/rental/retrieve_all', { type: 1 });
    if (!Array.isArray(data.data)) throw new Error('smspool did not return its available rentals.');
    // Always-on numbers receive every service and need no temporary port lease.
    const options = data.data.flatMap(item => {
      if (item.single_service != null || !Number.isInteger(Number(item.ID)) || Number(item.ID) <= 0 || typeof item.name !== 'string' || item.name.length >= 100) return [];
      const days = Object.keys(item.pricing || {}).map(Number).filter(day => Number.isInteger(day) && day >= 28 && day <= 31 && Number.isFinite(Number(item.pricing[day])) && Number(item.pricing[day]) > 0).sort((a, b) => a - b)[0];
      return days ? [{ id: String(item.ID), name: typeof item.tag === 'string' ? item.tag.slice(0, 100) : item.name, days, price: Number(item.pricing[days]) }] : [];
    });
    await chrome.storage.session.set({ smsPoolChoices: options });
    return { connected: true, options };
  }
  async function selection(id, price, days) {
    const options = (await chrome.storage.session.get('smsPoolChoices')).smsPoolChoices;
    const selected = options?.find(option => option.id === id);
    if (!selected) throw new Error('connect smspool and choose a monthly phone rental first.');
    if (!Number.isFinite(price) || price <= 0 || selected.price > price || selected.days !== days) throw new Error('refresh the phone rental prices and choose your number again.');
    return { ...selected, price };
  }
  async function get(requestId) {
    return (await chrome.storage.local.get(`smsPoolRental:${requestId}`))[`smsPoolRental:${requestId}`] || null;
  }
  async function credential(record) {
    const stored = await chrome.storage.session.get(['smsPoolKey', 'smsPoolCredential']);
    if (!stored.smsPoolKey || !stored.smsPoolCredential) throw new Error('reconnect smspool in phone setup.');
    if (record?.credentialId && stored.smsPoolCredential !== record.credentialId) throw new Error('reconnect the smspool account that owns this rental.');
    return stored.smsPoolCredential;
  }
  async function save(requestId, record) {
    await chrome.storage.local.set({ [`smsPoolRental:${requestId}`]: record });
    return record;
  }
  async function attach(requestId, rentalCode) {
    if (!validId(rentalCode)) throw new Error('enter the rental code shown in smspool.');
    const existing = await get(requestId);
    if (existing?.rentalCode && existing.rentalCode !== rentalCode) throw new Error('this signup already has a confirmed rental. keep using that number.');
    const credentialId = await credential(existing);
    const data = await request('/rental/info', { rental_code: rentalCode });
    if (data.rental_code !== rentalCode || Number(data.expiration_date) * 1000 <= Date.now()) throw new Error('that rental is missing or expired. check it in smspool.');
    if (Number(data.type) !== 1 || Number(data.service) > 0 || data.service_name) throw new Error('choose an extendable, always-on rental that can receive codes from either platform.');
    // Do not silently assign one rental to two different local accounts.
    const local = await chrome.storage.local.get(null);
    if (Object.entries(local).some(([key, value]) => key.startsWith('smsPoolRental:') && key !== `smsPoolRental:${requestId}` && value?.rentalCode === rentalCode)) throw new Error('this rental already belongs to another saved account on this device.');
    return save(requestId, { state: 'ready', credentialId, rentalCode, phone: phone(data.phonenumber), expiresAt: Number(data.expiration_date) * 1000, autoExtend: Number(data.auto_extend) === 1 });
  }
  async function ensure(requestId, chosen, assertActive) {
    const existing = await get(requestId);
    assertActive();
    const credentialId = await credential(existing);
    assertActive();
    if (existing?.rentalCode) return existing;
    if (existing) throw new Error('a rental purchase may already have completed. check smspool and enter its rental code in phone setup before continuing. no second number was ordered.');
    const fresh = (await choices()).options.find(option => option.id === chosen?.id);
    assertActive();
    if (!fresh || fresh.days !== chosen.days || fresh.price > chosen.price) throw new Error('the rental price changed or is unavailable. stop signup and choose a current rental before trying again.');
    const stock = await request('/rental/stock', { id: chosen.id, days: chosen.days });
    assertActive();
    if (!(Number(stock.count) > 0)) throw new Error('this phone rental is out of stock. choose another rental before trying again.');
    // This API has no idempotency key. Persist intent before purchase and never
    // repeat it after a timeout, worker restart, Stop, or uncertain response.
    await save(requestId, { state: 'ordering', credentialId, productId: chosen.id, quotedPrice: fresh.price, startedAt: Date.now() });
    try { assertActive(); } catch (error) { await save(requestId, null); throw error; }
    let data;
    try { data = await request('/purchase/rental', { id: chosen.id, days: chosen.days, create_token: 0 }); }
    catch (error) { if (error.rejected) await save(requestId, null); throw error; }
    if (!validId(data.rental_code)) throw new Error('smspool did not confirm the rental. check your smspool orders before continuing.');
    // Keep the receipt even if Stop arrived during the purchase request.
    const record = await save(requestId, { state: 'purchased', credentialId, rentalCode: data.rental_code, productId: chosen.id, quotedPrice: fresh.price, expiresAt: Number(data.expiry) * 1000 || null });
    assertActive();
    return record;
  }
  async function ready(requestId) {
    const rental = await get(requestId);
    if (!rental?.rentalCode) throw new Error('a phone rental has not been confirmed. check phone setup.');
    await credential(rental);
    const data = await request('/rental/retrieve_status', { rental_code: rental.rentalCode });
    if (Number(data.status?.available) !== 1) return null;
    const expiresAt = Number(data.status.expiry) * 1000;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('your phone rental expired. renew the same number in smspool before continuing.');
    const number = phone(data.status.phonenumber);
    if (rental.phone && number !== rental.phone) throw new Error('the rental number changed. check this account and its rental before continuing.');
    return save(requestId, { ...rental, state: 'ready', phone: number, expiresAt, autoExtend: Number(data.status.auto_extend) === 1 });
  }
  async function messages(requestId) {
    const rental = await get(requestId);
    if (!rental?.rentalCode) throw new Error('your saved phone rental is missing.');
    await credential(rental);
    const data = await request('/rental/retrieve_messages', { rental_code: rental.rentalCode });
    if (!Array.isArray(data.messages) || data.messages.length > 1000) throw new Error('smspool returned an unclear message history. check the code yourself in smspool.');
    if (data.messages.some(item => !validId(String(item.ID)) || typeof item.message !== 'string')) throw new Error('smspool returned an unclear message. check the code yourself.');
    return data.messages;
  }
  function verification(messages, baseline, platform) {
    const fresh = messages.filter(item => !baseline.includes(String(item.ID)) && new RegExp(`\\b${platform}\\b`, 'i').test(`${item.sender || ''} ${item.message}`));
    const candidates = fresh.map(item => ({ id: String(item.ID), codes: item.message.match(/(?<!\d)\d{6}(?!\d)/g) || [] })).filter(item => item.codes.length === 1);
    if (candidates.length !== 1) return null;
    return { id: candidates[0].id, code: candidates[0].codes[0] };
  }
  return { connect, choices, selection, get, attach, ensure, ready, messages, verification,
    async state() { return { connected: Boolean((await chrome.storage.session.get('smsPoolKey')).smsPoolKey) }; },
    async disconnect() { await chrome.storage.session.remove(['smsPoolKey', 'smsPoolChoices', 'smsPoolCredential']); return { connected: false }; }
  };
})();
