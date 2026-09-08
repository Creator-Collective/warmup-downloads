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
  for (const field of fields) if (typeof saved[field] === 'string') $(field).value = saved[field];
  $('enable-comments').checked = saved.enableComments === true;
} catch { /* defaults remain usable */ }
function input() {
  return { niche: $('niche').value, minutes: Number($('minutes').value), pace: $('pace').value, enableComments: $('enable-comments').checked,
    mix: Object.fromEntries(['like','follow','comment'].map(name => [name, Number($(`mix-${name}`).value)])),
    customLimits: Object.fromEntries(['like','follow','comment'].filter(name => $(`limit-${name}`).value !== '').map(name => [name, Number($(`limit-${name}`).value)])) };
}
function showError(message) { $('form-error').textContent = message; $('form-error').hidden = !message; }
function error(message) { requestError = message; showError(message); }
function plan() {
  let valid = false;
  try {
    const result = sessionPlan.validateSettings(input());
    for (const action of ['like','follow','comment']) $(`limit-${action}`).placeholder = String(result.limits[action]);
    $('pace-help').textContent = sessionPlan.paces[result.pace].description;
    showError(requestError); valid = true;
  } catch (e) { showError(e.message); }
  validPlan = valid;
  $('limit-comment').disabled = !$('enable-comments').checked;
  $('plan-mode').textContent = ['like','follow','comment'].some(action => $(`limit-${action}`).value !== '') ? 'custom amounts' : 'automatic';
  $('start').disabled = !connected || running || busy || !valid || !$('instagram-tab').value;
  try { localStorage.setItem('cc-web-session', JSON.stringify({ ...Object.fromEntries(fields.map(field => [field, $(field).value])), enableComments: $('enable-comments').checked })); } catch { /* in-memory settings still work */ }
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
  const selected = $('instagram-tab').value;
  const list = await request('tabs');
  $('instagram-tab').replaceChildren(new Option(list.length ? 'choose an instagram tab' : 'open instagram, then refresh', ''), ...list.map((tab, index) => new Option(`${tab.title} · tab ${index + 1}`, String(tab.id))));
  if (list.some(tab => String(tab.id) === selected)) $('instagram-tab').value = selected;
  else if (list.length === 1) $('instagram-tab').value = String(list[0].id);
  plan();
}
function render(state) {
  currentState = state;
  running = state.running;
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
for (const field of fields) $(field).addEventListener('input', edited);
$('enable-comments').addEventListener('change', edited);
$('instagram-tab').addEventListener('change', edited);
$('reset-limits').addEventListener('click', () => { for (const action of ['like','follow','comment']) $(`limit-${action}`).value = ''; plan(); });
$('reset-mix').addEventListener('click', () => { for (const action of ['like','follow','comment']) $(`mix-${action}`).value = action === 'like' ? '2' : '1'; plan(); });
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
