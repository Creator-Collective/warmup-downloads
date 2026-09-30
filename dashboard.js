'use strict';
const $ = id => document.getElementById(id);
const pending = new Map();
const inPanel = location.protocol === 'chrome-extension:' && location.pathname === '/sidepanel.html';
let connected = false;
let running = false;
let busy = false;
let currentState;
let supportsFocus = false;
let focusBusy = false;
let stateRevision = 0;
let polling = false;
let tabDiscoveryVersion = 0;
let canAutoSelectTab = true;
let tabDiscoveryError = '';
let requestError = '';
let validPlan = false;
const actions = ['like','follow','comment'];
let limitOverrides = {};
let editingLimit = null;
let savedDraft = null;
const fields = ['platform','niche','minutes','focus','limit-like','limit-follow','limit-comment'];
const draftFields = fields.filter(field => field !== 'platform' && !field.startsWith('limit-'));
const draftDefaults = Object.fromEntries(draftFields.map(field => [field, $(field).value]));
const platformDrafts = {};
const knownPlatforms = ['instagram', 'tiktok'];
// The hosted page is always instagram. Only an extension side panel takes its
// platform from its own page and, once connected, from its own extension build.
let platform = inPanel && knownPlatforms.includes($('platform').value) ? $('platform').value : 'instagram';
// A saved session without a platform is an instagram session.
const sessionPlatform = settings => settings?.platform || 'instagram';
window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'cc-warmup-response') return;
  const callback = pending.get(event.data.id);
  if (callback) { pending.delete(event.data.id); callback(event.data); }
});
function request(type, extra = {}) {
  if (inPanel) return chrome.runtime.sendMessage({type, ...extra}).then(response => {
    if (!response?.ok) throw new Error(response?.error || 'couldn’t connect. close and reopen the panel.');
    return response.data;
  });
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('extension not connected. finish setup, then refresh this page.')); }, 8000);
    pending.set(id, response => { clearTimeout(timer); response.ok ? resolve(response.data) : reject(new Error(response.error || 'couldn’t complete that action.')); });
    window.postMessage({ channel: 'cc-warmup-request', id, type, ...extra }, location.origin);
  });
}
try {
  const saved = JSON.parse(localStorage.getItem('cc-web-session') || '{}');
  if (saved.version === 3) {
    for (const platform of ['instagram', 'tiktok']) {
      if (saved.profiles?.[platform] && typeof saved.profiles[platform] === 'object') platformDrafts[platform] = saved.profiles[platform];
    }
  } else {
    const customLimits = {};
    for (const action of actions) {
      const value = saved.version === 2 ? saved.customLimits?.[action] : saved[`limit-${action}`];
      if (typeof value === 'string' && value !== '') customLimits[action] = value;
    }
    platformDrafts[saved.platform === 'tiktok' ? 'tiktok' : 'instagram'] = { ...saved, customLimits };
  }
} catch { /* defaults remain usable */ }
function restoreDraft(name) {
  const draft = platformDrafts[name] || {};
  $('platform').value = name;
  for (const field of draftFields) $(field).value = typeof draft[field] === 'string' ? draft[field] : draftDefaults[field];
  limitOverrides = Object.fromEntries(actions.filter(action => typeof draft.customLimits?.[action] === 'string' && draft.customLimits[action] !== '').map(action => [action, draft.customLimits[action]]));
  // Preserve actions explicitly disabled in the retired mix as visible zero targets.
  for (const action of actions) if (draft[`mix-${action}`] === '0') limitOverrides[action] = '0';
  editingLimit = null;
}
function saveDraft() {
  platformDrafts[platform] = { ...Object.fromEntries(draftFields.map(field => [field, $(field).value])), customLimits: { ...limitOverrides } };
  try { localStorage.setItem('cc-web-session', JSON.stringify({ version: 3, platform, profiles: platformDrafts })); } catch { /* in-memory settings still work */ }
}
restoreDraft(platform);
platformChanged();
function usePlatform(name) {
  platform = name;
  restoreDraft(platform);
  canAutoSelectTab = true;
  tabDiscoveryVersion += 1;
  platformChanged();
}
const numeric = value => value.trim() === '' ? NaN : Number(value);
function input() {
  return { platform, niche: $('niche').value, minutes: numeric($('minutes').value), pace: 'auto', enableComments: true, focus: supportsFocus ? $('focus').value : 'balanced',
    customLimits: Object.fromEntries(Object.entries(limitOverrides).map(([name, value]) => [name, numeric(value)])) };
}
function showError(message) { $('form-error').textContent = message; $('form-error').hidden = !message; }
function error(message) { requestError = message; showError(message); }
function plan() {
  globalThis.warmupSelects?.sync();
  renderResume();
  if (running && currentState?.settings) {
    showError(requestError);
    $('start').disabled = true;
    return;
  }
  let valid = false;
  try {
    const automatic = sessionPlan.validateSettings({ ...input(), customLimits: {} });
    for (const action of actions) {
      if (!Object.hasOwn(limitOverrides, action) && editingLimit !== action) $(`limit-${action}`).value = String(automatic.limits[action]);
    }
    const result = sessionPlan.validateSettings(input());
    // Polling and recalculation must not replace a number while it is edited.
    for (const action of actions) if (editingLimit !== action) $(`limit-${action}`).value = String(result.limits[action]);
    const reach = sessionPlan.usualReach(result);
    renderLimitHint(actions.some(action => result.limits[action] > reach[action]));
    showError(requestError); valid = true;
  } catch (e) {
    renderLimitHint(false);
    showError(editingLimit && $(`limit-${editingLimit}`).value === '' ? requestError : e.message);
  }
  validPlan = valid;
  $('start').disabled = !connected || running || busy || !valid || !$('instagram-tab').value;
  saveDraft();
  renderFocus();
}
function renderLimitHint(show) {
  const hint = $('limit-hint');
  if (!hint) return;
  hint.textContent = show ? "more than this pace usually fits. the session stops when time runs out, it won't rush." : '';
  hint.hidden = !show;
}
function renderResume() {
  const available = !running && currentState?.canResume === true;
  $('resume').hidden = !available;
  $('resume').disabled = !available || !connected || busy || !$('instagram-tab').value;
  $('start').textContent = available ? 'start new session' : 'start session';
  $('start').classList.toggle('primary', !available);
  $('start').classList.toggle('secondary', available);
  $('resume-summary').hidden = !available;
  if (available) {
    const settings = currentState.settings;
    $('resume-summary').textContent = `resume uses saved settings: ${settings.terms.join(', ')} · ${settings.limits.like} likes · ${settings.limits.follow} follows · ${settings.limits.comment} comments · ${settings.focus || 'balanced'} focus. edits apply to new sessions.`;
  }
}
function renderRemaining() {
  const state = currentState;
  const remainingMs = state?.running && state.phase !== 'stopping' ? state.deadline - Date.now() : state?.remainingMs;
  if ((!state?.running && !state?.canResume) || !Number.isFinite(remainingMs)) { $('remaining').textContent = ''; return; }
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  $('remaining').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')} left`;
}
function renderFocus() {
  const parent = $(running ? 'focus-live' : 'focus-home');
  if ($('focus-controls').parentElement !== parent) parent.append($('focus-controls'));
  const available = supportsFocus && (!running || sessionPlatform(currentState?.settings) === platform);
  $('focus-controls').hidden = !available;
  $('focus').disabled = !available || !connected || busy || focusBusy || (running && !currentState?.canChangeFocus);
  for (const option of $('focus').options) {
    const limit = running ? currentState?.settings?.limits?.[option.value] : Number($(`limit-${option.value}`)?.value);
    option.disabled = option.value !== 'balanced' && limit === 0;
  }
  if (!running) {
    $('focus-status').hidden = true;
    if ([...$('focus').options].some(option => option.selected && option.disabled)) {
      $('focus').value = 'balanced';
      saveDraft();
    }
  }
  globalThis.warmupSelects?.sync();
}
function connection(value) {
  if (connected !== value) tabDiscoveryVersion += 1;
  connected = value;
  $('connection').textContent = value ? (inPanel ? 'connected' : 'extension connected') : 'extension needed';
  $('connection').classList.toggle('connected', value);
  $('setup').hidden = value;
  $('open-instagram').disabled = !value || running;
  $('refresh-tabs').disabled = !value || running;
  platformChanged();
  plan();
  renderRemaining();
}
async function tabs({ reportError = false } = {}) {
  if (!connected || running || busy) return;
  const requested = platform;
  const version = ++tabDiscoveryVersion;
  const isCurrent = () => connected && !running && !busy && version === tabDiscoveryVersion && requested === platform && requested === $('platform').value;
  let list;
  try { list = await request('tabs', { platform: requested }); }
  catch (e) {
    if (isCurrent() && reportError) { tabDiscoveryError = e.message; error(e.message); }
    return;
  }
  if (!isCurrent()) return;
  if (tabDiscoveryError && requestError === tabDiscoveryError) error('');
  tabDiscoveryError = '';
  const select = $('instagram-tab');
  const selected = select.value;
  const options = [new Option(list.length ? 'choose a tab' : `open ${requested} in this chrome profile`, ''), ...list.map((tab, index) => new Option(`${tab.title} · tab ${index + 1}`, String(tab.id)))];
  // Keep an open picker stable when polling has found nothing new.
  if (options.length !== select.options.length || options.some((option, index) => option.value !== select.options[index].value || option.text !== select.options[index].text)) select.replaceChildren(...options);
  if (list.some(tab => String(tab.id) === selected)) select.value = selected;
  else if (canAutoSelectTab && list.length === 1) select.value = String(list[0].id);
  else select.value = '';
  // A closed selection must not silently switch the session to another account.
  if (select.value) canAutoSelectTab = false;
  plan();
}
function selectActiveTab(tabId) {
  const select = $('instagram-tab');
  const value = String(tabId);
  const platform = currentState?.settings?.platform || $('platform').value;
  if (![...select.options].some(option => option.value === value)) select.add(new Option(`active ${platform} tab`, value));
  select.value = value;
}
function platformChanged() {
  $('platform').value = platform;
  $('tab-label').textContent = `${platform} tab`;
  $('instagram-tab').dataset.icon = platform;
  $('open-instagram').textContent = `open ${platform} ↗`;
}
function displayPlan(state) {
  if (state.running && state.settings && sessionPlatform(state.settings) === platform) {
    if (!savedDraft) savedDraft = { values: Object.fromEntries(fields.map(field => [field, $(field).value])), limits: { ...limitOverrides }, tabId: $('instagram-tab').value };
    editingLimit = null;
    const settings = state.settings;
    $('platform').value = settings.platform || 'instagram';
    platformChanged();
    $('niche').value = settings.terms.join(', ');
    $('minutes').value = String(settings.minutes);
    if (!focusBusy) $('focus').value = settings.focus || 'balanced';
    for (const action of actions) {
      $(`limit-${action}`).value = String(settings.limits[action]);
    }
    selectActiveTab(state.tabId);
  } else if (!state.running && savedDraft) {
    for (const field of fields) $(field).value = savedDraft.values[field];
    limitOverrides = savedDraft.limits;
    $('instagram-tab').value = savedDraft.tabId;
    savedDraft = null;
    platformChanged();
  }
}
function render(state) {
  commentHistory.render(document, state.comments);
  currentState = state;
  if (running !== state.running) tabDiscoveryVersion += 1;
  running = state.running;
  displayPlan(state);
  $('start').hidden = running; $('stop').hidden = !running;
  $('settings').disabled = running || busy;
  $('minutes').disabled = running || busy;
  renderFocus();
  $('message').textContent = state.message;
  document.body.classList.toggle('running', running);
  $('completed').hidden = !state.settings && !state.activity?.length;
  $('empty-state').hidden = Boolean(state.activity?.length || running);
  sessionResults.render(document, state);
  const key = JSON.stringify(state.activity || []);
  if ($('activity').dataset.key !== key) {
    $('activity').dataset.key = key;
    $('activity').replaceChildren(...(state.activity || []).map(item => { const row = document.createElement('li'); const time = document.createElement('time'); time.dateTime = new Date(item.time).toISOString(); time.textContent = new Date(item.time).toLocaleTimeString([], { hour:'2-digit',minute:'2-digit',second:'2-digit' }); const text = document.createElement('span'); text.textContent = item.message; row.append(time,text); return row; }));
  }
  plan();
  renderRemaining();
  if (inPanel) $('activity-panel').style.order = running ? '-1' : '';
}
$('session-form').addEventListener('submit', async event => {
  event.preventDefault(); if (running || busy) return;
  try {
    error(''); sessionPlan.validateSettings(input()); busy = true; stateRevision += 1; $('settings').disabled = true; $('minutes').disabled = true; plan();
    render(await request('start', { settings: input(), tabId: Number($('instagram-tab').value) }));
  } catch (e) { error(e.message); }
  finally { busy = false; stateRevision += 1; $('settings').disabled = running; $('minutes').disabled = running; $('start').disabled = !connected || running || !validPlan || !$('instagram-tab').value; renderResume(); globalThis.warmupSelects?.sync(); }
});
$('resume').addEventListener('click', async () => {
  if (running || busy || !connected || !currentState?.canResume || !$('instagram-tab').value) return;
  const sessionId = currentState.sessionId;
  try {
    error(''); busy = true; stateRevision += 1; $('settings').disabled = true; $('minutes').disabled = true; plan();
    render(await request('resume', { sessionId, tabId: Number($('instagram-tab').value) }));
  } catch (e) { error(e.message); }
  finally { busy = false; stateRevision += 1; $('settings').disabled = running; $('minutes').disabled = running; plan(); }
});
$('session-form').addEventListener('invalid', event => { const details = event.target.closest('details'); if (details) details.open = true; }, true);
function edited() { error(''); plan(); }
for (const field of draftFields.filter(field => field !== 'focus')) $(field).addEventListener('input', edited);
for (const action of actions) {
  const field = $(`limit-${action}`);
  field.addEventListener('focus', () => { editingLimit = action; });
  field.addEventListener('input', () => { editingLimit = action; limitOverrides[action] = field.value; edited(); });
  field.addEventListener('blur', () => {
    editingLimit = null;
    if (field.value === '' && !field.validity?.badInput) delete limitOverrides[action];
    plan();
  });
}
$('instagram-tab').addEventListener('change', () => { canAutoSelectTab = false; edited(); });
$('focus').addEventListener('change', async () => {
  if (focusBusy || !supportsFocus) return;
  if (!running) { edited(); return; }
  if (sessionPlatform(currentState?.settings) !== platform) return;
  const sessionId = currentState?.sessionId;
  if (!currentState?.canChangeFocus || !sessionId) return;
  const focus = $('focus').value;
  focusBusy = true;
  stateRevision += 1;
  $('focus-status').hidden = false;
  $('focus-status').textContent = 'applying…';
  renderFocus();
  try {
    const state = await request('set-focus', { sessionId, focus });
    // A response from before Stop or a replacement session cannot revive it.
    if (currentState?.sessionId !== sessionId || !currentState?.canChangeFocus) return;
    if (state.sessionId !== sessionId || state.settings?.focus !== focus) throw new Error('focus was not changed. try again.');
    focusBusy = false;
    stateRevision += 1;
    render(state);
    const focusPlatform = state.settings.platform;
    platformDrafts[focusPlatform] = { ...platformDrafts[focusPlatform], focus };
    if (savedDraft && platform === focusPlatform) savedDraft.values.focus = focus;
    try { localStorage.setItem('cc-web-session', JSON.stringify({ version: 3, platform, profiles: platformDrafts })); } catch { /* in-memory choice remains usable */ }
    $('focus-status').textContent = 'applies to remaining targets.';
  } catch (e) {
    if (currentState?.sessionId === sessionId && currentState?.canChangeFocus) $('focus-status').textContent = e.message;
  } finally {
    focusBusy = false;
    stateRevision += 1;
    $('focus').value = currentState?.running ? currentState.settings?.focus || 'balanced' : $('focus').value;
    if (!currentState?.canChangeFocus) $('focus-status').hidden = true;
    renderFocus();
  }
});
$('reset-limits').addEventListener('click', () => { limitOverrides = {}; editingLimit = null; edited(); });
$('refresh-tabs').addEventListener('click', () => tabs({ reportError: true }));
$('open-instagram').addEventListener('click', () => request('open-platform', { platform }).then(() => tabs({ reportError: true })).catch(e => error(e.message)));
$('stop').addEventListener('click', () => { stateRevision += 1; if (currentState) currentState.canChangeFocus = false; renderFocus(); return request('stop').then(state => { stateRevision += 1; render(state); }).catch(e => error(e.message)); });
// Test builds only (a side panel whose extension reports testTools): a read-only
// check of the chosen tab and a copyable report of numbers and fixed labels.
let lastProbe = null;
function showTestTools() {
  if ($('test-tools')) return;
  const make = (tag, properties) => Object.assign(document.createElement(tag), properties);
  const section = make('section', { id: 'test-tools', className: 'setup-strip test-tools' });
  section.setAttribute('aria-label', 'test tools');
  const check = make('button', { id: 'check-page', type: 'button', className: 'secondary', textContent: 'check this page' });
  const copy = make('button', { id: 'copy-report', type: 'button', className: 'secondary', textContent: 'copy test report' });
  const status = make('p', { id: 'test-status', className: 'results-note' });
  status.setAttribute('role', 'status');
  const output = make('textarea', { id: 'test-output', readOnly: true, rows: 8, hidden: true });
  output.setAttribute('aria-label', 'test output');
  section.append(make('h2', { textContent: 'test tools' }), check, copy);
  $('form-error').after(section, status, output);
  const show = text => { output.value = text; output.hidden = false; };
  check.addEventListener('click', async () => {
    check.disabled = true;
    status.textContent = 'checking this page…';
    try {
      const result = await request('test-probe', $('instagram-tab').value ? { tabId: Number($('instagram-tab').value) } : {});
      lastProbe = result.probe;
      show(result.lines.join('\n'));
      status.textContent = 'page checked. nothing was clicked or typed.';
    } catch (e) { status.textContent = e.message; }
    finally { check.disabled = false; }
  });
  copy.addEventListener('click', async () => {
    try {
      const { text } = await request('test-report', lastProbe ? { probe: lastProbe } : {});
      show(text);
      try { await navigator.clipboard.writeText(text); status.textContent = 'test report copied.'; }
      catch { output.select(); status.textContent = 'select the report below and copy it.'; }
    } catch (e) { status.textContent = e.message; }
  });
}
async function connect() {
  try {
    const hello = await request('hello');
    supportsFocus = hello.supportsFocus === true;
    // Only the side panel's own extension answers here. The hosted page may hear a
    // reply from any extension on its origin, so it ignores the platform list.
    // Builds before the list existed send none and stay on instagram.
    if (inPanel && Array.isArray(hello.platforms) && !hello.platforms.includes(platform)) {
      const offered = hello.platforms.find(name => knownPlatforms.includes(name));
      if (offered) usePlatform(offered);
    }
    if (inPanel && hello.testTools === true) showTestTools();
    error(''); connection(true); render(hello.state); await tabs({ reportError: true });
  }
  catch { connection(false); }
}
setInterval(async () => {
  if (!connected || polling) return;
  polling = true;
  const revision = stateRevision;
  try { const state = await request('state'); if (revision === stateRevision) render(state); if (!running && !busy) await tabs(); } catch { connection(false); $('message').textContent = 'connection lost. the session tab has the latest activity. refresh to reconnect.'; }
  finally { polling = false; }
}, 1500);
setInterval(renderRemaining, 1000);
plan(); connect();
