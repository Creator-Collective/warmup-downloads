'use strict';
const $ = id => document.getElementById(id);
const pending = new Map();
const inPanel = location.protocol === 'chrome-extension:' && location.pathname === '/sidepanel.html';
let connected = false;
let running = false;
let busy = false;
let currentState;
let polling = false;
let requestError = '';
let validPlan = false;
const actions = ['like','follow','comment'];
let limitOverrides = {};
let editingLimit = null;
let savedDraft = null;
const fields = ['niche','minutes','pace','mix-like','mix-follow','mix-comment','limit-like','limit-follow','limit-comment'];
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
  for (const field of fields.filter(field => !field.startsWith('limit-'))) if (typeof saved[field] === 'string') $(field).value = saved[field];
  for (const action of actions) {
    const value = saved.version === 2 ? saved.customLimits?.[action] : saved[`limit-${action}`];
    if (typeof value === 'string' && value !== '') limitOverrides[action] = value;
  }
} catch { /* defaults remain usable */ }
const numeric = value => value.trim() === '' ? NaN : Number(value);
function input() {
  return { niche: $('niche').value, minutes: numeric($('minutes').value), pace: $('pace').value, enableComments: true,
    mix: Object.fromEntries(actions.map(name => [name, numeric($(`mix-${name}`).value)])),
    customLimits: Object.fromEntries(Object.entries(limitOverrides).map(([name, value]) => [name, numeric(value)])) };
}
function showError(message) { $('form-error').textContent = message; $('form-error').hidden = !message; }
function error(message) { requestError = message; showError(message); }
function plan() {
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
    showError(requestError); valid = true;
  } catch (e) { showError(editingLimit && $(`limit-${editingLimit}`).value === '' ? requestError : e.message); }
  validPlan = valid;
  $('start').disabled = !connected || running || busy || !valid || !$('instagram-tab').value;
  try { localStorage.setItem('cc-web-session', JSON.stringify({ version: 2, ...Object.fromEntries(fields.filter(field => !field.startsWith('limit-')).map(field => [field, $(field).value])), customLimits: limitOverrides })); } catch { /* in-memory settings still work */ }
}
function connection(value) {
  connected = value;
  $('connection').textContent = value ? (inPanel ? 'connected' : 'extension connected') : 'extension needed';
  $('connection').classList.toggle('connected', value);
  $('setup').hidden = value;
  $('open-instagram').disabled = !value || running;
  $('refresh-tabs').disabled = !value || running;
  plan();
}
async function tabs() {
  const list = await request('tabs');
  const selected = running ? String(currentState.tabId) : $('instagram-tab').value;
  $('instagram-tab').replaceChildren(new Option(list.length ? 'choose an instagram tab' : 'open instagram, then refresh', ''), ...list.map((tab, index) => new Option(`${tab.title} · tab ${index + 1}`, String(tab.id))));
  if (running) selectActiveTab(currentState.tabId);
  else if (list.some(tab => String(tab.id) === selected)) $('instagram-tab').value = selected;
  else if (list.length === 1) $('instagram-tab').value = String(list[0].id);
  plan();
}
function selectActiveTab(tabId) {
  const select = $('instagram-tab');
  const value = String(tabId);
  if (![...select.options].some(option => option.value === value)) select.add(new Option('active instagram tab', value));
  select.value = value;
}
function displayPlan(state) {
  if (state.running && state.settings) {
    if (!savedDraft) savedDraft = { values: Object.fromEntries(fields.map(field => [field, $(field).value])), limits: { ...limitOverrides }, tabId: $('instagram-tab').value };
    editingLimit = null;
    const settings = state.settings;
    $('niche').value = settings.terms.join(', ');
    $('minutes').value = String(settings.minutes);
    $('pace').value = settings.pace;
    for (const action of actions) {
      $(`limit-${action}`).value = String(settings.limits[action]);
      $(`mix-${action}`).value = String(settings.weights[action]);
    }
    selectActiveTab(state.tabId);
  } else if (!state.running && savedDraft) {
    for (const field of fields) $(field).value = savedDraft.values[field];
    limitOverrides = savedDraft.limits;
    $('instagram-tab').value = savedDraft.tabId;
    savedDraft = null;
  }
}
function render(state) {
  currentState = state;
  running = state.running;
  displayPlan(state);
  $('start').hidden = running; $('stop').hidden = !running;
  $('settings').disabled = running || busy;
  $('minutes').disabled = running || busy;
  $('message').textContent = state.message;
  document.body.classList.toggle('running', running);
  $('completed').hidden = !state.activity?.length;
  $('empty-state').hidden = Boolean(state.activity?.length || running);
  for (const name of ['scroll','like','follow','comment']) $(`stat-${name}`).textContent = state.stats?.[name] || 0;
  const key = JSON.stringify(state.activity || []);
  if ($('activity').dataset.key !== key) {
    $('activity').dataset.key = key;
    $('activity').replaceChildren(...(state.activity || []).map(item => { const row = document.createElement('li'); const time = document.createElement('time'); time.textContent = new Date(item.time).toLocaleTimeString([], { hour:'2-digit',minute:'2-digit' }); const text = document.createElement('span'); text.textContent = item.message; row.append(time,text); return row; }));
  }
  plan();
  if (inPanel) $('activity-panel').style.order = running ? '-1' : '';
}
$('session-form').addEventListener('submit', async event => {
  event.preventDefault(); if (running || busy) return;
  try {
    error(''); sessionPlan.validateSettings(input()); busy = true; $('settings').disabled = true; $('minutes').disabled = true; plan();
    render(await request('start', { settings: input(), tabId: Number($('instagram-tab').value) }));
  } catch (e) { error(e.message); }
  finally { busy = false; $('settings').disabled = running; $('minutes').disabled = running; $('start').disabled = !connected || running || !validPlan || !$('instagram-tab').value; }
});
$('session-form').addEventListener('invalid', event => { const details = event.target.closest('details'); if (details) details.open = true; }, true);
function edited() { error(''); plan(); }
for (const field of fields.filter(field => !field.startsWith('limit-'))) $(field).addEventListener('input', edited);
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
$('instagram-tab').addEventListener('change', edited);
$('reset-limits').addEventListener('click', () => { limitOverrides = {}; editingLimit = null; edited(); });
$('reset-mix').addEventListener('click', () => { for (const action of actions) $(`mix-${action}`).value = action === 'like' ? '2' : '1'; edited(); });
$('refresh-tabs').addEventListener('click', () => tabs().catch(e => error(e.message)));
$('open-instagram').addEventListener('click', () => request('open-instagram').then(tabs).catch(e => error(e.message)));
$('stop').addEventListener('click', () => request('stop').then(render).catch(e => error(e.message)));
async function connect() {
  try { const hello = await request('hello'); error(''); connection(true); render(hello.state); await tabs(); }
  catch { connection(false); }
}
setInterval(async () => {
  if (!connected || polling) return;
  polling = true;
  try { render(await request('state')); } catch { connection(false); $('message').textContent = 'connection lost. the session tab has the latest activity. refresh to reconnect.'; }
  finally { polling = false; }
}, 1500);
setInterval(() => {
  if (!currentState?.running) { $('remaining').textContent = ''; return; }
  const seconds = Math.max(0, Math.ceil((currentState.deadline - Date.now()) / 1000));
  $('remaining').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')} left`;
}, 1000);
plan(); connect();
