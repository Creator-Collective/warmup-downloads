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
  let profile = null;
  let aliases = [];
  let state = null;
  let busy = false;
  let polling = false;
  let revision = 0;
  let identity = '';
  const activeButtons = ['show', 'continue', 'code', 'stop', 'complete'];

  async function request(type, extra = {}) {
    const result = await chrome.runtime.sendMessage({ type, ...extra });
    if (!result?.ok) throw new Error(result?.error || 'couldn’t connect. reopen the extension side panel.');
    return result.data;
  }

  function showError(message = '') {
    node('error').textContent = message;
    node('error').hidden = !message;
  }

  function syncControls() {
    const active = state?.active === true;
    node('dashboard-controls').disabled = busy || active || Boolean(profile);
    node('connect').disabled = busy || active || Boolean(profile) || !node('dashboard-tab').value;
    node('connection-row').hidden = !profile && !active;
    node('disconnect').disabled = busy;
    node('fields').disabled = busy || active || !profile;
    node('start').disabled = busy || active || !profile || !node('email').value;
    node('active-controls').hidden = !active;
    node('actual-username').disabled = busy || !active;
    for (const id of activeButtons) node(id).disabled = busy || !active;
    node('stop').disabled = !active;
  }

  function render(next) {
    state = next ?? null;
    const key = state?.active ? `${state.tabId}:${state.platform}:${state.email}` : '';
    if (key && key !== identity) node('actual-username').value = state.username || '';
    identity = key;
    if (state?.message) node('message').textContent = state.message;
    if (state?.active) node('section').open = true;
    if (state?.phase === 'complete') {
      aliases = aliases.map(alias => alias.email === state.email ? { ...alias, accountUsername: state.username } : alias);
      renderAliases();
    }
    syncControls();
  }

  function renderAliases(preferred = node('email').value) {
    const platform = node('platform').value;
    const available = aliases.filter(alias => !alias.accountUsername && (!alias.platform || alias.platform === platform));
    node('email').replaceChildren(new Option(available.length ? 'choose a signup email' : 'generate an email to get started', ''),
      ...available.map(alias => new Option(`${alias.email}${alias.accountUsername ? ` · @${alias.accountUsername}` : ''}`, alias.id)));
    node('email').value = available.some(alias => alias.id === preferred) ? preferred : available.length === 1 ? available[0].id : '';
    syncControls();
  }

  async function refreshTabs(preferred = node('dashboard-tab').value) {
    const list = await request('signup-dashboard-tabs');
    node('dashboard-tab').replaceChildren(new Option(list.length ? 'choose your student dashboard' : 'open your student dashboard first', ''),
      ...list.map((tab, index) => new Option(`${tab.title} · tab ${index + 1}`, String(tab.id))));
    node('dashboard-tab').value = list.some(tab => String(tab.id) === String(preferred)) ? String(preferred) : list.length === 1 ? String(list[0].id) : '';
    syncControls();
  }

  async function operate(action) {
    if (busy) return;
    busy = true;
    revision++;
    showError();
    syncControls();
    try { await action(); }
    catch (error) { showError(error?.message || 'couldn’t finish that step. try again.'); }
    finally { busy = false; syncControls(); }
  }

  node('dashboard-tab').addEventListener('change', syncControls);
  node('refresh-dashboard').addEventListener('click', () => operate(() => refreshTabs()));
  node('open-dashboard').addEventListener('click', () => operate(async () => {
    const opened = await request('signup-open-dashboard');
    await refreshTabs(opened.tabId);
    node('message').textContent = 'sign in to your student dashboard, then connect it here.';
  }));
  node('connect').addEventListener('click', () => operate(async () => {
    const dashboardTabId = Number(node('dashboard-tab').value);
    if (!Number.isInteger(dashboardTabId) || dashboardTabId < 1) throw new Error('choose your student dashboard tab first.');
    const result = await request('signup-connect', { dashboardTabId });
    profile = result.profile;
    aliases = result.aliases || [];
    node('profile').textContent = `connected to ${profile.fullName || 'your student dashboard'}`;
    if (!node('full-name').value) node('full-name').value = profile.fullName || '';
    node('message').textContent = 'choose an email and enter the account details to open signup.';
    renderAliases();
  }));

  node('disconnect').addEventListener('click', () => {
    node('password').value = '';
    return operate(async () => {
      render(await request('signup-stop'));
      profile = null;
      aliases = [];
      node('profile').textContent = '';
      node('full-name').value = '';
      node('username').value = '';
      node('actual-username').value = '';
      node('message').textContent = 'dashboard disconnected. connect a student dashboard to continue.';
      renderAliases();
    });
  });
  node('platform').addEventListener('change', () => { showError(); renderAliases(); });
  node('email').addEventListener('change', syncControls);
  node('generate').addEventListener('click', () => operate(async () => {
    const alias = await request('signup-generate', { platform: node('platform').value });
    aliases = [...aliases.filter(item => item.id !== alias.id), alias];
    renderAliases(alias.id);
    node('message').textContent = 'email ready. enter the account details to open signup.';
  }));

  node('form').addEventListener('submit', event => {
    event.preventDefault();
    if (busy || state?.active || !profile || !node('form').reportValidity()) return;
    const input = {
      aliasId: node('email').value,
      platform: node('platform').value,
      username: node('username').value.trim().replace(/^@+/, ''),
      fullName: node('full-name').value.trim(),
      password: node('password').value,
    };
    return operate(async () => {
      try {
        const pending = request('signup-start', input);
        node('password').value = '';
        input.password = '';
        render(await pending);
      } finally { node('password').value = ''; input.password = ''; }
    });
  });

  node('stop').addEventListener('click', async () => {
    node('password').value = '';
    revision++;
    try { render(await request('signup-stop')); }
    catch (error) { showError(error?.message || 'couldn’t stop signup. close its platform tab.'); }
  });
  for (const id of ['show', 'continue', 'code']) {
    node(id).addEventListener('click', () => {
      if (id === 'stop') node('password').value = '';
      return operate(async () => { render(await request(`signup-${id}`)); });
    });
  }
  node('completion-form').addEventListener('submit', event => {
    event.preventDefault();
    if (busy || !state?.active || !node('completion-form').reportValidity()) return;
    const username = node('actual-username').value.trim().replace(/^@+/, '');
    if (!username) { showError('enter the username the platform actually created.'); return; }
    return operate(async () => { render(await request('signup-complete', { username })); });
  });

  // A poll may finish after a button request; ignore that older snapshot.
  setInterval(async () => {
    if (busy || polling) return;
    polling = true;
    const startedAt = revision;
    try {
      const next = await request('signup-state');
      if (startedAt === revision) render(next);
    } catch (error) {
      if (startedAt === revision) showError(error?.message || 'connection lost. reopen the extension side panel.');
    } finally { polling = false; }
  }, 2000);
  window.addEventListener('pagehide', () => { node('password').value = ''; });
  void operate(async () => { render(await request('signup-state')); await refreshTabs(); });
})();
