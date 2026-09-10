(() => {
  'use strict';
  if (location.protocol !== 'chrome-extension:' || location.pathname !== '/sidepanel.html') return;
  const node = id => document.getElementById(`phone-${id}`);
  const rental = document.getElementById('signup-rental');
  const platform = document.getElementById('signup-platform');
  let busy = false;
  let active = false;
  let connected = false;
  function controls() {
    platform.disabled = busy || active;
    node('connect').disabled = busy || active;
    node('key').disabled = busy || active;
    node('refresh').disabled = busy || active;
    node('disconnect').disabled = busy || active;
    node('refresh').hidden = node('disconnect').hidden = !connected;
  }
  async function request(type, extra = {}) {
    const response = await chrome.runtime.sendMessage({ type: `signup-phone-${type}`, platform: platform.value, ...extra });
    if (!response?.ok) throw new Error(response?.error || 'couldn’t connect to the extension. reopen its side panel.');
    return response.data;
  }
  function showOptions(options) {
    const previous = rental.value;
    rental.replaceChildren(new Option('i’ll handle phone verification', ''));
    for (const option of options.filter(option => option.platform === platform.value)) {
      const choice = new Option(`${option.name} · up to $${option.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 20 })} once`, option.id);
      choice.dataset.price = String(option.price);
      rental.add(choice);
    }
    if ([...rental.options].some(option => option.value === previous)) rental.value = previous;
  }
  async function operate(action) {
    if (busy) return;
    busy = true; controls();
    try { await action(); }
    catch (error) { node('status').textContent = error.message || 'phone setup needs your attention.'; }
    finally { busy = false; controls(); }
  }
  node('connect-form').addEventListener('submit', event => {
    event.preventDefault();
    if (active || !node('connect-form').reportValidity()) return;
    void operate(async () => {
      let key = node('key').value;
      node('key').value = '';
      let result;
      try { result = await request('connect', { key }); } finally { key = ''; }
      connected = true; showOptions(result.options);
      node('status').textContent = 'connected. choose a temporary number above. you’re charged only if signup needs a phone number. the displayed price is your spending limit.';
    });
  });
  node('refresh').addEventListener('click', () => operate(async () => { const result = await request('choices'); showOptions(result.options); node('status').textContent = 'temporary number prices refreshed.'; }));
  platform.addEventListener('change', () => {
    showOptions([]);
    if (connected) void operate(async () => { const result = await request('choices'); showOptions(result.options); node('status').textContent = 'temporary number prices refreshed for this platform.'; });
  });
  node('disconnect').addEventListener('click', () => operate(async () => { await request('disconnect'); connected = false; showOptions([]); node('status').textContent = 'disconnected. existing orders stay in smspool.'; }));
  node('attach-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!node('attach-form').reportValidity()) return;
    void operate(async () => {
      await request('attach', { rentalCode: node('rental-code').value.trim() });
      node('rental-code').value = '';
      node('status').textContent = 'temporary number saved. continue signup when ready.';
    });
  });
  window.addEventListener('signup-state-change', event => {
    active = event.detail?.active === true;
    const state = event.detail;
    node('attach-form').hidden = !active || state.phase !== 'paused';
    node('saved').hidden = !state?.phone;
    if (state?.phone) {
      const expiration = Number.isFinite(state.phoneExpiresAt) ? new Date(state.phoneExpiresAt).toLocaleTimeString() : 'check smspool';
      node('saved').textContent = state.phoneKind !== 'temporary' ? `${state.phone} · earlier monthly order. manage it in smspool.` : `${state.phone} · temporary number expires at ${expiration}. keep your account email for recovery.`;
    }
    controls();
  });
  window.addEventListener('pagehide', () => { node('key').value = ''; });
  node('attach-form').hidden = true;
  void operate(async () => {
    const state = await request('state'); connected = state.connected;
    if (connected) { const result = await request('choices'); showOptions(result.options); }
    node('status').textContent = connected ? 'connected. choose a temporary number above.' : 'connect smspool to handle signup phone codes automatically.';
  });
})();
