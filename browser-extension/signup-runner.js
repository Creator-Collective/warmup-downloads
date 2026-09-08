'use strict';
(() => {
  const token = location.hash.slice(1);
  let stopped = false;
  let timer;
  const element = id => document.getElementById(id);
  async function send(type) {
    const response = await chrome.runtime.sendMessage({ type: `signup-runner-${type}`, token });
    if (!response?.ok) throw new Error(response?.error || 'the signup connection closed.');
    return response.data;
  }
  function render(state) {
    element('status').textContent = state.phase;
    element('message').textContent = state.message;
    element('stop').disabled = !state.active;
    if (!state.active) { stopped = true; clearTimeout(timer); }
  }
  function errorState(error) {
    stopped = true; clearTimeout(timer);
    element('status').textContent = 'paused';
    element('message').textContent = error.message || 'signup needs your attention. open its tab.';
  }
  async function poll() {
    if (stopped) return;
    try {
      const state = await send('tick');
      if (stopped) return;
      render(state);
      if (!stopped) timer = setTimeout(poll, state.nextPollMs === 5000 ? 5000 : 1500);
    } catch (error) { errorState(error); void send('stop').catch(() => {}); }
  }
  element('stop').addEventListener('click', () => {
    stopped = true; clearTimeout(timer);
    element('stop').disabled = true;
    element('message').textContent = 'stopping signup…';
    void send('stop').then(render, errorState);
  });
  element('show-signup').addEventListener('click', () => { void send('show').catch(errorState); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') element('stop').click(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' || !changes.signupJob) return;
    const next = changes.signupJob.newValue;
    if (!next || next.token !== token || !['starting', 'running', 'paused'].includes(next.phase)) {
      stopped = true; clearTimeout(timer);
      if (next?.token === token) render({ phase: next.phase, message: next.message, active: false });
    }
  });
  // The background handles ready once. A refreshed runner stops the existing
  // job instead of replaying a submission whose result may have been lost.
  send('ready').then(state => { render(state); if (!stopped) void poll(); }, error => { errorState(error); void send('stop').catch(() => {}); });
})();
