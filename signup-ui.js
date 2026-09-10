(() => {
  'use strict';
  const node = id => document.getElementById(`signup-${id}`);
  if (!node('section')) return;
  const panel = location.protocol === 'chrome-extension:' && location.pathname === '/sidepanel.html';
  if (!panel) {
    for (const control of node('panel').querySelectorAll('input, select, button')) control.disabled = true;
    return;
  }

  node('web-help').hidden = true;
  node('panel').hidden = false;
  let state = null;
  let busy = false;
  let starting = false;
  let stopping = false;
  let polling = false;
  let revision = 0;
  let identity = '';
  let receivedAt = Date.now();
  let startingAt = 0;

  function syncProgress() {
    const working = starting || (state?.active && state.phase !== 'paused' && !stopping);
    const phase = stopping ? 'stopping' : starting ? 'starting' : state?.phase;
    node('progress').hidden = !starting && (!state || ['ready', 'recovery'].includes(phase));
    node('progress').className = `signup-progress ${working ? 'is-working' : phase === 'paused' ? 'is-paused' : ''}`;
    node('status').textContent = phase === 'paused' ? 'waiting for you' : phase === 'error' ? 'not started' : phase === 'complete' ? 'account ready' : working ? (starting ? 'starting' : 'working') : phase || 'ready';
    const milliseconds = starting ? Date.now() - startingAt : (state?.elapsedMs || 0) + (working ? Date.now() - receivedAt : 0);
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    node('timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    node('account').hidden = !state?.active || !state?.username;
    node('account').textContent = state?.username ? `${state.platform} · @${state.username}` : '';
  }

  async function request(type, extra = {}) {
    const result = await chrome.runtime.sendMessage({ type, ...extra });
    if (!result?.ok) throw new Error(result?.error || 'couldn’t connect. reopen the extension side panel.');
    return result.data;
  }

  function showError(message = '') {
    node('error').textContent = message;
    node('error').hidden = !message;
    node('message').hidden = Boolean(message);
  }

  function syncControls() {
    const active = state?.active === true || starting;
    const hasTab = Number.isInteger(state?.tabId) && state.tabId > 0;
    node('fields').disabled = busy || active || stopping;
    node('start').disabled = busy || active || stopping;
    node('form').hidden = active;
    node('active-controls').hidden = !active;
    node('show').hidden = !hasTab;
    node('show').disabled = busy || stopping || !active || !hasTab;
    node('continue').hidden = !state?.active || state.phase !== 'paused';
    node('continue').disabled = busy || stopping || !state?.active || state.phase !== 'paused';
    node('continue').textContent = state?.continueLabel || 'continue';
    node('stop').disabled = !active || stopping;
    syncProgress();
  }

  function render(next) {
    state = next ?? null;
    window.dispatchEvent?.(new CustomEvent('signup-state-change', { detail: state }));
    receivedAt = Date.now();
    const key = state?.email ? `${state.platform}:${state.email}` : '';
    if (key && key !== identity) {
      if (state.platform === 'instagram' || state.platform === 'tiktok') node('platform').value = state.platform;
      node('username').value = state.username || '';
      syncUsernameLimit();
    }
    identity = key;
    node('email').textContent = state?.email || '';
    node('email-row').hidden = !state?.email;
    if (state?.message) node('message').textContent = state.message;
    if (state?.active) node('section').open = true;
    syncControls();
  }

  function syncUsernameLimit() {
    node('username').maxLength = node('platform').value === 'tiktok' ? 24 : 30;
  }

  async function operate(action) {
    if (busy || stopping) return;
    busy = true;
    const startedAt = ++revision;
    showError();
    syncControls();
    try {
      const next = await action();
      if (startedAt === revision) render(next);
    } catch (error) {
      if (startedAt === revision) showError(error?.message || 'couldn’t finish that step. try again.');
    } finally {
      busy = false;
      syncControls();
    }
  }

  node('platform').addEventListener('change', () => { showError(); syncUsernameLimit(); });
  node('form').addEventListener('submit', event => {
    event.preventDefault();
    if (busy || stopping || state?.active || !node('form').reportValidity()) return;
    const input = {
      platform: node('platform').value,
      username: node('username').value.trim().replace(/^@+/, ''),
      password: node('password').value,
      ...(node('rental')?.value ? { rentalId: node('rental').value, rentalPrice: Number(node('rental').selectedOptions?.[0]?.dataset.price) } : {}),
    };
    starting = true;
    startingAt = Date.now();
    node('message').textContent = 'getting signup ready…';
    node('section').open = true;
    return operate(async () => {
      try {
        const pending = request('signup-start', input);
        node('password').value = '';
        input.password = '';
        return await pending;
      } finally {
        node('password').value = '';
        input.password = '';
        starting = false;
      }
    });
  });

  node('stop').addEventListener('click', async () => {
    node('password').value = '';
    if (stopping || (!starting && !state?.active)) return;
    stopping = true;
    const startedAt = ++revision;
    showError();
    syncControls();
    try {
      const next = await request('signup-stop');
      if (startedAt === revision) {
        starting = false;
        render(next);
      }
    } catch (error) {
      if (startedAt === revision) showError(error?.message || 'couldn’t stop signup. close its platform tab.');
    } finally {
      stopping = false;
      syncControls();
    }
  });
  for (const id of ['show', 'continue']) {
    node(id).addEventListener('click', () => {
      if (!state?.active || (id === 'continue' && state.phase !== 'paused')) return;
      return operate(() => request(`signup-${id}`));
    });
  }

  // A poll may finish after a button request; ignore that older snapshot.
  setInterval(async () => {
    if (busy || stopping || polling) return;
    polling = true;
    const startedAt = revision;
    try {
      const next = await request('signup-state');
      if (startedAt === revision) render(next);
    } catch (error) {
      if (startedAt === revision) showError(error?.message || 'connection lost. reopen the extension side panel.');
    } finally { polling = false; }
  }, 2000);
  setInterval(syncProgress, 1000);
  window.addEventListener('pagehide', () => { node('password').value = ''; });
  syncUsernameLimit();
  void operate(() => request('signup-state'));
})();
